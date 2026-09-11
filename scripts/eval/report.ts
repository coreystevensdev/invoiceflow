import fs from "node:fs";
import path from "node:path";
import type { InvoiceScore, EvalSummary, GroundTruth } from "./types";

const RAW_DIR = path.resolve("eval-results/raw");
const OUT_DIR = path.resolve("eval-results");

function loadResults(): InvoiceScore[] {
  const resultsPath = path.join(RAW_DIR, "_results.json");
  if (!fs.existsSync(resultsPath)) {
    console.error("No _results.json found. Run npm run eval first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
}

function buildSummary(results: InvoiceScore[], model: string): EvalSummary {
  const groundTruthFields: (keyof GroundTruth)[] = [
    "invoice_number",
    "vendor_name",
    "bill_date",
    "due_date",
    "po_number",
    "subtotal",
    "tax",
    "total",
    "currency",
  ];

  const byField = Object.fromEntries(
    groundTruthFields.map((f) => [f, { matched: 0, total: 0 }]),
  ) as EvalSummary["byField"];

  const byCategory: EvalSummary["byCategory"] = {};

  let totalFields = 0;
  let matchedFields = 0;

  for (const r of results) {
    if (!byCategory[r.fixture.category]) {
      byCategory[r.fixture.category] = { count: 0, matched: 0, total: 0 };
    }
    byCategory[r.fixture.category].count += 1;

    for (const fieldScore of r.fields) {
      byField[fieldScore.field].total += 1;
      byCategory[r.fixture.category].total += 1;
      totalFields += 1;
      if (fieldScore.match) {
        byField[fieldScore.field].matched += 1;
        byCategory[r.fixture.category].matched += 1;
        matchedFields += 1;
      }
    }
  }

  return {
    runDate: new Date().toISOString().slice(0, 10),
    model,
    totalInvoices: results.length,
    passedInvoices: results.filter((r) => r.overallPass).length,
    totalFields,
    matchedFields,
    byField,
    byCategory,
  };
}

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function writeAccuracyTable(summary: EvalSummary): void {
  const fieldOrder: (keyof GroundTruth)[] = [
    "invoice_number", "vendor_name", "bill_date", "due_date",
    "po_number", "subtotal", "tax", "total", "currency",
  ];

  const lines: string[] = [
    `# InvoiceFlow Eval Results`,
    ``,
    `**Run date:** ${summary.runDate}`,
    `**Model:** ${summary.model}`,
    `**Corpus:** ${summary.totalInvoices} invoices`,
    ``,
    `## Overall`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Invoice pass rate | ${pct(summary.passedInvoices, summary.totalInvoices)} (${summary.passedInvoices}/${summary.totalInvoices}) |`,
    `| Field accuracy | ${pct(summary.matchedFields, summary.totalFields)} (${summary.matchedFields}/${summary.totalFields}) |`,
    ``,
    `## Per-Field Accuracy`,
    ``,
    `| Field | Matched | Total | Accuracy |`,
    `|-------|---------|-------|----------|`,
  ];

  for (const f of fieldOrder) {
    const { matched, total } = summary.byField[f];
    lines.push(`| ${f} | ${matched} | ${total} | ${pct(matched, total)} |`);
  }

  lines.push(
    ``,
    `## Per-Category Accuracy`,
    ``,
    `| Category | Invoices | Field Accuracy |`,
    `|----------|----------|----------------|`,
  );
  for (const [cat, data] of Object.entries(summary.byCategory).sort()) {
    lines.push(`| ${cat} | ${data.count} | ${pct(data.matched, data.total)} |`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "accuracy-table.md"), lines.join("\n") + "\n");
  console.log("Wrote eval-results/accuracy-table.md");
}

function writeFailuresMd(results: InvoiceScore[]): void {
  const failures = results
    .filter((r) => !r.overallPass && !r.error)
    .sort((a, b) => {
      const aFailed = a.fields.filter((f) => !f.match).length;
      const bFailed = b.fields.filter((f) => !f.match).length;
      return bFailed - aFailed;
    })
    .slice(0, 15);

  const errors = results.filter((r) => Boolean(r.error));

  const lines: string[] = [
    `# Eval Failures`,
    ``,
    `Bottom ${failures.length} invoices by failed-field count. Errors (API failures) listed separately.`,
    ``,
    `## Bottom ${failures.length} Failures`,
  ];

  if (failures.length === 0) {
    lines.push(``, `All invoices passed.`);
  }

  for (const r of failures) {
    const failedFields = r.fields.filter((f) => !f.match);
    lines.push(
      ``,
      `### ${r.fixture.id} (${r.fixture.category})`,
      ``,
      `**Source:** ${r.fixture.source}`,
    );
    if (r.fixture.notes) lines.push(`**Notes:** ${r.fixture.notes}`);
    lines.push(`**Failed fields (${failedFields.length}):**`, ``);
    for (const f of failedFields) {
      lines.push(
        `- **${f.field}**: expected \`${JSON.stringify(f.expected)}\`, got \`${JSON.stringify(f.actual)}\`${f.note ? ` (${f.note})` : ""}`,
      );
    }
  }

  if (errors.length > 0) {
    lines.push(``, `## Errors (${errors.length})`, ``);
    for (const r of errors) {
      lines.push(`- **${r.fixture.id}** (${r.fixture.category}): ${r.error}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "failures.md"), lines.join("\n") + "\n");
  console.log("Wrote eval-results/failures.md");
}

function main(): void {
  const results = loadResults();
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
  const summary = buildSummary(results, model);
  writeAccuracyTable(summary);
  writeFailuresMd(results);
  console.log(
    `\nSummary: ${pct(summary.matchedFields, summary.totalFields)} field accuracy across ${summary.totalInvoices} invoices`,
  );
}

main();
