# InvoiceFlow Eval Results

**Run date:** 2026-11-11
**Model:** claude-sonnet-4-6
**Corpus:** 150 invoices

## Overall

| Metric | Value |
|--------|-------|
| Invoice pass rate | 99.3% (149/150) |
| Field accuracy | 99.9% (1349/1350) |

## Per-Field Accuracy

| Field | Matched | Total | Accuracy |
|-------|---------|-------|----------|
| invoice_number | 150 | 150 | 100.0% |
| vendor_name | 150 | 150 | 100.0% |
| bill_date | 150 | 150 | 100.0% |
| due_date | 150 | 150 | 100.0% |
| po_number | 150 | 150 | 100.0% |
| subtotal | 149 | 150 | 99.3% |
| tax | 150 | 150 | 100.0% |
| total | 150 | 150 | 100.0% |
| currency | 150 | 150 | 100.0% |

## Per-Category Accuracy

| Category | Invoices | Field Accuracy |
|----------|----------|----------------|
| construction | 15 | 100.0% |
| healthcare | 16 | 100.0% |
| logistics | 11 | 100.0% |
| marketing | 10 | 100.0% |
| professional-services | 20 | 100.0% |
| real-estate | 10 | 100.0% |
| retail | 18 | 99.4% |
| saas-tech | 20 | 100.0% |
| staffing | 11 | 100.0% |
| tech | 1 | 100.0% |
| utilities | 18 | 100.0% |
