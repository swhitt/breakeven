import { describe, expect, it } from "vitest";
import {
  breakevenRentOnly,
  breakevenYearOnly,
  calculate,
  impliedRate,
  monthlyMortgagePayment,
  pmiLtvMultiplier,
  type CalcInputs,
  type YearRow,
} from "./calculator";
import { saltCapForYear, TAX_YEAR } from "./taxConstants";

const base: CalcInputs = {
  homePrice: 400000,
  downPaymentPct: 0.2,
  mortgageRate: 0.065,
  mortgageTermYears: 30,
  homeAppreciation: 0.03,
  yearsToStay: 9,
  investmentReturn: 0.05,
  inflation: 0.024,
  propertyTax: { kind: "pctOfValue", rate: 0.011 },
  maintenance: { kind: "pctOfValue", rate: 0.01 },
  homeInsurance: { kind: "pctOfValue", rate: 0.005 },
  hoaMonthly: 0,
  buyingClosingPct: 0.03,
  sellingCostPct: 0.06,
  pmiRate: 0.0058,
  marginalTaxRate: 0.24,
  standardDeduction: 32200,
  otherSALT: 0,
  filingJointly: true,
  capitalGainsRate: 0.15,
  monthlyRent: 2200,
  rentGrowth: 0.03,
  rentersInsuranceMonthly: 15,
  securityDepositMonths: 1,
  brokerFeeMonths: 0,
};

describe("monthlyMortgagePayment", () => {
  it("matches the standard amortization formula", () => {
    // $200k at 6% over 30yr is a textbook ~$1199.10
    expect(monthlyMortgagePayment(200000, 0.06, 30)).toBeCloseTo(1199.1, 1);
  });

  it("handles a zero interest rate as straight-line", () => {
    expect(monthlyMortgagePayment(360000, 0, 30)).toBeCloseTo(1000, 6);
  });
});

describe("calculate", () => {
  it("produces a positive, finite breakeven rent", () => {
    const r = calculate(base);
    expect(r.breakevenRent).toBeGreaterThan(0);
    expect(Number.isFinite(r.breakevenRent)).toBe(true);
  });

  it("breakeven rent ties buy and rent net cost (closed form is correct)", () => {
    const r = calculate(base);
    const atBreakeven = calculate({ ...base, monthlyRent: r.breakevenRent });
    // At the breakeven rent the two PV costs must coincide.
    expect(atBreakeven.buyNetCost).toBeCloseTo(atBreakeven.rentNetCost, 2);
  });

  it("recommends renting when market rent is below breakeven, buying when above", () => {
    const r = calculate(base);
    const cheap = calculate({ ...base, monthlyRent: r.breakevenRent - 300 });
    const pricey = calculate({ ...base, monthlyRent: r.breakevenRent + 300 });
    expect(cheap.verdict).toBe("rent");
    expect(pricey.verdict).toBe("buy");
  });

  it("a higher capital-gains rate raises the cost of buying (higher breakeven rent)", () => {
    // Push the gain well above the single-filer $250k exclusion so the tax actually bites.
    const taxable = { ...base, homePrice: 700000, homeAppreciation: 0.07, yearsToStay: 14, filingJointly: false };
    const low = calculate({ ...taxable, capitalGainsRate: 0 });
    const high = calculate({ ...taxable, capitalGainsRate: 0.3 });
    expect(high.breakevenRent).toBeGreaterThan(low.breakevenRent);
  });

  it("denies the IRC 121 exclusion on a sale inside two years", () => {
    // A one-year gain (~$102k) that sits UNDER the single-filer $250k exclusion: a qualifying
    // (2+ year) sale would shield it entirely, but a sub-2-year flip fails the 2-of-5 rule, so the
    // gain is taxable and moves the year-1 net worth. A one-year hold is also SHORT-term, so the
    // rate that bites is the ordinary one (see the short-term-gain tests below), not cap gains.
    const quickFlip = { ...base, homePrice: 2_000_000, homeAppreciation: 0.15, yearsToStay: 1, filingJointly: false };
    const noTax = calculate({ ...quickFlip, marginalTaxRate: 0 });
    const taxed = calculate({ ...quickFlip, marginalTaxRate: 0.37 });
    expect(taxed.netWorth[0].buyerNetWorth).toBeLessThan(noTax.netWorth[0].buyerNetWorth);
  });

  it("taxes a twelve-month flip as a SHORT-term gain, at ordinary rates", () => {
    // Long-term treatment needs MORE than a year of holding, so the year-1 point of the horizon
    // sweep is short-term: the buyer's own marginal rate, not the flattering 15% long-term rate.
    const flip = { ...base, homePrice: 2_000_000, homeAppreciation: 0.15, yearsToStay: 1, filingJointly: false };
    // Hand-computed gain: $2.3M value less 6% selling costs, against a basis of the $2M price plus
    // the 3% buying closing => $2,162,000 - $2,060,000 = $102,000, none of it excludable.
    const gain = 2_300_000 * 0.94 - 2_000_000 - 60_000;
    expect(gain).toBeCloseTo(102_000, 6);
    const untaxed = calculate({ ...flip, marginalTaxRate: 0, capitalGainsRate: 0 }).netWorth[0].buyerNetWorth;
    const ordinary = calculate({ ...flip, marginalTaxRate: 0.37, capitalGainsRate: 0 }).netWorth[0].buyerNetWorth;
    expect(untaxed - ordinary).toBeCloseTo(0.37 * gain, 6);
    // And the long-term rate must not touch a hold this short.
    const longTermRate = calculate({ ...flip, marginalTaxRate: 0, capitalGainsRate: 0.3 }).netWorth[0].buyerNetWorth;
    expect(longTermRate).toBe(untaxed);
  });

  it("switches to the long-term rate once the hold passes a year", () => {
    // Two years of 15% appreciation on a $2M home clears the single-filer $250k exclusion, so
    // there is a taxable gain to price - and past twelve months it prices at the cap-gains rate.
    const held = { ...base, homePrice: 2_000_000, homeAppreciation: 0.15, yearsToStay: 2, filingJointly: false };
    const taxable = 2_000_000 * 1.15 ** 2 * 0.94 - 2_060_000 - 250_000;
    expect(taxable).toBeGreaterThan(0);
    const noCg = calculate({ ...held, capitalGainsRate: 0 }).netWorth[1].buyerNetWorth;
    const cg = calculate({ ...held, capitalGainsRate: 0.3 }).netWorth[1].buyerNetWorth;
    expect(noCg - cg).toBeCloseTo(0.3 * taxable, 6);
    // The ordinary rate is irrelevant to the sale once the gain is long-term.
    const lowBracket = calculate({ ...held, marginalTaxRate: 0.1 }).netWorth[1].buyerNetWorth;
    const highBracket = calculate({ ...held, marginalTaxRate: 0.37 }).netWorth[1].buyerNetWorth;
    expect(highBracket).toBe(lowBracket);
  });

  it("still applies the IRC 121 exclusion once the 2-of-5 hold is met", () => {
    // Same kind of modest gain (~$116k, under the $250k exclusion) but held three years: it now
    // qualifies, so the gain is shielded and the cap-gains rate leaves net worth untouched.
    const held = { ...base, homePrice: 2_000_000, homeAppreciation: 0.05, yearsToStay: 3, filingJointly: false };
    const noTax = calculate({ ...held, capitalGainsRate: 0 });
    const taxed = calculate({ ...held, capitalGainsRate: 0.3 });
    expect(taxed.netWorth[2].buyerNetWorth).toBeCloseTo(noTax.netWorth[2].buyerNetWorth, 6);
  });

  it("longer horizons favor buying, so net cost lines cross at a finite breakeven year", () => {
    const r = calculate(base);
    expect(r.breakevenYear).not.toBeNull();
    expect(r.breakevenYear!).toBeGreaterThan(0);
  });

  it("exposes a per-year breakdown of the right length", () => {
    const r = calculate(base);
    expect(r.years).toHaveLength(base.yearsToStay);
    expect(r.years[0].interestPaid).toBeGreaterThan(0);
  });

  it("PMI only applies below 20% equity, so a big down payment carries none", () => {
    const noPmi = calculate({ ...base, downPaymentPct: 0.5 });
    const totalPmi = noPmi.years.reduce((s, y) => s + y.costs.pmi, 0);
    expect(totalPmi).toBe(0);
  });

  it("drops PMI sooner in an appreciating market (borrower-requested cancellation reads current value)", () => {
    // 10% down starts at 90% LTV. With appreciation the home outgrows the loan, so the borrower
    // can request cancellation once seasoned; flat, only amortization gets there, which is far
    // slower, so the rising market accrues materially less total PMI for exactly the low-down buyer.
    const lowDown = { ...base, downPaymentPct: 0.1 };
    const sumPmi = (r: ReturnType<typeof calculate>) => r.years.reduce((s, y) => s + y.costs.pmi, 0);
    const flat = sumPmi(calculate({ ...lowDown, homeAppreciation: 0 }));
    const rising = sumPmi(calculate({ ...lowDown, homeAppreciation: 0.08 }));
    expect(rising).toBeLessThan(flat);
    expect(rising).toBeGreaterThan(0); // still charged in the early months, just fewer years
  });

  it("prices PMI off LTV, so a 3% down loan costs far more per month than a 15% down one", () => {
    // Same base rate, but the multiplier steps up as the original LTV rises. Compare year-1
    // PMI (before either has amortized into a different LTV band) at flat appreciation so the
    // current-value trigger doesn't muddy the comparison.
    const flat = { ...base, homeAppreciation: 0 };
    const lowDown = calculate({ ...flat, downPaymentPct: 0.03 }).years[0].costs.pmi; // 97% LTV
    const midDown = calculate({ ...flat, downPaymentPct: 0.15 }).years[0].costs.pmi; // 85% LTV
    expect(lowDown).toBeGreaterThan(midDown);
    // A 97% LTV loan should run multiples of an 85% one, not the same flat rate as before.
    expect(lowDown / midDown).toBeGreaterThan(2);
  });

  it("charges no PMI at all at the 20%-down default, whatever the price or the market", () => {
    // The median visitor's inputs. The termination rules are irrelevant here because the loan never
    // attaches PMI in the first place, and that must hold for a falling market too (a current-value
    // LTV test would put an underwater 20%-down buyer back on the hook, which no servicer does) and
    // at prices where price*(1-0.2)/price lands a rounding step above 0.8.
    for (const homePrice of [250_000, 400_000, 200_003, 1_250_000]) {
      for (const homeAppreciation of [0.03, 0, -0.05]) {
        const r = calculate({ ...base, homePrice, homeAppreciation, yearsToStay: 30 });
        expect(r.years.every((y) => y.costs.pmi === 0)).toBe(true);
      }
    }
  });

  it("pmiLtvMultiplier steps up monotonically with original LTV", () => {
    expect(pmiLtvMultiplier(0.85)).toBeLessThan(pmiLtvMultiplier(0.92));
    expect(pmiLtvMultiplier(0.92)).toBeLessThanOrEqual(pmiLtvMultiplier(0.96));
    expect(pmiLtvMultiplier(0.96)).toBeLessThan(pmiLtvMultiplier(0.98));
  });

  it("tapers the SALT cap to the 2030 cliff instead of holding the entry-year value flat", () => {
    // High property tax + other SALT so the cap binds; a 9-year stay from 2026 crosses 2030,
    // where the OBBBA cap reverts to $10k. Years before that ride the +1%/yr schedule.
    const r = calculate({
      ...base,
      homePrice: 1_500_000,
      propertyTax: { kind: "pctOfValue", rate: 0.02 },
      otherSALT: 20000,
    });
    const y2029 = r.years[3]; // year 4
    const y2030 = r.years[4]; // year 5, the cliff
    expect(y2030.saltUsed).toBeLessThan(y2029.saltUsed);
    expect(y2030.saltUsed).toBe(10000); // base SALT exceeds the reverted cap, so it pins to $10k
  });

  it("dollar-mode maintenance equals percent-mode when value is flat (no appreciation/inflation)", () => {
    // With a static home value and no inflation, $4,000/yr and 1%-of-$400k are the
    // same stream, so the two modes must produce an identical breakeven.
    const flat = { ...base, homeAppreciation: 0, inflation: 0 };
    const asPct = calculate({ ...flat, maintenance: { kind: "pctOfValue", rate: 0.01 } });
    const asAmt = calculate({ ...flat, maintenance: { kind: "flatAnnual", annual: 4000 } });
    expect(asAmt.breakevenRent).toBeCloseTo(asPct.breakevenRent, 4);
  });

  it("dollar-mode property tax equals percent-mode when value is flat", () => {
    // $4,400/yr and 1.1%-of-$400k are the same stream with no appreciation/inflation.
    const flat = { ...base, homeAppreciation: 0, inflation: 0 };
    const asPct = calculate({ ...flat, propertyTax: { kind: "pctOfValue", rate: 0.011 } });
    const asAmt = calculate({ ...flat, propertyTax: { kind: "flatAnnual", annual: 4400 } });
    expect(asAmt.breakevenRent).toBeCloseTo(asPct.breakevenRent, 4);
  });

  it("a bigger flat insurance figure raises the cost of buying (higher breakeven rent)", () => {
    const cheap = calculate({ ...base, homeInsurance: { kind: "flatAnnual", annual: 1000 } });
    const pricey = calculate({ ...base, homeInsurance: { kind: "flatAnnual", annual: 6000 } });
    expect(pricey.breakevenRent).toBeGreaterThan(cheap.breakevenRent);
  });

  it("flat-dollar costs ride inflation, not appreciation", () => {
    // Same starting dollar, but percent-mode tracks a fast-appreciating home while
    // amount-mode only tracks (slower) inflation, so percent-mode costs more.
    const hot = { ...base, homeAppreciation: 0.08, inflation: 0.02 };
    const pctMode = calculate({ ...hot, maintenance: { kind: "pctOfValue", rate: 0.01 } });
    const amtMode = calculate({ ...hot, maintenance: { kind: "flatAnnual", annual: 4000 } });
    expect(pctMode.breakevenRent).toBeGreaterThan(amtMode.breakevenRent);
  });

  it("applies the $750k acquisition-debt cap to single and joint alike (MFS unmodeled)", () => {
    // $2M home, 20% down => $1.6M loan, above the cap. Neutralize cap-gains and
    // equalize the standard deduction so only an interest-cap difference could show.
    const jumbo = { ...base, homePrice: 2_000_000, capitalGainsRate: 0, standardDeduction: 30000 };
    const joint = calculate({ ...jumbo, filingJointly: true });
    const single = calculate({ ...jumbo, filingJointly: false });
    // Single/HoH/MFJ all get the $750k cap (only true MFS is $375k, not modeled),
    // so the filing toggle doesn't change the deductible-interest fraction.
    expect(single.breakevenRent).toBeCloseTo(joint.breakevenRent, 6);

    // The cap actually bites: a sub-cap loan deducts all its interest, so dropping
    // the deductible fraction (bigger loan) raises buying's cost (higher breakeven).
    const underCap = calculate({ ...base, homePrice: 800_000, standardDeduction: 30000 }); // $640k loan
    const overCap = calculate({ ...base, homePrice: 2_000_000, standardDeduction: 30000 }); // $1.6M loan
    expect(underCap.years[0].taxBenefit).toBeGreaterThan(0);
    // Deductible fraction at $1.6M is 750/1600 ≈ 0.47, so far less interest is
    // creditable per dollar than the under-cap loan's full deduction.
    expect(overCap.years[0].interestPaid).toBeGreaterThan(underCap.years[0].interestPaid);
  });

  it("raises the deductible-interest fraction as a jumbo loan amortizes under the cap", () => {
    // $2M home, 20% down => $1.6M loan: year 1 only ~$750k/$1.6M of interest is
    // deductible, but as the balance falls under $750k the fraction climbs to 1.
    // Strip SALT and the standard deduction so taxBenefit is purely marginal rate
    // times deductible interest, making the rising fraction observable per dollar.
    const j = calculate({
      ...base,
      homePrice: 2_000_000,
      propertyTax: { kind: "pctOfValue", rate: 0 },
      otherSALT: 0,
      standardDeduction: 0,
      capitalGainsRate: 0,
      yearsToStay: 30,
    });
    const early = j.years[0].taxBenefit / j.years[0].interestPaid;
    const late = j.years[27].taxBenefit / j.years[27].interestPaid;
    // Once the balance is under $750k the whole interest deducts, so the benefit
    // per dollar of interest is higher late than early (frozen-at-origination wouldn't move).
    expect(late).toBeGreaterThan(early);
  });

  it("exposes the itemization components its tax benefit is built from (single source of truth)", () => {
    // Jumbo loan, high rate, low standard deduction so itemizing wins and the cap bites.
    const r = calculate({ ...base, homePrice: 1_500_000, marginalTaxRate: 0.32, standardDeduction: 30000 });
    const y = r.years[0];
    expect(y.deductibleInterest).toBeGreaterThan(0);
    expect(y.deductibleInterest).toBeLessThanOrEqual(y.interestPaid); // the cap can only reduce it
    // taxBenefit must be exactly reconstructable from the exposed components, so the
    // "show your work" panel can read them instead of re-deriving (and drifting from) the engine.
    const itemized = y.deductibleInterest + y.saltUsed;
    expect(y.taxBenefit).toBeCloseTo(0.32 * Math.max(0, itemized - 30000), 6);
  });
});

/**
 * A textbook amortization schedule, written out here rather than read off the engine, so the PMI
 * termination pins below assert against arithmetic instead of against whatever the engine happens
 * to produce. Returns the post-payment balance for each month 1..term.
 */
function handSchedule(price: number, downPct: number, annualRate: number, termYears: number): number[] {
  const loan = price * (1 - downPct);
  const n = Math.round(termYears * 12);
  const i = annualRate / 12;
  const f = Math.pow(1 + i, n);
  const payment = (loan * i * f) / (f - 1);
  const balances: number[] = [];
  let balance = loan;
  for (let m = 1; m <= n; m++) {
    balance -= Math.min(payment - balance * i, balance);
    balances.push(balance);
  }
  return balances;
}

const totalPmi = (r: ReturnType<typeof calculate>) => r.years.reduce((s, y) => s + y.costs.pmi, 0);

describe("PMI termination (Homeowners Protection Act)", () => {
  // PMI is a flat monthly premium off the ORIGINAL loan, so a horizon total pins the exact month
  // it stopped: total / premium is the number of months charged. Every case below runs the full
  // 30-year stay so nothing falls outside the collected rows.
  const premium = (loan: number, multiplier: number) => (loan * 0.0058 * multiplier) / 12;

  it("runs to the 78%-of-ORIGINAL-price month when the market never opens a cancellation", () => {
    // 5% down into a 2%/yr decline: current LTV only rises, so neither borrower-requested test can
    // ever fire, and the term midpoint is month 180. Automatic termination is the binding exit.
    const balances = handSchedule(400_000, 0.05, 0.065, 30);
    const autoMonth = balances.findIndex((b) => b <= 0.78 * 400_000) + 1;
    expect(autoMonth).toBe(135); // $380k at 6.5%/30yr first prints a sub-$312,000 balance in month 135
    // The old rule would still have been charging here: at month 134 the loan is 87% of the
    // (shrunken) home value, nowhere near the 80% the appreciated-value test wanted.
    expect(balances[autoMonth - 2] / (400_000 * Math.pow(0.98, (autoMonth - 1) / 12))).toBeGreaterThan(0.8);

    const r = calculate({ ...base, downPaymentPct: 0.05, homeAppreciation: -0.02, yearsToStay: 30 });
    expect(totalPmi(r)).toBeCloseTo(premium(380_000, 1.0) * (autoMonth - 1), 6);
  });

  it("keeps charging after the appreciated value crosses 80% LTV, because cancelling takes seasoning", () => {
    // 5% down, 3% appreciation - the low-down case the old rule flattered. Current LTV passes 80%
    // in month 49, but a borrower can only ask at 80% after five years (or at 75% after two, and
    // this market doesn't reach 75% until month 66), so PMI runs through month 59 and stops at 60.
    const balances = handSchedule(400_000, 0.05, 0.065, 30);
    const ltv = (m: number) => balances[m - 1] / (400_000 * Math.pow(1.03, m / 12));
    expect(ltv(48)).toBeGreaterThan(0.8);
    expect(ltv(49)).toBeLessThanOrEqual(0.8); // where the old rule cancelled: 11 months too early
    expect(ltv(60)).toBeGreaterThan(0.75); // the 2-year/75% exit isn't open yet either

    const r = calculate({ ...base, downPaymentPct: 0.05, yearsToStay: 30 });
    expect(totalPmi(r)).toBeCloseTo(premium(380_000, 1.0) * 59, 6);
  });

  it("holds PMI for the full 24-month seasoning even when a hot market clears 75% LTV in year one", () => {
    // 10% down into a 20%/yr market: 75% LTV arrives in month 12, but nobody can cancel before
    // month 24 no matter how fast the comps move, so PMI runs months 1-23.
    const balances = handSchedule(400_000, 0.1, 0.065, 30);
    const ltv = (m: number) => balances[m - 1] / (400_000 * Math.pow(1.2, m / 12));
    expect(ltv(12)).toBeLessThanOrEqual(0.75);

    const r = calculate({ ...base, downPaymentPct: 0.1, homeAppreciation: 0.2, yearsToStay: 30 });
    expect(totalPmi(r)).toBeCloseTo(premium(360_000, 0.7) * 23, 6);
  });

  it("terminates at the amortization midpoint when nothing else has fired", () => {
    // 12% money amortizes slowly enough that the balance doesn't reach 78% of the original price
    // until month 200, and a 5%/yr decline keeps every LTV exit shut. The midpoint rule ends it at
    // month 180 regardless, so PMI runs months 1-179.
    const balances = handSchedule(400_000, 0.05, 0.12, 30);
    expect(balances[179]).toBeGreaterThan(0.78 * 400_000);

    const r = calculate({ ...base, downPaymentPct: 0.05, mortgageRate: 0.12, homeAppreciation: -0.05, yearsToStay: 30 });
    expect(totalPmi(r)).toBeCloseTo(premium(380_000, 1.0) * 179, 6);
  });
});

describe("input sanitization", () => {
  // Each of these is reachable only via a crafted ?s= share link or a momentarily
  // empty field, but must never produce NaN/Infinity or a silently-flipped verdict.
  const allFinite = (r: ReturnType<typeof calculate>) =>
    [r.breakevenRent, r.buyNetCost, r.rentNetCost, r.monthlyPayment, r.loanAmount].every(Number.isFinite) &&
    r.horizon.every((p) => Number.isFinite(p.buyNetCost) && Number.isFinite(p.rentNetCost)) &&
    r.years.every((y) => Number.isFinite(y.equity) && Number.isFinite(y.taxBenefit));

  it("stays finite when home appreciation is below -100%/yr", () => {
    const r = calculate({ ...base, homeAppreciation: -1.5 });
    expect(allFinite(r)).toBe(true);
  });

  it("stays finite (and discounts, not inflates) with a negative investment return", () => {
    const r = calculate({ ...base, investmentReturn: -1 });
    expect(allFinite(r)).toBe(true);
    // A negative discount rate would have blown costs up into the billions.
    expect(r.buyNetCost).toBeLessThan(5_000_000);
  });

  it("clamps an out-of-range down payment instead of producing a negative loan", () => {
    const r = calculate({ ...base, downPaymentPct: 1.5 });
    expect(r.loanAmount).toBe(0);
    expect(allFinite(r)).toBe(true);
  });

  it("treats a zero mortgage term as at least a one-year loan, not a free balloon", () => {
    const r = calculate({ ...base, mortgageTermYears: 0 });
    expect(r.monthlyPayment).toBeGreaterThan(0);
    expect(allFinite(r)).toBe(true);
  });

  it("survives a negative inflation / rent-growth link", () => {
    const r = calculate({ ...base, inflation: -2, rentGrowth: -3 });
    expect(allFinite(r)).toBe(true);
  });
});

describe("net worth (buy vs rent)", () => {
  it("the net-worth winner at the horizon matches the verdict", () => {
    const r = calculate(base);
    const last = r.years[r.years.length - 1];
    if (r.verdict === "buy") expect(last.buyerNetWorth).toBeGreaterThan(last.renterNetWorth);
    else expect(last.renterNetWorth).toBeGreaterThan(last.buyerNetWorth);
  });

  it("the wealth crossover sign-flips exactly at the breakeven year", () => {
    const r = calculate({ ...base, yearsToStay: 30 });
    expect(r.breakevenYear).not.toBeNull();
    const be = r.years.find((y) => y.year === r.breakevenYear)!;
    const prev = r.years.find((y) => y.year === r.breakevenYear! - 1);
    expect(be.buyerNetWorth).toBeGreaterThanOrEqual(be.renterNetWorth); // buyer has caught up
    if (prev) expect(prev.renterNetWorth).toBeGreaterThan(prev.buyerNetWorth); // renter was ahead before
  });

  it("seeds the renter's portfolio with the buyer's upfront (renting is not pure consumption)", () => {
    const r = calculate(base);
    // The renter invested ~down payment + closing ($80k + $12k) instead of buying; a year in
    // it is a real six-figure-ish asset, not zero.
    expect(r.years[0].renterNetWorth).toBeGreaterThan(80000);
  });

  it("exposes net worth across the FULL horizon so the chart can show a past-the-stay crossover", () => {
    const r = calculate(base); // stay 9, but breakeven is later, so years[] alone can't show it
    // The chart reads result.netWorth, which must span the whole horizon, not just the stay.
    expect(r.netWorth).toHaveLength(r.horizon.length);
    expect(r.netWorth.length).toBeGreaterThan(base.yearsToStay);
    const be = r.breakevenYear!;
    expect(be).not.toBeNull();
    // Wealth crosses in the same year the cost lines do (by construction).
    expect(r.netWorth[be - 1].buyerNetWorth).toBeGreaterThanOrEqual(r.netWorth[be - 1].renterNetWorth);
    if (be >= 2) expect(r.netWorth[be - 2].renterNetWorth).toBeGreaterThan(r.netWorth[be - 2].buyerNetWorth);
  });
});

describe("tax benefit", () => {
  // What the old rule paid out: a flat standard deduction, and every SALT dollar credited to
  // buying. Re-derived from the row's own exposed components so each test can say exactly where
  // the incremental rule agrees with it and where it bites.
  const oldPremium = (inp: CalcInputs, y: YearRow, standardDeduction: number) =>
    inp.marginalTaxRate * Math.max(0, y.deductibleInterest + y.saltUsed - standardDeduction);
  const indexedSd = (inp: CalcInputs, year: number) => inp.standardDeduction * Math.pow(1 + inp.inflation, year - 1);

  it("stays exactly $0 whenever the standard deduction wins, so the ~90% path is untouched", () => {
    // $400k home, 20% down, joint standard deduction: year-1 itemized is ~$20.7k of interest plus
    // $4.4k of property tax, nowhere near $32.2k, and the interest only falls from there. Both the
    // old premium and the incremental one floor at the standard deduction, so both are $0 for
    // every year of a full-term stay - including for a filer carrying some state income tax.
    for (const otherSALT of [0, 3000, 6000]) {
      const r = calculate({ ...base, otherSALT, yearsToStay: 30 });
      for (const y of r.years) {
        expect(y.deductibleInterest + y.saltUsed).toBeLessThan(base.standardDeduction);
        expect(y.taxBenefit).toBe(0);
      }
    }
  });

  it("credits the same premium as the old rule when other SALT can't beat the standard deduction", () => {
    // $1.5M home at 6.5%: itemizing wins on the buy side. $20k of state income tax is real money
    // but still under the $32.2k joint standard deduction, so the renter's counterfactual is the
    // standard deduction and the incremental premium collapses to the old max(0, itemized - SD).
    const inp = { ...base, homePrice: 1_500_000, marginalTaxRate: 0.32, otherSALT: 20000, yearsToStay: 12 };
    for (const y of calculate(inp).years) {
      expect(y.taxBenefit).toBeGreaterThan(0);
      expect(y.taxBenefit).toBeCloseTo(oldPremium(inp, y, indexedSd(inp, y.year)), 6);
    }
  });

  it("values the premium incrementally, so a high-SALT filer is credited less than the old rule gave", () => {
    // Single filer in a high-income-tax state: $30k of state income tax is deductible whether or
    // not they buy, and it already clears their $16.1k standard deduction. Buying only adds the
    // deductions stacked on top of that; the old rule handed them the whole itemized total over
    // the standard deduction, crediting buying with tax they'd have deducted as a renter.
    const inp = {
      ...base,
      homePrice: 1_200_000,
      marginalTaxRate: 0.32,
      standardDeduction: 16100,
      otherSALT: 30000,
      filingJointly: false,
      yearsToStay: 5,
    };
    const y1 = calculate(inp).years[0];
    const old = oldPremium(inp, y1, inp.standardDeduction);
    expect(y1.taxBenefit).toBeGreaterThan(0); // buying still buys a real deduction
    expect(y1.taxBenefit).toBeLessThan(old);
    // Exactly the renter's own itemized deduction, backed out of the premium.
    const rentersOwn = Math.min(inp.otherSALT, saltCapForYear(TAX_YEAR));
    expect(old - y1.taxBenefit).toBeCloseTo(inp.marginalTaxRate * (rentersOwn - inp.standardDeduction), 6);
  });

  it("indexes the standard deduction, so the premium doesn't drift up with inflation", () => {
    // Every cost here is percent-of-value and HOA is zero, so inflation touches nothing else in
    // the buy simulation: same interest, same SALT, only the deduction moves.
    const itemizing = { ...base, homePrice: 1_500_000, marginalTaxRate: 0.32, yearsToStay: 12 };
    const flat = calculate({ ...itemizing, inflation: 0 });
    const rising = calculate({ ...itemizing, inflation: 0.05 });
    expect(rising.years[0].taxBenefit).toBeCloseTo(flat.years[0].taxBenefit, 6); // year 1 is the entry value
    const late = rising.years[11];
    const lateFlat = flat.years[11];
    expect(late.deductibleInterest).toBeCloseTo(lateFlat.deductibleInterest, 6); // nothing else moved
    expect(late.saltUsed).toBeCloseTo(lateFlat.saltUsed, 6);
    expect(late.taxBenefit).toBeGreaterThan(0); // still itemizing, just by a lot less
    expect(late.taxBenefit).toBeLessThan(lateFlat.taxBenefit);
    const sd12 = 32200 * Math.pow(1.05, 11);
    expect(late.taxBenefit).toBeCloseTo(0.32 * Math.max(0, late.deductibleInterest + late.saltUsed - sd12), 6);
  });
});

describe("breakevenYearOnly", () => {
  it("matches calculate().breakevenYear across varied inputs (the fast path can't drift)", () => {
    const cases: CalcInputs[] = [
      base,
      { ...base, downPaymentPct: 0.05 },
      { ...base, homePrice: 900_000, marginalTaxRate: 0.32, otherSALT: 25000 },
      { ...base, yearsToStay: 3 },
      { ...base, homeAppreciation: 0.08, investmentReturn: 0.07 },
      { ...base, mortgageTermYears: 15 },
      { ...base, monthlyRent: 6000 }, // rent so far above the payment that buying wins immediately
      { ...base, monthlyRent: 500 }, // and rent so cheap the lines never cross
    ];
    for (const c of cases) expect(breakevenYearOnly(c)).toBe(calculate(c).breakevenYear);
  });

  it("returns null when the lines never cross inside the sweep", () => {
    const c = { ...base, monthlyRent: 500 };
    expect(calculate(c).breakevenYear).toBeNull();
    expect(breakevenYearOnly(c)).toBeNull();
  });
});

describe("breakevenRentOnly", () => {
  it("matches calculate().breakevenRent across varied inputs (the fast path can't drift)", () => {
    const cases: CalcInputs[] = [
      base,
      { ...base, downPaymentPct: 0.1 },
      { ...base, homePrice: 900_000, marginalTaxRate: 0.32, standardDeduction: 30000 },
      { ...base, yearsToStay: 3 },
      { ...base, homeAppreciation: 0.08, investmentReturn: 0.07 },
    ];
    for (const c of cases) {
      expect(breakevenRentOnly(c)).toBeCloseTo(calculate(c).breakevenRent, 6);
    }
  });
});

describe("impliedRate", () => {
  it("returns the rate as-is for a pct-of-value basis", () => {
    expect(impliedRate({ kind: "pctOfValue", rate: 0.011 }, 400000)).toBe(0.011);
  });

  it("derives flat-annual over price", () => {
    expect(impliedRate({ kind: "flatAnnual", annual: 4000 }, 400000)).toBeCloseTo(0.01, 6);
  });

  it("uses the fallback when the price is zero (no rate is derivable)", () => {
    expect(impliedRate({ kind: "flatAnnual", annual: 4000 }, 0, 0.02)).toBe(0.02);
    expect(impliedRate({ kind: "flatAnnual", annual: 4000 }, 0)).toBe(0);
  });
});

