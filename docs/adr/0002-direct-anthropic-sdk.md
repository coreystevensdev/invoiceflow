# 2. Use the Anthropic SDK directly, not the Vercel AI Gateway

Date: 2026-05-02
Status: Accepted

## Context

Vercel ships an AI Gateway that proxies to multiple model providers, with built-in observability, model fallbacks, and zero data retention by default. Vercel's own guidance recommends the Gateway as the default path for AI features on Vercel, and the AI SDK abstracts the provider so you can swap models without code changes.

InvoiceFlow has specific requirements that benefit from features the Gateway abstracts away.

## Decision

Use `@anthropic-ai/sdk` directly. The Anthropic API key is read in `src/lib/claude.ts` and the entire extraction pipeline runs against `messages.parse(...)`.

## Consequences

Positive:
- Full access to Anthropic-specific features:
  - `cache_control: { type: "ephemeral" }` on the system prompt: drops cached-fraction cost by ~90% after the first call in a cache window
  - `messages.parse(...)` with `zodOutputFormat(InvoiceExtractionSchema)`: validates Claude's response against the Zod schema inside the SDK, so malformed output throws at the SDK boundary instead of cluttering the route handler with defensive type guards
  - Direct `usage.input_tokens` / `output_tokens` on the response, which powers the rolling-median cost cap and the `$cost_usd` field surfaced in the UI
- Smaller dependency surface (one SDK, not Gateway + AI SDK + provider plugin)
- Easier to debug: a single network hop between the Vercel Function and Anthropic, no Gateway intermediate

Negative:
- Locked to Anthropic. If the cost or quality calculus shifts toward another provider, the migration costs more than a config change.
- No automatic provider fallback. If Anthropic is down, the request fails (mapped to `model-API-failure`).
- No built-in observability dashboard. Logs go to Vercel's structured-log surface; metrics are derived from log queries, not a dashboard.

The model is env-swappable via `CLAUDE_MODEL` (default `claude-sonnet-4-6`, escalation to `claude-opus-4-7` for hard inputs). The pipeline is vendor-neutral at the JSON-schema seam, so a future port to a different provider is a `claude.ts` rewrite, not a system rewrite.

## Alternatives considered

**Vercel AI Gateway with `provider/model` strings.** The recommended path on Vercel. Would lose `cache_control: ephemeral` (Anthropic-specific) and the Zod-based structured output helper that lives in `@anthropic-ai/sdk`'s `messages.parse`. Both are load-bearing for cost economics and code simplicity respectively.

**Vercel AI SDK with `@ai-sdk/anthropic` provider.** Better than the Gateway for accessing Anthropic features, but adds a layer between the application code and the SDK that has to be debugged when something breaks. The Zod helper requires the `messages.parse` call shape from the underlying SDK.

**LangChain.** Heavier framework, indirect call shape, harder to reason about cost and retry behavior. Mismatched abstraction level for a single-purpose extraction tool.
