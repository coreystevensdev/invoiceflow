# InvoiceFlow Eval Results

> Run `npm run eval` with ANTHROPIC_API_KEY set to populate this file.

**Corpus:** 20 fixtures ready (1 real, 19 synthetic across tech/utilities/contractor/retail/international categories)

## How to run

```bash
source .env.local  # or: export ANTHROPIC_API_KEY=sk-ant-...
npm run eval
npm run eval:report
```

Estimated cost: ~$0.50 for 20 fixtures at ~$0.025/invoice.
