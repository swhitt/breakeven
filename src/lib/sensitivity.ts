import { breakevenRentOnly, impliedRate, type CalcInputs } from "../engine/calculator";
import { pct } from "./format";

// Each factor sweeps one uncertain input across a plausible band, holding the rest at
// today's values, and reports how far the breakeven rent moves. The widest swings are
// the assumptions your answer is most hostage to. This is the data behind the tornado
// chart and the one-line "what your verdict leans on" callout, kept in one pure place
// so both read identical numbers.
// A factor sweeps a single scalar (lo..hi) into the inputs via `set`. Most factors target a
// plain numeric field, but `set` also lets a structured field ride along (maintenance and
// insurance are CostBasis, not bare numbers), so neither is shut out of the tornado for its shape.
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
  return [
    { label: "Mortgage rate", lo: Math.max(0, inp.mortgageRate - 0.015), hi: inp.mortgageRate + 0.015, fmt: (n) => pct(n, 2), set: setNumeric("mortgageRate") },
    { label: "Investment return", lo: Math.max(0, inp.investmentReturn - 0.02), hi: inp.investmentReturn + 0.02, fmt: p1, set: setNumeric("investmentReturn") },
    { label: "Home appreciation", lo: inp.homeAppreciation - 0.02, hi: inp.homeAppreciation + 0.02, fmt: p1, set: setNumeric("homeAppreciation") },
    // Round the endpoints: the engine rounds yearsToStay to whole years internally, so an
    // un-rounded (e.g. fractional, share-link) center would sweep a band whose printed labels
    // and computed horizons disagree. Rounding here keeps the swept value, the engine's horizon,
    // and the label in sync.
    { label: "Years you stay", lo: Math.max(1, Math.round(inp.yearsToStay - 3)), hi: Math.round(inp.yearsToStay + 3), fmt: (n) => `${Math.round(n)}y`, set: setNumeric("yearsToStay") },
    { label: "Rent growth", lo: Math.max(0, inp.rentGrowth - 0.015), hi: inp.rentGrowth + 0.015, fmt: p1, set: setNumeric("rentGrowth") },
    { label: "Inflation", lo: Math.max(0, inp.inflation - 0.015), hi: inp.inflation + 0.015, fmt: p1, set: setNumeric("inflation") },
    // The 1-2%/yr maintenance rule of thumb is wide enough to move (sometimes flip) the verdict,
    // so it belongs in the tornado rather than hiding in Advanced. Sweep it in its NATIVE basis:
    // a flat-dollar entry rides inflation in the engine while a pct entry rides appreciation, so
    // converting flat to pct would center the bar on the wrong cost behavior whenever the two
    // diverge. Both modes are swept as a rate-like scalar around the implied rate, but the flat
    // setter rebuilds a flat-dollar figure (rate * price) so the engine sees the same kind it would
    // for a real entry.
    maintenanceFactor(inp, p1),
    // Insurance is the one bar on this chart with a concrete next action behind it ("go get an
    // actual quote"), so it earns a row even though it never tops the tornado: on Tampa (FL, the
    // table's worst rate) it swings ~$386 against ~$803 for home appreciation, mid-pack of the
    // eight. Worth a row, not a headline.
    // Sweep it RELATIVE (0.65x-1.35x of the entered rate) rather than the fixed percentage-point
    // band the other factors use, because the state table behind the default spans ~0.23% (HI) to
    // ~1.86% (FL): any single point-width band is a rounding error at one end of that 8x range and
    // wider than the whole premium at the other.
    insuranceFactor(inp),
  ];
}

/**
 * Maintenance sweep that preserves the entry's basis kind. Both modes sweep around the same
 * implied %-of-value rate (so the band width matches the 1-2% rule of thumb), but a flat-dollar
 * entry stays flat-dollar through the setter, keeping the swept cost on the inflation track the
 * engine actually uses for it rather than flipping it onto the appreciation track.
 */
function maintenanceFactor(inp: CalcInputs, fmtRate: (n: number) => string): Factor {
  const maintRate = impliedRate(inp.maintenance, inp.homePrice, 0.01);
  const isFlat = inp.maintenance.kind === "flatAnnual";
  return {
    label: "Maintenance",
    lo: Math.max(0, maintRate - 0.005),
    hi: maintRate + 0.01,
    fmt: fmtRate,
    set: (i, v) =>
      isFlat
        ? { ...i, maintenance: { kind: "flatAnnual", annual: v * i.homePrice } }
        : { ...i, maintenance: { kind: "pctOfValue", rate: v } },
  };
}

/**
 * Insurance sweep, built on the same basis-preserving shape as maintenance: both modes sweep the
 * implied %-of-value rate, but a flat-dollar premium stays flat-dollar through the setter so the
 * swept cost keeps riding inflation instead of being silently flipped onto the appreciation track.
 * The band is multiplicative because the plausible error in a premium scales with the premium
 * itself: +/-35% is a believable quote-vs-default gap in Hawaii and in Florida alike, where a
 * shared percentage-point band could not be meaningful at both ends at once.
 * Endpoints print at two decimals (unlike the other rate factors' one) because the cheap end of
 * the table lives in the second digit: Hawaii's band is 0.15%-0.31%, which one decimal rounds to
 * "0.1%"-"0.3%", reading as a 3x spread rather than the +/-35% it actually is.
 */
function insuranceFactor(inp: CalcInputs): Factor {
  const insRate = impliedRate(inp.homeInsurance, inp.homePrice, 0.005);
  const isFlat = inp.homeInsurance.kind === "flatAnnual";
  return {
    label: "Home insurance",
    lo: insRate * 0.65,
    hi: insRate * 1.35,
    fmt: (n) => pct(n, 2),
    set: (i, v) =>
      isFlat
        ? { ...i, homeInsurance: { kind: "flatAnnual", annual: v * i.homePrice } }
        : { ...i, homeInsurance: { kind: "pctOfValue", rate: v } },
  };
}

/** Sweep every factor and sort widest-swing first (the tornado shape). breakevenRentOnly()
 *  is pure, but this runs it twice per factor, so callers should keep it off the input hot path. */
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
