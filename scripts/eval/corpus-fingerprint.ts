import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.resolve("scripts/eval/fixtures");

/** Hash of the committed ground truth, so a corpus change is detectable without
 *  calling the model.
 *
 *  The existing drift guard compares README against the committed accuracy table
 *  and deliberately makes no API calls, which means it verifies that two files
 *  agree with each other and not that either describes the fixtures on disk. On
 *  2026-11-12 that gap went live: 35 fixtures had their expected subtotal, tax
 *  and total corrected, and both files stayed green describing a corpus that no
 *  longer existed.
 *
 *  Only expected.json is hashed. invoice.txt and invoice.pdf are generated and
 *  gitignored, so they are not the ground truth and their bytes are not stable
 *  across regenerations. */
export function corpusFingerprint(): string {
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .map((dir) => path.join(FIXTURES_DIR, dir, "expected.json"))
    .filter((f) => fs.existsSync(f))
    .sort();

  if (files.length === 0) throw new Error(`No expected.json under ${FIXTURES_DIR}`);

  const h = crypto.createHash("sha256");
  for (const f of files) {
    // The path is hashed too, so a rename is a corpus change even when every
    // byte of ground truth is identical.
    h.update(path.relative(FIXTURES_DIR, f));
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex").slice(0, 12);
}

if (process.argv[1] && process.argv[1].endsWith("corpus-fingerprint.ts")) {
  process.stdout.write(`${corpusFingerprint()}\n`);
}
