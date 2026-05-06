import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  resetHistoryForTests,
  resetMonthlyStateForTests,
} from "@/lib/cost";
import { resetForTests as resetRateLimit } from "@/lib/rate-limit";

beforeEach(() => {
  resetHistoryForTests();
  resetMonthlyStateForTests();
  resetRateLimit();
  delete process.env.CLAUDE_MODEL;
  delete process.env.MODEL_PRICING_USD;
  delete process.env.MONTHLY_BUDGET_USD;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-not-real";
});

afterEach(() => {
  delete process.env.CLAUDE_MODEL;
  delete process.env.MODEL_PRICING_USD;
  delete process.env.MONTHLY_BUDGET_USD;
  delete process.env.ANTHROPIC_API_KEY;
});

function buildRequest(formData: FormData): NextRequest {
  return new NextRequest("http://localhost/api/extract", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/extract pricing pre-check", () => {
  it("returns 502 model-API-failure when CLAUDE_MODEL has no resolved pricing", async () => {
    process.env.CLAUDE_MODEL = "totally-fake-model-2099";
    const response = await POST(buildRequest(new FormData()));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("model-API-failure");
    expect(body.error).toMatch(/pricing is not configured/i);
    expect(body.error).toContain("totally-fake-model-2099");
    expect(typeof body.correlation_id).toBe("string");
    expect(response.headers.get("X-Correlation-Id")).toBe(body.correlation_id);
  });

  it("accepts a CLAUDE_MODEL that resolves via MODEL_PRICING_USD override", async () => {
    process.env.CLAUDE_MODEL = "claude-sonnet-5-0";
    process.env.MODEL_PRICING_USD = JSON.stringify({
      "claude-sonnet-5-0": { inputPerMillion: 4, outputPerMillion: 20 },
    });
    // Empty form-data fails the next gate (non-PDF) rather than the
    // pricing pre-check. That gate is the contract we want to confirm:
    // pricing pre-check did not block, and the request advanced.
    const response = await POST(buildRequest(new FormData()));
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body.code).toBe("non-PDF");
  });

  it("falls back to built-in pricing when MODEL_PRICING_USD is malformed JSON", async () => {
    process.env.CLAUDE_MODEL = "claude-sonnet-4-6";
    process.env.MODEL_PRICING_USD = "not json {";
    const response = await POST(buildRequest(new FormData()));
    // Built-in pricing covers claude-sonnet-4-6, so the pre-check passes
    // and the request advances to the next gate (non-PDF on empty form).
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body.code).toBe("non-PDF");
  });
});
