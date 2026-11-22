/**
 * Structured per-request logger. Binds a correlation ID up front so every
 * line from one request shares the same identifier.
 *
 * Invariant: the keys are enumerated, so a caller cannot invent a field for
 * extracted content (invoice fields, PDF text, webhook body) without editing
 * `StructuredPayload` first. `note` is the one free-form value and it is for
 * operator diagnostics, a bad env var or a retry reason; nothing passes
 * extracted content through it and a review should keep it that way.
 *
 * Logs go to `console.*`. In Vercel Fluid Compute they are picked up by
 * the log drain; in local dev they render to the terminal. No external
 * transport is configured on purpose (avoids a dependency for a demo).
 */

export type LogLevel = "info" | "warn" | "error";

export interface StructuredPayload {
  category?: string;
  pdf_size_bytes?: number;
  pdf_num_pages?: number;
  pdf_mime?: string;
  pdf_source?: "digital" | "image";
  duration_ms?: number;
  error_code?: string;
  retry_count?: number;
  http_status?: number;
  cost_usd?: number;
  monthly_cost_usd?: number;
  budget_cap_usd?: number;
  rate_limit_remaining?: number;
  // A character count, not the text. Lets the unparseable-output branch say how
  // much the model produced without putting any of it in a log line.
  output_length?: number;
  route?: string;
  note?: string;
}

export interface Logger {
  info(payload: StructuredPayload): void;
  warn(payload: StructuredPayload): void;
  error(payload: StructuredPayload): void;
}

function emit(
  level: LogLevel,
  correlationId: string,
  payload: StructuredPayload,
): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    correlation_id: correlationId,
    ...payload,
  };
  const write = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  write(JSON.stringify(line));
}

export function createLogger(correlationId: string): Logger {
  return {
    info: (payload) => emit("info", correlationId, payload),
    warn: (payload) => emit("warn", correlationId, payload),
    error: (payload) => emit("error", correlationId, payload),
  };
}
