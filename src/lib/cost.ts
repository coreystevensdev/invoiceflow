/**
 * Rolling-median cost tracker + anomaly cap.
 *
 * Purpose: surface requests that cost dramatically more than the usual
 * extraction — a runaway prompt, a multi-page statement, or a pricing
 * misconfiguration. See PRD NFR-R4.
 *
 * Scope notes:
 *   - In-memory, per Fluid Compute instance. Each instance tracks
 *     independently; acceptable for a ceiling-not-quota semantic.
 *   - The cap is checked **after** the Claude call completes, not
 *     before. By the time we know the cost, the tokens are spent. The
 *     real runaway guard is EXTRACTION_MAX_RETRIES (bounded at 2) and
 *     EXTRACTION_MAX_TOKENS (4096) in claude.ts. This tracker detects
 *     and reports anomalies; it does not prevent the first expensive
 *     response from being generated.
 *   - Between reading the median and appending the new cost, two
 *     concurrent requests may both pass the check. Acceptable because
 *     (a) retries are bounded, (b) the cap triggers an alert log line,
 *     and (c) adding a lock would not reduce spend already incurred.
 *
 * Pricing (per 1M tokens, as of 2026-04):
 *   claude-sonnet-4-6: input $3, output $15
 *   claude-opus-4-7:   input $15, output $75
 *   claude-haiku-4-5:  input $1, output $5
 *
 * If an unknown model is used, `computeCost` returns null and
 * `exceedsBudget` fails open — a demo-safe default.
 */

export const CAP_MULTIPLIER = 3;
const HISTORY_CAP = 50;

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-4-7": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export function computeCost(usage: Usage, model: string): number | null {
  const key = Object.keys(PRICING).find((prefix) => model.startsWith(prefix));
  if (!key) return null;
  const pricing = PRICING[key];
  const input = (usage.input_tokens / 1_000_000) * pricing.inputPerMillion;
  const output = (usage.output_tokens / 1_000_000) * pricing.outputPerMillion;
  return input + output;
}

const history: number[] = [];

export function recordCost(cost: number): void {
  if (!Number.isFinite(cost) || cost < 0) return;
  history.push(cost);
  if (history.length > HISTORY_CAP) history.shift();
}

export function medianCost(): number | null {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface BudgetCheck {
  exceeded: boolean;
  observed: number;
  cap: number | null;
  median: number | null;
}

export function exceedsBudget(current: number): BudgetCheck {
  const median = medianCost();
  if (median === null || median === 0) {
    return { exceeded: false, observed: current, cap: null, median };
  }
  const cap = median * CAP_MULTIPLIER;
  return { exceeded: current > cap, observed: current, cap, median };
}

export function resetHistoryForTests(): void {
  history.length = 0;
}
