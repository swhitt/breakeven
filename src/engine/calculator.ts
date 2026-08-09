/**
 * Rent-vs-buy engine.
 *
 * Model uses a four-bucket cost decomposition (initial costs, recurring costs,
 * opportunity costs, net sale proceeds), grounded in the user-cost-of-
 * homeownership literature (Himmelberg, Mayer & Sinai 2005). Every cash flow is
 * discounted at the investment-return rate,
 * which IS the opportunity cost of capital, then we solve for the monthly rent
 * at which buying and renting break even.
 *
 * Two headline outputs:
 *   1. breakevenRent  - the first-year monthly rent that makes buying == renting
 *                       at the chosen horizon. Rent for less => renting wins.
 *   2. breakevenYear  - the horizon at which buying overtakes renting given the
 *                       rent the user actually entered ("stay longer than N years
 *                       and buying wins").
 *
 * The simulation is monthly for accuracy (amortization, PMI drop-off, compounding).
 */

import { CAPITAL_GAINS_EXCLUSION, MORTGAGE_INTEREST_DEBT_CAP, saltCapForYear, TAX_YEAR } from "./taxConstants";

/**
 * How a recurring ownership cost is expressed. A tagged union so only one
 * representation exists at a time (no stale sibling field):
 *   pctOfValue - a fraction of the *current* (appreciating) home value / yr.
 *   flatAnnual - a flat dollar figure / yr in today's dollars, grown with inflation
 *                (useful where assessment caps decouple the bill from market value).
 */
export type CostBasis = { kind: "pctOfValue"; rate: number } | { kind: "flatAnnual"; annual: number };

/** Monthly cost from a basis: %-of-value rides the home value, flat rides inflation. */
export function monthlyCostFromBasis(basis: CostBasis, homeValue: number, inflationFactor: number): number {
  return basis.kind === "flatAnnual"
    ? (Math.max(0, basis.annual) * inflationFactor) / 12
    : (homeValue * Math.max(0, basis.rate)) / 12;
}

/**
 * The percent-of-value rate a basis implies at a given price: the rate itself for a pct entry,
 * or the flat dollar figure over the price for a flat entry. `fallback` covers a zero/unknown
 * price (no rate is derivable). The UI and the sensitivity sweep both need to show or seed a
 * single rate regardless of which mode the cost was entered in, so this lives next to the
 * CostBasis it interprets instead of being re-spelled per call site.
 */
export function impliedRate(basis: CostBasis, homePrice: number, fallback = 0): number {
  if (basis.kind === "pctOfValue") return basis.rate;
  return homePrice > 0 ? basis.annual / homePrice : fallback;
}

export interface CalcInputs {
  // Purchase
  homePrice: number;
  downPaymentPct: number; // fraction, e.g. 0.2
  mortgageRate: number; // annual, e.g. 0.0652
  mortgageTermYears: number; // e.g. 30
  homeAppreciation: number; // annual, e.g. 0.03

  // Horizon & money
  yearsToStay: number; // e.g. 9
  // Does double duty (on purpose): the opportunity cost of the down payment AND the
  // discount rate for every cash flow. So mortgage and uncertain-appreciation flows
  // are discounted at the same risk-blind rate, a deliberate simplification. The engine
  // discounts/compounds at this rate net of INVESTMENT_TAX_DRAG, since the renter's
  // alternative is a taxable portfolio (see afterTaxReturn).
  investmentReturn: number; // annual opportunity / discount rate (pre-tax), e.g. 0.05
  inflation: number; // annual, e.g. 0.024

  // Recurring ownership costs. Property tax, maintenance, and insurance each carry
  // a CostBasis (percent-of-value or flat-annual); see CostBasis above.
  propertyTax: CostBasis;
  maintenance: CostBasis;
  homeInsurance: CostBasis;
  hoaMonthly: number; // grows with inflation

  // Transaction costs
  buyingClosingPct: number; // of price, e.g. 0.03
  sellingCostPct: number; // of sale price, e.g. 0.06

  // Financing extras
  pmiRate: number; // base rate on original loan / yr while LTV > 80%, scaled by original LTV (see pmiLtvMultiplier), e.g. 0.0058

  // Taxes
  marginalTaxRate: number; // e.g. 0.24
  standardDeduction: number; // for the itemization-premium calc
  otherSALT: number; // other state/local taxes counted toward SALT cap
  filingJointly: boolean; // cap-gains exclusion 500k vs 250k
  capitalGainsRate: number; // e.g. 0.15

  // Rent side
  monthlyRent: number; // market rent being compared
  rentGrowth: number; // annual, e.g. 0.03
  rentersInsuranceMonthly: number;
  securityDepositMonths: number; // e.g. 1
  brokerFeeMonths: number; // e.g. 0
}

/**
 * Recurring carrying costs of owning, as a registry the simulation, the breakdown
 * table, and the composition chart all read from. Adding a cost (or, later, a
 * rent-side cost like moving expenses) is a single entry here instead of a hand-
 * synced edit across the loop, the row shape, the chart buckets, and the table.
 */
export interface CostContext {
  homePrice: number;
  homeValue: number; // current (appreciated) value
  inflationFactor: number; // (1 + inflation)^yearFraction
  loanBalance: number; // after this month's principal
  originalLoan: number;
  month: number; // 1-based month of the simulation (PMI termination is seasoning-dependent)
  termMonths: number; // amortization term in months (PMI's midpoint termination)
}

export interface RecurringCost {
  // Widened to string so CostKey can be derived FROM the registry below; `as const` narrows
  // each actual entry's key back to its literal, which is what makes up CostKey.
  key: string;
  label: string;
  side: "buy" | "rent";
  // Required (not optional) so every `as const` entry carries the key, which keeps the flag
  // readable across the whole union instead of existing on only some members.
  deductibleSALT: boolean; // counts toward the SALT itemized base (capped)
  inHousingPayment: boolean; // part of the all-in monthly housing payment (excludes maintenance)
  monthly: (inp: CalcInputs, ctx: CostContext) => number;
}

export const RECURRING_COSTS = [
  {
    key: "propertyTax",
    label: "Property tax",
    side: "buy",
    deductibleSALT: true,
    inHousingPayment: true,
    monthly: (i, c) => monthlyCostFromBasis(i.propertyTax, c.homeValue, c.inflationFactor),
  },
  {
    key: "maintenance",
    label: "Maintenance",
    side: "buy",
    deductibleSALT: false,
    inHousingPayment: false, // a budget reality, not part of the lender's payment
    monthly: (i, c) => monthlyCostFromBasis(i.maintenance, c.homeValue, c.inflationFactor),
  },
  {
    key: "insurance",
    label: "Insurance",
    side: "buy",
    deductibleSALT: false,
    inHousingPayment: true,
    monthly: (i, c) => monthlyCostFromBasis(i.homeInsurance, c.homeValue, c.inflationFactor),
  },
  {
    // HOA dues (and any other flat monthly owning cost), inflation-grown.
    key: "hoa",
    label: "HOA / other",
    side: "buy",
    deductibleSALT: false,
    inHousingPayment: true,
    monthly: (i, c) => i.hoaMonthly * c.inflationFactor,
  },
  {
    // PMI attaches to loans that START above 80% LTV and comes off the way the Homeowners
    // Protection Act actually makes servicers drop it, which is much later than "the moment
    // the appreciated value implies 80%". Three separate exits, whichever lands first:
    //   1. Automatic termination at 78% of the ORIGINAL price. The statutory trigger is the
    //      amortization schedule, not the market, so appreciation buys nothing here.
    //   2. Midpoint of the amortization term, unconditionally (the HPA final-termination rule).
    //   3. Borrower-REQUESTED cancellation off current (appreciated) value, which is the only
    //      exit appreciation opens and which the borrower has to ask for: 75% LTV after 2 years
    //      of seasoning, 80% after 5. We model the earliest a diligent borrower could get it;
    //      a borrower who never asks pays until (1) or (2), so this is the optimistic edge.
    // Cancelling on appreciated value alone with no seasoning (the old rule here) let a 5%-down
    // buyer out around year 4 when the real schedule keeps them in for years longer, understating
    // the cost of a low-down purchase by thousands. Cancellation is a one-way door in real life
    // and stays one here: under a constant appreciation rate the current LTV can't dip under a
    // threshold and climb back (amortization only accelerates), so no month re-imposes PMI.
    // The premium itself is priced off the ORIGINAL loan, the way servicers quote it, and scaled
    // by the ORIGINAL LTV: PMI is risk-priced, so a 97% LTV loan costs multiples of an 85% one
    // (see pmiLtvMultiplier).
    key: "pmi",
    label: "PMI",
    side: "buy",
    deductibleSALT: false,
    inHousingPayment: true,
    monthly: (i, c) => {
      // Compared as a product, not a ratio: `1 - 0.2` is exactly 0.8 in binary, so this is the
      // same multiplication that produced a 20%-down buyer's loan and ties exactly, whereas
      // loan/price can round a step above 0.8 (try $200,003) and bill them for PMI forever.
      if (!(c.originalLoan > c.homePrice * 0.8)) return 0;
      if (c.loanBalance <= 0.78 * c.homePrice) return 0; // automatic termination
      if (c.month >= c.termMonths / 2) return 0; // midpoint termination
      const currentLtv = c.loanBalance / c.homeValue;
      if (c.month >= 24 && currentLtv <= 0.75) return 0; // borrower-requested, 2yr seasoning
      if (c.month >= 60 && currentLtv <= 0.8) return 0; // borrower-requested, 5yr seasoning
      return (c.originalLoan * i.pmiRate * pmiLtvMultiplier(c.originalLoan / c.homePrice)) / 12;
    },
  },
] as const satisfies readonly RecurringCost[];

/**
 * Risk multiplier on the base PMI rate, keyed off the ORIGINAL loan-to-value. Real PMI rate
 * sheets price almost entirely off LTV (and credit, which we don't model): a 95-97% LTV loan
 * runs roughly double an 85% one, and a 97%+ loan higher still. The base `pmiRate` (~0.58%)
 * is calibrated to the 90-95% band, so the multiplier is ~1 there and steps up or down from it.
 * A single flat rate massively understated the cost of a low-down purchase, which made a 3-5%
 * down buy look far cheaper than a lender would ever price it.
 */
export function pmiLtvMultiplier(originalLtv: number): number {
  if (originalLtv > 0.97) return 2.6; // ~1.5%+ effective, the high-balance-risk tier
  if (originalLtv > 0.95) return 1.7; // ~1.0% effective, the 95-97 band
  if (originalLtv > 0.9) return 1.0; // the band the base rate is calibrated to
  return 0.7; // 80-90% LTV, where PMI is cheapest
}

// The registry is the single source of truth for cost keys. Deriving CostKey from it means
// adding an entry above extends the type, and Record<CostKey, ...> consumers (the year row,
// COST_COLORS in the chart) fail to compile until they cover the new key.
export type CostKey = (typeof RECURRING_COSTS)[number]["key"];

const BUY_COSTS = RECURRING_COSTS.filter((c) => c.side === "buy");

/** A fresh per-cost accumulator zeroed for every registry key. */
function zeroCosts(): Record<CostKey, number> {
  return Object.fromEntries(RECURRING_COSTS.map((c) => [c.key, 0])) as Record<CostKey, number>;
}

/** A fresh set of annual accumulators, as one object so the year-end reset is a single
 *  assignment that can't desync (add a field here and it's reset for free). */
function zeroYear() {
  return { interest: 0, deductibleInterest: 0, principal: 0, mortgage: 0, costs: zeroCosts() };
}

// Year-row aggregations live next to the row so every view derives the same number
// from one place instead of re-spelling the sum (and silently dropping a new cost).

/** Total recurring carrying costs for the year (every registry bucket). */
export const sumCosts = (y: YearRow): number => Object.values(y.costs).reduce((s, n) => s + n, 0);

/** Gross annual cash cost of owning: mortgage plus all carrying costs, before tax. */
export const grossOwningCost = (y: YearRow): number => y.mortgagePaid + sumCosts(y);

/** Net annual cash cost of owning: gross less the federal tax benefit. */
export const netOwningCost = (y: YearRow): number => grossOwningCost(y) - y.taxBenefit;

/** The carrying costs that make up the all-in monthly housing payment (property tax,
 *  insurance, HOA, PMI; NOT maintenance), as {label, monthly} pairs for the year. */
export const housingPaymentLines = (y: YearRow): { label: string; monthly: number }[] =>
  BUY_COSTS.filter((c) => c.inHousingPayment).map((c) => ({ label: c.label, monthly: y.costs[c.key] / 12 }));

export interface YearRow {
  year: number;
  // buy
  mortgagePaid: number;
  interestPaid: number;
  principalPaid: number;
  costs: Record<CostKey, number>; // recurring carrying costs for the year, keyed by registry
  taxBenefit: number; // positive = money back (itemization premium over the standard deduction)
  // The two itemized-deduction components the tax benefit is built from, exposed so the
  // "show your work" panel narrates the engine's actual numbers instead of re-deriving them.
  deductibleInterest: number; // mortgage interest left deductible after the 163(h)(3) cap
  saltUsed: number; // property tax + other SALT, after the SALT cap
  homeValue: number;
  loanBalance: number;
  equity: number;
  // rent
  rentPaid: number;
  // Wealth, if you exited at the end of this year. buyerNetWorth is the home sale's net
  // proceeds (value, less selling costs, loan payoff, and capital-gains tax). renterNetWorth
  // is the "invest the difference" portfolio: the down payment + closing the buyer sank into
  // the house, plus every month of cash-flow difference, compounded at the investment return.
  // Both are filled by calculate() (simulateBuy alone doesn't know the rent side); they cross
  // in the exact year the cumulative-cost lines cross, by construction.
  buyerNetWorth: number;
  renterNetWorth: number;
}

export interface HorizonPoint {
  year: number;
  buyNetCost: number; // PV today's dollars
  rentNetCost: number; // PV today's dollars
}

// Wealth at each horizon year if you sold and moved out then. buyerNetWorth is the home
// sale's net proceeds; renterNetWorth is the invest-the-difference portfolio. They cross in
// the exact breakeven year by construction. Spans the FULL horizon (not just the stay), so
// the net-worth chart can show the crossover even when breakeven is past yearsToStay.
export interface NetWorthPoint {
  year: number;
  buyerNetWorth: number;
  renterNetWorth: number;
}

export interface CalcResult {
  breakevenRent: number; // first-year monthly rent that ties buy vs rent at yearsToStay
  verdict: "buy" | "rent";
  monthlyDifference: number; // breakevenRent - monthlyRent (positive => renting cheaper)
  buyNetCost: number; // PV at yearsToStay
  rentNetCost: number; // PV at yearsToStay
  breakevenYear: number | null; // horizon where buying overtakes renting at entered rent
  monthlyPayment: number; // mortgage P&I
  loanAmount: number;
  horizon: HorizonPoint[]; // per-year net cost, both sides, for charting
  netWorth: NetWorthPoint[]; // per-year wealth, both sides, across the full horizon (chart)
  years: YearRow[]; // per-year breakdown for the "show your work" table
}

const clampPos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Clamp inputs to safe ranges before simulating. The sliders already keep normal
 * use in range, so this is a no-op for the UI; its job is to stop a crafted ?s=
 * share link or a momentarily-empty field from driving the sim to NaN/Infinity
 * (negative-base fractional powers, a negative discount factor) and then having
 * clampPos launder that into a confident, wrong "buy" verdict.
 */
export function sanitizeInputs(inp: CalcInputs): CalcInputs {
  return {
    ...inp,
    homePrice: Math.max(0, inp.homePrice),
    // Growth rates feed Math.pow(1 + r, t) with fractional t, so 1 + r must stay >= 0.
    homeAppreciation: Math.max(-1, inp.homeAppreciation),
    inflation: Math.max(-1, inp.inflation),
    rentGrowth: Math.max(-1, inp.rentGrowth),
    mortgageRate: Math.max(0, inp.mortgageRate),
    // Discount rate is an opportunity cost: negative would inflate future flows.
    investmentReturn: Math.max(0, inp.investmentReturn),
    downPaymentPct: Math.min(1, Math.max(0, inp.downPaymentPct)),
    // Term 0 would skip amortization yet still net out the full balance at sale
    // (an interest-free balloon); a financed purchase needs at least one year.
    mortgageTermYears: Math.max(1, inp.mortgageTermYears),
    yearsToStay: Math.max(1, inp.yearsToStay),
  };
}

/** Standard fixed-rate monthly payment. */
export function monthlyMortgagePayment(loan: number, annualRate: number, termYears: number): number {
  const n = Math.round(termYears * 12);
  if (n <= 0) return 0;
  const i = annualRate / 12;
  if (i === 0) return loan / n;
  const f = Math.pow(1 + i, n);
  return (loan * i * f) / (f - 1);
}

interface BuySim {
  pvCost: number;
  years: YearRow[];
  monthlyPayment: number;
  loanAmount: number;
  endHomeValue: number; // appreciated value at the sale point
  endBalance: number; // remaining loan balance at the sale point
}

/**
 * Buyer's wealth if they sold today: net sale proceeds after selling costs, loan payoff,
 * and capital-gains tax (IRC 121 primary-residence exclusion applied). The single source of
 * truth for "what the buyer walks away with", shared by the headline sale, the breakdown
 * rows, and the net-worth chart so they can't drift.
 */
function buyerNetWorthAt(inp: CalcInputs, homeValue: number, loanBalance: number, holdYears: number): number {
  const closing = inp.homePrice * inp.buyingClosingPct;
  const sellingCosts = homeValue * inp.sellingCostPct;
  const gain = homeValue - sellingCosts - inp.homePrice - closing;
  // IRC 121 needs 2 of the last 5 years of ownership and use, so a sale inside two years gets
  // no exclusion and is taxed on the full gain. (For the common owner-occupant hold past 2yr
  // this is the usual $250k/$500k shield.)
  const fullExclusion = inp.filingJointly ? CAPITAL_GAINS_EXCLUSION.joint : CAPITAL_GAINS_EXCLUSION.single;
  const exclusion = holdYears >= 2 ? fullExclusion : 0;
  // A gain on a hold of a year or less is SHORT-term: it's taxed as ordinary income, not at
  // the preferential long-term rate. Long-term status needs MORE than a year, so the 12-month
  // point (the year-1 point of the horizon sweep) is still short-term, and a flip there should
  // show the buyer's own marginal rate rather than a flattering 15%.
  const gainsRate = holdYears <= 1 ? inp.marginalTaxRate : inp.capitalGainsRate;
  const capGainsTax = gainsRate * Math.max(0, gain - exclusion);
  return homeValue - sellingCosts - loanBalance - capGainsTax;
}

/**
 * Present-value cost of buying, assuming a sale at `horizonYears`.
 * Positive = net dollars spent in today's money. Monthly cash flows discounted
 * at investmentReturn/12. Tax benefit credited annually as the itemization
 * premium over the standard deduction (so it's $0 when standard deduction wins).
 */
// The renter's "invest the difference" savings sit in a taxable brokerage, so they don't
// compound at the full return: a buy-and-hold index fund pays tax on its dividends every year,
// while the appreciation is deferred (and partly stepped up), much as the home's sale gain is
// usually shielded by the IRC 121 exclusion. The lifetime drag on such a portfolio runs ~0.5%/yr,
// which we take off the opportunity/discount rate so neither side compounds entirely tax-free.
// Deliberately NOT tied to capitalGainsRate: that taxes a realized gain, this is an annual
// holding drag, and coupling them would make the cap-gains knob push the verdict two ways.
export const INVESTMENT_TAX_DRAG = 0.005;

// After-tax opportunity cost of capital: the single rate that both discounts every flow and
// compounds the renter's invested savings. Using one rate for both is what keeps the cost
// breakeven and the wealth crossover on the same year (see the net-worth identity in calculate).
const afterTaxReturn = (inp: CalcInputs): number => Math.max(0, inp.investmentReturn - INVESTMENT_TAX_DRAG);

function simulateBuy(inp: CalcInputs, horizonYears: number, collectRows: boolean): BuySim {
  const months = Math.round(horizonYears * 12);
  const loan = inp.homePrice * (1 - inp.downPaymentPct);
  const payment = monthlyMortgagePayment(loan, inp.mortgageRate, inp.mortgageTermYears);
  const termMonths = Math.round(inp.mortgageTermYears * 12);
  const mRate = inp.mortgageRate / 12;
  const disc = afterTaxReturn(inp) / 12;

  const downPayment = inp.homePrice * inp.downPaymentPct;
  const closing = inp.homePrice * inp.buyingClosingPct;

  // Initial outlay happens at t=0, no discount.
  let pv = downPayment + closing;

  let balance = loan;
  const rows: YearRow[] = [];

  // Annual accumulators for the tax-benefit calc and the breakdown table. `deductibleInterest`
  // is interest scaled month-by-month by the IRC 163(h)(3) cap (see the loop), separate from
  // `interest` (cash paid). One object so the year-end reset can't drift from the fields.
  let acc = zeroYear();

  for (let m = 1; m <= months; m++) {
    const yearFrac = m / 12;
    const homeValue = inp.homePrice * Math.pow(1 + inp.homeAppreciation, yearFrac);
    const df = Math.pow(1 + disc, m); // discount factor for end of month m

    // Mortgage split
    let interest = 0;
    let principal = 0;
    let pay = 0;
    if (m <= termMonths && balance > 0) {
      interest = balance * mRate;
      principal = Math.min(payment - interest, balance);
      pay = interest + principal;
      // IRC 163(h)(3): interest is deductible only on the first $750k of
      // acquisition debt (same cap for single/HoH/MFJ; MFS's $375k isn't modeled).
      // Acquisition debt falls as you amortize, so the deductible fraction is
      // recomputed off the current balance and rises to 1 once it's under the cap.
      acc.deductibleInterest += interest * Math.min(1, MORTGAGE_INTEREST_DEBT_CAP / balance);
      balance -= principal;
    }

    // Recurring carrying costs from the registry. Percent-of-value items ride the
    // appreciating home value; flat-dollar items (and HOA/utilities) ride inflation.
    const infl = Math.pow(1 + inp.inflation, yearFrac);
    const ctx: CostContext = {
      homePrice: inp.homePrice,
      homeValue,
      inflationFactor: infl,
      loanBalance: balance, // post-amortization, for the PMI LTV test
      originalLoan: loan,
      month: m,
      termMonths,
    };
    let recurring = 0;
    for (const c of BUY_COSTS) {
      const amt = c.monthly(inp, ctx);
      acc.costs[c.key] += amt;
      recurring += amt;
    }

    const monthlyOut = pay + recurring;
    pv += monthlyOut / df;

    acc.interest += interest;
    acc.principal += principal;
    acc.mortgage += pay;

    // Year boundary: credit the tax benefit (itemization premium over standard).
    // Horizons are always whole years (callers round), so every year is full.
    if (m % 12 === 0) {
      const saltBase = BUY_COSTS.reduce((s, c) => (c.deductibleSALT ? s + acc.costs[c.key] : s), 0);
      // SALT cap is time-varying: it follows the OBBBA schedule and drops to the $10k cliff
      // in 2030, so a horizon that crosses 2030 uses the lower cap in its later years instead
      // of holding the entry-year value flat (which overstated the long-horizon buyer benefit).
      const calendarYear = TAX_YEAR + (m / 12 - 1);
      const saltCap = saltCapForYear(calendarYear);
      const saltUsed = Math.min(saltBase + inp.otherSALT, saltCap);
      // PMI is deliberately excluded from itemized deductions. OBBBA restored the
      // mortgage-insurance-premium deduction for 2026+, but it phases out between
      // $100k-$110k AGI and the model has no AGI input (the default 24% marginal
      // rate already implies AGI past the phaseout), so we treat PMI as a pure cost.
      // The standard deduction is indexed at general inflation, the way the statute indexes it.
      // Freezing it while the itemized total inflates with the home doesn't hedge the SALT taper
      // above - both shrink the itemization premium, so they compound - it just overstates the
      // long-horizon benefit for itemizers. (otherSALT is still held at its entry-year nominal.)
      const standardDeduction = inp.standardDeduction * Math.pow(1 + inp.inflation, calendarYear - TAX_YEAR);
      // The benefit is INCREMENTAL: what buying adds on top of the deduction this filer takes
      // anyway. `otherSALT` (state/local income tax, fed in by the tax estimator) is deductible
      // whether or not you buy, so a renter carrying enough of it already itemizes; crediting
      // buying with those dollars overstates the benefit for exactly the high earner in a
      // high-tax state. Both sides floor at the standard deduction, so the premium is identically
      // $0 whenever the standard deduction wins the buy case (the common path), and collapses to
      // a plain max(0, itemized - standard) whenever otherSALT alone can't beat it.
      // The premium is still valued at a single marginal rate (a small overstatement when it
      // straddles a bracket).
      const itemizedBuy = acc.deductibleInterest + saltUsed;
      const itemizedRent = Math.min(inp.otherSALT, saltCap);
      const benefit =
        inp.marginalTaxRate * (Math.max(standardDeduction, itemizedBuy) - Math.max(standardDeduction, itemizedRent));
      pv -= benefit / df;

      if (collectRows) {
        rows.push({
          year: Math.ceil(m / 12),
          mortgagePaid: acc.mortgage,
          interestPaid: acc.interest,
          principalPaid: acc.principal,
          costs: acc.costs,
          taxBenefit: benefit,
          deductibleInterest: acc.deductibleInterest,
          saltUsed,
          homeValue,
          loanBalance: balance,
          equity: homeValue - balance,
          rentPaid: 0, // placeholder, filled by calculate()
          buyerNetWorth: 0, // placeholders, filled by calculate() (need the rent side + horizon)
          renterNetWorth: 0,
        });
      }
      acc = zeroYear();
    }
  }

  // Sale at the horizon (inflow, discounted). Net proceeds are the buyer's wealth at the
  // sale point, so the shared helper computes them (basis = purchase price + buying closing,
  // symmetric with selling costs, with the IRC 121 exclusion applied inside).
  const saleValue = inp.homePrice * Math.pow(1 + inp.homeAppreciation, horizonYears);
  const netProceeds = buyerNetWorthAt(inp, saleValue, balance, horizonYears);
  const saleDf = Math.pow(1 + disc, months);
  pv -= netProceeds / saleDf;

  return {
    pvCost: pv,
    years: rows,
    monthlyPayment: payment,
    loanAmount: loan,
    endHomeValue: saleValue,
    endBalance: balance,
  };
}

/**
 * Present-value cost of renting at a given first-year monthly rent.
 * Linear in `monthlyRent`, which we exploit to solve breakeven in closed form.
 */
function simulateRent(inp: CalcInputs, horizonYears: number, monthlyRent: number): number {
  const months = Math.round(horizonYears * 12);
  const disc = afterTaxReturn(inp) / 12;

  const deposit = monthlyRent * inp.securityDepositMonths;
  const brokerFee = monthlyRent * inp.brokerFeeMonths;
  let pv = deposit + brokerFee;

  for (let m = 1; m <= months; m++) {
    const yearIdx = Math.floor((m - 1) / 12);
    const rent = monthlyRent * Math.pow(1 + inp.rentGrowth, yearIdx);
    const renters = inp.rentersInsuranceMonthly * Math.pow(1 + inp.inflation, m / 12);
    const df = Math.pow(1 + disc, m);
    pv += (rent + renters) / df;
  }

  // Deposit returned at move-out (inflow).
  pv -= deposit / Math.pow(1 + disc, months);
  return pv;
}

/** Closed-form breakeven rent: rent PV is affine in monthlyRent, so solve directly. */
function breakevenRentAt(inp: CalcInputs, horizonYears: number, buyPvCost: number): number {
  // slope: rent-proportional flows only (zero renters insurance, the one rent-independent cost)
  const perUnit = simulateRent({ ...inp, rentersInsuranceMonthly: 0 }, horizonYears, 1);
  // intercept: rent-independent flows only (zero deposit/broker, which scale with rent)
  const fixed = simulateRent({ ...inp, securityDepositMonths: 0, brokerFeeMonths: 0 }, horizonYears, 0);
  if (perUnit <= 0) return 0;
  return clampPos((buyPvCost - fixed) / perUnit);
}

export function calculate(rawInp: CalcInputs): CalcResult {
  const inp = sanitizeInputs(rawInp);
  const horizon = Math.max(1, Math.round(inp.yearsToStay));

  // Headline: full sim at the chosen horizon, with breakdown rows.
  const buy = simulateBuy(inp, horizon, true);
  const rentNetCost = simulateRent(inp, horizon, inp.monthlyRent);
  const breakevenRent = breakevenRentAt(inp, horizon, buy.pvCost);

  // Horizon sweep for the charts, the breakeven year, and the per-year cumulative PV the net
  // worth derives from. (When does buying overtake renting?) Net worth is built here too, so
  // the wealth chart spans the full horizon, not just the stay.
  const disc = afterTaxReturn(inp) / 12;
  const maxYears = Math.max(horizon, inp.mortgageTermYears, 30);
  const points: HorizonPoint[] = [];
  const netWorth: NetWorthPoint[] = [];
  let breakevenYear: number | null = null;
  for (let y = 1; y <= maxYears; y++) {
    const sim = simulateBuy(inp, y, false);
    const r = simulateRent(inp, y, inp.monthlyRent);
    points.push({ year: y, buyNetCost: sim.pvCost, rentNetCost: r });
    // Buyer wealth = net sale proceeds at year y. Renter wealth = that plus the future value
    // of buying's PV cost advantage, so the two cross in the exact breakeven year (same
    // identity as the per-row fill below, just across every horizon year).
    const buyerNetWorth = buyerNetWorthAt(inp, sim.endHomeValue, sim.endBalance, y);
    const renterNetWorth = buyerNetWorth + (sim.pvCost - r) * Math.pow(1 + disc, y * 12);
    netWorth.push({ year: y, buyerNetWorth, renterNetWorth });
    if (breakevenYear === null && sim.pvCost <= r) breakevenYear = y;
  }

  // Fill rentPaid + the net-worth pair into the breakdown rows (the chart reads result.netWorth
  // above; these rows feed the table + CSV, which only span the stay).
  const years = buy.years.map((r) => {
    let rentPaid = 0;
    for (let m = (r.year - 1) * 12 + 1; m <= r.year * 12; m++) {
      const yearIdx = Math.floor((m - 1) / 12);
      rentPaid += inp.monthlyRent * Math.pow(1 + inp.rentGrowth, yearIdx);
    }
    const buyerNetWorth = buyerNetWorthAt(inp, r.homeValue, r.loanBalance, r.year);
    const pt = points[r.year - 1];
    const renterNetWorth = buyerNetWorth + (pt.buyNetCost - pt.rentNetCost) * Math.pow(1 + disc, r.year * 12);
    return { ...r, rentPaid, buyerNetWorth, renterNetWorth };
  });

  const verdict: "buy" | "rent" = inp.monthlyRent <= breakevenRent ? "rent" : "buy";

  return {
    breakevenRent,
    verdict,
    monthlyDifference: breakevenRent - inp.monthlyRent,
    buyNetCost: buy.pvCost,
    rentNetCost,
    breakevenYear,
    monthlyPayment: buy.monthlyPayment,
    loanAmount: buy.loanAmount,
    horizon: points,
    netWorth,
    years,
  };
}

/**
 * Just the breakeven rent at the chosen horizon, nothing else. The sensitivity tornado runs
 * this two dozen times per slider settle and reads only `breakevenRent`, so it skips the full
 * calculate() (the horizon sweep, the per-year net-worth array, the breakdown rows) that those
 * runs would throw away. Byte-identical to calculate().breakevenRent: same first three steps,
 * just minus the unread work. A test pins the two together so they can't drift.
 */
export function breakevenRentOnly(rawInp: CalcInputs): number {
  const inp = sanitizeInputs(rawInp);
  const horizon = Math.max(1, Math.round(inp.yearsToStay));
  const buy = simulateBuy(inp, horizon, false);
  return breakevenRentAt(inp, horizon, buy.pvCost);
}

/**
 * Just the year buying overtakes renting, nothing else. Same sweep calculate() runs, minus the
 * per-year net-worth array, the breakdown rows, and the horizon points nobody reads here, and it
 * stops at the first crossing instead of walking the full 30 years. Callers that only need "stay
 * longer than N years" (the copy that leads the verdict, share-card text) pay for one answer, not
 * a whole result object. Identical to calculate().breakevenYear, including the null when the two
 * lines never cross inside the sweep; a test pins the two together so they can't drift.
 */
export function breakevenYearOnly(rawInp: CalcInputs): number | null {
  const inp = sanitizeInputs(rawInp);
  const horizon = Math.max(1, Math.round(inp.yearsToStay));
  const maxYears = Math.max(horizon, inp.mortgageTermYears, 30);
  for (let y = 1; y <= maxYears; y++) {
    if (simulateBuy(inp, y, false).pvCost <= simulateRent(inp, y, inp.monthlyRent)) return y;
  }
  return null;
}
