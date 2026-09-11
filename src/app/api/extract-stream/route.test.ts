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
  return new NextRequest("http://localhost/api/extract-stream", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/extract-stream pricing pre-check", () => {
  it("returns 502 model-API-failure when CLAUDE_MODEL has no resolved pricing", async () => {
    process.env.CLAUDE_MODEL = "totally-fake-model-2099";
    const response = await POST(buildRequest(new FormData()));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("model-API-failure");
    expect(body.error).toMatch(/pricing is not configured/i);
    expect(body.error).toContain("totally-fake-model-2099");
  });

  it("returns 415 non-PDF when the pdf file field is missing", async () => {
    const response = await POST(buildRequest(new FormData()));
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body.code).toBe("non-PDF");
  });

  it("returns text/event-stream when a valid PDF is provided", async () => {
    const pdfMagicBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const file = new File([pdfMagicBytes], "test.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.append("pdf", file);
    const response = await POST(buildRequest(formData));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  });
});
