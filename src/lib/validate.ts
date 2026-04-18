import type { InvoiceExtraction, ExtractionFlag } from "./claude";

const MONEY_TOLERANCE = 0.02;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Deterministic cross-field validation. Claude produces its own flags in the
 * extraction response; this function runs an independent pass and merges new
 * findings. Two-pass detection (model + deterministic) is a stronger credibility
 * signal than relying on either alone.
 */
export function deterministicFlags(invoice: InvoiceExtraction): ExtractionFlag[] {
  const flags: ExtractionFlag[] = [];

  const subtotal = invoice.subtotal.value;
  const tax = invoice.tax.value;
  const total = invoice.total.value;
  const billDate = invoice.bill_date.value;
  const dueDate = invoice.due_date.value;

  if (subtotal !== null && tax !== null && total !== null) {
    const computed = round2(subtotal + tax);
    if (Math.abs(computed - total) > MONEY_TOLERANCE) {
      flags.push({
        severity: "error",
        message: `Math doesn't add up: subtotal ($${subtotal.toFixed(2)}) + tax ($${tax.toFixed(2)}) = $${computed.toFixed(2)}, but total is $${total.toFixed(2)}.`,
      });
    }
  }

  if (invoice.line_items.length > 0 && subtotal !== null) {
    const lineSum = invoice.line_items
      .map((li) => li.amount ?? 0)
      .reduce((a, b) => a + b, 0);
    const lineSumRounded = round2(lineSum);
    if (Math.abs(lineSumRounded - subtotal) > MONEY_TOLERANCE) {
      flags.push({
        severity: "warning",
        message: `Line items sum to $${lineSumRounded.toFixed(2)}, but subtotal is $${subtotal.toFixed(2)}.`,
      });
    }
  }

  if (total !== null && total <= 0) {
    flags.push({
      severity: "warning",
      message: `Total is $${total.toFixed(2)} — expected a positive value.`,
    });
  }

  if (billDate && dueDate) {
    const bill = new Date(billDate);
    const due = new Date(dueDate);
    if (!isNaN(bill.getTime()) && !isNaN(due.getTime()) && due < bill) {
      flags.push({
        severity: "error",
        message: `Due date (${dueDate}) is before bill date (${billDate}).`,
      });
    }
  }

  if (billDate) {
    const bill = new Date(billDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!isNaN(bill.getTime()) && bill > today) {
      flags.push({
        severity: "warning",
        message: `Bill date (${billDate}) is in the future.`,
      });
    }
  }

  if (!invoice.vendor.name) {
    flags.push({
      severity: "warning",
      message: "Vendor name could not be extracted.",
    });
  }

  return flags;
}

/**
 * Merge Claude's flags with deterministic flags, de-duplicating by message.
 */
export function mergeFlags(
  modelFlags: ExtractionFlag[],
  detFlags: ExtractionFlag[],
): ExtractionFlag[] {
  const seen = new Set<string>();
  const merged: ExtractionFlag[] = [];
  for (const flag of [...detFlags, ...modelFlags]) {
    const key = `${flag.severity}:${flag.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(flag);
    }
  }
  return merged;
}

export interface ConfidenceSummary {
  high: number;
  medium: number;
  low: number;
}

/**
 * Count per-field confidence levels for webhook consumers and UI summary.
 * Line items are not counted here because they share a single reasoning string.
 */
export function confidenceSummary(invoice: InvoiceExtraction): ConfidenceSummary {
  const summary: ConfidenceSummary = { high: 0, medium: 0, low: 0 };
  const fields = [
    invoice.invoice_number.confidence,
    invoice.vendor.confidence,
    invoice.bill_date.confidence,
    invoice.due_date.confidence,
    invoice.po_number.confidence,
    invoice.subtotal.confidence,
    invoice.tax.confidence,
    invoice.total.confidence,
    invoice.currency.confidence,
  ];
  for (const c of fields) summary[c]++;
  return summary;
}
