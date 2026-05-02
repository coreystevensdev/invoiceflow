/**
 * Typed error taxonomy for the extraction pipeline and its consumers.
 *
 * Categories are contract-stable strings (kebab-case). They appear in:
 *   - API JSON responses under `code`
 *   - Structured logs under `category`
 *   - The UI ErrorState component via `describeError`
 *
 * Adding a new category means: extend `ExtractionErrorCode`, add a row to
 * `ERROR_DESCRIPTIONS`, and pick an HTTP status in `STATUS_BY_CODE`. The
 * compiler enforces exhaustiveness through the `Record<...>` types.
 */

export type ExtractionErrorCode =
  | "corrupt-PDF"
  | "oversized-PDF"
  | "non-PDF"
  | "not-an-invoice"
  | "model-API-failure"
  | "rate-limited"
  | "extraction-timeout"
  | "cost-budget-exceeded"
  | "monthly-budget-exhausted";

export interface ErrorDescription {
  title: string;
  message: string;
  nextStep: string;
}

export const ERROR_DESCRIPTIONS: Record<ExtractionErrorCode, ErrorDescription> =
  {
    "corrupt-PDF": {
      title: "We couldn't read that PDF",
      message:
        "The file doesn't look like a valid PDF. It may be truncated, password-protected, or saved in an unusual variant.",
      nextStep:
        "Open it in your PDF viewer, re-save as a standard PDF, and try again.",
    },
    "oversized-PDF": {
      title: "That file is too large",
      message:
        "We accept PDFs up to 25 MB and images up to 3.5 MB (Anthropic vision's per-image envelope after base64 encoding). Larger PDFs usually contain embedded images that can be compressed; phone photos may need to be saved at a smaller resolution.",
      nextStep:
        "Compress the PDF (most viewers have a 'Reduce file size' option) or re-save the image at a smaller resolution, then upload again.",
    },
    "non-PDF": {
      title: "That file isn't a supported format",
      message:
        "We accept PDF invoices and image-format invoices (JPG, PNG, GIF, WebP). Office documents (.docx, .xlsx) and other formats aren't supported.",
      nextStep:
        "Export the invoice as a PDF, take a photo of it, or save it as an image, then drop it here.",
    },
    "not-an-invoice": {
      title: "This doesn't look like an invoice",
      message:
        "The file was readable, but the model couldn't find invoice fields. It may be a different kind of document (a manual, a flyer, a receipt fragment) or too low-quality to extract reliably.",
      nextStep:
        "Confirm the file is an invoice and try again. If it's a poor scan, re-scan at higher resolution.",
    },
    "model-API-failure": {
      title: "The extraction model is unavailable",
      message:
        "The language model that reads your invoice returned an error after 2 retries. This is almost always transient.",
      nextStep:
        "Wait a minute and try again. If it persists, the model provider is likely having an incident.",
    },
    "rate-limited": {
      title: "Too many requests",
      message:
        "You've hit the request limit for this IP. This prevents abuse and keeps extraction fast for everyone.",
      nextStep:
        "Wait until the limit window resets, then try again. The response's Retry-After header shows when.",
    },
    "extraction-timeout": {
      title: "The extraction took too long",
      message:
        "The model didn't respond in time. Very long invoices or complex layouts can trip this.",
      nextStep:
        "If the PDF has many pages, try splitting it. Otherwise retry once, the timeout is often transient.",
    },
    "cost-budget-exceeded": {
      title: "Extraction aborted to protect your budget",
      message:
        "This request's cost exceeded the safety cap (3× the typical extraction cost). We stopped before burning more budget.",
      nextStep:
        "Check whether the PDF is unusually large or complex. If it's legitimate, contact the operator to raise the cap.",
    },
    "monthly-budget-exhausted": {
      title: "Free tier exhausted for the month",
      message:
        "InvoiceFlow's free tier is funded by a fixed monthly compute budget. The current month's budget is gone, it resets on the 1st.",
      nextStep:
        "Want unlimited extraction with no monthly ceiling? Tellsight reads spreadsheets the same way and runs on metered billing. Same Claude, same privacy posture.",
    },
  };

export const STATUS_BY_CODE: Record<ExtractionErrorCode, number> = {
  "corrupt-PDF": 422,
  "oversized-PDF": 413,
  "non-PDF": 415,
  "not-an-invoice": 422,
  "model-API-failure": 502,
  "rate-limited": 429,
  "extraction-timeout": 504,
  "cost-budget-exceeded": 429,
  "monthly-budget-exhausted": 429,
};

export function describeError(code: ExtractionErrorCode): ErrorDescription {
  return ERROR_DESCRIPTIONS[code];
}

export interface ExtractionErrorResponse {
  error: string;
  code: ExtractionErrorCode;
  correlation_id: string;
  detected?: Record<string, unknown>;
  retry_after_seconds?: number;
}

export interface ToErrorResponseOptions {
  code: ExtractionErrorCode;
  correlationId: string;
  detected?: Record<string, unknown>;
  retryAfterSeconds?: number;
  messageOverride?: string;
}

/**
 * Build the JSON payload + HTTP status + headers for an error response.
 * Route handlers use the return value directly in `NextResponse.json`.
 */
export function toErrorResponse(opts: ToErrorResponseOptions): {
  body: ExtractionErrorResponse;
  status: number;
  headers: Record<string, string>;
} {
  const description = describeError(opts.code);
  const body: ExtractionErrorResponse = {
    error: opts.messageOverride ?? description.message,
    code: opts.code,
    correlation_id: opts.correlationId,
  };
  if (opts.detected) body.detected = opts.detected;
  if (typeof opts.retryAfterSeconds === "number") {
    body.retry_after_seconds = opts.retryAfterSeconds;
  }
  const headers: Record<string, string> = {
    "X-Correlation-Id": opts.correlationId,
  };
  if (typeof opts.retryAfterSeconds === "number") {
    headers["Retry-After"] = String(opts.retryAfterSeconds);
  }
  return { body, status: STATUS_BY_CODE[opts.code], headers };
}

/**
 * Tagged extraction error. Thrown from lib/claude.ts; routes map to a
 * typed response via `code` without parsing free-form messages.
 */
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly detected?: Record<string, unknown>;

  constructor(
    code: ExtractionErrorCode,
    message: string,
    detected?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
    this.detected = detected;
  }
}
