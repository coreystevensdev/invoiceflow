// Copy pdfjs-dist's bundled worker into public/ so PdfPreview can reference
// it at /pdf.worker.min.mjs without inlining a third-party blob in our git
// history. Runs as a postinstall hook so a fresh `npm install` always
// produces the worker; the file itself is gitignored.

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const SRC = join(
  process.cwd(),
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const DEST = join(process.cwd(), "public", "pdf.worker.min.mjs");

async function main() {
  if (!existsSync(SRC)) {
    // pdfjs-dist not yet installed (e.g., partial install). Postinstall
    // will run again once dependencies are present; skip silently.
    console.log("[copy-pdf-worker] pdfjs-dist not present yet, skipping.");
    return;
  }
  await mkdir(dirname(DEST), { recursive: true });
  await copyFile(SRC, DEST);
  console.log(`[copy-pdf-worker] copied ${SRC} -> ${DEST}`);
}

main().catch((err) => {
  console.error("[copy-pdf-worker] failed:", err);
  // Don't fail the install for a worker copy issue; PdfPreview surfaces
  // a graceful error if the worker is missing at runtime.
  process.exit(0);
});
