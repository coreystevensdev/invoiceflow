# 1. Zero retention as architecture, not policy

Date: 2026-05-02
Status: Accepted

## Context

PDF invoice extraction inherently sees the user's financial documents (vendor names, line items, totals, tax, dates). The default for most SaaS products is to store everything for retraining, debugging, and analytics, then make a privacy promise in the policy. That promise is one config change away from being broken, and one breach away from being a regulatory event.

Small businesses and bookkeepers (the natural audience) are sensitive to where their financial data ends up. A demo tool that asks them to trust a privacy policy is a worse offer than one that can't store the data even if the operator wanted to.

## Decision

No persistence layer. PDFs and extracted field values process in memory inside a single Vercel Function execution and disappear when the request ends.

The structured logger in `src/lib/log.ts` enforces this with a typed allowlist of metadata keys: `pdf_size_bytes`, `pdf_num_pages`, `correlation_id`, `error_code`, `cost_usd`, `retry_count`. Anything outside that allowlist is a compile-time error. Field values, PDF bytes, and reasoning strings never reach the log stream.

The webhook endpoint strips the model's reasoning text (which contains extracted source content) before forwarding to the user-supplied URL.

## Consequences

Positive:
- Zero attack surface for content data: there is no persistence layer to leak from
- Simple architecture: no database migrations, no schema, no auth, no per-user storage
- Marketing thesis is enforceable from code, not policy: "the promise lives in the code, not a policy"
- Audit-friendly: an operator can prove non-retention by reading `src/lib/log.ts` and `src/app/api/*/route.ts`

Negative:
- No retry queue: a failed extraction after the response has been sent cannot be replayed
- No history view: users can't see "the last 10 invoices I extracted" without re-uploading
- No analytics on extraction patterns: no way to learn that a specific layout fails 80% of the time
- The in-memory rate limiter and cost history are per-Fluid-Compute-instance, not globally shared (acknowledged trade-off, see ADR 0005-style limitation in the README)

## Alternatives considered

**Vercel Blob with TTL.** Store the PDF for N minutes to enable retry-on-failure, then auto-delete. Rejected because any persistence is a privacy commitment that gets audited differently than non-persistence. A 60-minute TTL is still a 60-minute window for a leak.

**Database with sanitized metadata only.** Store extraction outcomes (success/failure, cost, duration) but not field values. Would enable analytics. Rejected because it adds a tracked surface (schema, migrations, ORM, backup posture) for a feature the demo doesn't need, and metadata-only storage is hard to keep clean over time as new fields are added.

**Log full PDFs for "internal use only".** Common pattern: store everything in cloud logging, mark it as not-for-customer-access. Rejected because it's indistinguishable from a leak under audit, and "internal use" is exactly where retraining-data exfiltration happens.
