import { describe, expect, it } from "vitest";
import { calculate } from "./calculator";
import { buildInputs } from "./defaults";
import { STANDARD_DEDUCTION } from "./taxConstants";
import type { LocationData, MarketData, StateRateTable } from "../data/types";

const market: MarketData = {
  asOf: "2026-06-14",
  mortgage: { rate30: 0.065, rate15: 0.058, asOf: "2026-06-11", source: "PMMS" },
  inflation: { rate: 0.042, asOf: "2026-05", source: "BLS" },
  appreciation: { rate1yr: 0.03, rate5yrCagr: 0.04, asOf: "2026-04", source: "Zillow" },
  national: { homeValue: 368000, rent: 1930, asOf: "2026-04", source: "Zillow" },
};
const propertyTax: StateRateTable = { TX: 0.018, US: 0.011 };
const insurance: StateRateTable = { TX: 0.008, US: 0.005 };
const houston: LocationData = { id: "houston-tx", metro: "Houston, TX", state: "TX", homeValue: 300000, rent: 1600 };

describe("buildInputs", () => {
  it("seeds price, rent, state, and the live mortgage rate from the inputs", () => {
    const inp = buildInputs(houston, market, propertyTax, insurance);
    expect(inp).toMatchObject({
      homePrice: 300000,
      monthlyRent: 1600,
      taxState: "TX",
      mortgageRate: 0.065,
      downPaymentPct: 0.2,
      mortgageTermYears: 30,
      taxAuto: true,
      annualIncome: 0,
    });
  });

  it("pulls the state property-tax and insurance rates", () => {
    const inp = buildInputs(houston, market, propertyTax, insurance);
    expect(inp.propertyTax).toEqual({ kind: "pctOfValue", rate: 0.018 });
    expect(inp.homeInsurance).toEqual({ kind: "pctOfValue", rate: 0.008 });
  });

  it("falls back to default rates when the state isn't in the table", () => {
    const inp = buildInputs({ ...houston, state: "ZZ" }, market, propertyTax, insurance);
    expect(inp.propertyTax).toEqual({ kind: "pctOfValue", rate: 0.011 });
    expect(inp.homeInsurance).toEqual({ kind: "pctOfValue", rate: 0.005 });
  });

  it("clamps inflation into a sane band", () => {
    expect(buildInputs(houston, { ...market, inflation: { ...market.inflation, rate: 0.2 } }, propertyTax, insurance).inflation).toBe(0.06);
    expect(buildInputs(houston, { ...market, inflation: { ...market.inflation, rate: 0.001 } }, propertyTax, insurance).inflation).toBe(0.01);
  });

  it("floors rent growth at 3% even when inflation is lower", () => {
    const inp = buildInputs(houston, { ...market, inflation: { ...market.inflation, rate: 0.02 } }, propertyTax, insurance);
    expect(inp.rentGrowth).toBe(0.03);
  });

  it("uses the joint standard deduction by default and single when told", () => {
    expect(buildInputs(houston, market, propertyTax, insurance).standardDeduction).toBe(STANDARD_DEDUCTION.joint);
    const single = buildInputs(houston, market, propertyTax, insurance, false);
    expect(single.standardDeduction).toBe(STANDARD_DEDUCTION.single);
    expect(single.filingJointly).toBe(false);
  });

  it("produces inputs the engine accepts and computes a finite breakeven from", () => {
    const r = calculate(buildInputs(houston, market, propertyTax, insurance));
    expect(Number.isFinite(r.breakevenRent)).toBe(true);
    expect(r.breakevenRent).toBeGreaterThan(0);
  });
});
