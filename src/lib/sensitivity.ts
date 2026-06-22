import { breakevenRentOnly, type CalcInputs } from "../engine/calculator";
import { pct } from "./format";

// Each factor sweeps one uncertain input across a plausible band, holding the rest at
// today's values, and reports how far the breakeven rent moves. The widest swings are
// the assumptions your answer is most hostage to. This is the data behind the tornado
// chart and the one-line "what your verdict leans on" callout, kept in one pure place
// so both read identical numbers.
// A factor sweeps a single scalar (lo..hi) into the inputs via `set`. Most factors target a
// plain numeric field, but `set` also lets a structured field ride along (maintenance is a
// CostBasis, not a bare number), so it isn't shut out of the tornado just for its shape.
type NumericKey = { [K in keyof CalcInputs]: CalcInputs[K] extends number ? K : never }[keyof CalcInputs];

// Default setter for the common case: overwrite one numeric field with the swept value.
const setNumeric = (key: NumericKey) => (inp: CalcInputs, v: number): CalcInputs => ({ ...inp, [key]: v });

export interface Factor {
  label: string;
  lo: number;
  hi: number;
  fmt: (n: number) => string;
  set: (inp: CalcInputs, value: number) => CalcInputs;
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
  // Maintenance can be entered as a flat dollar figure; sweep it as a percent of value either way
  // (deriving the implied rate from a flat entry) so it sits alongside the other rate sweeps.
  const maintRate =
    inp.maintenance.kind === "pctOfValue"
      ? inp.maintenance.rate
      : inp.homePrice > 0
        ? inp.maintenance.annual / inp.homePrice
        : 0.01;
  return [
    { label: "Mortgage rate", lo: Math.max(0, inp.mortgageRate - 0.015), hi: inp.mortgageRate + 0.015, fmt: (n) => pct(n, 2), set: setNumeric("mortgageRate") },
    { label: "Investment return", lo: Math.max(0, inp.investmentReturn - 0.02), hi: inp.investmentReturn + 0.02, fmt: p1, set: setNumeric("investmentReturn") },
    { label: "Home appreciation", lo: inp.homeAppreciation - 0.02, hi: inp.homeAppreciation + 0.02, fmt: p1, set: setNumeric("homeAppreciation") },
    { label: "Years you stay", lo: Math.max(1, inp.yearsToStay - 3), hi: inp.yearsToStay + 3, fmt: (n) => `${Math.round(n)}y`, set: setNumeric("yearsToStay") },
    { label: "Rent growth", lo: Math.max(0, inp.rentGrowth - 0.015), hi: inp.rentGrowth + 0.015, fmt: p1, set: setNumeric("rentGrowth") },
    { label: "Inflation", lo: Math.max(0, inp.inflation - 0.015), hi: inp.inflation + 0.015, fmt: p1, set: setNumeric("inflation") },
    // The 1-2%/yr maintenance rule of thumb is wide enough to move (sometimes flip) the verdict,
    // so it belongs in the tornado rather than hiding in Advanced.
    {
      label: "Maintenance",
      lo: Math.max(0, maintRate - 0.005),
      hi: maintRate + 0.01,
      fmt: p1,
      set: (i, v) => ({ ...i, maintenance: { kind: "pctOfValue", rate: v } }),
    },
  ];
}

/** Sweep every factor and sort widest-swing first (the tornado shape). breakevenRentOnly()
 *  is pure, but this runs it ~12 times, so callers should keep it off the input hot path. */
export function computeSensitivity(inputs: CalcInputs): SensitivityRow[] {
  const monthlyRent = inputs.monthlyRent;
  return buildFactors(inputs)
    .map((factor) => {
      const loBreakeven = breakevenRentOnly(factor.set(inputs, factor.lo));
      const hiBreakeven = breakevenRentOnly(factor.set(inputs, factor.hi));
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
