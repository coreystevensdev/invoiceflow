import { describe, expect, it } from "vitest";
import type { InvoiceExtraction } from "./claude";
import { toCsv, toLineItemCsv, toSummaryCsv } from "./csv";

function makeInvoice(
  overrides: Partial<InvoiceExtraction> = {},
): InvoiceExtraction {
  const base: InvoiceExtraction = {
    invoice_number: { value: "INV-1", confidence: "high", reasoning: "" },
    vendor: {
      name: "Acme Co",
      address: "1 Main St",
      confidence: "high",
      reasoning: "",
    },
    bill_date: { value: "2026-04-01", confidence: "high", reasoning: "" },
    due_date: { value: "2026-04-30", confidence: "high", reasoning: "" },
    po_number: { value: "PO-9", confidence: "medium", reasoning: "" },
    subtotal: { value: 100, confidence: "high", reasoning: "" },
    tax: { value: 8, confidence: "high", reasoning: "" },
    total: { value: 108, confidence: "high", reasoning: "" },
    currency: { value: "USD", confidence: "high", reasoning: "" },
    line_items: [],
    flags: [],
  };
  return { ...base, ...overrides };
}

describe("toSummaryCsv", () => {
  it("emits header row first", () => {
    const csv = toSummaryCsv([]);
    expect(csv.split("\r\n")[0]).toBe(
      "invoice_number,vendor_name,vendor_address,bill_date,due_date,po_number,subtotal,tax,total,currency,memo,flags",
    );
  });

  it("escapes commas in values per RFC 4180", () => {
    const csv = toSummaryCsv([
      makeInvoice({
        vendor: {
          name: "Smith, Jones & Co",
          address: null,
          confidence: "high",
          reasoning: "",
        },
      }),
    ]);
    expect(csv).toContain('"Smith, Jones & Co"');
  });

  it("doubles quotes inside values per RFC 4180", () => {
    const csv = toSummaryCsv([
      makeInvoice({
        vendor: {
          name: 'The "Big Boss"',
          address: null,
          confidence: "high",
          reasoning: "",
        },
      }),
    ]);
    expect(csv).toContain('"The ""Big Boss"""');
  });

  it("joins line item descriptions into the memo column", () => {
    const csv = toSummaryCsv([
      makeInvoice({
        line_items: [
          { description: "Widget", quantity: 1, unit_price: 50, amount: 50 },
          { description: "Gadget", quantity: 1, unit_price: 50, amount: 50 },
        ],
      }),
    ]);
    expect(csv).toContain("Widget | Gadget");
  });
});

describe("toLineItemCsv", () => {
  it("emits one row per line item", () => {
    const csv = toLineItemCsv([
      makeInvoice({
        line_items: [
          { description: "A", quantity: 1, unit_price: 50, amount: 50 },
          { description: "B", quantity: 1, unit_price: 50, amount: 50 },
        ],
      }),
    ]);
    const dataRows = csv.split("\r\n").slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toContain("A");
    expect(dataRows[1]).toContain("B");
  });

  it("emits a single row with empty line columns when invoice has no items", () => {
    const csv = toLineItemCsv([makeInvoice()]);
    const dataRows = csv.split("\r\n").slice(1);
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0].endsWith(",,,")).toBe(true);
  });

  it("repeats invoice headers across rows for the same invoice", () => {
    const csv = toLineItemCsv([
      makeInvoice({
        line_items: [
          { description: "A", quantity: 1, unit_price: 50, amount: 50 },
          { description: "B", quantity: 1, unit_price: 50, amount: 50 },
        ],
      }),
    ]);
    const dataRows = csv.split("\r\n").slice(1);
    expect(dataRows[0].startsWith("INV-1,Acme Co")).toBe(true);
    expect(dataRows[1].startsWith("INV-1,Acme Co")).toBe(true);
  });
});

describe("toCsv", () => {
  it("dispatches to the summary formatter", () => {
    const csv = toCsv([makeInvoice()], "summary");
    expect(csv.split("\r\n")[0]).toContain("memo");
  });

  it("dispatches to the line-item formatter", () => {
    const csv = toCsv([makeInvoice()], "line_items");
    expect(csv.split("\r\n")[0]).toContain("line_description");
  });
});
