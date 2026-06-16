import { describe, it, expect } from "vitest";
import {
  scoreStringField,
  scoreDateField,
  scoreNumericField,
  scoreInvoice,
} from "./score";
import type { GroundTruth } from "./types";

describe("scoreStringField", () => {
  it("matches exact strings after trim+lowercase", () => {
    expect(scoreStringField("INV-001", "INV-001").match).toBe(true);
    expect(scoreStringField(" INV-001 ", "INV-001").match).toBe(true);
    expect(scoreStringField("inv-001", "INV-001").match).toBe(true);
  });

  it("fails on different strings", () => {
    expect(scoreStringField("INV-001", "INV-002").match).toBe(false);
  });

  it("passes when both are null", () => {
    expect(scoreStringField(null, null).match).toBe(true);
  });

  it("fails when expected is non-null and actual is null", () => {
    expect(scoreStringField(null, "INV-001").match).toBe(false);
  });

  it("passes when expected is null (we don't penalize extracting extra data)", () => {
    expect(scoreStringField("anything", null).match).toBe(true);
  });
});

describe("scoreDateField", () => {
  it("matches ISO 8601 dates", () => {
    expect(scoreDateField("2026-04-15", "2026-04-15").match).toBe(true);
  });

  it("normalizes common date formats", () => {
    expect(scoreDateField("04/15/2026", "2026-04-15").match).toBe(true);
    expect(scoreDateField("April 15, 2026", "2026-04-15").match).toBe(true);
    expect(scoreDateField("15-Apr-2026", "2026-04-15").match).toBe(true);
  });

  it("fails on wrong date", () => {
    expect(scoreDateField("2026-04-16", "2026-04-15").match).toBe(false);
  });
});

describe("scoreNumericField", () => {
  it("matches exactly", () => {
    expect(scoreNumericField(2167.56, 2167.56).match).toBe(true);
  });

  it("matches within $0.01 tolerance", () => {
    expect(scoreNumericField(2167.559, 2167.56).match).toBe(true);
    expect(scoreNumericField(2167.561, 2167.56).match).toBe(true);
  });

  it("fails beyond $0.01 tolerance", () => {
    expect(scoreNumericField(2167.58, 2167.56).match).toBe(false);
  });

  it("passes when both are null", () => {
    expect(scoreNumericField(null, null).match).toBe(true);
  });

  it("passes when expected is null", () => {
    expect(scoreNumericField(100, null).match).toBe(true);
  });
});

describe("scoreInvoice", () => {
  it("produces a pass for a perfect match", () => {
    const expected: GroundTruth = {
      invoice_number: "INV-001",
      vendor_name: "Acme LLC",
      bill_date: "2026-04-15",
      due_date: "2026-05-15",
      po_number: null,
      subtotal: 2007.0,
      tax: 160.56,
      total: 2167.56,
      currency: "USD",
    };
    const extracted: GroundTruth = { ...expected };
    const result = scoreInvoice(expected, extracted);
    expect(result.every((f) => f.match)).toBe(true);
  });

  it("marks individual field failures", () => {
    const expected: GroundTruth = {
      invoice_number: "INV-001",
      vendor_name: "Acme LLC",
      bill_date: "2026-04-15",
      due_date: null,
      po_number: null,
      subtotal: 100.0,
      tax: 10.0,
      total: 110.0,
      currency: "USD",
    };
    const extracted: GroundTruth = {
      ...expected,
      invoice_number: "INV-002",  // wrong
      total: 110.005,             // within $0.01 tolerance -> pass
    };
    const results = scoreInvoice(expected, extracted);
    const byField = Object.fromEntries(results.map((r) => [r.field, r.match]));
    expect(byField["invoice_number"]).toBe(false);
    expect(byField["total"]).toBe(true); // within $0.01
  });
});
