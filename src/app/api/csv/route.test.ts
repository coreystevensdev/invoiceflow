import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import type { InvoiceExtraction } from "@/lib/claude";

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/csv", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const baseField = <T>(value: T) => ({
  value,
  confidence: "high" as const,
  reasoning: "test fixture",
});

function fixture(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    invoice_number: baseField("INV-001"),
    vendor: {
      name: "Acme Co",
      address: "123 Main St",
      confidence: "high",
      reasoning: "test fixture",
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
      },
    ],
    flags: [],
    ...overrides,
  };
}

describe("POST /api/csv", () => {
  it("returns 400 with details when the body is not valid JSON", async () => {
    const response = await POST(buildRequest("{not json"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid request body/i);
    expect(typeof body.correlation_id).toBe("string");
    expect(response.headers.get("X-Correlation-Id")).toBe(body.correlation_id);
  });

  it("returns 400 when invoices array is empty", async () => {
    const response = await POST(buildRequest({ invoices: [] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid request body/i);
  });

  it("returns 400 when an invoice fails schema validation", async () => {
    const broken = fixture();
    const response = await POST(
      buildRequest({
        invoices: [{ ...broken, total: { value: "not a number" } }],
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details).toBeDefined();
  });

  it("returns 400 when invoices array exceeds the 100-row cap", async () => {
    const invoices = Array.from({ length: 101 }, () => fixture());
    const response = await POST(buildRequest({ invoices }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid request body/i);
  });

  it("returns CSV with summary headers and Content-Disposition for the default format", async () => {
    const response = await POST(buildRequest({ invoices: [fixture()] }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/text\/csv/);
    expect(response.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="invoiceflow-summary-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(response.headers.get("X-Correlation-Id")).toMatch(
      /^[0-9a-f-]{36}$/i,
    );

    const csv = await response.text();
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      "invoice_number,vendor_name,vendor_address,bill_date,due_date,po_number,subtotal,tax,total,currency,memo,flags",
    );
    expect(row).toContain("INV-001");
    expect(row).toContain("Acme Co");
    expect(row).toContain("USD");
  });

  it("returns line-item-shaped CSV with one row per line item when format=line_items", async () => {
    const invoice = fixture({
      line_items: [
        { description: "Widget", quantity: 2, unit_price: 50, amount: 100 },
        { description: "Gadget", quantity: 1, unit_price: 10, amount: 10 },
      ],
    });

    const response = await POST(
      buildRequest({ format: "line_items", invoices: [invoice] }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "invoiceflow-line_items-",
    );

    const rows = (await response.text()).split("\r\n");
    expect(rows[0]).toBe(
      "invoice_number,vendor_name,bill_date,due_date,total,currency,line_description,line_quantity,line_unit_price,line_amount",
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("Widget");
    expect(rows[2]).toContain("Gadget");
  });
});
