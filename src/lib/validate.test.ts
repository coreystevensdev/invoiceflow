import { describe, expect, it } from "vitest";
import type { InvoiceExtraction, ExtractionFlag } from "./claude";
import {
  confidenceSummary,
  deterministicFlags,
  mergeFlags,
} from "./validate";

function makeInvoice(
  overrides: Partial<InvoiceExtraction> = {},
): InvoiceExtraction {
  const base: InvoiceExtraction = {
    invoice_number: { value: "INV-1", confidence: "high", reasoning: "" },
    vendor: {
      name: "Acme Co",
      address: null,
      confidence: "high",
      reasoning: "",
    },
    bill_date: { value: "2026-04-01", confidence: "high", reasoning: "" },
    due_date: { value: "2026-04-30", confidence: "high", reasoning: "" },
    po_number: { value: null, confidence: "low", reasoning: "" },
    subtotal: { value: 100, confidence: "high", reasoning: "" },
    tax: { value: 8, confidence: "high", reasoning: "" },
    total: { value: 108, confidence: "high", reasoning: "" },
    currency: { value: "USD", confidence: "high", reasoning: "" },
    line_items: [],
    flags: [],
  };
  return { ...base, ...overrides };
}

describe("deterministicFlags", () => {
  it("produces no flags on a clean invoice", () => {
    expect(deterministicFlags(makeInvoice())).toEqual([]);
  });

  it("flags subtotal + tax not equal to total", () => {
    const invoice = makeInvoice({
      total: { value: 200, confidence: "high", reasoning: "" },
    });
    const flags = deterministicFlags(invoice);
    expect(flags.some((f) => f.severity === "error")).toBe(true);
    expect(flags[0].message).toContain("subtotal");
  });

  it("tolerates a $0.02 rounding gap on subtotal + tax", () => {
    const invoice = makeInvoice({
      subtotal: { value: 100.0, confidence: "high", reasoning: "" },
      tax: { value: 8.0, confidence: "high", reasoning: "" },
      total: { value: 108.01, confidence: "high", reasoning: "" },
    });
    expect(deterministicFlags(invoice)).toEqual([]);
  });

  it("flags line items not summing to subtotal", () => {
    const invoice = makeInvoice({
      line_items: [
        { description: "X", quantity: 1, unit_price: 30, amount: 30 },
        { description: "Y", quantity: 1, unit_price: 30, amount: 30 },
      ],
    });
    const flags = deterministicFlags(invoice);
    expect(flags.some((f) => f.message.includes("Line items"))).toBe(true);
  });

  it("flags non-positive totals", () => {
    const invoice = makeInvoice({
      subtotal: { value: 0, confidence: "high", reasoning: "" },
      tax: { value: 0, confidence: "high", reasoning: "" },
      total: { value: 0, confidence: "high", reasoning: "" },
    });
    const flags = deterministicFlags(invoice);
    expect(flags.some((f) => f.message.includes("expected a positive"))).toBe(
      true,
    );
  });

  it("flags due date before bill date as an error", () => {
    const invoice = makeInvoice({
      bill_date: { value: "2026-04-30", confidence: "high", reasoning: "" },
      due_date: { value: "2026-04-01", confidence: "high", reasoning: "" },
    });
    const flags = deterministicFlags(invoice);
    expect(flags.some((f) => f.severity === "error" && f.message.includes("before"))).toBe(true);
  });

  it("flags bill date in the future as a warning", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    const invoice = makeInvoice({
      bill_date: {
        value: future.toISOString().slice(0, 10),
        confidence: "high",
        reasoning: "",
      },
      due_date: { value: null, confidence: "low", reasoning: "" },
    });
    const flags = deterministicFlags(invoice);
    expect(flags.some((f) => f.message.includes("future"))).toBe(true);
  });

  it("flags missing vendor name", () => {
    const invoice = makeInvoice({
      vendor: { name: null, address: null, confidence: "low", reasoning: "" },
    });
    const flags = deterministicFlags(invoice);
    expect(flags.some((f) => f.message.includes("Vendor"))).toBe(true);
  });
});

describe("the s074 shape: printed arithmetic correct, line items disagreeing", () => {
  // The prompt used to ask the model to check these conditions too, so a user
  // saw the same finding twice in different words, plus a fabricated error
  // reading "Subtotal + Tax does not equal Total: 641.60 + 41.70 = 683.30,
  // which matches the printed Total of 683.30". The model no longer checks
  // computable conditions, which means this is the only source of the warning
  // and it has to keep firing.
  const s074 = () =>
    makeInvoice({
      subtotal: { value: 641.6, confidence: "high", reasoning: "" },
      tax: { value: 41.7, confidence: "high", reasoning: "" },
      total: { value: 683.3, confidence: "high", reasoning: "" },
      line_items: [
        {
          description: "Copy paper 20lb 8.5x11 5-ream case",
          quantity: 8,
          unit_price: 64,
          amount: 512,
        },
        {
          description: "Legal pads yellow 12-pack",
          quantity: 5,
          unit_price: 16.32,
          amount: 81.6,
        },
      ],
    });

  it("warns that line items do not sum to the subtotal", () => {
    const flags = deterministicFlags(s074());
    const warnings = flags.filter((f) => f.severity === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("593.60");
    expect(warnings[0]!.message).toContain("641.60");
  });

  it("raises no error, because subtotal plus tax does equal the printed total", () => {
    // 641.60 + 41.70 = 683.30 exactly. An error here is the false positive the
    // model used to invent.
    expect(deterministicFlags(s074()).filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("mergeFlags drops model flags for conditions the code owns", () => {
  // Verbatim from a real run before the prompt stopped asking the model to check
  // these. The deterministic message and the model message describe the same
  // finding in different words, so the old exact-string dedupe kept both.
  const detLineItems: ExtractionFlag = {
    message: "Line items sum to $593.60, but subtotal is $641.60.",
    severity: "warning",
  };
  const modelLineItems: ExtractionFlag = {
    message:
      "Line items sum (512.00 + 81.60 = 593.60) does not match the printed subtotal of 641.60. Discrepancy of $48.00.",
    severity: "warning",
  };
  // The fabricated one: severity error, and the message says the condition holds.
  const modelFalseError: ExtractionFlag = {
    message:
      "Subtotal + Tax does not equal Total: 641.60 + 41.70 = 683.30, which matches the printed Total of 683.30.",
    severity: "error",
  };

  it("keeps one line-items finding, not two", () => {
    const merged = mergeFlags([modelLineItems], [detLineItems]);
    expect(merged).toEqual([detLineItems]);
  });

  it("drops a model flag for a computed condition even when the code raised none", () => {
    // s074's printed arithmetic is correct, so deterministicFlags raises no
    // error here. The code evaluated the condition and said no; the model's
    // contradiction of that is not information.
    expect(mergeFlags([modelFalseError], [detLineItems])).toEqual([detLineItems]);
  });

  it("keeps a model flag the code cannot compute", () => {
    const illegible: ExtractionFlag = {
      message: "The tax figure is smudged; 41.70 is a best reading of the printed digits.",
      severity: "warning",
    };
    expect(mergeFlags([illegible], [detLineItems])).toEqual([detLineItems, illegible]);
  });

  it("keeps an unclassifiable model flag rather than silencing it", () => {
    const novel: ExtractionFlag = {
      message: "Two different PO numbers appear in the header and the footer.",
      severity: "warning",
    };
    expect(mergeFlags([novel], [])).toEqual([novel]);
  });
});

describe("mergeFlags", () => {
  it("dedupes by severity + message", () => {
    const a: ExtractionFlag[] = [{ severity: "warning", message: "X" }];
    const b: ExtractionFlag[] = [
      { severity: "warning", message: "X" },
      { severity: "error", message: "Y" },
    ];
    expect(mergeFlags(a, b)).toHaveLength(2);
  });

  it("treats same message at different severities as distinct", () => {
    const a: ExtractionFlag[] = [{ severity: "warning", message: "X" }];
    const b: ExtractionFlag[] = [{ severity: "error", message: "X" }];
    expect(mergeFlags(a, b)).toHaveLength(2);
  });

  it("places deterministic flags first in merge order", () => {
    const model: ExtractionFlag[] = [{ severity: "info", message: "model" }];
    const det: ExtractionFlag[] = [{ severity: "info", message: "det" }];
    const merged = mergeFlags(model, det);
    expect(merged[0].message).toBe("det");
  });
});

describe("confidenceSummary", () => {
  it("counts the nine top-level fields by confidence", () => {
    const invoice = makeInvoice({
      invoice_number: { value: "X", confidence: "low", reasoning: "" },
      po_number: { value: null, confidence: "low", reasoning: "" },
      currency: { value: "USD", confidence: "medium", reasoning: "" },
    });
    const summary = confidenceSummary(invoice);
    expect(summary.high).toBe(6);
    expect(summary.medium).toBe(1);
    expect(summary.low).toBe(2);
  });
});
