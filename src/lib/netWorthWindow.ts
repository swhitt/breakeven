import type { NetWorthPoint } from "../engine/calculator";

/**
 * The engine simulates net worth out to a fixed 30 years so the breakeven crossing is always
 * somewhere in the array, however short the stay. That full span is right for the CSV, the
 * year-by-year table, and the breakeven marker, but wrong for the chart: on a long horizon the
 * renter's series is a balance, not a portfolio (rent outgrows the cost of owning and the kept
 * savings drain away), so a card titled "What you're worth" ends up plotting a renter hundreds
 * of thousands of dollars underwater at a year nobody in this scenario is staying to.
 */
export const NET_WORTH_MAX_YEARS = 30;

/**
 * How many years the wealth chart should plot: the user's stay, or the breakeven if it lands
 * later, plus two years of runway past whichever it is so the crossing isn't jammed against the
 * right edge.
 *
 * The max() is load-bearing and must not collapse to `yearsToStay + 2`: Los Angeles breaks even
 * at year 14 against the 9-year default stay, and clipping to 11 there would hide the exact
 * crossing the chart exists to show. (Pricier metros push it further out still, so the gap grows
 * with the metro rather than being an LA quirk.)
 */
export const netWorthWindowYears = (yearsToStay: number, breakevenYear: number | null): number =>
  Math.min(NET_WORTH_MAX_YEARS, Math.max(yearsToStay, breakevenYear ?? yearsToStay) + 2);

/** The engine's net-worth series clipped to that window. Years run 1..n from index 0. */
export const clipNetWorth = (
  data: NetWorthPoint[],
  yearsToStay: number,
  breakevenYear: number | null,
): NetWorthPoint[] => data.slice(0, netWorthWindowYears(yearsToStay, breakevenYear));
