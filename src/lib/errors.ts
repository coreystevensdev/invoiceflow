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
  | "cost-budget-exceeded";

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
      title: "That PDF is too large",
      message:
        "We accept PDFs up to 25 MB. Larger files usually contain embedded images that can be compressed.",
      nextStep:
        "Use your PDF viewer's 'Reduce file size' or 'Save as Optimized PDF' option, then upload again.",
    },
    "non-PDF": {
      title: "That file isn't a PDF",
      message:
        "We only process PDF invoices right now. Image files and office documents aren't supported.",
      nextStep:
        "Export or scan your invoice as a PDF, then drop it here.",
    },
    "not-an-invoice": {
      title: "No readable text in this PDF",
      message:
        "The PDF contains no extractable text. It's likely an image-only scan that needs OCR first.",
      nextStep:
        "Run the file through an OCR tool (most scanners and PDF editors can do this), then upload the OCR'd version.",
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
        "If the PDF has many pages, try splitting it. Otherwise retry once — the timeout is often transient.",
    },
    "cost-budget-exceeded": {
      title: "Extraction aborted to protect your budget",
      message:
        "This request's cost exceeded the safety cap (3× the typical extraction cost). We stopped before burning more budget.",
      nextStep:
        "Check whether the PDF is unusually large or complex. If it's legitimate, contact the operator to raise the cap.",
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
