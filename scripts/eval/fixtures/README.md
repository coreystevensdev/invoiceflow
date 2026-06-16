# Eval Fixtures

Each fixture is a subdirectory named `NNN-<slug>/` containing:

- `invoice.pdf` -- the invoice file to extract
- `expected.json` -- ground truth (see format below)
- `meta.json` -- fixture metadata (category, source, notes)

## expected.json format

```json
{
  "invoice_number": "INV-2026-001",
  "vendor_name": "Acme Office Supplies LLC",
  "bill_date": "2026-04-15",
  "due_date": "2026-05-15",
  "po_number": null,
  "subtotal": 2007.00,
  "tax": 160.56,
  "total": 2167.56,
  "currency": "USD"
}
```

## meta.json format

```json
{
  "id": "001",
  "category": "tech",
  "source": "synthetic",
  "notes": "Standard digital invoice, all fields present"
}
```

## Categories

- `tech` -- software/SaaS/hardware vendors
- `utilities` -- electricity, water, internet service providers
- `contractor` -- freelance, agency, professional services
- `retail` -- product suppliers, office supply companies
- `international` -- non-USD currency, non-English layout
- `synthetic` -- programmatically generated, full ground truth known
- `scanned` -- image-only PDFs, requires vision path

## Adding real invoices

Use anonymized invoices only. Replace vendor names, addresses, and
invoice numbers with fictional equivalents before committing. The
`notes` field should document any anonymization.
