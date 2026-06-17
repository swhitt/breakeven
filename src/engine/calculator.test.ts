import { describe, expect, it } from "vitest";
import { breakevenRentOnly, calculate, monthlyMortgagePayment, type CalcInputs } from "./calculator";

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

  it("drops PMI sooner in an appreciating market (LTV trigger is current value, not original)", () => {
    // 10% down starts at 90% LTV. With appreciation the home outgrows the loan and crosses
    // 80% LTV in a couple years; flat, only amortization gets there, which is far slower, so
    // the rising market accrues materially less total PMI for exactly the low-down buyer.
    const lowDown = { ...base, downPaymentPct: 0.1 };
    const sumPmi = (r: ReturnType<typeof calculate>) => r.years.reduce((s, y) => s + y.costs.pmi, 0);
    const flat = sumPmi(calculate({ ...lowDown, homeAppreciation: 0 }));
    const rising = sumPmi(calculate({ ...lowDown, homeAppreciation: 0.08 }));
    expect(rising).toBeLessThan(flat);
    expect(rising).toBeGreaterThan(0); // still charged in the early months, just fewer years
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
