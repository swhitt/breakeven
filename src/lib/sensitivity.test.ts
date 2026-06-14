import { describe, expect, it } from "vitest";
import type { CalcInputs } from "../engine/calculator";
import { computeSensitivity, drivingFactor } from "./sensitivity";

// A realistic base, so the sweep runs the real engine end to end (no mocks).
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

describe("computeSensitivity", () => {
  const rows = computeSensitivity(base);

  it("sorts widest-swing first (the tornado shape)", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].swing).toBeGreaterThanOrEqual(rows[i].swing);
    }
  });

  it("orders each range low-to-high regardless of which endpoint is the higher breakeven", () => {
    for (const r of rows) {
      expect(r.range[0]).toBeLessThanOrEqual(r.range[1]);
      expect(r.swing).toBeCloseTo(r.range[1] - r.range[0], 6);
    }
  });

  it("flags a factor as flipping exactly when its range straddles the actual rent", () => {
    for (const r of rows) {
      const straddles = r.range[0] <= base.monthlyRent && base.monthlyRent <= r.range[1];
      expect(r.flips).toBe(straddles);
    }
  });
});

describe("drivingFactor", () => {
  it("is the first flipping row in the sorted array, else the widest overall", () => {
    const rows = computeSensitivity(base);
    expect(drivingFactor(rows)).toBe(rows.find((r) => r.flips) ?? rows[0]);
  });

  it("returns null for an empty set", () => {
    expect(drivingFactor([])).toBeNull();
  });
});
