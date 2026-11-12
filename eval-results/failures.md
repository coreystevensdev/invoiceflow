# Eval Failures

Bottom 1 invoices by failed-field count. Errors (API failures) listed separately.

## Bottom 1 Failures

### s074 (retail)

**Source:** synthetic
**Notes:** Paper reorder, two products. The printed subtotal of 641.60 deliberately disagrees with the two line items, which sum to 593.60. Rule 9 requires transcribing the printed figure and flagging the discrepancy, never correcting it.
**Failed fields (1):**

- **subtotal**: expected `641.6`, got `593.6` (diff: 48.0000)
