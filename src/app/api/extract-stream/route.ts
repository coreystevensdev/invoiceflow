import { NextRequest } from "next/server";
import {
  getExtractionModel,
  type InvoiceExtraction,
  type SupportedImageMediaType,
} from "@/lib/claude";
import { extractInvoiceStream } from "@/lib/claude-stream";
import { parsePdf, PdfParseError } from "@/lib/pdf";
import { MAX_IMAGE_BYTES, MAX_PDF_BYTES } from "@/lib/limits";
import { confidenceSummary, deterministicFlags, mergeFlags } from "@/lib/validate";
import { toErrorResponse, type ExtractionErrorCode } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { clientIpFrom, extractLimit } from "@/lib/rate-limit";
import {
  consumeModelPricingMisconfig,
  consumeMonthlyBudgetMisconfig,
  exceedsMonthlyBudget,
  getModelPricing,
  getMonthlyCumulativeUsd,
} from "@/lib/cost";
import { CustomFieldsArraySchema, type CustomField } from "@/lib/custom-fields";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  if (declaredMime in IMAGE_MIME_TYPES) return IMAGE_MIME_TYPES[declaredMime];
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return "image/gif";
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
  )
    return "image/webp";
  return null;
}

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const logger = createLogger(correlationId);
  const start = Date.now();
  const encoder = new TextEncoder();

  // Pre-validation guards return non-streaming JSON errors so the client
  // can check response.ok before attempting to read the SSE stream body.
  const ip = clientIpFrom(request.headers);
  const limit = extractLimit(ip);
  if (!limit.ok) {
    const { body, status, headers } = toErrorResponse({
      code: "rate-limited",
      correlationId,
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return Response.json(body, { status, headers });
  }

  const isMonthlyExhausted = exceedsMonthlyBudget();
  const monthlyMisconfig = consumeMonthlyBudgetMisconfig();
  if (monthlyMisconfig) {
    logger.warn({
      route: "extract-stream",
      category: "monthly-budget-misconfig",
      note: `MONTHLY_BUDGET_USD=${JSON.stringify(monthlyMisconfig.raw)} (${monthlyMisconfig.reason}); falling back to default`,
    });
  }
  if (isMonthlyExhausted) {
    logger.warn({
      route: "extract-stream",
      category: "monthly-budget-exhausted",
      monthly_cost_usd: getMonthlyCumulativeUsd(),
    });
    const { body, status, headers } = toErrorResponse({
      code: "monthly-budget-exhausted",
      correlationId,
    });
    return Response.json(body, { status, headers });
  }

  const configuredModel = getExtractionModel();
  const pricingMisconfig = consumeModelPricingMisconfig();
  if (pricingMisconfig) {
    const detailSuffix = pricingMisconfig.detail ? ` ${pricingMisconfig.detail}` : "";
    logger.warn({
      route: "extract-stream",
      category: "model-pricing-misconfig",
      note: `MODEL_PRICING_USD=${JSON.stringify(pricingMisconfig.raw)} (${pricingMisconfig.reason}); falling back to built-in pricing.${detailSuffix}`,
    });
  }
  if (getModelPricing(configuredModel) === null) {
    logger.error({
      route: "extract-stream",
      category: "model-API-failure",
      http_status: 502,
      duration_ms: Date.now() - start,
      note: `pricing not configured for model ${JSON.stringify(configuredModel)}`,
    });
    const { body, status, headers } = toErrorResponse({
      code: "model-API-failure",
      correlationId,
      messageOverride: `Pricing is not configured for model "${configuredModel}". Set CLAUDE_MODEL to a supported model or extend MODEL_PRICING_USD.`,
    });
    return Response.json(body, { status, headers });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    const { body, status, headers } = toErrorResponse({
      code: "non-PDF",
      correlationId,
      messageOverride: "Invalid multipart/form-data body.",
    });
    return Response.json(body, { status, headers });
  }

  const file = formData.get("pdf");
  if (!(file instanceof File)) {
    const { body, status, headers } = toErrorResponse({
      code: "non-PDF",
      correlationId,
      messageOverride: "Missing 'pdf' file field.",
    });
    return Response.json(body, { status, headers });
  }

  let customFields: CustomField[] = [];
  const customFieldsRaw = formData.get("custom_fields");
  if (typeof customFieldsRaw === "string" && customFieldsRaw.length > 0) {
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(customFieldsRaw);
    } catch {
      const { body, status, headers } = toErrorResponse({
        code: "non-PDF",
        correlationId,
        messageOverride: "Malformed custom_fields field; expected JSON array.",
      });
      return Response.json(body, { status, headers });
    }
    const parseResult = CustomFieldsArraySchema.safeParse(parsedRaw);
    if (!parseResult.success) {
      const { body, status, headers } = toErrorResponse({
        code: "non-PDF",
        correlationId,
        messageOverride: "Invalid custom_fields shape.",
      });
      return Response.json(body, { status, headers });
    }
    customFields = parseResult.data;
  }

  const declaredMime = (file.type || "").toLowerCase();
  const looksLikePdf =
    declaredMime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const bytes = Buffer.from(await file.arrayBuffer());
  const imageMime = looksLikePdf ? null : detectImageMime(declaredMime, bytes);

  if (!looksLikePdf && !imageMime) {
    const { body, status, headers } = toErrorResponse({
      code: "non-PDF",
      correlationId,
      detected: { mime: declaredMime || "unknown", size_bytes: file.size },
    });
    return Response.json(body, { status, headers });
  }

  const sizeCap = imageMime ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  if (file.size > sizeCap) {
    const { body, status, headers } = toErrorResponse({
      code: "oversized-PDF",
      correlationId,
      detected: {
        size_bytes: file.size,
        mime: imageMime ?? declaredMime ?? "unknown",
        cap_bytes: sizeCap,
      },
    });
    return Response.json(body, { status, headers });
  }

  // All sync validation passed. Stream SSE events for the remainder.
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(type, data)));
      };

      send("progress", { phase: "parsing", message: "Reading file...", elapsed_ms: 0 });

      let pdfText: string | null = null;
      let pdfNumPages = 1;
      let pdfVisionFallback = false;

      if (!imageMime) {
        try {
          const pdfResult = await parsePdf(bytes);
          pdfText = pdfResult.text;
          pdfNumPages = pdfResult.num_pages;
        } catch (err) {
          if (err instanceof PdfParseError) {
            if (err.code === "image_only") {
              pdfVisionFallback = true;
              const detectedPages = err.detected?.num_pages;
              if (typeof detectedPages === "number") {
                pdfNumPages = detectedPages;
              }
            } else {
              const code: ExtractionErrorCode =
                err.code === "not_a_pdf" ? "non-PDF" : "corrupt-PDF";
              send("error", { code, correlation_id: correlationId });
              controller.close();
              return;
            }
          } else {
            send("error", { code: "corrupt-PDF", correlation_id: correlationId });
            controller.close();
            return;
          }
        }
      }

      const visionUsed = imageMime !== null || pdfVisionFallback;
      const input =
        imageMime !== null
          ? { kind: "image" as const, data: bytes, mediaType: imageMime }
          : pdfVisionFallback
            ? { kind: "pdf" as const, data: bytes }
            : { kind: "text" as const, text: pdfText ?? "" };

      send("progress", {
        phase: "extracting",
        message: "Sending to Claude...",
        elapsed_ms: Date.now() - start,
      });

      for await (const event of extractInvoiceStream(input, { logger, customFields })) {
        if (event.type === "field") {
          send("field", { field: event.field, value: event.value });
        } else if (event.type === "progress") {
          send("progress", {
            phase: event.phase,
            message: event.message,
            elapsed_ms: event.elapsed_ms,
          });
        } else if (event.type === "error") {
          send("error", { code: event.code, correlation_id: correlationId });
          controller.close();
          return;
        } else if (event.type === "complete") {
          const modelFlags = (event.invoice as InvoiceExtraction).flags;
          const detFlags = deterministicFlags(event.invoice as InvoiceExtraction);
          const flags = mergeFlags(modelFlags, detFlags);
          const invoice: InvoiceExtraction = {
            ...(event.invoice as InvoiceExtraction),
            flags,
          };

          logger.info({
            route: "extract-stream",
            category: "ok",
            http_status: 200,
            pdf_size_bytes: bytes.length,
            pdf_num_pages: pdfNumPages,
            duration_ms: Date.now() - start,
            cost_usd: event.cost_usd ?? undefined,
            retry_count: event.retry_count,
          });

          send("complete", {
            correlation_id: correlationId,
            invoice,
            confidence_summary: confidenceSummary(invoice),
            pdf: { num_pages: pdfNumPages, size_bytes: bytes.length },
            input_type: imageMime ? "image" : "pdf",
            vision_used: visionUsed,
            usage: event.usage,
            duration_ms: {
              claude: event.duration_ms,
              total: Date.now() - start,
            },
            model: event.model,
            cost_usd: event.cost_usd,
            retry_count: event.retry_count,
          });
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Correlation-Id": correlationId,
    },
  });
}
