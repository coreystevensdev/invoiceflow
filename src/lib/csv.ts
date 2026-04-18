import type { InvoiceExtraction } from "./claude";

/**
 * CSV-escape a cell value. Wraps in double quotes when the value contains
 * commas, quotes, newlines, or leading/trailing whitespace; doubles internal
 * quote marks per RFC 4180.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s) || s.trim() !== s) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function flagString(invoice: InvoiceExtraction): string {
  return invoice.flags.map((f) => `${f.severity}: ${f.message}`).join("; ");
}

const SUMMARY_HEADERS = [
  "invoice_number",
  "vendor_name",
  "vendor_address",
  "bill_date",
  "due_date",
  "po_number",
  "subtotal",
  "tax",
  "total",
  "currency",
  "memo",
  "flags",
];

const LINE_ITEM_HEADERS = [
  "invoice_number",
  "vendor_name",
  "bill_date",
  "due_date",
  "total",
  "currency",
  "line_description",
  "line_quantity",
  "line_unit_price",
  "line_amount",
];

/**
 * Format A: one row per invoice. Use when the prospect just wants a list of
 * bills to pay.
 */
export function toSummaryCsv(invoices: InvoiceExtraction[]): string {
  const rows = [toRow(SUMMARY_HEADERS)];
  for (const inv of invoices) {
    const memo = inv.line_items
      .map((li) => li.description)
      .filter(Boolean)
      .join(" | ");
    rows.push(
      toRow([
        inv.invoice_number.value,
        inv.vendor.name,
        inv.vendor.address,
        inv.bill_date.value,
        inv.due_date.value,
        inv.po_number.value,
        inv.subtotal.value,
        inv.tax.value,
        inv.total.value,
        inv.currency.value,
        memo,
        flagString(inv),
      ]),
    );
  }
  return rows.join("\r\n");
}

/**
 * Format B: one row per line item, invoice headers repeated. Use when the
 * prospect wants to categorize individual line items for bookkeeping.
 */
export function toLineItemCsv(invoices: InvoiceExtraction[]): string {
  const rows = [toRow(LINE_ITEM_HEADERS)];
  for (const inv of invoices) {
    if (inv.line_items.length === 0) {
      rows.push(
        toRow([
          inv.invoice_number.value,
          inv.vendor.name,
          inv.bill_date.value,
          inv.due_date.value,
          inv.total.value,
          inv.currency.value,
          null,
          null,
          null,
          null,
        ]),
      );
      continue;
    }
    for (const li of inv.line_items) {
      rows.push(
        toRow([
          inv.invoice_number.value,
          inv.vendor.name,
          inv.bill_date.value,
          inv.due_date.value,
          inv.total.value,
          inv.currency.value,
          li.description,
          li.quantity,
          li.unit_price,
          li.amount,
        ]),
      );
    }
  }
  return rows.join("\r\n");
}

export type CsvFormat = "summary" | "line_items";

export function toCsv(
  invoices: InvoiceExtraction[],
  format: CsvFormat,
): string {
  return format === "summary"
    ? toSummaryCsv(invoices)
    : toLineItemCsv(invoices);
}
