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
 * Built-in pricing (per 1M tokens, as of 2026-04):
 *   claude-sonnet-4-6: $3 in / $15 out
 *   claude-opus-4-7:   $15 in / $75 out
 *   claude-haiku-4-5:  $1 in / $5 out
 *
 * Operators can extend or override the built-in pricing map by setting
 * MODEL_PRICING_USD to a JSON object. The route handler runs a fail-loud
 * pre-check via getModelPricing before any Claude call: a CLAUDE_MODEL
 * value with no resolved pricing surfaces as model-API-failure rather
 * than silently disabling the per-request and monthly cost ceilings.
 */

export const CAP_MULTIPLIER = 3;
const HISTORY_CAP = 50;

/** Hard per-request ceiling. Catches runaways before the rolling median seeds. */
export const ABSOLUTE_CEILING_USD = 1.0;

/** Default monthly Anthropic-spend ceiling (USD). Override via MONTHLY_BUDGET_USD. */
export const MONTHLY_BUDGET_USD_DEFAULT = 25;

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const BUILTIN_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-4-7": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
};

export type ModelPricingMisconfigReason =
  | "non-json"
  | "non-object"
  | "invalid-entry";

interface ModelPricingMisconfig {
  raw: string;
  reason: ModelPricingMisconfigReason;
  detail?: string;
}

let pricingMisconfig: ModelPricingMisconfig | null = null;

function isPricingShape(value: unknown): value is ModelPricing {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ModelPricing>;
  return (
    typeof candidate.inputPerMillion === "number" &&
    Number.isFinite(candidate.inputPerMillion) &&
    candidate.inputPerMillion >= 0 &&
    typeof candidate.outputPerMillion === "number" &&
    Number.isFinite(candidate.outputPerMillion) &&
    candidate.outputPerMillion >= 0
  );
}

/**
 * Reads MODEL_PRICING_USD and returns it merged on top of BUILTIN_PRICING.
 * On any malformed input, records a one-shot diagnostic and falls back to
 * the built-in map. Misconfig surfaces in extract-route logs the same way
 * MONTHLY_BUDGET_USD's diagnostic does.
 */
function resolvePricing(): Record<string, ModelPricing> {
  const raw = process.env.MODEL_PRICING_USD;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return BUILTIN_PRICING;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    pricingMisconfig ??= { raw, reason: "non-json" };
    return BUILTIN_PRICING;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    pricingMisconfig ??= { raw, reason: "non-object" };
    return BUILTIN_PRICING;
  }
  const overrides: Record<string, ModelPricing> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isPricingShape(value)) {
      pricingMisconfig ??= {
        raw,
        reason: "invalid-entry",
        detail: `entry "${key}" must be { inputPerMillion: number >= 0, outputPerMillion: number >= 0 }`,
      };
      return BUILTIN_PRICING;
    }
    overrides[key] = {
      inputPerMillion: value.inputPerMillion,
      outputPerMillion: value.outputPerMillion,
    };
  }
  return { ...BUILTIN_PRICING, ...overrides };
}

/**
 * Returns the resolved pricing for a model, matching by prefix to tolerate
 * Anthropic version suffixes (e.g., claude-sonnet-4-6-20250514). Returns
 * null when no built-in or env override matches; the route handler treats
 * null as a fail-loud pricing-misconfig signal.
 */
export function getModelPricing(model: string): ModelPricing | null {
  const pricing = resolvePricing();
  const key = Object.keys(pricing).find((prefix) => model.startsWith(prefix));
  return key ? pricing[key] : null;
}

/** Returns the pending pricing misconfig diagnostic (if any) and clears it. */
export function consumeModelPricingMisconfig(): ModelPricingMisconfig | null {
  const diagnostic = pricingMisconfig;
  pricingMisconfig = null;
  return diagnostic;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export function computeCost(usage: Usage, model: string): number | null {
  const pricing = getModelPricing(model);
  if (!pricing) return null;
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
  pricingMisconfig = null;
}
