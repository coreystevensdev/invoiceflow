# InvoiceFlow

AI invoice processor. Drop a PDF, get structured data in under 5 seconds, export as CSV or POST to a webhook.

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
| `/` | GET | Landing page + upload UI |
| `/api/extract` | POST (multipart) | `pdf` form field → `ExtractResponse` JSON |
| `/api/csv` | POST (JSON) | `{invoices, format: "summary"\|"line_items"}` → CSV download |
| `/api/webhook` | POST (JSON) | `{webhook_url, invoice, verbose?}` → fires webhook |

## Architecture

```
src/
├── app/
│   ├── page.tsx              # Upload + results UI
│   ├── api/
│   │   ├── extract/route.ts  # PDF → Claude → structured JSON
│   │   ├── csv/route.ts      # Invoice JSON → CSV (2 formats)
│   │   └── webhook/route.ts  # Invoice JSON → POST to user URL
│   └── layout.tsx, globals.css
└── lib/
    ├── claude.ts             # System prompt + Zod schema + extractInvoice()
    ├── pdf.ts                # pdf-parse wrapper with typed errors
    ├── validate.ts           # Deterministic cross-field flags
    └── csv.ts                # Summary + line-item CSV formatters
```

### Key design decisions

- **Per-field confidence + reasoning.** Every extracted field carries its own `{value, confidence, reasoning}` tuple. Hover the UI to see Claude's reasoning — the single highest-impact credibility signal.
- **Two-pass validation.** Claude flags cross-field issues in the extraction; a deterministic pass in `lib/validate.ts` runs independently and merges findings. Doubled detection is stronger than either alone.
- **Universal CSV schema.** Not pinned to QuickBooks. Imports into QBO via SaasAnt, into Xero natively, and opens cleanly in Excel / Google Sheets.
- **Prompt caching on the system prompt.** Ephemeral cache reduces cost on repeat calls by ~90% on the system-prompt tokens.
- **Structured output via `messages.parse` + `zodOutputFormat`.** The SDK validates and parses Claude's response against the Zod schema; no manual JSON parsing.

## Deploy

```bash
npx vercel          # preview
npx vercel --prod   # production
```

Set `ANTHROPIC_API_KEY` in Vercel → Project → Settings → Environment Variables.

## Planning artifacts

- [`_bmad-output/brainstorming/brainstorming-session-2026-04-18-0755.md`](./_bmad-output/brainstorming/brainstorming-session-2026-04-18-0755.md) — full brainstorm: 35 ideas, Jenna persona filter, ranked top 10
- [`_bmad-output/implementation-artifacts/invoiceflow-build-checklist.md`](./_bmad-output/implementation-artifacts/invoiceflow-build-checklist.md) — weekend build checklist, time-estimated
- [`_bmad-output/implementation-artifacts/invoiceflow-technical-reference.md`](./_bmad-output/implementation-artifacts/invoiceflow-technical-reference.md) — prompt + schema + cost model reference
