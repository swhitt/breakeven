import { describe, expect, it } from "vitest";
import type { AppInputs } from "../engine/defaults";
import {
  cleanOverrides,
  coerceByKind,
  diffOverrides,
  overridesFromShare,
  parseCostBasis,
  pruneLocationOverrides,
  rememberOverrides,
  valuesEqual,
} from "./persist";

const ref: AppInputs = {
  homePrice: 400000,
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
  monthlyRent: 2200,
  rentGrowth: 0.03,
  rentersInsuranceMonthly: 15,
  securityDepositMonths: 1,
  brokerFeeMonths: 0,
  taxAuto: true,
  annualIncome: 0,
  taxState: "US",
  localTaxRate: 0,
  otherMonthlyDebt: 0,
};

describe("coerceByKind", () => {
  it("validates and coerces values by kind", () => {
    expect(coerceByKind("number", 5)).toBe(5);
    expect(coerceByKind("number", "5")).toBe(5); // numeric strings are coerced
    expect(coerceByKind("number", "x")).toBeUndefined();
    expect(coerceByKind("number", Number.NaN)).toBeUndefined();
    expect(coerceByKind("boolean", false)).toBe(false); // false must survive, not read as "drop"
    expect(coerceByKind("boolean", "true")).toBeUndefined();
    expect(coerceByKind("string", "NY")).toBe("NY");
    expect(coerceByKind("string", 5)).toBeUndefined();
    expect(coerceByKind("costBasis", { kind: "flatAnnual", annual: 4000 })).toEqual({ kind: "flatAnnual", annual: 4000 });
    expect(coerceByKind("costBasis", { kind: "bogus" })).toBeUndefined();
  });
});

describe("parseCostBasis", () => {
  it("accepts valid bases and rejects malformed ones", () => {
    expect(parseCostBasis({ kind: "pctOfValue", rate: 0.01 })).toEqual({ kind: "pctOfValue", rate: 0.01 });
    expect(parseCostBasis({ kind: "flatAnnual", annual: 5000 })).toEqual({ kind: "flatAnnual", annual: 5000 });
    expect(parseCostBasis({ kind: "pctOfValue", rate: "x" })).toBeNull();
    expect(parseCostBasis({ kind: "flatAnnual" })).toBeNull();
    expect(parseCostBasis(null)).toBeNull();
    expect(parseCostBasis(42)).toBeNull();
  });
});

describe("valuesEqual", () => {
  it("deep-compares CostBasis objects, identity for primitives", () => {
    expect(valuesEqual({ kind: "pctOfValue", rate: 0.01 }, { kind: "pctOfValue", rate: 0.01 })).toBe(true);
    expect(valuesEqual({ kind: "pctOfValue", rate: 0.01 }, { kind: "pctOfValue", rate: 0.02 })).toBe(false);
    expect(valuesEqual(0.2, 0.2)).toBe(true);
    expect(valuesEqual("US", "NY")).toBe(false);
  });
});

describe("cleanOverrides (localStorage path)", () => {
  it("whitelists known fields and validates by kind", () => {
    const clean = cleanOverrides({
      homePrice: 500000,
      taxState: "NY",
      filingJointly: false,
      propertyTax: { kind: "flatAnnual", annual: 6000 },
      mortgageRate: 0.07, // not in PERSIST_SPEC -> dropped
      unknownKey: 1, // unknown -> dropped
      monthlyRent: "oops", // wrong type -> dropped
    });
    expect(clean).toEqual({
      homePrice: 500000,
      taxState: "NY",
      filingJointly: false,
      propertyTax: { kind: "flatAnnual", annual: 6000 },
    });
  });

  it("yields {} from all-garbage storage", () => {
    expect(cleanOverrides({ homePrice: null, taxState: 5, propertyTax: { kind: "nope" } })).toEqual({});
  });
});

describe("overridesFromShare (share-link path)", () => {
  it("validates a payload against the reference shape, dropping unknown/mistyped fields", () => {
    const o = overridesFromShare(
      { homePrice: 999000, propertyTax: { kind: "flatAnnual", annual: 5555 }, filingJointly: false, bogus: 1 },
      ref,
    );
    expect(o).toEqual({ homePrice: 999000, propertyTax: { kind: "flatAnnual", annual: 5555 }, filingJointly: false });
  });

  it("drops a value whose type doesn't match the reference", () => {
    expect(overridesFromShare({ homePrice: "nope", taxState: 5 }, ref)).toEqual({});
  });
});

describe("diffOverrides (share encode)", () => {
  it("emits only fields that differ from the metro defaults", () => {
    const inputs: AppInputs = { ...ref, homePrice: 500000, propertyTax: { kind: "flatAnnual", annual: 6000 } };
    const o = diffOverrides(inputs, ref);
    expect(o.homePrice).toBe(500000);
    expect(o.propertyTax).toEqual({ kind: "flatAnnual", annual: 6000 });
    expect("monthlyRent" in o).toBe(false);
  });

  it("treats an equal-valued CostBasis as unchanged (no reference-identity bloat)", () => {
    const inputs: AppInputs = { ...ref, propertyTax: { kind: "pctOfValue", rate: 0.011 } }; // same values, new object
    expect("propertyTax" in diffOverrides(inputs, ref)).toBe(false);
  });
});

describe("rememberOverrides / pruneLocationOverrides", () => {
  it("remembers only persistable patch fields", () => {
    const acc: Partial<AppInputs> = {};
    const changed = rememberOverrides(acc, { homePrice: 500000, mortgageRate: 0.07 });
    expect(acc).toEqual({ homePrice: 500000 }); // mortgageRate isn't persisted
    expect(changed).toBe(true);
  });

  it("prunes place-specific overrides on a metro switch but keeps personal ones", () => {
    const acc: Partial<AppInputs> = {
      homePrice: 5, // location field
      taxState: "NY", // location field
      maintenance: { kind: "flatAnnual", annual: 1 }, // personal, kept
      standardDeduction: 30000, // not location, kept
    };
    expect(pruneLocationOverrides(acc)).toBe(true);
    expect("homePrice" in acc).toBe(false);
    expect("taxState" in acc).toBe(false);
    expect(acc.maintenance).toEqual({ kind: "flatAnnual", annual: 1 });
    expect(acc.standardDeduction).toBe(30000);
  });
});
