/**
 * Two claims the verdict copy makes that the engine has no field for.
 *
 * The first is the number behind "hinges on home appreciation": the rate at which buying stops
 * losing and starts winning, so the card can say what the answer actually costs instead of
 * gesturing at a lever. The second is the precondition for calling the auto-filled rent "the
 * typical local rent" at all -- that the price being modelled still describes a local home.
 *
 * Both are pure and live here rather than inline in App because both have edges that print
 * nonsense when they're wrong (a bisection that never brackets quotes its own ceiling; a rent
 * asserted about a house nobody is buying), and an edge you can't write a test for is an edge
 * that ships.
 */

import { breakevenRentOnly, type CalcInputs } from "../engine/calculator";

/**
 * Top of the swept appreciation range. Past ~15%/yr the question stops being "will prices rise
 * enough" and becomes "is this a bubble", so a scenario that needs more than this is reported as
 * having no answer rather than quoted a number someone might plan around.
 */
export const MAX_APPRECIATION_SEARCH = 0.15;

/**
 * Where the verdict turns as home appreciation varies, in the only three shapes the copy can
 * honestly print.
 *
 * The two non-numeric cases are not defensive padding, they're both reachable from the sliders.
 * "flat" is a cheap house against a dear rent: buying already wins with prices dead still, so
 * there is no rate to name. "unreachable" is the short stay, where the ~9% round trip in closing
 * and selling costs outruns any appreciation worth quoting. Collapsing either into a rate is
 * exactly how this shipped once before, printing the search ceiling as though it were an answer
 * for every city on the list.
 */
export type AppreciationPivot = { kind: "rate"; rate: number } | { kind: "flat" } | { kind: "unreachable" };

/**
 * The home-appreciation rate at which buying overtakes renting, found by bisecting the engine's
 * own breakeven rent rather than by inverting anything.
 *
 * Buying's present cost falls as prices rise, so the breakeven rent (the rent at which the two
 * tie) is decreasing in appreciation, and the verdict is "buy" exactly where it drops under the
 * rent actually being paid. That monotonicity is what makes bisection legitimate. Percent-of-value
 * carrying costs do ride appreciation upward too, but over any horizon this app models the equity
 * at sale outruns them by an order of magnitude, so the crossing is single.
 *
 * The win test is `<`, matching the engine's own verdict tie-break (a rent exactly at the
 * breakeven is a rent verdict), so the quoted rate can't disagree with the word above it.
 * Twenty halvings of [0, 15%] land inside 1.5e-7, far finer than the one decimal place printed.
 */
export function pivotAppreciation(inputs: CalcInputs): AppreciationPivot {
  const buyingWinsAt = (rate: number) =>
    breakevenRentOnly({ ...inputs, homeAppreciation: rate }) < inputs.monthlyRent;
  if (buyingWinsAt(0)) return { kind: "flat" };
  if (!buyingWinsAt(MAX_APPRECIATION_SEARCH)) return { kind: "unreachable" };
  let lo = 0; // buying loses here
  let hi = MAX_APPRECIATION_SEARCH; // and wins here
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (buyingWinsAt(mid)) hi = mid;
    else lo = mid;
  }
  // The winning side, so the quoted rate is one buying actually clears rather than one it misses.
  return { kind: "rate", rate: hi };
}

/**
 * How far a price may sit from the place's typical home before the local typical rent stops
 * being a comparable for it. Symmetric in ratio rather than in dollars, so a home 20% dearer and
 * one 20% cheaper (typical / 1.2) both land exactly on the edge instead of the cheap side
 * getting a wider pass.
 */
export const LOCAL_PRICE_TOLERANCE = 0.2;

/**
 * Whether the modelled price still describes the kind of home the auto-filled rent was measured
 * on. Type $600k into a $308k metro and the site would otherwise keep calling the $2,209 it
 * filled in "the typical local rent" -- true of that metro, and false of the house now being
 * priced, which is the sort of quiet mismatch that makes a whole verdict wrong.
 *
 * A missing or zero typical value means we have nothing to compare against, which reads as "no
 * complaint" rather than as a mismatch: this gates a warning, and a warning fired on data we
 * never had is worse than no warning.
 */
export const pricedLikeLocal = (price: number, typical: number, tolerance = LOCAL_PRICE_TOLERANCE): boolean => {
  if (!(typical > 0) || !(price > 0)) return true;
  const ratio = price / typical;
  return ratio <= 1 + tolerance && ratio >= 1 / (1 + tolerance);
};
