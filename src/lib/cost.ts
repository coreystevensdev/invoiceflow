/**
 * Per-request rolling-median cost cap and a calendar-month aggregate
 * spend ceiling for Anthropic API usage.
 *
 * Both checks are in-memory per Fluid Compute instance, not globally
 * shared. Acceptable for an anomaly detector and a soft monthly cap;
 * not appropriate as a hard global quota. Move to Redis if that changes.
 *
 * The per-request cap runs after the Claude call (cost is only known
 * once usage comes back). Real prevention is upstream: bounded retries
 * and EXTRACTION_MAX_TOKENS in claude.ts.
 *
 * Pricing (per 1M tokens, as of 2026-04):
 *   claude-sonnet-4-6: $3 in / $15 out
 *   claude-opus-4-7:   $15 in / $75 out
 *   claude-haiku-4-5:  $1 in / $5 out
 *
 * Unknown models return null cost and the budget check fails open.
 */

export const CAP_MULTIPLIER = 3;
const HISTORY_CAP = 50;

/** Hard per-request ceiling. Catches runaways before the rolling median seeds. */
export const ABSOLUTE_CEILING_USD = 1.0;

/** Default monthly Anthropic-spend ceiling (USD). Override via MONTHLY_BUDGET_USD. */
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
 * Reads MONTHLY_BUDGET_USD; falls back to the default on missing or
 * malformed input. Strict regex parse rejects "50 USD"-style values that
 * parseFloat would silently accept. Records a one-shot diagnostic on
 * fallback so operator typos surface in logs.
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

/** Returns the pending misconfig diagnostic (if any) and clears it. */
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

// Reset cumulative state on month rollover.
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

/** Server-side observability only. Used by route logging. */
export function getMonthlyCumulativeUsd(): number {
  resolveCurrentMonth();
  return monthlyState.cumulativeUsd;
}

export function resetMonthlyStateForTests(): void {
  monthlyState.monthKey = currentMonthKey();
  monthlyState.cumulativeUsd = 0;
  pendingMisconfig = null;
}
