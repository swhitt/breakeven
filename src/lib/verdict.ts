import type { CalcResult } from "../engine/calculator";

// Within this fraction of the breakeven the verdict is a near-tie; below that the gap reads
// like a real rent-vs-buy advantage worth naming. A single product constant so the Hero, the
// Verdict card, the announcer, and SimpleCalc can't disagree on what counts as a toss-up.
export const CLOSE_CALL_FRACTION = 0.05;

// Just the fields the verdict copy needs from the inputs, so SimpleCalc (which holds AppInputs)
// and App both satisfy it without a CalcInputs/AppInputs mismatch.
interface VerdictInputs {
  monthlyRent: number;
}

/** True when the breakeven and the actual rent are within CLOSE_CALL_FRACTION of each other. */
export const isCloseCall = (result: CalcResult, inputs: VerdictInputs): boolean =>
  Math.abs(result.monthlyDifference) < inputs.monthlyRent * CLOSE_CALL_FRACTION;

/** The short verdict word: a toss-up, or the cheaper option. */
export const verdictLabel = (result: CalcResult, inputs: VerdictInputs): string =>
  isCloseCall(result, inputs) ? "Toss-up" : result.verdict === "rent" ? "Rent it" : "Buy it";
