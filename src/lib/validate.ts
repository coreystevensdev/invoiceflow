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
      message: `Total is $${total.toFixed(2)}, expected a positive value.`,
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
// The conditions this module computes. The prompt tells the model not to check
// them, but a prompt is a request and this is the check: a model flag classified
// into a condition the code already owns is dropped, whether or not the code
// raised one. If the code evaluated the condition, the code's verdict stands.
type FlagCondition =
  | "subtotal_plus_tax_vs_total"
  | "line_items_vs_subtotal"
  | "non_positive_total"
  | "due_before_bill"
  | "future_bill_date"
  | "missing_vendor";

// Deliberately conservative. A model flag only classifies when its wording is
// unambiguous about which computed condition it concerns; anything else stays,
// because silencing a genuine observation the code cannot make is the worse
// error. Order matters: line-items wording is checked before the subtotal/total
// wording, since a message can mention both and the more specific one wins.
const MODEL_FLAG_PATTERNS: ReadonlyArray<readonly [FlagCondition, RegExp]> = [
  ["line_items_vs_subtotal", /line[- ]?items?[\s\S]{0,20}(sum|total)[\s\S]{0,80}subtotal|subtotal[\s\S]{0,80}line[- ]?items?/i],
  ["subtotal_plus_tax_vs_total", /subtotal[\s\S]{0,20}\+[\s\S]{0,20}tax|add(s)? up|does not equal total/i],
  ["due_before_bill", /due date[\s\S]{0,40}before[\s\S]{0,40}bill date/i],
  ["future_bill_date", /bill date[\s\S]{0,40}(future|after today)/i],
  ["non_positive_total", /total is (0|zero|negative|\$?-)/i],
  ["missing_vendor", /vendor name (is )?(missing|absent|not)/i],
];

function classifyModelFlag(message: string): FlagCondition | null {
  for (const [condition, pattern] of MODEL_FLAG_PATTERNS) {
    if (pattern.test(message)) return condition;
  }
  return null;
}

/** Conditions this module evaluates, independent of whether any fired. */
const COMPUTED_CONDITIONS: ReadonlySet<FlagCondition> = new Set<FlagCondition>([
  "subtotal_plus_tax_vs_total",
  "line_items_vs_subtotal",
  "non_positive_total",
  "due_before_bill",
  "future_bill_date",
  "missing_vendor",
]);

export function mergeFlags(
  modelFlags: ExtractionFlag[],
  detFlags: ExtractionFlag[],
): ExtractionFlag[] {
  const seen = new Set<string>();
  const merged: ExtractionFlag[] = [];

  for (const flag of detFlags) {
    const key = `${flag.severity}:${flag.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(flag);
    }
  }

  for (const flag of modelFlags) {
    // Exact-string dedupe alone never fired across sources: the code's message
    // is fixed and the model's is prose, so both survived and a user saw one
    // finding twice in different words.
    const condition = classifyModelFlag(flag.message);
    if (condition && COMPUTED_CONDITIONS.has(condition)) continue;

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
