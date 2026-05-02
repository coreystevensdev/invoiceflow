# 6. Per-field confidence and reasoning data structure

Date: 2026-05-02
Status: Accepted

## Context

Most invoice extraction APIs return either flat key-value pairs (`vendor: "Acme", total: 1234.56`) or rich-but-opaque objects with confidence scores. Neither tells the user where the value came from in the source document.

For accounts-payable workflows the user is making a trust decision: do I send this $2,167.56 to the vendor as-is, or do I open the PDF and verify? A confidence score alone ("model thinks this is 92% likely correct") tells the user how confident the model is, but not why. Without a way to verify against the source, the user opens the PDF anyway, which means the extraction saved them nothing.

This is also a privacy posture issue: ADR 0001 commits to never logging customer content, but the user still needs to audit individual extractions in the moment. The audit has to happen in the user's browser, against the model's own evidence, without round-tripping through a backend log.

## Decision

Every extracted field is a `{ value, confidence, reasoning }` tuple:

```ts
type ExtractedField<T> = {
  value: T | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
};
```

The `reasoning` is a string the model wrote that cites the source content from the PDF or image. The UI surfaces it through hover/focus tooltips wired via `aria-describedby`. Tab to reveal, Escape to dismiss.

For image inputs, Claude vision is asked to prefix each reasoning string with a `[bbox: x, y, w, h]` tag in normalized 0..1 coordinates. The client parses the prefix off, strips it from the displayed reasoning, and uses the coordinates to overlay an indigo highlight on the source region whenever the field is hovered or focused.

For PDF inputs, the bbox is derived client-side from `pdfjs-dist`'s `getTextContent()` positions by substring-matching the field value against the page's text items (see ADR 0005).

The `confidence` enum is three levels (high/medium/low) instead of a numeric score because three is the granularity a human bookkeeper can act on. "92% confident" prompts the question "92% according to what calibration"; "high confidence" prompts the question "is the source citation believable", which is the question the reasoning is there to answer.

## Consequences

Positive:
- Auditable extraction. The user can verify each value against the source without leaving the page or opening the original PDF in a separate viewer.
- WCAG 2.1 AA accessibility flows from the data structure for free: the tooltips are real ARIA-related elements wired via `aria-describedby`, keyboard-accessible, and screen-reader-readable.
- Model-quality improvements automatically flow through to the UI without prompt engineering changes. Better Claude reasoning means better tooltips with no client code change.
- The data structure is uniform across every field, so the UI rendering is one component (`FieldRow`) that doesn't have per-field special cases.

Negative:
- Response payload is approximately 3x larger than flat key-value. For a typical invoice with 12 extracted fields, the response is ~4-6KB instead of ~1-2KB. Acceptable at this scale.
- Clients have to handle the tuple shape. The CSV export and webhook routes flatten it back to value-only for downstream consumers.
- The reasoning is the model's voice and may include hallucinations on hard inputs (faded scans, multilingual invoices). Confidence flags partially mitigate; the deterministic validation pass in `src/lib/validate.ts` cross-checks the math regardless of what the model claims.

## Alternatives considered

**Flat key-value pairs.** The default for most extraction APIs. Cheaper payload, simpler client code, but no audit trail. Forces the user to manually verify against the original PDF, which defeats the purpose of using the tool.

**Confidence score only (no reasoning).** Tells the user the model's certainty but not the basis. Less actionable than the tuple. Doesn't enable the click-to-highlight overlay because there's nothing to anchor to source coordinates.

**Bbox-only without reasoning text.** Works for images but PDFs with text-layer extraction don't have meaningful bbox coordinates from the model's perspective; the bbox is derived client-side from `getTextContent()` positions. The reasoning text is the bridge between the two paths.

**Separate `/api/audit/<correlation_id>` endpoint.** Return the flat value-only response from `/api/extract`, then a follow-up call returns the audit data. Rejected because it requires storing the audit data between calls (violates ADR 0001) and because the user wants the audit data inline with the extraction, not on a separate roundtrip.
