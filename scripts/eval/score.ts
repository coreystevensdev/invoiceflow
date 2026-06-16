import type { GroundTruth, FieldScore } from "./types";

const NUMERIC_TOLERANCE = 0.01;

export type SimpleScore = { match: boolean; note?: string };

export function scoreStringField(
  actual: string | null,
  expected: string | null,
): SimpleScore {
  // null expected means the fixture didn't specify a value for this field.
  // We don't penalize extracting something when the fixture is silent.
  if (expected === null) return { match: true };
  if (actual === null) return { match: false, note: "actual is null" };
  return {
    match: actual.trim().toLowerCase() === expected.trim().toLowerCase(),
  };
}

// Attempts to parse a date string in several common formats and normalises
// to YYYY-MM-DD. Returns null if unparseable.
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // MM/DD/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  // DD-Mon-YYYY or D-Mon-YYYY
  const dMonY = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dMonY) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const m = months[dMonY[2].toLowerCase()];
    if (m) return `${dMonY[3]}-${m}-${dMonY[1].padStart(2, "0")}`;
  }
  // "Month DD, YYYY"
  const longDate = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (longDate) {
    const months: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04", may: "05",
      june: "06", july: "07", august: "08", september: "09", october: "10",
      november: "11", december: "12",
    };
    const m = months[longDate[1].toLowerCase()];
    if (m) return `${longDate[3]}-${m}-${longDate[2].padStart(2, "0")}`;
  }
  // Fallback: try native Date parsing
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function scoreDateField(
  actual: string | null,
  expected: string | null,
): SimpleScore {
  if (expected === null) return { match: true };
  if (actual === null) return { match: false, note: "actual is null" };
  const normActual = normalizeDate(actual);
  const normExpected = normalizeDate(expected);
  if (!normActual || !normExpected) {
    return { match: false, note: `unparseable date: actual=${actual} expected=${expected}` };
  }
  return { match: normActual === normExpected };
}

export function scoreNumericField(
  actual: number | null,
  expected: number | null,
): SimpleScore {
  if (expected === null) return { match: true };
  if (actual === null) return { match: false, note: "actual is null" };
  return {
    match: Math.abs(actual - expected) <= NUMERIC_TOLERANCE,
    note: Math.abs(actual - expected) > NUMERIC_TOLERANCE
      ? `diff: ${Math.abs(actual - expected).toFixed(4)}`
      : undefined,
  };
}

// Extracts the vendor_name from an InvoiceExtraction-shaped object.
// extractInvoice returns vendor as { name, address, confidence, reasoning }.
export function extractVendorName(invoice: Record<string, unknown>): string | null {
  const vendor = invoice["vendor"] as Record<string, unknown> | undefined;
  if (!vendor) return null;
  const name = vendor["name"];
  return typeof name === "string" ? name : null;
}

// Extract the 9-field GroundTruth from a raw InvoiceExtraction-shaped object.
export function invoiceToGroundTruth(invoice: Record<string, unknown>): GroundTruth {
  function strVal(key: string): string | null {
    const field = invoice[key] as Record<string, unknown> | undefined;
    if (!field) return null;
    const v = field["value"];
    return typeof v === "string" ? v : null;
  }
  function numVal(key: string): number | null {
    const field = invoice[key] as Record<string, unknown> | undefined;
    if (!field) return null;
    const v = field["value"];
    return typeof v === "number" ? v : null;
  }
  return {
    invoice_number: strVal("invoice_number"),
    vendor_name: extractVendorName(invoice),
    bill_date: strVal("bill_date"),
    due_date: strVal("due_date"),
    po_number: strVal("po_number"),
    subtotal: numVal("subtotal"),
    tax: numVal("tax"),
    total: numVal("total"),
    currency: strVal("currency"),
  };
}

// Compare extracted ground truth against expected ground truth.
export function scoreInvoice(
  expected: GroundTruth,
  actual: GroundTruth,
): FieldScore[] {
  const stringFields = [
    "invoice_number",
    "vendor_name",
    "po_number",
    "currency",
  ] as const;
  const dateFields = ["bill_date", "due_date"] as const;
  const numericFields = ["subtotal", "tax", "total"] as const;

  const scores: FieldScore[] = [];

  for (const field of stringFields) {
    const s = scoreStringField(actual[field], expected[field]);
    scores.push({ field, match: s.match, expected: expected[field], actual: actual[field], note: s.note });
  }
  for (const field of dateFields) {
    const s = scoreDateField(actual[field], expected[field]);
    scores.push({ field, match: s.match, expected: expected[field], actual: actual[field], note: s.note });
  }
  for (const field of numericFields) {
    const s = scoreNumericField(actual[field], expected[field]);
    scores.push({ field, match: s.match, expected: expected[field], actual: actual[field], note: s.note });
  }
  return scores;
}
