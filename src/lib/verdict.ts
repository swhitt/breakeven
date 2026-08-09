import type { CalcResult } from "../engine/calculator";

// Within this fraction of the breakeven the verdict is a near-tie; below that the gap reads
// like a real rent-vs-buy advantage worth naming. A single product constant so the Hero, the
// Verdict card, the announcer, and SimpleCalc can't disagree on what counts as a toss-up.
export const CLOSE_CALL_FRACTION = 0.05;

// The dollar gap is only half the story: an answer can sit far outside the close-call band and
// still be hostage to assumptions that each, on their own, move the breakeven past your rent.
// At three such assumptions the honest word is "toss-up", however wide the gap looks. Without
// this the site prints a confident "Buy it" directly above "A close call: 3 assumptions could
// each flip it", two different claims about the same number. (The 5% band alone fires on
// roughly one metro in ten, so it can't carry this on its own.)
export const TOSS_UP_FLIP_COUNT = 3;

// Just the fields the verdict copy needs from the inputs, so SimpleCalc (which holds AppInputs)
// and App both satisfy it without a CalcInputs/AppInputs mismatch.
interface VerdictInputs {
  monthlyRent: number;
}

/** Exactly three outcomes, shared by every surface: the Hero, the announcer, the share text,
 *  the OG cards. Deliberately no hedged fourth word ("Leaning buy"), because a verdict is
 *  either named or it's a toss-up. */
export type VerdictConfidence = "toss-up" | "rent" | "buy";

/** True when the breakeven and the actual rent are within CLOSE_CALL_FRACTION of each other. */
export const isCloseCall = (result: CalcResult, inputs: VerdictInputs): boolean =>
  Math.abs(result.monthlyDifference) < inputs.monthlyRent * CLOSE_CALL_FRACTION;

/**
 * How confident the answer is, in the only three words the product uses. A toss-up when the gap
 * is inside the close-call band OR when TOSS_UP_FLIP_COUNT assumptions can each flip it alone.
 *
 * `flipCount` is the number of sensitivity rows whose swing straddles the actual rent (see
 * computeSensitivity). It's optional because surfaces that never run the sweep (SimpleCalc,
 * anything holding only a CalcResult) shouldn't have to import the tornado to ask this
 * question: omitting it means "band only", which is exactly how the site behaved before.
 */
export const verdictConfidence = (
  result: CalcResult,
  inputs: VerdictInputs,
  flipCount = 0,
): VerdictConfidence =>
  flipCount >= TOSS_UP_FLIP_COUNT || isCloseCall(result, inputs) ? "toss-up" : result.verdict;

const VERDICT_WORDS: Record<VerdictConfidence, string> = {
  "toss-up": "Toss-up",
  rent: "Rent it",
  buy: "Buy it",
};

/** The short verdict word: a toss-up, or the cheaper option. */
export const verdictLabel = (result: CalcResult, inputs: VerdictInputs, flipCount?: number): string =>
  VERDICT_WORDS[verdictConfidence(result, inputs, flipCount)];
