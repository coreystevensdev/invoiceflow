import fs from "node:fs";
import { extractInvoice } from "../../src/lib/claude";
import { invoiceToGroundTruth } from "./score";

// s074 prints Subtotal 641.60 while its two line items sum to 593.60. Rule 9
// says transcribe the printed figure and raise the mismatch flag, never correct
// it. The eval takes one sample per fixture and temperature is no longer pinned
// (the API refuses it alongside structured output), so a single failure cannot
// distinguish a systematic miss from sampling variance. This samples it N times
// and records the reasoning the model attaches to its own answer.
const N = Number(process.env.N ?? 10);
const EXPECT = process.env.EXPECT ?? "";
const FIXTURE = process.env.FIXTURE ?? "s074-retail";
const text = fs.readFileSync(`scripts/eval/fixtures/${FIXTURE}/invoice.txt`, "utf-8");

async function main() {
  const counts: Record<string, number> = {};
  const reasons: string[] = [];
  let sawMismatchFlag = 0;
  const allFlags: string[] = [];

  for (let i = 0; i < N; i++) {
    const r = await extractInvoice({ kind: "text", text }, {});
    const inv = r.invoice as unknown as Record<string, unknown>;
    const gt = invoiceToGroundTruth(inv);
    const key = String(gt.subtotal);
    counts[key] = (counts[key] ?? 0) + 1;

    const field = inv["subtotal"] as Record<string, unknown> | undefined;
    const reasoning = String(field?.["reasoning"] ?? "");
    if (i < 3 && reasoning) reasons.push(`[${key}] ${reasoning}`);

    // flags live inside parsed_output, i.e. r.invoice.flags. Reading r.flags
    // returned undefined and made every sample look flagless.
    const flagArr = (inv["flags"] as Array<Record<string, unknown>>) ?? [];
    allFlags.push(flagArr.map((f) => `${f.severity}: ${f.message}`).join(" | ") || "(none)");
    if (flagArr.some((f) => /sum|match|subtotal|add up/i.test(String(f.message)))) sawMismatchFlag++;

    process.stdout.write(`  sample ${i + 1}: subtotal=${key}\n`);
  }

  console.log("\n  distribution:");
  for (const [v, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const verdict = EXPECT && v === EXPECT ? "matches expected" : EXPECT ? "differs from expected" : "";
    console.log(`    ${v}  x${n}/${N}  ${verdict}`);
  }
  console.log(`\n  raised a line-items mismatch flag: ${sawMismatchFlag}/${N}`);
  console.log("\n  flags raised, per sample:");
  allFlags.forEach((f, i) => console.log(`    ${i + 1}: ${f}`));
  console.log("\n  the model's own reasoning, first few samples:");
  for (const r of reasons) console.log(`    ${r.slice(0, 220)}`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
