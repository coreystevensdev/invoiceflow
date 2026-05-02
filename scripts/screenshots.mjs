// One-shot screenshot capture for the README. Drives a headless Chromium
// against the live demo (or SCREENSHOT_URL override), generates a synthetic
// invoice PDF on the fly via Playwright's page.pdf() so no fixture lives
// in the repo, and writes the four reference images to public/screenshots/.
//
// Re-run when the UI changes substantially:
//   node scripts/screenshots.mjs
//
// Optional override for local dev capture:
//   SCREENSHOT_URL=http://localhost:3000 node scripts/screenshots.mjs

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.SCREENSHOT_URL ?? "https://invoiceflow-cs.vercel.app";
const OUT = join(process.cwd(), "public", "screenshots");
const VIEWPORT = { width: 1440, height: 900 };

const INVOICE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 56px; color: #111; font-size: 13px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; margin-bottom: 48px; }
    .invoice-num { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
    .meta { color: #555; margin-top: 8px; }
    .vendor { text-align: right; }
    .vendor strong { font-size: 15px; color: #000; }
    .bill-to { margin-bottom: 32px; }
    .bill-to .label { color: #555; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { background: #f5f5f5; padding: 12px; text-align: left; border-bottom: 1px solid #ddd; font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid #eee; }
    .num { text-align: right; }
    .totals { margin-top: 24px; margin-left: auto; width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; }
    .totals-row.total { font-size: 17px; font-weight: 700; border-top: 2px solid #111; margin-top: 8px; padding-top: 12px; }
    .terms { margin-top: 56px; font-size: 11px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="invoice-num">INVOICE #INV-2026-0042</div>
      <div class="meta">Issue Date: April 15, 2026</div>
      <div class="meta">Due Date: May 15, 2026</div>
    </div>
    <div class="vendor">
      <strong>Acme Office Supplies, LLC</strong><br>
      123 Industrial Way<br>
      Philadelphia, PA 19103<br>
      billing@acme-office.example
    </div>
  </div>

  <div class="bill-to">
    <div class="label">Bill To</div>
    <div><strong>Tellsight Holdings, LLC</strong></div>
    <div>456 Market Street, Floor 9</div>
    <div>Philadelphia, PA 19107</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Standing desk, oak finish</td><td class="num">2</td><td class="num">$549.00</td><td class="num">$1,098.00</td></tr>
      <tr><td>Ergonomic mesh task chair</td><td class="num">2</td><td class="num">$329.00</td><td class="num">$658.00</td></tr>
      <tr><td>Dual monitor arm</td><td class="num">1</td><td class="num">$179.00</td><td class="num">$179.00</td></tr>
      <tr><td>Cable management kit</td><td class="num">3</td><td class="num">$24.00</td><td class="num">$72.00</td></tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span>Subtotal</span><span>$2,007.00</span></div>
    <div class="totals-row"><span>Tax (8.0%)</span><span>$160.56</span></div>
    <div class="totals-row total"><span>Total</span><span>$2,167.56</span></div>
  </div>

  <div class="terms">Payment terms: Net 30. Late fees of 1.5%/month apply to past due balances.</div>
</body>
</html>`;

async function generateInvoicePdf(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent(INVOICE_HTML, { waitUntil: "networkidle" });
  const buffer = await page.pdf({ format: "Letter", printBackground: true });
  await ctx.close();
  return buffer;
}

async function generateInvoiceImage(browser) {
  // Render the same synthetic invoice as a PNG image at Letter aspect ratio.
  const ctx = await browser.newContext({
    viewport: { width: 850, height: 1100 },
  });
  const page = await ctx.newPage();
  await page.setContent(INVOICE_HTML, { waitUntil: "networkidle" });
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  await ctx.close();
  return buffer;
}

async function captureLanding(page) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(OUT, "landing.png") });
  console.log("[screenshot] landing.png");
}

async function captureExtraction(page, pdfBuffer) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.setInputFiles("#pdf-input", {
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });
  await page.waitForSelector('section[aria-label="Extraction results"]', { timeout: 90_000 });
  // Wait for PDF.js to lazy-load, fetch the blob, render to canvas, and
  // extract text positions for the bbox map.
  await page.waitForTimeout(4_500);
  // Hover a money field whose value reliably appears verbatim in the PDF
  // text so the bbox highlight is visible in the capture.
  const totalBtn = page.locator('button[aria-label^="Total,"]').first();
  if (await totalBtn.count()) {
    await totalBtn.hover();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: join(OUT, "extract-success.png") });
  console.log("[screenshot] extract-success.png");
}

async function captureImageHighlight(browser, imageBuffer) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.setInputFiles("#pdf-input", {
    name: "invoice.png",
    mimeType: "image/png",
    buffer: imageBuffer,
  });
  await page.waitForSelector('section[aria-label="Extraction results"]', {
    timeout: 90_000,
  });
  // Wait for the image to load and bbox-aware extraction to settle.
  await page.waitForTimeout(2_000);
  // Hover the Vendor field so the source bbox highlight shows in the capture.
  const vendorField = page.locator("div.group").nth(1);
  await vendorField.hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "extract-highlight.png") });
  console.log("[screenshot] extract-highlight.png");
  await ctx.close();
}

async function captureJsonView(page) {
  // Same page, click the JSON tab and capture the response panel.
  const jsonTab = page.getByRole("tab", { name: "JSON" });
  await jsonTab.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "extract-json.png") });
  console.log("[screenshot] extract-json.png");
  // Reset to Fields tab so subsequent CSV shot keeps the standard view.
  await page.getByRole("tab", { name: "Fields" }).click();
  await page.waitForTimeout(200);
}

async function captureCsvExport(page) {
  // Same page, with extraction state still rendered.
  const csvBtn = page.getByRole("button", { name: /download summary csv/i }).first();
  await csvBtn.scrollIntoViewIfNeeded();
  await csvBtn.hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, "csv-export.png") });
  console.log("[screenshot] csv-export.png");
}

async function captureError(page) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.setInputFiles("#pdf-input", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("this is not a pdf"),
  });
  // Error UI renders client-side from a typed-error code.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "error-state.png") });
  console.log("[screenshot] error-state.png");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`[screenshot] target: ${BASE}`);
  console.log(`[screenshot] output: ${OUT}`);
  // Use the system Chrome channel so the iframe-rendered PDF appears in
  // captures. Headless Chromium ships without the PDF viewer and renders
  // the iframe blank; real Chrome has it.
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const pdfBuffer = await generateInvoicePdf(browser);
    console.log(`[screenshot] synthetic invoice PDF: ${pdfBuffer.byteLength} bytes`);
    const imageBuffer = await generateInvoiceImage(browser);
    console.log(`[screenshot] synthetic invoice PNG: ${imageBuffer.byteLength} bytes`);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await captureLanding(page);
    await captureExtraction(page, pdfBuffer);
    await captureJsonView(page);
    await captureCsvExport(page);
    await captureError(page);
    await ctx.close();
    await captureImageHighlight(browser, imageBuffer);
  } finally {
    await browser.close();
  }
  console.log("[screenshot] done.");
}

main().catch((err) => {
  console.error("[screenshot] failed:", err);
  process.exit(1);
});
