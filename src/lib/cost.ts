/**
 * Rolling-median cost tracker + anomaly cap, plus calendar-month aggregate ceiling.
 *
 * Purpose: surface requests that cost dramatically more than the usual
 * extraction, a runaway prompt, a multi-page statement, or a pricing
 * misconfiguration. See PRD NFR-R4. Also enforces an aggregate monthly
 * ceiling (Story 2.0) so a viral spike or rotating-IP abuse cannot burn
 * through more than `MONTHLY_BUDGET_USD` in a calendar month.
 *
 * Scope notes:
 *   - In-memory, per Fluid Compute instance. Each instance tracks
 *     independently; acceptable for a ceiling-not-quota semantic.
 *   - The per-request cap is checked **after** the Claude call completes,
 *     not before. By the time we know the cost, the tokens are spent. The
 *     real runaway guard is EXTRACTION_MAX_RETRIES (bounded at 2) and
 *     EXTRACTION_MAX_TOKENS (4096) in claude.ts. This tracker detects
 *     and reports anomalies; it does not prevent the first expensive
 *     response from being generated.
 *   - Between reading the median and appending the new cost, two
 *     concurrent requests may both pass the check. Acceptable because
 *     (a) retries are bounded, (b) the cap triggers an alert log line,
 *     and (c) adding a lock would not reduce spend already incurred.
 *   - The monthly tracker (`exceedsMonthlyBudget`, `recordMonthlyCost`,
 *     `getMonthlyCumulativeUsd`) buckets cumulative cost by calendar
 *     month in UTC (`YYYY-MM`). `resolveCurrentMonth()` is the single
 *     rollover point, every public monthly function calls it first so
 *     observability getters never return stale cumulative data after a
 *     month boundary.
 *   - The "$MONTHLY_BUDGET_USD" ceiling is *soft* by design. Three
 *     sources of overshoot, all documented and accepted:
 *       (1) Horizontal scale: per-instance accounting. Under N warm
 *           Fluid Compute instances, effective ceiling is
 *           `N × MONTHLY_BUDGET_USD`. Matches the per-instance rate
 *           limiter trade-off (see rate-limit.ts).
 *       (2) Intra-instance concurrency: `exceedsMonthlyBudget()` checks
 *           prior cumulative; up to K concurrent in-flight requests can
 *           each pass the gate before the first one calls
 *           `recordMonthlyCost()`. Effective overshoot per instance is
 *           bounded by `K × max_single_cost` where K is the concurrent
 *           request count and `max_single_cost ≤ ABSOLUTE_CEILING_USD`.
 *       (3) Crossing-request boundary: the gate compares prior
 *           cumulative to the budget. The request that crosses the
 *           budget always completes (and records the cost that produced
 *           the crossing). The *next* request is the one that gets
 *           rejected. So actual spend can land at
 *           `MONTHLY_BUDGET_USD + max_single_cost` even with no
 *           concurrency.
 *     For a portfolio-tier tool this softness is acceptable; do not
 *     introduce Redis/Upstash/Vercel KV without an explicit growth-tier
 *     decision (see project-context.md).
 *   - `getMonthlyBudgetUsd()` parses `MONTHLY_BUDGET_USD` defensively:
 *     missing, empty, non-numeric, NaN, or ≤ 0 inputs all fall back to
 *     `MONTHLY_BUDGET_USD_DEFAULT`. A malformed env var must not
 *     produce a zero-budget DoS-of-self. Misconfiguration is recorded
 *     in a one-shot diagnostic that the route handler consumes and
 *     emits as a structured warn line (see
 *     `consumeMonthlyBudgetMisconfig()`); silent fallback would mask
 *     "why did my $50 budget reset to $25?" support tickets.
 *   - The monthly check is evaluated **pre-call** in the route handler
 *     (cumulative state is already known); the per-request rolling
 *     median + absolute ceiling are evaluated **post-call**. A single
 *     high-cost request can still complete and only be detected after
 *     the fact; a budget-exhausted state rejects the *next* request.
 *
 * Pricing (per 1M tokens, as of 2026-04):
 *   claude-sonnet-4-6: input $3, output $15
 *   claude-opus-4-7:   input $15, output $75
 *   claude-haiku-4-5:  input $1, output $5
 *
 * If an unknown model is used, `computeCost` returns null and
 * `exceedsBudget` fails open, a demo-safe default. The monthly tracker
 * only ever sees finite, non-negative costs (guarded by the same
 * `if (cost_usd !== null)` check at the call site).
 */

export const CAP_MULTIPLIER = 3;
const HISTORY_CAP = 50;

/**
 * Hard per-request ceiling, regardless of history. Prevents a first
 * request (no median yet) from slipping past and racking up an
 * unbounded bill. Tuned for a typical invoice extraction: even a long
 * multi-page statement on Opus should not exceed this in normal use.
 * Requests above this ceiling are aborted as `cost-budget-exceeded`.
 */
export const ABSOLUTE_CEILING_USD = 1.0;

/**
 * Default aggregate monthly Anthropic-spend ceiling in USD. Overridable
 * via the `MONTHLY_BUDGET_USD` env var. See `getMonthlyBudgetUsd`.
 */
export const MONTHLY_BUDGET_USD_DEFAULT = 25;

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
  if (current > ABSOLUTE_CEILING_USD) {
    return {
      exceeded: true,
      observed: current,
      cap: ABSOLUTE_CEILING_USD,
      median,
    };
  }
  if (median === null || median === 0) {
    return { exceeded: false, observed: current, cap: null, median };
  }
  const cap = median * CAP_MULTIPLIER;
  return { exceeded: current > cap, observed: current, cap, median };
}

export function resetHistoryForTests(): void {
  history.length = 0;
}

export type MonthlyBudgetMisconfigReason =
  | "non-numeric"
  | "non-positive";

interface MonthlyBudgetMisconfig {
  raw: string;
  reason: MonthlyBudgetMisconfigReason;
}

let pendingMisconfig: MonthlyBudgetMisconfig | null = null;

/**
 * Reads `MONTHLY_BUDGET_USD`, parses as a strict numeric literal, falls
 * back to `MONTHLY_BUDGET_USD_DEFAULT` on missing/invalid/non-positive
 * input. Fail-safe: a malformed env var must not produce a zero-budget
 * DoS-of-self. To "disable" the ceiling, set a deliberately large value.
 *
 * Strict parse rejects values `parseFloat` would silently accept (e.g.
 * `"50 USD"` → 50). Operator typos that mask intent must surface.
 *
 * On fallback, records a one-shot diagnostic for the route handler to
 * emit. Trailing/leading whitespace is tolerated to match shell quoting
 * conventions but anything else (units, garbage) trips the strict regex.
 */
export function getMonthlyBudgetUsd(): number {
  const raw = process.env.MONTHLY_BUDGET_USD;
  if (typeof raw !== "string" || raw.length === 0) {
    return MONTHLY_BUDGET_USD_DEFAULT;
  }
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    pendingMisconfig ??= { raw, reason: "non-numeric" };
    return MONTHLY_BUDGET_USD_DEFAULT;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    pendingMisconfig ??= { raw, reason: "non-positive" };
    return MONTHLY_BUDGET_USD_DEFAULT;
  }
  return parsed;
}

/**
 * Returns the pending misconfiguration diagnostic (if any) and clears
 * it. Route handler emits a one-time structured warn line so silent
 * env-var fallback doesn't mask operator typos.
 */
export function consumeMonthlyBudgetMisconfig(): MonthlyBudgetMisconfig | null {
  const diagnostic = pendingMisconfig;
  pendingMisconfig = null;
  return diagnostic;
}

interface MonthlyState {
  monthKey: string;
  cumulativeUsd: number;
}

const monthlyState: MonthlyState = {
  monthKey: currentMonthKey(),
  cumulativeUsd: 0,
};

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Single rollover point. Every public monthly function calls this first
 * so observability getters never return stale cumulative data after a
 * month boundary. Without this, `getMonthlyCumulativeUsd()` invoked
 * after rollover but before the next record/exceeds call would emit a
 * stale figure on the rejection log line, a real failure mode.
 */
function resolveCurrentMonth(): void {
  const now = currentMonthKey();
  if (now !== monthlyState.monthKey) {
    monthlyState.monthKey = now;
    monthlyState.cumulativeUsd = 0;
  }
}

export function recordMonthlyCost(cost: number): void {
  resolveCurrentMonth();
  if (!Number.isFinite(cost) || cost < 0) return;
  monthlyState.cumulativeUsd += cost;
}

export function exceedsMonthlyBudget(): boolean {
  resolveCurrentMonth();
  return monthlyState.cumulativeUsd >= getMonthlyBudgetUsd();
}

/**
 * Server-side observability only, never surface in user-facing
 * responses (NFR-S2 / FR41). Used by the route handler's structured log
 * line on a `monthly-budget-exhausted` rejection.
 */
export function getMonthlyCumulativeUsd(): number {
  resolveCurrentMonth();
  return monthlyState.cumulativeUsd;
}

export function resetMonthlyStateForTests(): void {
  monthlyState.monthKey = currentMonthKey();
  monthlyState.cumulativeUsd = 0;
  pendingMisconfig = null;
}
