import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  inquiryLimit,
  resetForTests as resetRateLimit,
} from "@/lib/rate-limit";
import type { InvoiceExtraction } from "@/lib/claude";

const baseField = <T>(value: T) => ({
  value,
  confidence: "high" as const,
  reasoning: "extracted from line 12",
});

function fixtureInvoice(): InvoiceExtraction {
  return {
    invoice_number: baseField("INV-001"),
    vendor: {
      name: "Acme Co",
      address: "123 Main St",
      confidence: "high",
      reasoning: "vendor block at top",
    },
    bill_date: baseField("2026-05-06"),
    due_date: baseField("2026-06-05"),
    po_number: baseField<string | null>(null),
    subtotal: baseField(100),
    tax: baseField(10),
    total: baseField(110),
    currency: baseField("USD"),
    line_items: [
      {
        description: "Widget",
        quantity: 2,
        unit_price: 50,
        amount: 100,
        reasoning: "row 1 of line items",
      },
    ],
    flags: [],
  };
}

function buildRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRateLimit();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("POST /api/webhook rate-limit gate", () => {
  it("returns 429 with retry_after_seconds when the IP bucket is exhausted", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 10; i++) inquiryLimit(ip);

    const response = await POST(
      buildRequest(
        {
          webhook_url: "https://example.com/hook",
          invoice: fixtureInvoice(),
        },
        { "x-forwarded-for": ip },
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = await response.json();
    expect(body.code).toBe("rate-limited");
    expect(typeof body.retry_after_seconds).toBe("number");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhook body validation", () => {
  it("returns 400 invalid-request when the body is not valid JSON", async () => {
    const response = await POST(buildRequest("{not json"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid-request");
    expect(typeof body.correlation_id).toBe("string");
    expect(response.headers.get("X-Correlation-Id")).toBe(body.correlation_id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 invalid-request when webhook_url is not a URL", async () => {
    const response = await POST(
      buildRequest({
        webhook_url: "not-a-url",
        invoice: fixtureInvoice(),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid-request");
    expect(body.details).toBeDefined();
  });
});

describe("POST /api/webhook outbound delivery", () => {
  it("returns 502 webhook-failed when the outbound fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    const response = await POST(
      buildRequest({
        webhook_url: "https://example.com/hook",
        invoice: fixtureInvoice(),
      }),
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("webhook-failed");
    expect(body.error).toMatch(/network down/);
    expect(typeof body.correlation_id).toBe("string");
  });

  it("strips reasoning from the outbound payload by default", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: {} }),
    );

    const response = await POST(
      buildRequest({
        webhook_url: "https://example.com/hook",
        invoice: fixtureInvoice(),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0]!;
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.event).toBe("invoice.extracted");
    expect(sent.invoice.invoice_number).not.toHaveProperty("reasoning");
    expect(sent.invoice.vendor).not.toHaveProperty("reasoning");
    expect(sent.invoice.line_items[0]).not.toHaveProperty("reasoning");
  });

  it("preserves reasoning in the outbound payload when verbose=true", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: {} }),
    );

    const response = await POST(
      buildRequest({
        webhook_url: "https://example.com/hook",
        invoice: fixtureInvoice(),
        verbose: true,
      }),
    );

    expect(response.status).toBe(200);
    const [, init] = fetchSpy.mock.calls[0]!;
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.invoice.invoice_number.reasoning).toBe("extracted from line 12");
    expect(sent.invoice.line_items[0].reasoning).toBe("row 1 of line items");
  });

  it("forwards a supplied idempotency_key as an Idempotency-Key header and a stable payload field", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: {} }),
    );

    const response = await POST(
      buildRequest({
        webhook_url: "https://example.com/hook",
        invoice: fixtureInvoice(),
        idempotency_key: "client-key-abc123",
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("client-key-abc123");

    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.idempotency_key).toBe("client-key-abc123");
  });

  it("omits the Idempotency-Key header when no idempotency_key is supplied", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: {} }),
    );

    await POST(
      buildRequest({
        webhook_url: "https://example.com/hook",
        invoice: fixtureInvoice(),
      }),
    );

    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeUndefined();

    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.idempotency_key).toBeNull();
  });

  it("forwards the upstream status code and a 500-char preview of the response body", async () => {
    const longBody = "x".repeat(800);
    fetchSpy.mockResolvedValueOnce(
      new Response(longBody, { status: 201, headers: {} }),
    );

    const response = await POST(
      buildRequest({
        webhook_url: "https://example.com/hook",
        invoice: fixtureInvoice(),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe(201);
    expect(body.response_preview).toHaveLength(500);
    expect(body.webhook_url).toBe("https://example.com/hook");
  });
});
