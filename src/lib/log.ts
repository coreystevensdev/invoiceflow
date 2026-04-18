/**
 * Structured per-request logger. Binds a correlation ID up front so every
 * line from one request shares the same identifier.
 *
 * Invariant: loggers never accept free-form strings for payloads. Callers
 * pass a shape via `StructuredPayload`; if the shape contains anything
 * resembling extracted content (invoice fields, PDF text, webhook body),
 * the type system should stop them — the allowed keys are enumerated.
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
  budget_cap_usd?: number;
  rate_limit_remaining?: number;
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
