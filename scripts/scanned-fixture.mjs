// Generate a scanned-style PDF fixture for testing the OCR fallback path.
// Renders the same synthetic invoice as scripts/sample-pdf.mjs, but pipes
// it through a screenshot-then-rewrap step so the resulting PDF contains
// only a rasterized image (no text layer). pdf-parse returns empty text
// on the result, which is the trigger for the vision-based extraction
// fallback in src/app/api/extract/route.ts.
//
// Output is _fixtures/scanned-invoice.pdf (gitignored). Re-run when the
// invoice content changes:
//   node scripts/scanned-fixture.mjs

import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import pdfParse from "pdf-parse";

const FIXTURE_DIR = join(process.cwd(), "_fixtures");
const OUT = join(FIXTURE_DIR, "scanned-invoice.pdf");

// Same content as scripts/sample-pdf.mjs so the visual rendering matches
// the in-app sample. Synthetic vendor + amounts; no real invoice data.
const HTML = `<!DOCTYPE html>
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

async function main() {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    // Letter size at 96dpi = 816 x 1056. Scale 2x for crisper raster
    // so the embedded image still looks reasonable when Claude vision
    // processes it.
    const ctx = await browser.newContext({
      viewport: { width: 816, height: 1056 },
      deviceScaleFactor: 2,
    });

    const sourcePage = await ctx.newPage();
    await sourcePage.setContent(HTML, { waitUntil: "networkidle" });
    const png = await sourcePage.screenshot({ fullPage: true, type: "png" });
    await sourcePage.close();

    const wrapperHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: Letter; margin: 0; }
      body { margin: 0; padding: 0; }
      img { display: block; width: 100%; }
    </style>
  </head>
  <body>
    <img src="data:image/png;base64,${png.toString("base64")}" />
  </body>
</html>`;

    const wrapperPage = await ctx.newPage();
    await wrapperPage.setContent(wrapperHtml, { waitUntil: "networkidle" });
    const pdfBuffer = await wrapperPage.pdf({
      format: "Letter",
      printBackground: true,
    });
    await writeFile(OUT, pdfBuffer);

    // Verify the produced PDF actually returns empty text. If pdf-parse
    // can extract any text, the fixture won't trigger the OCR fallback
    // and will silently fall through to the digital-PDF code path.
    const parsed = await pdfParse(pdfBuffer);
    const extracted = parsed.text.trim();
    if (extracted.length > 0) {
      console.error(
        `[scanned-fixture] FAIL: pdf-parse returned ${extracted.length} chars of text, ` +
          `which means the fixture will NOT trigger the OCR fallback. ` +
          `First 100 chars: ${JSON.stringify(extracted.slice(0, 100))}`,
      );
      process.exit(1);
    }
    console.log(
      `[scanned-fixture] wrote ${OUT} (${pdfBuffer.byteLength} bytes, ${parsed.numpages} page${parsed.numpages === 1 ? "" : "s"}); ` +
        `pdf-parse text empty: ✓`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[scanned-fixture] failed:", err);
  process.exit(1);
});
