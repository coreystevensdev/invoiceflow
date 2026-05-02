import { NextRequest, NextResponse } from "next/server";
import {
  extractInvoice,
  type InvoiceExtraction,
  type SupportedImageMediaType,
  type UsageSummary,
} from "@/lib/claude";
import { parsePdf, PdfParseError, type PdfParseErrorCode } from "@/lib/pdf";
import {
  confidenceSummary,
  deterministicFlags,
  mergeFlags,
} from "@/lib/validate";
import {
  ExtractionError,
  toErrorResponse,
  type ExtractionErrorCode,
} from "@/lib/errors";
import { createLogger, type StructuredPayload } from "@/lib/log";
import { clientIpFrom, extractLimit } from "@/lib/rate-limit";
import {
  consumeMonthlyBudgetMisconfig,
  exceedsMonthlyBudget,
  getMonthlyCumulativeUsd,
} from "@/lib/cost";
import {
  CustomFieldsArraySchema,
  type CustomField,
} from "@/lib/custom-fields";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 25 * 1024 * 1024;
// Anthropic vision's per-image limit is 5 MB after base64 encoding. Base64
// inflates raw bytes by ~1.33x, so the equivalent raw cap is ~3.75 MB. Use
// 3.5 MB to leave a small buffer for JSON payload overhead and avoid
// model-API-failure responses on legitimate uploads near the limit.
const MAX_IMAGE_BYTES = Math.floor(3.5 * 1024 * 1024);

const IMAGE_MIME_TYPES: Record<string, SupportedImageMediaType> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

function detectImageMime(
  declaredMime: string,
  bytes: Buffer,
): SupportedImageMediaType | null {
  if (declaredMime in IMAGE_MIME_TYPES) {
    return IMAGE_MIME_TYPES[declaredMime];
  }
  // Magic-number sniffing as a fallback for clients that send octet-stream.
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export interface ExtractResponse {
  correlation_id: string;
  invoice: InvoiceExtraction;
  confidence_summary: ReturnType<typeof confidenceSummary>;
  pdf: {
    num_pages: number;
    size_bytes: number;
  };
  input_type: "pdf" | "image";
  /**
   * True when extraction used Claude vision (image input or scanned-PDF
   * fallback) rather than parsed text. The client uses this to pick the
   * bbox source: vision-derived (from reasoning prefix) vs text-derived
   * (PdfPreview's text-item matching).
   */
  vision_used: boolean;
  usage: UsageSummary;
  duration_ms: {
    pdf_parse: number;
    claude: number;
    total: number;
  };
  model: string;
  cost_usd: number | null;
  retry_count: number;
}

function mapPdfError(code: PdfParseErrorCode): ExtractionErrorCode {
  switch (code) {
    case "empty_file":
      return "corrupt-PDF";
    case "not_a_pdf":
      return "non-PDF";
    case "image_only":
      return "not-an-invoice";
    case "parse_failed":
      return "corrupt-PDF";
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = crypto.randomUUID();
  const logger = createLogger(correlationId);
  const start = Date.now();

  const respond = (
    code: ExtractionErrorCode,
    opts: {
      detected?: Record<string, unknown>;
      message?: string;
      retryAfterSeconds?: number;
    } = {},
  ) => {
    const { body, status, headers } = toErrorResponse({
      code,
      correlationId,
      detected: opts.detected,
      messageOverride: opts.message,
      retryAfterSeconds: opts.retryAfterSeconds,
    });
    const warnPayload: StructuredPayload = {
      route: "extract",
      category: code,
      http_status: status,
      duration_ms: Date.now() - start,
      ...(code === "monthly-budget-exhausted"
        ? { monthly_cost_usd: getMonthlyCumulativeUsd() }
        : {}),
    };
    logger.warn(warnPayload);
    return NextResponse.json(body, { status, headers });
  };

  const ip = clientIpFrom(request.headers);
  const limit = extractLimit(ip);
  if (!limit.ok) {
    return respond("rate-limited", {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  const isMonthlyExhausted = exceedsMonthlyBudget();
  const misconfig = consumeMonthlyBudgetMisconfig();
  if (misconfig) {
    logger.warn({
      route: "extract",
      category: "monthly-budget-misconfig",
      note: `MONTHLY_BUDGET_USD=${JSON.stringify(misconfig.raw)} (${misconfig.reason}); falling back to default`,
    });
  }
  if (isMonthlyExhausted) {
    return respond("monthly-budget-exhausted");
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return respond("non-PDF", {
      message: "Invalid multipart/form-data body.",
    });
  }

  const file = formData.get("pdf");
  if (!(file instanceof File)) {
    return respond("non-PDF", {
      message: "Missing 'pdf' file field.",
    });
  }

  // Optional user-defined custom fields (sent as JSON-stringified
  // multipart form field). Validated against the same schema the client
  // uses for localStorage so the server can't be tricked into building
  // a Zod schema with weird key/value shapes.
  let customFields: CustomField[] = [];
  const customFieldsRaw = formData.get("custom_fields");
  if (typeof customFieldsRaw === "string" && customFieldsRaw.length > 0) {
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(customFieldsRaw);
    } catch {
      return respond("non-PDF", {
        message: "Malformed custom_fields field; expected JSON array.",
      });
    }
    const parseResult = CustomFieldsArraySchema.safeParse(parsedRaw);
    if (!parseResult.success) {
      return respond("non-PDF", {
        message: "Invalid custom_fields shape.",
        detected: { issues: parseResult.error.format() },
      });
    }
    customFields = parseResult.data;
  }

  const declaredMime = (file.type || "").toLowerCase();
  const looksLikePdf =
    declaredMime === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  const bytes = Buffer.from(await file.arrayBuffer());
  const imageMime = looksLikePdf ? null : detectImageMime(declaredMime, bytes);

  if (!looksLikePdf && !imageMime) {
    return respond("non-PDF", {
      detected: { mime: declaredMime || "unknown", size_bytes: file.size },
    });
  }

  const sizeCap = imageMime ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  if (file.size > sizeCap) {
    return respond("oversized-PDF", {
      detected: {
        size_bytes: file.size,
        mime: imageMime ?? declaredMime ?? "unknown",
        cap_bytes: sizeCap,
      },
    });
  }

  let pdfText: string | null = null;
  let pdfNumPages = 1;
  let pdfMs = 0;
  // True when pdf-parse returned empty text and we route the raw PDF
  // through Claude vision instead. Distinct from imageMime (which signals
  // a JPG/PNG/GIF/WebP upload).
  let pdfVisionFallback = false;

  if (!imageMime) {
    const pdfStart = Date.now();
    try {
      const pdfResult = await parsePdf(bytes);
      pdfText = pdfResult.text;
      pdfNumPages = pdfResult.num_pages;
    } catch (err) {
      if (err instanceof PdfParseError) {
        // Scanned / image-only PDFs used to surface as "not-an-invoice".
        // Instead, route the raw PDF bytes through Claude vision so the
        // user gets a successful extraction even without a text layer.
        if (err.code === "image_only") {
          pdfVisionFallback = true;
          const detectedPages = err.detected?.num_pages;
          if (typeof detectedPages === "number") {
            pdfNumPages = detectedPages;
          }
        } else {
          return respond(mapPdfError(err.code), {
            detected: err.detected,
            message: err.message,
          });
        }
      } else {
        logger.error({
          route: "extract",
          category: "corrupt-PDF",
          http_status: 500,
          duration_ms: Date.now() - start,
          note: "unexpected pdf-parse failure",
        });
        return respond("corrupt-PDF");
      }
    }
    pdfMs = Date.now() - pdfStart;
  }

  const visionUsed = imageMime !== null || pdfVisionFallback;

  logger.info({
    route: "extract",
    category: imageMime
      ? "image-received"
      : pdfVisionFallback
        ? "pdf-vision-fallback"
        : "pdf-parsed",
    pdf_size_bytes: bytes.length,
    pdf_num_pages: pdfNumPages,
    pdf_mime: imageMime ?? declaredMime ?? "application/pdf",
    duration_ms: pdfMs,
  });

  try {
    const extraction = await extractInvoice(
      imageMime
        ? { kind: "image", data: bytes, mediaType: imageMime }
        : pdfVisionFallback
          ? { kind: "pdf", data: bytes }
          : { kind: "text", text: pdfText ?? "" },
      { logger, customFields },
    );
    const modelFlags = extraction.invoice.flags;
    const detFlags = deterministicFlags(extraction.invoice);
    const flags = mergeFlags(modelFlags, detFlags);
    const invoice: InvoiceExtraction = { ...extraction.invoice, flags };

    const response: ExtractResponse = {
      correlation_id: correlationId,
      invoice,
      confidence_summary: confidenceSummary(invoice),
      pdf: { num_pages: pdfNumPages, size_bytes: bytes.length },
      input_type: imageMime ? "image" : "pdf",
      vision_used: visionUsed,
      usage: extraction.usage,
      duration_ms: {
        pdf_parse: pdfMs,
        claude: extraction.duration_ms,
        total: Date.now() - start,
      },
      model: extraction.model,
      cost_usd: extraction.cost_usd,
      retry_count: extraction.retry_count,
    };

    logger.info({
      route: "extract",
      category: "ok",
      http_status: 200,
      pdf_size_bytes: bytes.length,
      pdf_num_pages: pdfNumPages,
      duration_ms: Date.now() - start,
      cost_usd: extraction.cost_usd ?? undefined,
      retry_count: extraction.retry_count,
    });

    return NextResponse.json(response, {
      headers: { "X-Correlation-Id": correlationId },
    });
  } catch (err) {
    if (err instanceof ExtractionError) {
      return respond(err.code, { detected: err.detected, message: err.message });
    }
    logger.error({
      route: "extract",
      category: "model-API-failure",
      http_status: 502,
      duration_ms: Date.now() - start,
      note: "unexpected extraction failure",
    });
    return respond("model-API-failure");
  }
}
