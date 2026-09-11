// Ground truth for one invoice. Only the nine standard fields are scored;
// line items and flags are deliberately excluded -- line item matching is
// too brittle (OCR variation, ordering) and flags are deterministic (we
// test those in src/lib/validate.test.ts already).
export type GroundTruth = {
  invoice_number: string | null;
  vendor_name: string | null;
  bill_date: string | null;   // YYYY-MM-DD or null
  due_date: string | null;    // YYYY-MM-DD or null
  po_number: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;    // ISO 4217 e.g. "USD"
};

export type FixtureMeta = {
  id: string;
  category: string;
  source: string;
  notes?: string;
};

export type Fixture = {
  meta: FixtureMeta;
  expected: GroundTruth;
  pdfPath: string;   // absolute path to invoice.pdf
};

export type FieldScore = {
  field: keyof GroundTruth;
  match: boolean;
  expected: unknown;
  actual: unknown;
  note?: string;
};

export type InvoiceScore = {
  fixture: FixtureMeta;
  fields: FieldScore[];
  // true when every non-null expected field matched
  overallPass: boolean;
  duration_ms: number;
  cost_usd: number | null;
  error?: string;
};

export type EvalSummary = {
  runDate: string;
  model: string;
  totalInvoices: number;
  passedInvoices: number;
  totalFields: number;
  matchedFields: number;
  byField: Record<keyof GroundTruth, { matched: number; total: number }>;
  byCategory: Record<string, { count: number; matched: number; total: number }>;
};
