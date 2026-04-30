import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ABSOLUTE_CEILING_USD,
  CAP_MULTIPLIER,
  MONTHLY_BUDGET_USD_DEFAULT,
  computeCost,
  consumeMonthlyBudgetMisconfig,
  exceedsBudget,
  exceedsMonthlyBudget,
  getMonthlyBudgetUsd,
  getMonthlyCumulativeUsd,
  medianCost,
  recordCost,
  recordMonthlyCost,
  resetHistoryForTests,
  resetMonthlyStateForTests,
} from "./cost";

beforeEach(() => {
  resetHistoryForTests();
  resetMonthlyStateForTests();
  delete process.env.MONTHLY_BUDGET_USD;
});

afterEach(() => {
  delete process.env.MONTHLY_BUDGET_USD;
});

describe("computeCost", () => {
  it("returns expected USD for sonnet pricing", () => {
    const cost = computeCost(
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      "claude-sonnet-4-6",
    );
    expect(cost).toBe(18);
  });

  it("matches a model when the version suffix differs", () => {
    const cost = computeCost(
      { input_tokens: 100_000, output_tokens: 50_000 },
      "claude-sonnet-4-6-20250514",
    );
    expect(cost).toBeCloseTo(0.3 + 0.75, 5);
  });

  it("returns null for an unknown model", () => {
    const cost = computeCost(
      { input_tokens: 1000, output_tokens: 500 },
      "gpt-5-omega",
    );
    expect(cost).toBeNull();
  });

  it("returns 0 for zero usage", () => {
    expect(
      computeCost({ input_tokens: 0, output_tokens: 0 }, "claude-haiku-4-5"),
    ).toBe(0);
  });
});

describe("recordCost and medianCost", () => {
  it("ignores NaN and negative inputs", () => {
    recordCost(Number.NaN);
    recordCost(-1);
    expect(medianCost()).toBeNull();
  });

  it("returns null on empty history", () => {
    expect(medianCost()).toBeNull();
  });

  it("returns the middle value for odd-length history", () => {
    [0.01, 0.05, 0.02].forEach(recordCost);
    expect(medianCost()).toBe(0.02);
  });

  it("averages the two middle values for even-length history", () => {
    [0.01, 0.02, 0.03, 0.04].forEach(recordCost);
    expect(medianCost()).toBe(0.025);
  });

  it("caps history length, dropping oldest entries", () => {
    for (let i = 0; i < 60; i++) recordCost(i);
    // History capped at 50; oldest 10 dropped.
    const median = medianCost();
    expect(median).toBeGreaterThanOrEqual(34);
  });
});

describe("exceedsBudget", () => {
  it("flags any single request above the absolute ceiling", () => {
    const result = exceedsBudget(ABSOLUTE_CEILING_USD + 0.01);
    expect(result.exceeded).toBe(true);
    expect(result.cap).toBe(ABSOLUTE_CEILING_USD);
  });

  it("passes on empty history (no median to compare)", () => {
    const result = exceedsBudget(0.5);
    expect(result.exceeded).toBe(false);
    expect(result.median).toBeNull();
  });

  it("flags requests above CAP_MULTIPLIER × median", () => {
    [0.01, 0.02, 0.03].forEach(recordCost);
    // median = 0.02, cap = 0.06
    const result = exceedsBudget(0.07);
    expect(result.exceeded).toBe(true);
    expect(result.cap).toBeCloseTo(0.02 * CAP_MULTIPLIER, 5);
  });

  it("passes requests at or below CAP_MULTIPLIER × median", () => {
    [0.01, 0.02, 0.03].forEach(recordCost);
    const result = exceedsBudget(0.05);
    expect(result.exceeded).toBe(false);
  });
});

describe("getMonthlyBudgetUsd", () => {
  it("returns the default when env is unset", () => {
    expect(getMonthlyBudgetUsd()).toBe(MONTHLY_BUDGET_USD_DEFAULT);
    expect(consumeMonthlyBudgetMisconfig()).toBeNull();
  });

  it("parses a plain numeric env value", () => {
    process.env.MONTHLY_BUDGET_USD = "75";
    expect(getMonthlyBudgetUsd()).toBe(75);
  });

  it("rejects '50 USD' and records a misconfig diagnostic", () => {
    process.env.MONTHLY_BUDGET_USD = "50 USD";
    expect(getMonthlyBudgetUsd()).toBe(MONTHLY_BUDGET_USD_DEFAULT);
    const diag = consumeMonthlyBudgetMisconfig();
    expect(diag?.reason).toBe("non-numeric");
    expect(diag?.raw).toBe("50 USD");
  });

  it("rejects zero and records a non-positive misconfig", () => {
    process.env.MONTHLY_BUDGET_USD = "0";
    expect(getMonthlyBudgetUsd()).toBe(MONTHLY_BUDGET_USD_DEFAULT);
    expect(consumeMonthlyBudgetMisconfig()?.reason).toBe("non-positive");
  });

  it("clears the misconfig diagnostic after consume", () => {
    process.env.MONTHLY_BUDGET_USD = "garbage";
    getMonthlyBudgetUsd();
    consumeMonthlyBudgetMisconfig();
    expect(consumeMonthlyBudgetMisconfig()).toBeNull();
  });
});

describe("monthly tracker", () => {
  it("accumulates only finite, non-negative costs", () => {
    recordMonthlyCost(0.5);
    recordMonthlyCost(Number.NaN);
    recordMonthlyCost(-1);
    recordMonthlyCost(0.25);
    expect(getMonthlyCumulativeUsd()).toBeCloseTo(0.75, 5);
  });

  it("reports below budget when cumulative under the cap", () => {
    process.env.MONTHLY_BUDGET_USD = "10";
    recordMonthlyCost(5);
    expect(exceedsMonthlyBudget()).toBe(false);
  });

  it("reports exhausted when cumulative meets or exceeds the cap", () => {
    process.env.MONTHLY_BUDGET_USD = "5";
    recordMonthlyCost(3);
    recordMonthlyCost(2);
    expect(exceedsMonthlyBudget()).toBe(true);
  });
});
