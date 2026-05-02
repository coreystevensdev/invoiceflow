# Architecture Decision Records

Each ADR captures one load-bearing decision made during InvoiceFlow's design, the alternatives considered, and the consequences accepted. Format follows Michael Nygard's pattern (Context / Decision / Consequences / Alternatives).

| # | Title | Status |
|---|---|---|
| [0001](0001-zero-retention.md) | Zero retention as architecture, not policy | Accepted |
| [0002](0002-direct-anthropic-sdk.md) | Use the Anthropic SDK directly, not the Vercel AI Gateway | Accepted |
| [0003](0003-typed-error-taxonomy.md) | Typed error taxonomy with compile-time exhaustiveness | Accepted |
| [0004](0004-strict-csp-nonce.md) | Strict nonce-based CSP without `unsafe-inline` | Accepted |
| [0005](0005-pdfjs-legacy-build-static-worker.md) | pdfjs-dist legacy build with a static worker file | Accepted |
| [0006](0006-per-field-confidence-and-reasoning.md) | Per-field confidence and reasoning data structure | Accepted |

## When to add an ADR

Add one when the decision:

1. Has real alternatives that were considered and rejected
2. Is hard to reverse later without significant cost
3. Affects more than one part of the codebase
4. A future contributor (including future-you) would ask "why was this done this way?"

Skip an ADR for routine implementation choices, library version bumps, refactors that preserve behavior, or anything where the answer is "it's how the framework documents it."

## Format

```
# N. Short imperative title

Date: YYYY-MM-DD
Status: Proposed | Accepted | Deprecated | Superseded by ADR-X

## Context
What forced the decision. The constraints, the problem, the surrounding system state.

## Decision
What was actually decided, in enough detail to act on.

## Consequences
What this means going forward, both positive and negative. Be honest about the costs accepted.

## Alternatives considered
What else was evaluated, and why it wasn't chosen. One paragraph per alternative.
```
