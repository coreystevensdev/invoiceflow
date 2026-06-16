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
    subtotal: 280.80,
    taxRate: 0.075,
    currency: "USD",
    lineItems: [
      { description: "Copy paper case", qty: 4, unitPrice: 35.00 },
      { description: "Pens box", qty: 2, unitPrice: 12.80 },
      { description: "Stapler", qty: 1, unitPrice: 115.20 },
    ],
    notes: "No due date, multiple small items",
  },
  {
    id: "s006",
    category: "contractor",
    vendorName: "Bright Consulting Group",
    invoiceNumber: "BCG-2026-0312",
    billDate: "2026-05-01",
    dueDate: "2026-05-31",
    poNumber: "PO-9900",
    subtotal: 12500.00,
    taxRate: 0.0,
    currency: "USD",
    lineItems: [{ description: "Strategy consulting May 2026", qty: 50, unitPrice: 250.00 }],
    notes: "Consulting invoice, no tax, large subtotal",
  },
  {
    id: "s007",
    category: "retail",
    vendorName: "Industrial Parts Depot",
    invoiceNumber: "IPD-20260215",
    billDate: "2026-02-15",
    dueDate: "2026-03-17",
    poNumber: "PO-1144",
    subtotal: 634.50,
    taxRate: 0.06,
    currency: "USD",
    lineItems: [
      { description: "Hex bolts M8 box", qty: 3, unitPrice: 45.00 },
      { description: "Steel brackets", qty: 10, unitPrice: 49.95 },
    ],
    notes: "Retail parts invoice",
  },
  {
    id: "s008",
    category: "utilities",
    vendorName: "Pacific Gas and Electric",
    invoiceNumber: "PGE-2026-03-88201",
    billDate: "2026-03-10",
    dueDate: "2026-04-01",
    poNumber: null,
    subtotal: 312.44,
    taxRate: 0.0,
    currency: "USD",
    lineItems: [{ description: "Gas and electricity March 2026", qty: 1, unitPrice: 312.44 }],
    notes: "Utility, zero tax, no PO",
  },
  {
    id: "s009",
    category: "international",
    vendorName: "Tokyo Data Systems Ltd",
    invoiceNumber: "TDS-2026-4421",
    billDate: "2026-01-20",
    dueDate: "2026-02-20",
    poNumber: null,
    subtotal: 580000,
    taxRate: 0.10,
    currency: "JPY",
    lineItems: [{ description: "Data processing services Q1", qty: 1, unitPrice: 580000 }],
    notes: "JPY currency, Japanese vendor, large integer amounts",
  },
  {
    id: "s010",
    category: "synthetic",
    vendorName: "Apex Staffing Solutions",
    invoiceNumber: "ASS-2026-0099",
    billDate: "2026-06-01",
    dueDate: "2026-06-30",
    poNumber: "PO-6600",
    subtotal: 22400.00,
    taxRate: 0.075,
    currency: "USD",
    lineItems: [
      { description: "Contract staff - week 22", qty: 40, unitPrice: 280.00 },
      { description: "Contract staff - week 23", qty: 40, unitPrice: 280.00 },
    ],
    notes: "Staffing invoice, two identical line items",
  },
  {
    id: "s011",
    category: "tech",
    vendorName: "SaaS Platform Inc",
    invoiceNumber: "SP-2026-001122",
    billDate: "2026-04-01",
    dueDate: "2026-05-01",
    poNumber: null,
    subtotal: 499.00,
    taxRate: 0.08875,
    currency: "USD",
    lineItems: [{ description: "Pro plan monthly subscription", qty: 1, unitPrice: 499.00 }],
    notes: "SaaS subscription, NY tax rate 8.875%",
  },
  {
    id: "s012",
    category: "contractor",
    vendorName: "Rivera Design Studio",
    invoiceNumber: "RDS-042",
    billDate: "2026-03-31",
    dueDate: null,
    poNumber: null,
    subtotal: 3750.00,
    taxRate: 0.0,
    currency: "USD",
    lineItems: [{ description: "Brand identity project", qty: 1, unitPrice: 3750.00 }],
    notes: "Freelance design, no due date, no PO, no tax",
  },
  {
    id: "s013",
    category: "international",
    vendorName: "Brightshore Analytics Ltd",
    invoiceNumber: "BA-UK-2026-0041",
    billDate: "2026-02-28",
    dueDate: "2026-03-28",
    poNumber: "PO-UK-100",
    subtotal: 8200.00,
    taxRate: 0.20,
    currency: "GBP",
    lineItems: [{ description: "Analytics platform license Q1", qty: 1, unitPrice: 8200.00 }],
    notes: "GBP currency, UK vendor, 20% VAT",
  },
  {
    id: "s014",
    category: "retail",
    vendorName: "Green Leaf Office Supplies",
    invoiceNumber: "GL-2026-5501",
    billDate: "2026-05-15",
    dueDate: "2026-06-14",
    poNumber: "PO-3310",
    subtotal: 107.81,
    taxRate: 0.065,
    currency: "USD",
    lineItems: [
      { description: "Recycled notebooks 12-pack", qty: 2, unitPrice: 28.90 },
      { description: "Bamboo pens 20-pack", qty: 1, unitPrice: 19.50 },
      { description: "Sticky notes bulk set", qty: 3, unitPrice: 10.17 },
    ],
    notes: "Small retail invoice, many line items",
  },
  {
    id: "s015",
    category: "utilities",
    vendorName: "Clearstream Internet",
    invoiceNumber: "CSI-2026-08811",
    billDate: "2026-04-05",
    dueDate: "2026-04-20",
    poNumber: null,
    subtotal: 189.99,
    taxRate: 0.0,
    currency: "USD",
    lineItems: [{ description: "Business internet April 2026", qty: 1, unitPrice: 189.99 }],
    notes: "ISP invoice, zero tax",
  },
  {
    id: "s016",
    category: "tech",
    vendorName: "SecureVault Backup Co",
    invoiceNumber: "SVB-Q2-2026",
    billDate: "2026-04-01",
    dueDate: "2026-04-30",
    poNumber: "PO-SVBQ2",
    subtotal: 2400.00,
    taxRate: 0.08,
    currency: "USD",
    lineItems: [
      { description: "Cloud backup storage Q2", qty: 1, unitPrice: 1200.00 },
      { description: "Disaster recovery license Q2", qty: 1, unitPrice: 1200.00 },
    ],
    notes: "Quarterly tech invoice, equal line items",
  },
  {
    id: "s017",
    category: "synthetic",
    vendorName: "FastFleet Logistics",
    invoiceNumber: "FFL-2026-3390",
    billDate: "2026-03-20",
    dueDate: "2026-04-19",
    poNumber: null,
    subtotal: 5630.00,
    taxRate: 0.0,
    currency: "USD",
    lineItems: [
      { description: "Freight delivery 03/05 to 03/10", qty: 1, unitPrice: 2100.00 },
      { description: "Freight delivery 03/12 to 03/18", qty: 1, unitPrice: 1980.00 },
      { description: "Expedited shipping surcharge", qty: 1, unitPrice: 1550.00 },
    ],
    notes: "Logistics invoice, date ranges in descriptions",
  },
  {
    id: "s018",
    category: "international",
    vendorName: "MapleTech Solutions Inc",
    invoiceNumber: "MTS-CA-2026-077",
    billDate: "2026-05-10",
    dueDate: "2026-06-09",
    poNumber: "PO-CA-445",
    subtotal: 6800.00,
    taxRate: 0.13,
    currency: "CAD",
    lineItems: [{ description: "Software development retainer May", qty: 1, unitPrice: 6800.00 }],
    notes: "CAD currency, Ontario HST 13%",
  },
  {
    id: "s019",
    category: "contractor",
    vendorName: "Summit Security Consulting",
    invoiceNumber: "SSC-2026-114",
    billDate: "2026-06-15",
    dueDate: "2026-07-15",
    poNumber: "PO-7780",
    subtotal: 18750.00,
    taxRate: 0.0,
    currency: "USD",
    lineItems: [
      { description: "Security audit Phase 1", qty: 1, unitPrice: 9500.00 },
      { description: "Penetration test report", qty: 1, unitPrice: 9250.00 },
    ],
    notes: "Security consulting, two deliverables, no tax",
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
