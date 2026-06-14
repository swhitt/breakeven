import { describe, expect, it } from "vitest";
import { breakevenRentOnly, calculate, type CalcInputs } from "./calculator";

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
  saltCap: 40400,
  filingJointly: true,
  capitalGainsRate: 0.15,
  monthlyRent: 2200,
  rentGrowth: 0.03,
  rentersInsuranceMonthly: 15,
  securityDepositMonths: 1,
  brokerFeeMonths: 0,
};

const isFinite = (n: number) => Number.isFinite(n);

describe("engine invariants", () => {
  it("ties buy and rent costs exactly at the breakeven rent", () => {
    const r = calculate(base);
    const atBe = calculate({ ...base, monthlyRent: r.breakevenRent });
    expect(atBe.buyNetCost).toBeCloseTo(atBe.rentNetCost, 2);
    expect(Math.abs(atBe.monthlyDifference)).toBeLessThan(1);
  });

  it("defines monthlyDifference as breakevenRent minus your rent", () => {
    const r = calculate(base);
    expect(r.monthlyDifference).toBeCloseTo(r.breakevenRent - base.monthlyRent, 6);
  });

  it("calls rent below the breakeven and buy above it", () => {
    const r = calculate(base);
    expect(calculate({ ...base, monthlyRent: r.breakevenRent - 500 }).verdict).toBe("rent");
    expect(calculate({ ...base, monthlyRent: r.breakevenRent + 500 }).verdict).toBe("buy");
  });

  it("matches breakevenRentOnly against the full calculate path", () => {
    expect(breakevenRentOnly(base)).toBeCloseTo(calculate(base).breakevenRent, 6);
  });

  it("raises the breakeven rent as the mortgage rate rises (pricier buy ties at higher rent)", () => {
    const rents = [0.04, 0.06, 0.08, 0.1].map((mortgageRate) => breakevenRentOnly({ ...base, mortgageRate }));
    for (let i = 1; i < rents.length; i++) expect(rents[i]).toBeGreaterThan(rents[i - 1]);
  });

  it("raises the breakeven rent as the home price rises", () => {
    const rents = [250000, 400000, 600000, 900000].map((homePrice) => breakevenRentOnly({ ...base, homePrice }));
    for (let i = 1; i < rents.length; i++) expect(rents[i]).toBeGreaterThan(rents[i - 1]);
  });

  it("charges PMI under 20% down and none at or above it", () => {
    const under = calculate({ ...base, downPaymentPct: 0.15 }).years[0];
    const at = calculate({ ...base, downPaymentPct: 0.2 }).years[0];
    expect(under.costs.pmi).toBeGreaterThan(0);
    expect(at.costs.pmi).toBe(0);
  });

  it("has no loan, payment, or PMI at 100% down", () => {
    const r = calculate({ ...base, downPaymentPct: 1 });
    expect(r.loanAmount).toBe(0);
    expect(r.monthlyPayment).toBe(0);
    expect(r.years[0].costs.pmi).toBe(0);
  });

  it("borrows the full price at 0% down", () => {
    expect(calculate({ ...base, downPaymentPct: 0 }).loanAmount).toBe(base.homePrice);
  });

  it("produces only finite numbers across the whole result", () => {
    const r = calculate(base);
    for (const n of [r.breakevenRent, r.buyNetCost, r.rentNetCost, r.monthlyDifference, r.monthlyPayment, r.loanAmount])
      expect(isFinite(n)).toBe(true);
    for (const y of r.years) {
      expect(isFinite(y.principalPaid) && isFinite(y.interestPaid) && isFinite(y.equity)).toBe(true);
      for (const v of Object.values(y.costs)) expect(isFinite(v)).toBe(true);
    }
    for (const p of r.netWorth) expect(isFinite(p.buyerNetWorth) && isFinite(p.renterNetWorth)).toBe(true);
  });

  it("stays finite at the horizon extremes (1 year and the full term)", () => {
    for (const yearsToStay of [1, 30]) {
      const r = calculate({ ...base, yearsToStay });
      expect(isFinite(r.breakevenRent)).toBe(true);
      expect(isFinite(r.buyNetCost) && isFinite(r.rentNetCost)).toBe(true);
    }
  });

  it("crosses buyer and renter net worth at the breakeven horizon", () => {
    const r = calculate(base);
    if (r.breakevenYear == null) return; // never crosses, nothing to assert
    const atBe = calculate({ ...base, monthlyRent: r.breakevenRent });
    // The breakeven rent ties buy and rent at yearsToStay, so the two wealth lines meet that
    // year by construction (the net-worth series can run past the horizon).
    const pt = atBe.netWorth.find((p) => p.year === base.yearsToStay);
    expect(pt).toBeDefined();
    expect(Math.abs(pt!.buyerNetWorth - pt!.renterNetWorth)).toBeLessThan(Math.abs(pt!.buyerNetWorth) * 0.01 + 50);
  });
});
