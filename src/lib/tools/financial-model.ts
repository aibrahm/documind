// src/lib/tools/financial-model.ts
//
// Pure-JavaScript financial calculations exposed to Claude as a tool.
// Zero dependencies. NPV / IRR / payback period / sensitivity sweep.
// Handler returns a JSON string (the format Claude tool_result expects).

export interface CashFlow {
  year: number; // 0 = today
  amount: number; // positive = inflow, negative = outflow
}

/**
 * Net Present Value — sum of discounted cash flows.
 * NPV = Σ [ CF_t / (1 + r)^t ]
 */
export function npv(cashflows: CashFlow[], discountRate: number): number {
  return cashflows.reduce(
    (sum, cf) => sum + cf.amount / Math.pow(1 + discountRate, cf.year),
    0,
  );
}

/**
 * Internal Rate of Return — discount rate that makes NPV = 0.
 * Newton-Raphson with bisection fallback. Returns null if no convergence.
 */
export function irr(cashflows: CashFlow[], guess = 0.1): number | null {
  // Newton-Raphson
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const npvAtRate = npv(cashflows, rate);
    if (Math.abs(npvAtRate) < 0.01) return rate;
    const derivative = cashflows.reduce(
      (sum, cf) =>
        sum - (cf.year * cf.amount) / Math.pow(1 + rate, cf.year + 1),
      0,
    );
    if (Math.abs(derivative) < 1e-10) break;
    rate = rate - npvAtRate / derivative;
    if (rate < -0.99) rate = -0.99;
  }
  // Bisection fallback between -0.99 and +10
  let lo = -0.99;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npv(cashflows, mid);
    if (Math.abs(npvMid) < 0.01) return mid;
    if (npvMid > 0) lo = mid;
    else hi = mid;
  }
  return null;
}

/**
 * Simple payback period — fractional years until cumulative cashflow >= 0.
 */
export function paybackPeriod(cashflows: CashFlow[]): number | null {
  let cumulative = 0;
  const sorted = [...cashflows].sort((a, b) => a.year - b.year);
  for (let i = 0; i < sorted.length; i++) {
    const next = cumulative + sorted[i].amount;
    if (next >= 0 && cumulative < 0) {
      const fraction = -cumulative / sorted[i].amount;
      return sorted[i].year - (1 - fraction);
    }
    cumulative = next;
  }
  return null;
}

/**
 * Sensitivity sweep — recompute NPV across a range of discount rates.
 */
export function sensitivitySweep(params: {
  cashflows: CashFlow[];
  variable: "discount_rate";
  min: number;
  max: number;
  steps: number;
  metric: "npv";
}): Array<{ value: number; result: number }> {
  if (params.steps < 2) {
    return [{ value: params.min, result: npv(params.cashflows, params.min) }];
  }
  const stepSize = (params.max - params.min) / (params.steps - 1);
  return Array.from({ length: params.steps }, (_, i) => {
    const value = params.min + i * stepSize;
    const result = npv(params.cashflows, value);
    return { value, result };
  });
}

// ────────────────────────────────────────
// TOOL HANDLER
// ────────────────────────────────────────

export interface FinancialModelInput {
  operation: "npv" | "irr" | "payback" | "sensitivity";
  cashflows: CashFlow[];
  discount_rate?: number;
  sensitivity?: {
    variable: "discount_rate";
    min: number;
    max: number;
    steps: number;
  };
}

export async function runFinancialModel(rawInput: unknown): Promise<string> {
  const input = rawInput as Partial<FinancialModelInput>;
  if (!input || typeof input !== "object") {
    return JSON.stringify({ error: "Invalid input — expected object" });
  }

  const cashflows = Array.isArray(input.cashflows) ? input.cashflows : [];
  if (cashflows.length === 0) {
    return JSON.stringify({
      error: "cashflows array is required and must be non-empty",
    });
  }
  for (const cf of cashflows) {
    if (typeof cf.year !== "number" || typeof cf.amount !== "number") {
      return JSON.stringify({
        error: "Each cashflow must have { year: number, amount: number }",
      });
    }
  }

  switch (input.operation) {
    case "npv": {
      const rate =
        typeof input.discount_rate === "number" ? input.discount_rate : 0.12;
      const value = npv(cashflows, rate);
      return JSON.stringify({
        operation: "npv",
        discount_rate: rate,
        result: value,
        currency: "unspecified (assumed consistent across cashflows)",
      });
    }
    case "irr": {
      const rate = irr(cashflows);
      return JSON.stringify({
        operation: "irr",
        result: rate,
        note:
          rate === null
            ? "Could not converge — check cashflow pattern"
            : "Expressed as a decimal (0.15 = 15%)",
      });
    }
    case "payback": {
      const years = paybackPeriod(cashflows);
      return JSON.stringify({
        operation: "payback",
        result: years,
        note:
          years === null
            ? "Never recovers initial investment"
            : "Fractional years from year 0",
      });
    }
    case "sensitivity": {
      if (!input.sensitivity) {
        return JSON.stringify({
          error: "sensitivity config required for sensitivity operation",
        });
      }
      const sweep = sensitivitySweep({
        cashflows,
        variable: input.sensitivity.variable,
        min: input.sensitivity.min,
        max: input.sensitivity.max,
        steps: input.sensitivity.steps,
        metric: "npv",
      });
      return JSON.stringify({ operation: "sensitivity", sweep });
    }
    default:
      return JSON.stringify({
        error: `Unknown operation: ${input.operation}`,
      });
  }
}
