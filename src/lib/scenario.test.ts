import { describe, expect, it } from "vitest";
import { breakevenRentOnly, type CalcInputs } from "../engine/calculator";
import { LOCAL_PRICE_TOLERANCE, MAX_APPRECIATION_SEARCH, pivotAppreciation, pricedLikeLocal } from "./scenario";

// A realistic base so every assertion runs the real engine, not a stub. Roughly the national
// default: 20% down, 9-year stay, rent a little over the breakeven so buying wins at the modelled
// 3.5% appreciation and the pivot sits somewhere below it.
const base: CalcInputs = {
  homePrice: 370000,
  downPaymentPct: 0.2,
  mortgageRate: 0.065,
  mortgageTermYears: 30,
  homeAppreciation: 0.035,
  yearsToStay: 9,
  investmentReturn: 0.06,
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
  monthlyRent: 2290,
  rentGrowth: 0.03,
  rentersInsuranceMonthly: 15,
  securityDepositMonths: 1,
  brokerFeeMonths: 0,
};

const at = (o: Partial<CalcInputs>) => ({ ...base, ...o });

// The engine's own verdict test, spelled out here so the assertions check the pivot against the
// definition of winning rather than against the module's opinion of it.
const buyingWinsAt = (inp: CalcInputs, rate: number) =>
  breakevenRentOnly({ ...inp, homeAppreciation: rate }) < inp.monthlyRent;

describe("pivotAppreciation", () => {
  // First, because getting this wrong is what shipped "15.00%" for every city: buy and sell
  // inside a single year and no appreciation worth quoting pays back the round trip, so there is
  // no rate to name and the ceiling of the search is not the answer.
  it("reports no rate at all when buying loses across the whole swept range", () => {
    const inp = at({ yearsToStay: 1, homePrice: 2_000_000, monthlyRent: 1500 });
    expect(buyingWinsAt(inp, MAX_APPRECIATION_SEARCH)).toBe(false);
    expect(pivotAppreciation(inp)).toEqual({ kind: "unreachable" });
  });

  it("reports no rate when buying already wins with prices dead flat", () => {
    const inp = at({ homePrice: 250_000, monthlyRent: 4000 });
    expect(buyingWinsAt(inp, 0)).toBe(true);
    expect(pivotAppreciation(inp)).toEqual({ kind: "flat" });
  });

  it("brackets the turn: buying wins at the quoted rate and loses just under it", () => {
    const pivot = pivotAppreciation(base);
    expect(pivot.kind).toBe("rate");
    if (pivot.kind !== "rate") return;
    expect(buyingWinsAt(base, pivot.rate)).toBe(true);
    expect(buyingWinsAt(base, pivot.rate - 1e-4)).toBe(false);
  });

  it("lands well under the modelled appreciation when the verdict is a comfortable buy", () => {
    const pivot = pivotAppreciation(base);
    if (pivot.kind !== "rate") throw new Error("expected a rate for the national-ish base");
    // ~1.5%: the national default buys at 3.5%, and the gap between the two is the whole point of
    // printing the number.
    expect(pivot.rate).toBeGreaterThan(0.005);
    expect(pivot.rate).toBeLessThan(base.homeAppreciation);
  });

  it("moves the turn later as renting gets cheaper", () => {
    const cheap = pivotAppreciation(at({ monthlyRent: 2000 }));
    const dear = pivotAppreciation(at({ monthlyRent: 2600 }));
    if (cheap.kind !== "rate" || dear.kind !== "rate") throw new Error("expected rates for both rents");
    expect(cheap.rate).toBeGreaterThan(dear.rate);
  });
});

describe("pricedLikeLocal", () => {
  it("rejects a price well above the local typical", () => {
    expect(pricedLikeLocal(600_000, 308_000)).toBe(false);
  });

  it("rejects a price well below the local typical", () => {
    expect(pricedLikeLocal(120_000, 308_000)).toBe(false);
  });

  it("accepts the typical itself and both edges of the tolerance", () => {
    const typical = 308_000;
    expect(pricedLikeLocal(typical, typical)).toBe(true);
    expect(pricedLikeLocal(typical * (1 + LOCAL_PRICE_TOLERANCE), typical)).toBe(true);
    expect(pricedLikeLocal(typical / (1 + LOCAL_PRICE_TOLERANCE), typical)).toBe(true);
  });

  it("is symmetric in ratio, so dear and cheap trip at the same distance", () => {
    const typical = 308_000;
    const past = 1 + LOCAL_PRICE_TOLERANCE + 0.01;
    expect(pricedLikeLocal(typical * past, typical)).toBe(false);
    expect(pricedLikeLocal(typical / past, typical)).toBe(false);
  });

  it("stays quiet when there's nothing to compare against", () => {
    expect(pricedLikeLocal(600_000, 0)).toBe(true);
    expect(pricedLikeLocal(0, 308_000)).toBe(true);
  });
});
