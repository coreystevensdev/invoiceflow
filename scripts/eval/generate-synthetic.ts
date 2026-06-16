import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const FIXTURES_DIR = path.resolve("scripts/eval/fixtures");

type SyntheticConfig = {
  id: string;
  category: string;
  vendorName: string;
  invoiceNumber: string;
  billDate: string;
  dueDate: string | null;
  poNumber: string | null;
  subtotal: number;
  taxRate: number;
  currency: string;
  lineItems: Array<{ description: string; qty: number; unitPrice: number }>;
  notes?: string;
};

async function generatePdf(config: SyntheticConfig): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const { height } = page.getSize();
  let y = height - 50;

  const line = (text: string, x: number, size = 11, bold = false) => {
    page.drawText(text, { x, y, size, font: bold ? boldFont : font, color: rgb(0, 0, 0) });
    y -= size + 4;
  };

  line("INVOICE", 50, 20, true);
  y -= 4;
  line(config.vendorName, 50, 13, true);
  y -= 10;

  line(`Invoice Number: ${config.invoiceNumber}`, 50);
  line(`Bill Date: ${config.billDate}`, 50);
  if (config.dueDate) line(`Due Date: ${config.dueDate}`, 50);
  if (config.poNumber) line(`PO Number: ${config.poNumber}`, 50);
  line(`Currency: ${config.currency}`, 50);
  y -= 10;

  line("Description", 50, 10, true);
  for (const item of config.lineItems) {
    const amount = item.qty * item.unitPrice;
    line(`${item.description}  ${item.qty} x ${item.unitPrice.toFixed(2)} = ${amount.toFixed(2)}`, 50, 10);
  }
  y -= 5;

  const tax = Math.round(config.subtotal * config.taxRate * 100) / 100;
  const total = Math.round((config.subtotal + tax) * 100) / 100;
  line(`Subtotal: ${config.subtotal.toFixed(2)}`, 350, 11, true);
  line(`Tax (${(config.taxRate * 100).toFixed(0)}%): ${tax.toFixed(2)}`, 350, 11);
  line(`Total: ${total.toFixed(2)}`, 350, 13, true);

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

const CONFIGS: SyntheticConfig[] = [
  {
    id: "s001",
    category: "synthetic",
    vendorName: "CloudCore Inc.",
    invoiceNumber: "CC-2026-0001",
    billDate: "2026-01-10",
    dueDate: "2026-02-10",
    poNumber: "PO-5500",
    subtotal: 3200.00,
    taxRate: 0.08,
    currency: "USD",
    lineItems: [{ description: "Cloud hosting January", qty: 1, unitPrice: 3200.00 }],
    notes: "Standard SaaS invoice, all fields present",
  },
  {
    id: "s002",
    category: "synthetic",
    vendorName: "Metro Electric Co.",
    invoiceNumber: "ME-2026-00442",
    billDate: "2026-02-01",
    dueDate: "2026-02-15",
    poNumber: null,
    subtotal: 487.32,
    taxRate: 0.0,
    currency: "USD",
    lineItems: [{ description: "Electricity January 2026", qty: 1, unitPrice: 487.32 }],
    notes: "Utility invoice, zero tax",
  },
  {
    id: "s003",
    category: "synthetic",
    vendorName: "Pixel and Code Studio",
    invoiceNumber: "PCS-2026-042",
    billDate: "2026-03-15",
    dueDate: "2026-04-14",
    poNumber: "PO-7001",
    subtotal: 8500.00,
    taxRate: 0.085,
    currency: "USD",
    lineItems: [
      { description: "UI/UX design Sprint 4", qty: 40, unitPrice: 125.00 },
      { description: "Frontend development Sprint 4", qty: 40, unitPrice: 87.50 },
    ],
    notes: "Agency invoice, multiple line items",
  },
  {
    id: "s004",
    category: "international",
    vendorName: "Muller Software GmbH",
    invoiceNumber: "2026-DE-0089",
    billDate: "2026-04-01",
    dueDate: "2026-04-30",
    poNumber: null,
    subtotal: 4200.00,
    taxRate: 0.19,
    currency: "EUR",
    lineItems: [{ description: "Software license Q2 2026", qty: 1, unitPrice: 4200.00 }],
    notes: "EUR currency, German vendor name simplified for ASCII PDF",
  },
  {
    id: "s005",
    category: "synthetic",
    vendorName: "Office Planet LLC",
    invoiceNumber: "OP-88012",
    billDate: "2026-01-28",
    dueDate: null,
    poNumber: null,
    subtotal: 245.60,
    taxRate: 0.075,
    currency: "USD",
    lineItems: [
      { description: "Copy paper case", qty: 4, unitPrice: 35.00 },
      { description: "Pens box", qty: 2, unitPrice: 12.80 },
      { description: "Stapler", qty: 1, unitPrice: 115.20 },
    ],
    notes: "No due date, multiple small items",
  },
];

async function main() {
  const [,, countArg] = process.argv;
  const count = countArg ? parseInt(countArg, 10) : CONFIGS.length;

  for (const config of CONFIGS.slice(0, count)) {
    const dir = path.join(FIXTURES_DIR, `${config.id}-${config.category}`);
    fs.mkdirSync(dir, { recursive: true });

    const pdfBytes = await generatePdf(config);
    fs.writeFileSync(path.join(dir, "invoice.pdf"), pdfBytes);

    const tax = Math.round(config.subtotal * config.taxRate * 100) / 100;
    const total = Math.round((config.subtotal + tax) * 100) / 100;

    const expected = {
      invoice_number: config.invoiceNumber,
      vendor_name: config.vendorName,
      bill_date: config.billDate,
      due_date: config.dueDate,
      po_number: config.poNumber,
      subtotal: config.subtotal,
      tax,
      total,
      currency: config.currency,
    };
    fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(expected, null, 2));

    const meta = {
      id: config.id,
      category: config.category,
      source: "synthetic",
      notes: config.notes ?? "",
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    console.log(`Generated ${dir}`);
  }
}

main().catch(console.error);
