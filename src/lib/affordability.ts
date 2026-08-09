/**
 * Affordability math: the lender's view of the payment.
 *
 * Three things need the same number, and they used to be three hand-copied expressions in the
 * UI: the ratio panel ("housing payment, 31% of gross"), the verdict's qualification caveat
 * ("past the 43% line, a standard loan likely won't approve this"), and the price search
 * ("what could you afford?"). A quoted max price that disagrees with the panel by a few dollars
 * is a UI that offers you a price and then denies it, so everything here folds through one
 * definition of the housing payment and one definition of the ratio.
 *
 * Pure module, no React and no simulation: the price search is closed-form arithmetic on the
 * engine's own primitives rather than a calculate() per candidate price.
 */

import {
  housingPaymentLines,
  impliedRate,
  monthlyMortgagePayment,
  pmiLtvMultiplier,
  type CalcResult,
  type CostBasis,
} from "../engine/calculator";

// The conventional 28/36 underwriting rule of thumb: lenders like housing costs at or under 28%
// of gross monthly income (front-end), and total debt (housing plus car/student/card payments)
// at or under 36% (back-end). Many programs stretch the back-end to ~43%, but 36% is the
// comfortable line the affordability panel measures against.
export const DTI_FRONT_END_LIMIT = 0.28;
export const DTI_BACK_END_LIMIT = 0.36;
// The QM safe-harbor back-end ceiling. Above this most lenders deny or kick to manual
// underwrite, so a confident "Buy it" deserves a qualification caveat regardless of the
// economic verdict. 36% is the comfort line; 43% is the approval wall.
export const DTI_QM_LIMIT = 0.43;

/**
 * Just the income and debt the ratios divide by, so any holder of the app's full input state
 * satisfies it without this module importing that state's shape (same structural trick as
 * verdict.ts, and the reason the engine's CalcInputs stays free of UI-only fields).
 */
export interface DtiInputs {
  annualIncome: number;
  otherMonthlyDebt: number;
}

/**
 * Everything needed to re-price a purchase from scratch at a candidate price: the financing
 * terms, plus the carrying costs that ride the price. `homePrice` is the user's own price, read
 * only to interpret a flat-dollar tax or insurance entry as a rate (see impliedRate) before that
 * rate is applied to the candidate.
 */
export interface PriceSearchInputs extends DtiInputs {
  homePrice: number;
  downPaymentPct: number;
  mortgageRate: number;
  mortgageTermYears: number;
  propertyTax: CostBasis;
  homeInsurance: CostBasis;
  hoaMonthly: number;
  pmiRate: number;
}

/**
 * Ceiling on the price search. Bisection needs a bounded interval, and past this the answer
 * stops describing the loan the rest of the app models (jumbo/portfolio underwriting has its
 * own ratios). A search that runs into the cap returns the cap, so callers that want to say
 * "over $5M" rather than "$5,000,000" can compare against it.
 */
export const MAX_SEARCH_PRICE = 5_000_000;

// Percent-of-value fallbacks for a flat-dollar cost entered against a zero price, where no rate
// is derivable from the entry itself. Same national-ish figures defaults.ts falls back to when a
// state is missing from the rate tables.
const FALLBACK_PROPERTY_TAX_RATE = 0.011;
const FALLBACK_INSURANCE_RATE = 0.005;

/**
 * Gross monthly PITI from its two halves: the mortgage payment, and the carrying costs the
 * lender counts. Trivial arithmetic, deliberately named: both the simulation-backed payment
 * below and the closed-form one the price search quotes fold their components through here, so
 * "the housing payment" is one composition rather than two that drift a line item apart.
 */
const totalHousingPayment = (principalAndInterest: number, components: number[]): number =>
  components.reduce((sum, c) => sum + c, principalAndInterest);

/**
 * Back-end DTI once the payment is known: housing plus every other recurring debt payment, over
 * gross monthly income. Callers own the "is there any income" guard, which is what lets the
 * price search evaluate this a few dozen times without re-testing a constant.
 */
const dtiFor = (housing: number, otherMonthlyDebt: number, grossMonthly: number): number =>
  (housing + otherMonthlyDebt) / grossMonthly;

/**
 * Gross monthly PITI: the all-in housing payment lenders qualify against, before any tax
 * benefit. The year-1 housing-payment lines deliberately EXCLUDE maintenance (see the
 * `inHousingPayment` flag on the engine's cost registry) because lenders exclude it: it's a
 * budget reality, not part of the payment underwriting measures.
 *
 * Lines are filtered to the ones that actually cost something, matching what the panel itemizes.
 * That filter is load-bearing for exactly one input: a negative HOA (reachable only via a
 * crafted share link) is dropped rather than credited against the payment.
 *
 * A result always carries a year-1 row for any horizon the engine accepts, so the fallback is a
 * totality guard rather than a real branch. It answers with the closed form at the user's own
 * price instead of 0 or a null both callers would have to unwrap, which also means the fallback
 * can't contradict the price the search quotes.
 */
export function housingPayment(result: CalcResult, inputs: PriceSearchInputs): number {
  const y1 = result.years[0];
  if (!y1) return housingPaymentAtPrice(inputs, inputs.homePrice);
  const lines = housingPaymentLines(y1).filter((l) => l.monthly > 0);
  return totalHousingPayment(
    result.monthlyPayment,
    lines.map((l) => l.monthly),
  );
}

/**
 * Back-end DTI (housing PITI + other debt over gross monthly income), or null when there's no
 * income or no loan to qualify. Shared by the verdict's qualification caveat and the
 * affordability panel so both read the same ratio.
 */
export function backEndDti(result: CalcResult, inputs: PriceSearchInputs): number | null {
  const y1 = result.years[0];
  if (!y1 || inputs.annualIncome <= 0 || result.loanAmount <= 0) return null;
  return dtiFor(housingPayment(result, inputs), inputs.otherMonthlyDebt, inputs.annualIncome / 12);
}

/**
 * The gross monthly housing payment a purchase at `price` would carry, priced from scratch
 * rather than read off a simulation. Same components in the same order as housingPayment, so
 * the two answer the same question; they differ only in when they ask it.
 *
 * housingPayment reports the year-1 AVERAGE, which the engine grows month by month with
 * appreciation and inflation. This is the payment at closing. On a 3.5%-appreciation default
 * that makes the panel's tax + insurance run ~2% above what the search priced, so a price quoted
 * right at a limit can land a fraction of a point over it once typed in. Modelling within-year
 * growth here would be modelling a payment nobody makes on day one, so callers that quote a
 * price should round it down (a few thousand dollars covers the gap at any realistic price)
 * rather than quote to the dollar.
 *
 * PMI is priced off the ORIGINAL loan-to-value, which is 1 - downPaymentPct and therefore the
 * same at every candidate price. The engine cancels PMI mid-year once appreciation drops the
 * current LTV under 80%; charging the full premium here errs toward a smaller max price, the
 * safe direction for a number the UI is offering.
 *
 * Rate, term, and down payment are clamped the way sanitizeInputs clamps them before the engine
 * runs, so a crafted share link can't make the search price a loan the simulation wouldn't.
 */
function housingPaymentAtPrice(inputs: PriceSearchInputs, price: number): number {
  const downPct = Math.min(1, Math.max(0, inputs.downPaymentPct));
  const loan = Math.max(0, price) * (1 - downPct);
  const pi = monthlyMortgagePayment(loan, Math.max(0, inputs.mortgageRate), Math.max(1, inputs.mortgageTermYears));
  // A flat-dollar tax bill or premium is read as the rate it implies at the user's own price,
  // then applied to the candidate: a pricier house carries a proportionally bigger bill, which
  // is the whole reason the payment is monotone in price.
  const taxRate = impliedRate(inputs.propertyTax, inputs.homePrice, FALLBACK_PROPERTY_TAX_RATE);
  const insuranceRate = impliedRate(inputs.homeInsurance, inputs.homePrice, FALLBACK_INSURANCE_RATE);
  const originalLtv = 1 - downPct;
  const pmi = originalLtv > 0.8 ? (loan * Math.max(0, inputs.pmiRate) * pmiLtvMultiplier(originalLtv)) / 12 : 0;
  return totalHousingPayment(pi, [
    (taxRate * Math.max(0, price)) / 12,
    (insuranceRate * Math.max(0, price)) / 12,
    // Matches the `monthly > 0` filter housingPayment applies to the same line.
    Math.max(0, inputs.hoaMonthly),
    pmi,
  ]);
}

/**
 * The highest home price whose back-end DTI lands at `targetDti`, holding income, other debt,
 * down-payment percent, rate, term, and the user's tax/insurance rates fixed. Null when no
 * positive price qualifies, i.e. there's no income, or other debt and HOA alone already eat the
 * whole ratio before a single dollar of mortgage.
 *
 * Bisection rather than the closed-form inversion the (currently affine) payment would allow:
 * the payment stops being affine the moment a component gets a bracket or a floor, and every
 * component here is monotone non-decreasing in price, which is all the search needs. Forty
 * halvings take a $5M interval to well under a cent, so the result is exact for any price the
 * UI would print.
 */
export function maxPriceForDti(inputs: PriceSearchInputs, targetDti: number): number | null {
  const grossMonthly = inputs.annualIncome / 12;
  if (grossMonthly <= 0) return null;
  const dtiAt = (price: number) => dtiFor(housingPaymentAtPrice(inputs, price), inputs.otherMonthlyDebt, grossMonthly);
  // The ratio at a free house: other debt plus HOA. At or over the target there's nothing left
  // to spend on a mortgage, and quoting $0 would be worse than saying nothing.
  if (!(dtiAt(0) < targetDti)) return null;
  if (dtiAt(MAX_SEARCH_PRICE) <= targetDti) return MAX_SEARCH_PRICE;
  let lo = 0; // always qualifies
  let hi = MAX_SEARCH_PRICE; // never qualifies
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (dtiAt(mid) <= targetDti) lo = mid;
    else hi = mid;
  }
  return lo > 0 ? lo : null;
}
