import fs from "node:fs";
import path from "node:path";
import { extractInvoice } from "../../src/lib/claude";
import { parsePdf, PdfParseError } from "../../src/lib/pdf";
import { scoreInvoice, invoiceToGroundTruth } from "./score";
import type { Fixture, InvoiceScore } from "./types";

const FIXTURES_DIR = path.resolve("scripts/eval/fixtures");
const RAW_DIR = path.resolve("eval-results/raw");
const ESTIMATED_COST_PER_INVOICE = 0.025;

function loadFixtures(): Fixture[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  const entries = fs.readdirSync(FIXTURES_DIR, { withFileTypes: true });
  const fixtures: Fixture[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(FIXTURES_DIR, entry.name);
    const pdfPath = path.join(dir, "invoice.pdf");
    const expectedPath = path.join(dir, "expected.json");
    const metaPath = path.join(dir, "meta.json");
    if (
      !fs.existsSync(pdfPath) ||
      !fs.existsSync(expectedPath) ||
      !fs.existsSync(metaPath)
    ) {
      console.warn(`Skipping ${entry.name}: missing invoice.pdf, expected.json, or meta.json`);
      continue;
    }
    fixtures.push({
      meta: JSON.parse(fs.readFileSync(metaPath, "utf-8")),
      expected: JSON.parse(fs.readFileSync(expectedPath, "utf-8")),
      pdfPath,
    });
  }
  return fixtures.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

async function runOne(fixture: Fixture): Promise<InvoiceScore> {
  const start = Date.now();
  const bytes = fs.readFileSync(fixture.pdfPath);

  try {
    let input: Parameters<typeof extractInvoice>[0];
    try {
      const parsed = await parsePdf(bytes);
      input = { kind: "text", text: parsed.text };
    } catch (err) {
      if (err instanceof PdfParseError && err.code === "image_only") {
        input = { kind: "pdf", data: bytes };
      } else {
        throw err;
      }
    }

    const extraction = await extractInvoice(input, {});
    const actualGT = invoiceToGroundTruth(extraction.invoice as unknown as Record<string, unknown>);
    const fields = scoreInvoice(fixture.expected, actualGT);
    const overallPass = fields
      .filter((f) => fixture.expected[f.field] !== null)
      .every((f) => f.match);

    return {
      fixture: fixture.meta,
      fields,
      overallPass,
      duration_ms: Date.now() - start,
      cost_usd: extraction.cost_usd,
    };
  } catch (err) {
    return {
      fixture: fixture.meta,
      fields: [],
      overallPass: false,
      duration_ms: Date.now() - start,
      cost_usd: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and source it.");
    process.exit(1);
  }

  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found in scripts/eval/fixtures/. Add PDFs + expected.json + meta.json.");
    process.exit(1);
  }

  const estimatedCost = fixtures.length * ESTIMATED_COST_PER_INVOICE;
  console.log(`\nFound ${fixtures.length} fixtures. Estimated cost: ~$${estimatedCost.toFixed(2)}`);
  console.log("Starting eval run... (Ctrl-C to abort)\n");

  fs.mkdirSync(RAW_DIR, { recursive: true });

  const results: InvoiceScore[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    process.stdout.write(`[${i + 1}/${fixtures.length}] ${fixture.meta.id} ${fixture.meta.category}... `);
    const score = await runOne(fixture);
    results.push(score);
    const failCount = score.fields.filter((f) => !f.match).length;
    const status = score.error
      ? `ERROR: ${score.error.slice(0, 60)}`
      : score.overallPass
        ? "PASS"
        : `FAIL (${failCount} field${failCount === 1 ? "" : "s"})`;
    console.log(status);

    fs.writeFileSync(
      path.join(RAW_DIR, `${fixture.meta.id}.json`),
      JSON.stringify(score, null, 2),
    );
  }

  fs.writeFileSync(path.join(RAW_DIR, "_results.json"), JSON.stringify(results, null, 2));
  console.log(`\nDone. Raw results written to eval-results/raw/`);
  console.log("Run npm run eval:report to generate accuracy-table.md and failures.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
