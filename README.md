# InvoiceFlow

Extract structured data from PDF invoices with Claude. Drop a PDF, see vendor, line items, tax, total, and due date with per-field reasoning in under five seconds. Export QuickBooks-ready or Xero-ready CSV, or POST the payload to a webhook.

No account. No database. No platform.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind 4 · `@anthropic-ai/sdk` · `pdf-parse` · `zod`

## Run locally

```bash
cp .env.example .env.local
# Edit .env.local and paste your Anthropic API key
npm run dev
```

Open http://localhost:3000 and drop a PDF.

## Routes

| Route | Method | What it does |
|-------|--------|--------------|
| `/` | GET | Landing + extraction UI |
| `/api/extract` | POST (multipart) | `pdf` form field → `ExtractResponse` JSON |
| `/api/csv` | POST (JSON) | `{invoices, format: "summary" \| "line_items"}` → CSV download |
| `/api/webhook` | POST (JSON) | `{webhook_url, invoice, verbose?}` → fires webhook |
| `/robots.txt`, `/sitemap.xml`, `/schema.jsonld` | GET | SEO surfaces |

Every API response carries a `correlation_id` (UUID v4) for observability and support follow-up. Errors are typed — see `src/lib/errors.ts`.

## Architecture

```
src/
├── app/
│   ├── page.tsx                # Upload + reasoning-tooltip results UI
│   ├── layout.tsx              # Metadata, OG, Twitter, canonical, JSON-LD link
│   ├── globals.css             # :focus-visible ring + prefers-reduced-motion guard
│   ├── api/
│   │   ├── extract/route.ts    # PDF → Claude → structured JSON
│   │   ├── csv/route.ts        # Invoice JSON → CSV (QBO or Xero schema)
│   │   └── webhook/route.ts    # Invoice JSON → POST to user URL (rate-limited)
│   ├── robots.ts, sitemap.ts
│   └── schema.jsonld/route.ts  # SoftwareApplication structured data
├── components/
│   ├── error-state.tsx         # Typed ErrorState (all 8 categories)
│   └── upgrade-browser-notice.tsx
├── lib/
│   ├── claude.ts               # System prompt + Zod schema + extractInvoice()
│   ├── pdf.ts                  # pdf-parse wrapper with typed errors
│   ├── validate.ts             # Deterministic cross-field flags
│   ├── csv.ts                  # Summary + line-item CSV formatters
│   ├── errors.ts               # ExtractionErrorCode union + toErrorResponse
│   ├── log.ts                  # Structured correlation-ID logger
│   ├── cost.ts                 # Rolling-median cost ceiling
│   ├── rate-limit.ts           # Sliding-window in-memory limiter
│   └── site.ts                 # Canonical URL + metadata helpers
└── proxy.ts                    # Next.js 16 middleware: CSP nonce, HSTS, headers
```

### Key design decisions

- **Per-field confidence + reasoning.** Every extracted field carries its own `{value, confidence, reasoning}` tuple. Hover or focus a field to see Claude's source-cited reasoning. The reasoning tooltip is keyboard-accessible (Tab to reveal, Escape to dismiss) and screen-reader-wired via `aria-describedby`.
- **Two-pass validation.** Claude flags cross-field issues in the extraction; a deterministic pass in `lib/validate.ts` runs independently and merges findings. Doubled detection is stronger than either alone.
- **Zero-retention architecture.** No database, no auth, no content logging. Uploaded PDFs process in-memory within a single Vercel Function execution; only metadata (size, page count, correlation ID, error category) reaches the logs.
- **Typed error taxonomy.** Eight categorized error codes (`corrupt-PDF`, `oversized-PDF`, `non-PDF`, `not-an-invoice`, `model-API-failure`, `rate-limited`, `extraction-timeout`, `cost-budget-exceeded`) each render a user-readable title + cause + next step via the shared `ErrorState` component. No raw 5xx surfaced.
- **Strict nonce-based CSP** via `src/proxy.ts`. No `'unsafe-inline'`; per-request nonce; HSTS, Referrer-Policy, X-Content-Type-Options, Permissions-Policy.
- **WCAG 2.1 AA baseline.** Keyboard-operable, `aria-live` status announcements, icon+text state communication (never color-only), `prefers-reduced-motion` honored globally, visible focus rings on every interactive element.
- **Universal CSV schema.** Imports into any current QBO CSV importer, into Xero natively, and opens cleanly in Excel / Google Sheets. ISO-8601 dates, numeric money, UTF-8 with BOM.
- **Prompt caching on the system prompt.** Ephemeral cache reduces cost on repeat calls by ~90% on the system-prompt tokens.
- **Structured output via `messages.parse` + `zodOutputFormat`.** The SDK validates and parses Claude's response against the Zod schema; no manual JSON parsing.
- **Cost + retry safety.** 90-second Claude timeout, max 2 retries with exponential backoff, 3× rolling-median cost ceiling with an absolute first-request guard. Runaway extractions surface as `cost-budget-exceeded`.

## Deploy

```bash
npx vercel          # preview
npx vercel --prod   # production
```

Set `ANTHROPIC_API_KEY` in Vercel → Project → Settings → Environment Variables. Optional: `CLAUDE_MODEL` (default `claude-sonnet-4-6`), `SITE_URL`, `MAX_PDF_SIZE_MB`.

## Planning artifacts

Documented using the [BMad Method](https://docs.bmad-method.org/) for traceable decision-making from concept to architecture.

- [`prd.md`](./_bmad-output/planning-artifacts/prd.md) — Product requirements: 48 FRs, 38 NFRs, 4 user journeys, domain scope boundaries
- [`ux-design-specification.md`](./_bmad-output/planning-artifacts/ux-design-specification.md) — UX spec: personas, core experience, emotional register, pattern analysis, design system rationale, 4 journey flows (Mermaid), WCAG 2.1 AA strategy
- [`architecture.md`](./_bmad-output/planning-artifacts/architecture.md) — Architecture decisions: FR/NFR coverage, technology stack rationale, implementation patterns with reference call sites, complete project tree, validation with honest gap analysis
- [`research/domain-ap-automation-research-2026-04-18.md`](./_bmad-output/planning-artifacts/research/domain-ap-automation-research-2026-04-18.md) — AP automation domain research
- [`brainstorming-session-2026-04-18-0755.md`](./_bmad-output/brainstorming/brainstorming-session-2026-04-18-0755.md) — Idea generation + persona-driven filtering
- [`invoiceflow-technical-reference.md`](./_bmad-output/implementation-artifacts/invoiceflow-technical-reference.md) — Prompt + schema + cost model reference
- [`spec-sunday-quality-bar-polish.md`](./_bmad-output/implementation-artifacts/spec-sunday-quality-bar-polish.md) — Post-MVP polish spec (a11y, CSP, SEO, typed errors, cost caps)
