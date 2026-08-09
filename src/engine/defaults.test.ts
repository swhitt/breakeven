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
const propertyTax: StateRateTable = { CA: 0.007, TX: 0.018, US: 0.011 };
const insurance: StateRateTable = { CA: 0.0038, TX: 0.008, US: 0.005 };
// Sparse by design: only the states whose assessment cap resets at transfer appear.
const propertyTaxNewBuyer: StateRateTable = { CA: 0.011, FL: 0.0105, MI: 0.014 };
const houston: LocationData = { id: "houston-tx", metro: "Houston, TX", state: "TX", homeValue: 300000, rent: 1600 };
const losAngeles: LocationData = { id: "los-angeles-ca", metro: "Los Angeles, CA", state: "CA", homeValue: 950000, rent: 4501 };

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

  it("prefers the new-buyer property-tax rate where the assessment cap resets at transfer", () => {
    const inp = buildInputs(losAngeles, market, propertyTax, insurance, true, propertyTaxNewBuyer);
    // 1.1% (Prop 13 base + voter-approved debt), not the 0.7% statewide median-of-medians.
    expect(inp.propertyTax).toEqual({ kind: "pctOfValue", rate: 0.011 });
    // Insurance is unaffected: no assessment cap involved, so it still comes from its own table.
    expect(inp.homeInsurance).toEqual({ kind: "pctOfValue", rate: 0.0038 });
  });

  it("keeps the statewide rate in states that already reassess at market, like TX", () => {
    const inp = buildInputs(houston, market, propertyTax, insurance, true, propertyTaxNewBuyer);
    expect(inp.propertyTax).toEqual({ kind: "pctOfValue", rate: 0.018 });
  });

  it("leaves a state absent from the new-buyer table on the statewide rate", () => {
    const seattle: LocationData = { ...houston, id: "seattle-wa", metro: "Seattle, WA", state: "WA" };
    const withOverrides = buildInputs(seattle, market, { ...propertyTax, WA: 0.0081 }, insurance, true, propertyTaxNewBuyer);
    expect(withOverrides.propertyTax).toEqual({ kind: "pctOfValue", rate: 0.0081 });
    // And an unknown state still lands on the shared 1.1% default rather than on an override.
    const unknown = buildInputs({ ...houston, state: "ZZ" }, market, propertyTax, insurance, true, propertyTaxNewBuyer);
    expect(unknown.propertyTax).toEqual({ kind: "pctOfValue", rate: 0.011 });
  });

  it("ignores the new-buyer table when callers omit it, keeping the old 4-arg contract", () => {
    expect(buildInputs(losAngeles, market, propertyTax, insurance).propertyTax).toEqual({ kind: "pctOfValue", rate: 0.007 });
  });

  it("keeps the pctOfValue basis for the new-buyer rate so a metro switch can re-point it", () => {
    // LOCATION_FIELDS carries propertyTax across location changes, and App only re-points it
    // while the basis is pctOfValue; a system-set flatAnnual would strand and read as an edit.
    expect(buildInputs(losAngeles, market, propertyTax, insurance, true, propertyTaxNewBuyer).propertyTax.kind).toBe("pctOfValue");
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
