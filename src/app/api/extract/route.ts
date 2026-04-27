import { NextRequest, NextResponse } from "next/server";
import {
  extractInvoice,
  type InvoiceExtraction,
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
import { exceedsMonthlyBudget, getMonthlyCumulativeUsd } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 25 * 1024 * 1024;

export interface ExtractResponse {
  correlation_id: string;
  invoice: InvoiceExtraction;
  confidence_summary: ReturnType<typeof confidenceSummary>;
  pdf: {
    num_pages: number;
    size_bytes: number;
  };
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
    };
    if (code === "monthly-budget-exhausted") {
      warnPayload.monthly_cost_usd = getMonthlyCumulativeUsd();
    }
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

  if (exceedsMonthlyBudget()) {
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

  if (file.size > MAX_PDF_BYTES) {
    return respond("oversized-PDF", {
      detected: { size_bytes: file.size, mime: file.type || "unknown" },
    });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const pdfStart = Date.now();
  let pdfResult;
  try {
    pdfResult = await parsePdf(bytes);
  } catch (err) {
    if (err instanceof PdfParseError) {
      return respond(mapPdfError(err.code), {
        detected: err.detected,
        message: err.message,
      });
    }
    logger.error({
      route: "extract",
      category: "corrupt-PDF",
      http_status: 500,
      duration_ms: Date.now() - start,
      note: "unexpected pdf-parse failure",
    });
    return respond("corrupt-PDF");
  }
  const pdfMs = Date.now() - pdfStart;

  logger.info({
    route: "extract",
    category: "pdf-parsed",
    pdf_size_bytes: bytes.length,
    pdf_num_pages: pdfResult.num_pages,
    pdf_mime: file.type || "application/pdf",
    duration_ms: pdfMs,
  });

  try {
    const extraction = await extractInvoice(pdfResult.text, { logger });
    const modelFlags = extraction.invoice.flags;
    const detFlags = deterministicFlags(extraction.invoice);
    const flags = mergeFlags(modelFlags, detFlags);
    const invoice: InvoiceExtraction = { ...extraction.invoice, flags };

    const response: ExtractResponse = {
      correlation_id: correlationId,
      invoice,
      confidence_summary: confidenceSummary(invoice),
      pdf: { num_pages: pdfResult.num_pages, size_bytes: bytes.length },
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
      pdf_num_pages: pdfResult.num_pages,
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
