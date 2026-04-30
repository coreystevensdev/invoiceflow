import { describe, expect, it } from "vitest";
import {
  describeError,
  ExtractionError,
  STATUS_BY_CODE,
  toErrorResponse,
} from "./errors";

describe("describeError", () => {
  it("returns a description for every code in STATUS_BY_CODE", () => {
    for (const code of Object.keys(STATUS_BY_CODE) as Array<
      keyof typeof STATUS_BY_CODE
    >) {
      const desc = describeError(code);
      expect(desc.title).toBeTruthy();
      expect(desc.message).toBeTruthy();
      expect(desc.nextStep).toBeTruthy();
    }
  });
});

describe("toErrorResponse", () => {
  it("builds the correct shape for a typical error", () => {
    const { body, status, headers } = toErrorResponse({
      code: "corrupt-PDF",
      correlationId: "abc-123",
    });
    expect(body.code).toBe("corrupt-PDF");
    expect(body.correlation_id).toBe("abc-123");
    expect(body.error).toContain("PDF");
    expect(status).toBe(STATUS_BY_CODE["corrupt-PDF"]);
    expect(headers["X-Correlation-Id"]).toBe("abc-123");
  });

  it("uses messageOverride when provided", () => {
    const { body } = toErrorResponse({
      code: "non-PDF",
      correlationId: "x",
      messageOverride: "Specific override message.",
    });
    expect(body.error).toBe("Specific override message.");
  });

  it("includes detected metadata when provided", () => {
    const { body } = toErrorResponse({
      code: "oversized-PDF",
      correlationId: "x",
      detected: { size_bytes: 30_000_000 },
    });
    expect(body.detected).toEqual({ size_bytes: 30_000_000 });
  });

  it("omits detected when not provided", () => {
    const { body } = toErrorResponse({
      code: "non-PDF",
      correlationId: "x",
    });
    expect(body.detected).toBeUndefined();
  });

  it("adds Retry-After header for rate-limited responses", () => {
    const { body, headers } = toErrorResponse({
      code: "rate-limited",
      correlationId: "x",
      retryAfterSeconds: 42,
    });
    expect(headers["Retry-After"]).toBe("42");
    expect(body.retry_after_seconds).toBe(42);
  });

  it("maps every code to a 4xx or 5xx status", () => {
    for (const [code, status] of Object.entries(STATUS_BY_CODE)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(code).toBeTruthy();
    }
  });
});

describe("ExtractionError", () => {
  it("captures code and detected on the thrown instance", () => {
    const err = new ExtractionError("extraction-timeout", "Timed out", {
      duration_ms: 95_000,
    });
    expect(err.name).toBe("ExtractionError");
    expect(err.code).toBe("extraction-timeout");
    expect(err.detected).toEqual({ duration_ms: 95_000 });
    expect(err.message).toBe("Timed out");
  });

  it("subclasses Error so instanceof works", () => {
    const err = new ExtractionError("model-API-failure", "boom");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ExtractionError).toBe(true);
  });
});
