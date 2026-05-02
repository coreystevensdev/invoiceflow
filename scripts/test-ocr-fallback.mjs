// End-to-end smoke test for the OCR fallback path.
//
// POSTs the scanned-invoice fixture (image-only PDF, no text layer) to a
// running InvoiceFlow dev server and asserts the response shape. Confirms
// that pdf-parse returning empty text triggers the Claude vision fallback
// rather than the legacy "not-an-invoice" error.
//
// Prerequisites:
//   1. Generate the fixture: node scripts/scanned-fixture.mjs
//   2. Start the dev server: npm run dev (with ANTHROPIC_API_KEY set)
//   3. Run this:             node scripts/test-ocr-fallback.mjs
//
// Cost: each run is one Claude vision call (~$0.02 with Sonnet 4.6).
// Override the target with INVOICE_FLOW_URL to point at a non-local deploy.
//
// Exit codes: 0 = all checks passed, 1 = any check failed or fixture
// missing or server unreachable.
//
// If every check fails with HTTP 404 (or 502 with "Server action not
// found" / "ANTHROPIC_API_KEY is not set"), the dev server is in one of
// two known broken states:
//   1. Stale Turbopack cache. Stop the server, `rm -rf .next`, restart.
//   2. Missing API key. Run `vercel env pull .env.local --environment=production`
//      and (because Vercel marks production secrets as Sensitive and
//      can't return them through the CLI) paste the ANTHROPIC_API_KEY
//      into .env.local manually before restarting the dev server.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TARGET_URL = process.env.INVOICE_FLOW_URL ?? "http://localhost:3000";
const FIXTURE = join(process.cwd(), "_fixtures", "scanned-invoice.pdf");

// ANSI color codes — no dependency, terminal-only output.
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let failures = 0;

/**
 * Run a single assertion. The predicate returns true (pass), or a string
 * (fail with that message). Throwing also counts as fail.
 */
function check(label, predicate) {
  try {
    const result = predicate();
    if (result === true || result === undefined) {
      console.log(`  ${GREEN}✓${RESET} ${label}`);
    } else {
      console.log(`  ${RED}✗${RESET} ${label}${DIM} — ${result}${RESET}`);
      failures++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${RED}✗${RESET} ${label}${DIM} — threw: ${msg}${RESET}`);
    failures++;
  }
}

const isUuid = (s) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

async function main() {
  console.log(`${BOLD}OCR fallback E2E${RESET}`);
  console.log(`${DIM}endpoint:${RESET} ${TARGET_URL}/api/extract`);
  console.log(`${DIM}fixture: ${RESET}${FIXTURE}`);
  console.log();

  let pdfBuf;
  try {
    pdfBuf = await readFile(FIXTURE);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}fixture not found:${RESET} ${msg}`);
    console.error(`${DIM}generate it first:${RESET} node scripts/scanned-fixture.mjs`);
    process.exit(1);
  }

  const form = new FormData();
  form.append(
    "pdf",
    new File([pdfBuf], "scanned-invoice.pdf", { type: "application/pdf" }),
  );

  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(`${TARGET_URL}/api/extract`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}could not reach ${TARGET_URL}${RESET}: ${msg}`);
    console.error(`${DIM}is the dev server running? (npm run dev)${RESET}`);
    process.exit(1);
  }
  const elapsedMs = Date.now() - startedAt;

  let body;
  try {
    body = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}response was not JSON:${RESET} ${msg}`);
    process.exit(1);
  }

  console.log(
    `${DIM}response:${RESET} HTTP ${res.status} in ${elapsedMs}ms` +
      (body.correlation_id ? ` ${DIM}(${body.correlation_id})${RESET}` : ""),
  );
  console.log();

  // --- HTTP and metadata ---
  check(
    "HTTP 200",
    () =>
      res.status === 200 ||
      `got ${res.status}: ${JSON.stringify(body).slice(0, 200)}`,
  );
  check(
    "X-Correlation-Id header set",
    () =>
      typeof res.headers.get("x-correlation-id") === "string" ||
      "header missing",
  );
  check(
    "correlation_id is UUID v4",
    () => isUuid(body.correlation_id) || `got ${body.correlation_id}`,
  );

  // --- OCR-fallback contract ---
  check(
    "input_type === 'pdf'",
    () => body.input_type === "pdf" || `got ${body.input_type}`,
  );
  check(
    "vision_used === true (the OCR fallback fired)",
    () =>
      body.vision_used === true ||
      `got ${body.vision_used}; pdf-parse may have found text in the fixture, regenerate it`,
  );

  // --- Standard fields populated by Claude vision ---
  check(
    "invoice.invoice_number.value populated",
    () =>
      body.invoice?.invoice_number?.value != null ||
      `got ${body.invoice?.invoice_number?.value}`,
  );
  check(
    "invoice.vendor.name populated",
    () =>
      body.invoice?.vendor?.name != null ||
      `got ${body.invoice?.vendor?.name}`,
  );
  check(
    "invoice.total.value populated",
    () =>
      body.invoice?.total?.value != null ||
      `got ${body.invoice?.total?.value}`,
  );
  // Fixture's expected total is $2,167.56. Allow $1 of tolerance for rare
  // misreads (e.g., the model dropping a digit) without failing the smoke
  // test on every minor variance.
  check("invoice.total.value within $1 of 2167.56", () => {
    const v = body.invoice?.total?.value;
    if (typeof v !== "number") return `got non-number ${v}`;
    if (Math.abs(v - 2167.56) > 1) return `got ${v}`;
    return true;
  });
  check(
    "invoice.line_items has 4 entries (matches fixture)",
    () =>
      body.invoice?.line_items?.length === 4 ||
      `got ${body.invoice?.line_items?.length}`,
  );

  // --- bbox-prefix contract: at least one standard field carries a
  // [bbox: x, y, w, h] or [bbox: none] prefix from the vision prompt ---
  check("at least one reasoning has [bbox: ...] prefix", () => {
    const reasonings = [
      body.invoice?.invoice_number?.reasoning,
      body.invoice?.vendor?.reasoning,
      body.invoice?.bill_date?.reasoning,
      body.invoice?.due_date?.reasoning,
      body.invoice?.total?.reasoning,
      body.invoice?.subtotal?.reasoning,
    ].filter((r) => typeof r === "string");
    if (reasonings.length === 0) return "no reasoning strings present";
    const hasBbox = reasonings.some((r) => /^\[bbox:/i.test(r));
    return (
      hasBbox ||
      `none of ${reasonings.length} reasoning strings start with [bbox:`
    );
  });

  // --- Cost / model metadata ---
  check(
    "model populated",
    () =>
      (typeof body.model === "string" && body.model.length > 0) ||
      `got ${body.model}`,
  );
  check(
    "cost_usd is a number",
    () => typeof body.cost_usd === "number" || `got ${body.cost_usd}`,
  );

  console.log();
  if (failures === 0) {
    console.log(`${GREEN}${BOLD}all checks passed${RESET}`);
    if (typeof body.cost_usd === "number") {
      console.log(`${DIM}cost: $${body.cost_usd.toFixed(4)}${RESET}`);
    }
    process.exit(0);
  } else {
    console.log(
      `${RED}${BOLD}${failures} check${failures === 1 ? "" : "s"} failed${RESET}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${RED}fatal:${RESET}`, err);
  process.exit(1);
});
