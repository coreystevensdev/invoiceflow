import { describe, it, expect } from "vitest";
import {
  PartialJsonFieldParser,
  STREAMING_FIELD_KEYS,
  STREAMING_SCHEMA_CONSTRAINT,
} from "./claude-stream";
import { InvoiceExtractionSchema } from "./claude";

describe("PartialJsonFieldParser", () => {
  it("emits a field once its value object closes", () => {
    const parser = new PartialJsonFieldParser();
    const results = parser.feed(`{"invoice_number": {"value": "INV-001", "confidence": "high", "reasoning": "Found at top"}`);
    // Not yet closed: the outer object is not closed
    // But the invoice_number value IS closed
    expect(results).toHaveLength(1);
    expect(results[0].field).toBe("invoice_number");
    expect((results[0].value as Record<string, unknown>)["value"]).toBe("INV-001");
  });

  it("does not emit a field until its object is complete", () => {
    const parser = new PartialJsonFieldParser();
    const r1 = parser.feed(`{"invoice_number": {"value": "INV-`);
    expect(r1).toHaveLength(0);
    const r2 = parser.feed(`001", "confidence": "high", "reasoning": "top"}}`);
    expect(r2).toHaveLength(1);
    expect(r2[0].field).toBe("invoice_number");
  });

  it("handles strings with escaped quotes inside values", () => {
    const parser = new PartialJsonFieldParser();
    const json = `{"invoice_number": {"value": "INV \\"quoted\\" 001", "confidence": "high", "reasoning": "found"}}`;
    const results = parser.feed(json);
    expect(results).toHaveLength(1);
    expect((results[0].value as Record<string, unknown>)["value"]).toBe(`INV "quoted" 001`);
  });

  it("does not emit the same field twice", () => {
    const parser = new PartialJsonFieldParser();
    const json = `{"invoice_number": {"value": "INV-001", "confidence": "high", "reasoning": "found"}}`;
    const r1 = parser.feed(json);
    const r2 = parser.feed(json); // feed the same again
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(0); // already emitted
  });

  it("emits multiple fields from one chunk", () => {
    const parser = new PartialJsonFieldParser();
    const json = `{
      "invoice_number": {"value": "INV-001", "confidence": "high", "reasoning": "a"},
      "currency": {"value": "USD", "confidence": "high", "reasoning": "b"}
    }`;
    const results = parser.feed(json);
    expect(results).toHaveLength(2);
    const fields = results.map((r) => r.field);
    expect(fields).toContain("invoice_number");
    expect(fields).toContain("currency");
  });

  it("handles array values (line_items)", () => {
    const parser = new PartialJsonFieldParser();
    const json = `{"line_items": [{"description": "Widget", "quantity": 2, "unit_price": 5.00, "amount": 10.00}]}`;
    const results = parser.feed(json);
    expect(results).toHaveLength(1);
    expect(results[0].field).toBe("line_items");
    expect(Array.isArray(results[0].value)).toBe(true);
  });
});

describe("STREAMING_SCHEMA_CONSTRAINT", () => {
  it("stays in sync with InvoiceExtractionSchema's top-level fields", () => {
    const zodKeys = Object.keys(InvoiceExtractionSchema.shape).sort();
    expect(zodKeys).toEqual([...STREAMING_FIELD_KEYS].sort());
    for (const key of zodKeys) {
      expect(STREAMING_SCHEMA_CONSTRAINT).toContain(`"${key}"`);
    }
  });

  it("embeds a JSON Schema block that parses and matches the current schema shape", () => {
    const jsonStart = STREAMING_SCHEMA_CONSTRAINT.indexOf("{");
    const embedded = JSON.parse(STREAMING_SCHEMA_CONSTRAINT.slice(jsonStart));
    expect(embedded.required.sort()).toEqual(
      Object.keys(InvoiceExtractionSchema.shape).sort(),
    );
  });
});
