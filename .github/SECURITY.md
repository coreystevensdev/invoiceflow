# Security policy

## Reporting a vulnerability

If you find a security issue in InvoiceFlow, please email **cstevens3446@gmail.com** with:

- A description of the issue.
- Steps to reproduce, ideally with the smallest input that triggers it.
- The impact you believe it has (data exposure, denial of service, prompt injection that bypasses the cost ceiling, etc.).

I'll respond within 72 hours and aim to ship a fix or mitigation within 7 days for high-severity issues.

Please do not file a public GitHub issue for security reports.

## Supported versions

This project tracks `main` only. There are no maintained release branches at this stage.

## Threat model context

InvoiceFlow is a stateless service: PDFs and extracted fields process in memory inside a single Vercel Function and are never persisted. The structured logger in `src/lib/log.ts` deliberately enumerates allowed metadata keys to prevent content leakage. Reports about the privacy posture are especially welcome — for example, a code path that could exfiltrate PDF bytes or extracted field values to logs, third-party services, or the response of an unrelated request.

The strict nonce-based CSP in `src/proxy.ts` is also load-bearing. Any path that requires `'unsafe-inline'` or introduces a new third-party script domain should be flagged rather than worked around.
