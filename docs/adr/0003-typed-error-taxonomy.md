# 3. Typed error taxonomy with compile-time exhaustiveness

Date: 2026-05-02
Status: Accepted

## Context

API errors typically end up as either generic `500 Internal Server Error` with a stack trace, or as ad-hoc strings ("invalid file", "couldn't process") that drift between the UI, the docs, and the actual code over time. Both fail under audit when a user asks "why did my upload fail".

Adding a new failure mode (a new file format, a new cost guard, a new upstream error) typically requires touching three places: the error path in the code that throws it, the HTTP status mapping, and the user-facing copy. In an untyped system, you can ship two of the three and not notice the third is missing.

## Decision

`ExtractionErrorCode` is a TypeScript discriminated union of eight named codes:

```ts
type ExtractionErrorCode =
  | "corrupt-PDF"
  | "oversized-PDF"
  | "non-PDF"
  | "not-an-invoice"
  | "model-API-failure"
  | "rate-limited"
  | "extraction-timeout"
  | "cost-budget-exceeded";
```

Each code is wired to three sites via `Record<ExtractionErrorCode, ...>` types:

1. `STATUS_BY_CODE`: HTTP status (400, 415, 422, 429, 504, 502)
2. `ERROR_DESCRIPTIONS`: user-readable title + cause + next-step copy, consumed by the `ErrorState` UI component
3. `toErrorResponse(code, opts)`: the only function that can construct an error JSON response in the route handlers

Adding a new code is a compile-time obligation: TypeScript's exhaustiveness checking on `Record<ExtractionErrorCode, ...>` refuses to compile if any of the three sites is missing the new entry.

## Consequences

Positive:
- Every failure path has an exact reason. The user who hits `code: non-PDF` and the developer reading logs see the same identifier.
- UI copy stays consistent with API. The `ErrorState` component renders from the same `ERROR_DESCRIPTIONS` map that the API references.
- Impossible to ship a new error category without wiring all three sites. The compiler catches the omission.
- Raw stack traces never reach the client. Unexpected errors are caught and mapped to `model-API-failure` or another typed category before the response is constructed.

Negative:
- More verbose than throwing strings. A new error path is a 4-file change instead of a 1-line throw.
- The union has to be kept synced with the actual failure modes in the code. If a route handler invents a new ad-hoc error string, it bypasses the safety net.

## Alternatives considered

**Throwing strings.** Cheap to write, drifts immediately. UI copy and API messages diverge as soon as one is updated without the other.

**Class-based error hierarchy** (`class CorruptPdfError extends ExtractionError`). JavaScript class hierarchies don't enforce exhaustive-switch the way TypeScript does on string unions. A `switch (err)` on instanceof checks compiles fine even when a new subclass is added but not handled.

**Returning `{ error: string }` from handlers.** Same drift problem as throwing strings, plus loses the type safety of return-value contracts. Clients have to parse the error string to know what happened.
