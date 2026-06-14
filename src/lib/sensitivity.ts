import { calculate, type CalcInputs } from "../engine/calculator";
import { pct } from "./format";

// Each factor sweeps one uncertain input across a plausible band, holding the rest at
// today's values, and reports how far the breakeven rent moves. The widest swings are
// the assumptions your answer is most hostage to. This is the data behind the tornado
// chart and the one-line "what your verdict leans on" callout, kept in one pure place
// so both read identical numbers.
// Only the numeric inputs are sweepable (lo/hi are numbers), so the key can't be a
// CostBasis or boolean field. This catches a bad factor entry at the table, not three
// calls deep inside calculate().
type NumericKey = { [K in keyof CalcInputs]: CalcInputs[K] extends number ? K : never }[keyof CalcInputs];

export interface Factor {
  key: NumericKey;
  label: string;
  lo: number;
  hi: number;
  fmt: (n: number) => string;
}

export interface SensitivityRow {
  label: string;
  range: [number, number]; // [low, high] breakeven rent, for the floating bar
  swing: number;
  loBreakeven: number; // breakeven rent at the factor's low end (and high end)
  hiBreakeven: number;
  factor: Factor;
  flips: boolean; // does the range straddle your actual rent?
}

export function buildFactors(inp: CalcInputs): Factor[] {
  const p1 = (n: number) => pct(n, 1);
  return [
    { key: "mortgageRate", label: "Mortgage rate", lo: Math.max(0, inp.mortgageRate - 0.015), hi: inp.mortgageRate + 0.015, fmt: (n) => pct(n, 2) },
    { key: "investmentReturn", label: "Investment return", lo: Math.max(0, inp.investmentReturn - 0.02), hi: inp.investmentReturn + 0.02, fmt: p1 },
    { key: "homeAppreciation", label: "Home appreciation", lo: inp.homeAppreciation - 0.02, hi: inp.homeAppreciation + 0.02, fmt: p1 },
    { key: "yearsToStay", label: "Years you stay", lo: Math.max(1, inp.yearsToStay - 3), hi: inp.yearsToStay + 3, fmt: (n) => `${Math.round(n)}y` },
    { key: "rentGrowth", label: "Rent growth", lo: Math.max(0, inp.rentGrowth - 0.015), hi: inp.rentGrowth + 0.015, fmt: p1 },
    { key: "inflation", label: "Inflation", lo: Math.max(0, inp.inflation - 0.015), hi: inp.inflation + 0.015, fmt: p1 },
  ];
}

/** Sweep every factor and sort widest-swing first (the tornado shape). calculate() is
 *  pure, but this runs it ~12 times, so callers should keep it off the input hot path. */
export function computeSensitivity(inputs: CalcInputs): SensitivityRow[] {
  const monthlyRent = inputs.monthlyRent;
  return buildFactors(inputs)
    .map((factor) => {
      const loBreakeven = calculate({ ...inputs, [factor.key]: factor.lo }).breakevenRent;
      const hiBreakeven = calculate({ ...inputs, [factor.key]: factor.hi }).breakevenRent;
      const lo = Math.min(loBreakeven, hiBreakeven);
      const hi = Math.max(loBreakeven, hiBreakeven);
      return {
        label: factor.label,
        range: [lo, hi] as [number, number],
        swing: hi - lo,
        loBreakeven,
        hiBreakeven,
        factor,
        flips: lo <= monthlyRent && monthlyRent <= hi,
      };
    })
    .sort((a, b) => b.swing - a.swing);
}

/** The single assumption the verdict leans on most: the widest swing that can actually
 *  flip the answer, or, if none can, the widest swing overall (a robust verdict). */
export function drivingFactor(rows: SensitivityRow[]): SensitivityRow | null {
  if (rows.length === 0) return null;
  return rows.find((r) => r.flips) ?? rows[0];
}
