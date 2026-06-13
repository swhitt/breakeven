import { describe, expect, it } from "vitest";
import { calculate, monthlyMortgagePayment, type CalcInputs } from "./calculator";

const base: CalcInputs = {
  homePrice: 400000,
  downPaymentPct: 0.2,
  mortgageRate: 0.065,
  mortgageTermYears: 30,
  homeAppreciation: 0.03,
  yearsToStay: 9,
  investmentReturn: 0.05,
  inflation: 0.024,
  propertyTaxRate: 0.011,
  maintenanceMode: "pct",
  maintenanceRate: 0.01,
  maintenanceAnnual: 4000,
  homeInsuranceMode: "pct",
  homeInsuranceRate: 0.005,
  homeInsuranceAnnual: 2000,
  hoaMonthly: 0,
  extraUtilitiesMonthly: 0,
  buyingClosingPct: 0.03,
  sellingCostPct: 0.06,
  pmiRate: 0.0058,
  marginalTaxRate: 0.24,
  standardDeduction: 32200,
  otherSALT: 0,
  saltCap: 40400,
  filingJointly: true,
  capitalGainsRate: 0.15,
  taxAuto: false,
  annualIncome: 0,
  taxState: "US",
  localTaxRate: 0,
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
    const totalPmi = noPmi.years.reduce((s, y) => s + y.pmi, 0);
    expect(totalPmi).toBe(0);
  });

  it("dollar-mode maintenance equals percent-mode when value is flat (no appreciation/inflation)", () => {
    // With a static home value and no inflation, $4,000/yr and 1%-of-$400k are the
    // same stream, so the two modes must produce an identical breakeven.
    const flat = { ...base, homeAppreciation: 0, inflation: 0 };
    const asPct = calculate({ ...flat, maintenanceMode: "pct", maintenanceRate: 0.01 });
    const asAmt = calculate({ ...flat, maintenanceMode: "amount", maintenanceAnnual: 4000 });
    expect(asAmt.breakevenRent).toBeCloseTo(asPct.breakevenRent, 4);
  });

  it("a bigger flat insurance figure raises the cost of buying (higher breakeven rent)", () => {
    const cheap = calculate({ ...base, homeInsuranceMode: "amount", homeInsuranceAnnual: 1000 });
    const pricey = calculate({ ...base, homeInsuranceMode: "amount", homeInsuranceAnnual: 6000 });
    expect(pricey.breakevenRent).toBeGreaterThan(cheap.breakevenRent);
  });

  it("flat-dollar costs ride inflation, not appreciation", () => {
    // Same starting dollar, but percent-mode tracks a fast-appreciating home while
    // amount-mode only tracks (slower) inflation, so percent-mode costs more.
    const hot = { ...base, homeAppreciation: 0.08, inflation: 0.02, maintenanceAnnual: 4000, maintenanceRate: 0.01 };
    const pctMode = calculate({ ...hot, maintenanceMode: "pct" });
    const amtMode = calculate({ ...hot, maintenanceMode: "amount" });
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
});
