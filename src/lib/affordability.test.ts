import { describe, expect, it } from "vitest";
import { calculate, monthlyMortgagePayment, pmiLtvMultiplier, type CalcInputs } from "../engine/calculator";
import {
  backEndDti,
  DTI_BACK_END_LIMIT,
  DTI_QM_LIMIT,
  housingPayment,
  maxPriceForDti,
  MAX_SEARCH_PRICE,
  type PriceSearchInputs,
} from "./affordability";

// A realistic base, so every assertion runs the real engine end to end (no mocks). 20% down
// keeps PMI off; the PMI band gets its own case below.
const base: CalcInputs & PriceSearchInputs = {
  homePrice: 600000,
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
  monthlyRent: 3000,
  rentGrowth: 0.03,
  rentersInsuranceMonthly: 15,
  securityDepositMonths: 1,
  brokerFeeMonths: 0,
  annualIncome: 180000,
  otherMonthlyDebt: 450,
};

const at = (o: Partial<typeof base>) => ({ ...base, ...o });

/**
 * The closed form the search claims to solve, spelled out independently here so the test pins
 * the arithmetic instead of asking the module whether it agrees with itself.
 */
function expectedPayment(inputs: PriceSearchInputs, price: number): number {
  const loan = price * (1 - inputs.downPaymentPct);
  const pi = monthlyMortgagePayment(loan, inputs.mortgageRate, inputs.mortgageTermYears);
  const taxRate = inputs.propertyTax.kind === "pctOfValue" ? inputs.propertyTax.rate : inputs.propertyTax.annual / inputs.homePrice;
  const insRate =
    inputs.homeInsurance.kind === "pctOfValue" ? inputs.homeInsurance.rate : inputs.homeInsurance.annual / inputs.homePrice;
  const ltv = 1 - inputs.downPaymentPct;
  const pmi = ltv > 0.8 ? (loan * inputs.pmiRate * pmiLtvMultiplier(ltv)) / 12 : 0;
  return pi + (taxRate * price) / 12 + (insRate * price) / 12 + inputs.hoaMonthly + pmi;
}

const expectedDti = (inputs: PriceSearchInputs, price: number) =>
  (expectedPayment(inputs, price) + inputs.otherMonthlyDebt) / (inputs.annualIncome / 12);

describe("housingPayment", () => {
  it("is gross PITI: the mortgage payment plus the lender-counted carrying costs", () => {
    const inputs = at({});
    const result = calculate(inputs);
    const y1 = result.years[0];
    // Maintenance is the one recurring cost deliberately left out, because lenders leave it out.
    const counted = y1.costs.propertyTax + y1.costs.insurance + y1.costs.hoa + y1.costs.pmi;
    expect(housingPayment(result, inputs)).toBeCloseTo(result.monthlyPayment + counted / 12, 6);
    expect(housingPayment(result, inputs)).toBeLessThan(result.monthlyPayment + (counted + y1.costs.maintenance) / 12);
  });

  it("is the payment the back-end ratio is built on", () => {
    const inputs = at({});
    const result = calculate(inputs);
    const expected = (housingPayment(result, inputs) + inputs.otherMonthlyDebt) / (inputs.annualIncome / 12);
    expect(backEndDti(result, inputs)).toBeCloseTo(expected, 12);
  });
});

describe("backEndDti", () => {
  it("returns null without income to qualify against", () => {
    const inputs = at({ annualIncome: 0 });
    expect(backEndDti(calculate(inputs), inputs)).toBeNull();
  });

  it("returns null on an all-cash buy (no loan, so no lender ratio)", () => {
    const inputs = at({ downPaymentPct: 1 });
    expect(backEndDti(calculate(inputs), inputs)).toBeNull();
  });

  it("rises with price, which is what makes the max-price search a bisection", () => {
    let previous = -Infinity;
    for (const homePrice of [200000, 400000, 600000, 800000, 1200000, 2000000]) {
      const inputs = at({ homePrice });
      const dti = backEndDti(calculate(inputs), inputs)!;
      expect(dti).toBeGreaterThan(previous);
      previous = dti;
    }
  });
});

describe("maxPriceForDti", () => {
  it("lands the recomputed back-end DTI on the target, to within a dollar of payment", () => {
    for (const inputs of [
      at({}),
      at({ otherMonthlyDebt: 0 }),
      at({ hoaMonthly: 400 }),
      at({ annualIncome: 95000, otherMonthlyDebt: 200 }),
      at({ downPaymentPct: 0.1 }), // PMI band
      at({ downPaymentPct: 0.035 }), // the high-LTV PMI tier
      at({ propertyTax: { kind: "flatAnnual", annual: 9000 } }),
      at({ homeInsurance: { kind: "flatAnnual", annual: 3600 } }),
      at({ mortgageRate: 0.03, mortgageTermYears: 15 }),
    ]) {
      for (const target of [DTI_BACK_END_LIMIT, DTI_QM_LIMIT]) {
        const price = maxPriceForDti(inputs, target)!;
        expect(price).toBeGreaterThan(0);
        const dollarsOff = Math.abs(expectedDti(inputs, price) - target) * (inputs.annualIncome / 12);
        expect(dollarsOff).toBeLessThan(1);
      }
    }
  });

  it("is the maximum: a dollar more price is over the target, a dollar less is under", () => {
    const inputs = at({});
    const price = maxPriceForDti(inputs, DTI_BACK_END_LIMIT)!;
    expect(expectedDti(inputs, price + 1000)).toBeGreaterThan(DTI_BACK_END_LIMIT);
    expect(expectedDti(inputs, price - 1000)).toBeLessThan(DTI_BACK_END_LIMIT);
  });

  it("rises with the target ratio and falls as other debt eats the budget", () => {
    const inputs = at({});
    expect(maxPriceForDti(inputs, DTI_QM_LIMIT)!).toBeGreaterThan(maxPriceForDti(inputs, DTI_BACK_END_LIMIT)!);
    let previous = Infinity;
    for (const otherMonthlyDebt of [0, 250, 500, 1000, 2000]) {
      const price = maxPriceForDti(at({ otherMonthlyDebt }), DTI_BACK_END_LIMIT)!;
      expect(price).toBeLessThan(previous);
      previous = price;
    }
  });

  it("round-trips: buying at the quoted price puts the engine's own ratio on the target", () => {
    for (const inputs of [at({}), at({ hoaMonthly: 300 }), at({ annualIncome: 250000, otherMonthlyDebt: 900 })]) {
      const price = maxPriceForDti(inputs, DTI_BACK_END_LIMIT)!;
      const priced = { ...inputs, homePrice: price };
      const dti = backEndDti(calculate(priced), priced)!;
      // Not exact, and can't be: the panel reads the engine's year-1 AVERAGE payment, which has
      // grown a few months of appreciation and inflation, while the search prices the payment at
      // closing. The gap is the within-year growth on tax + insurance, well under a fifth of a
      // point of DTI, which is why the module tells callers to round a quoted price down.
      expect(dti).toBeGreaterThan(DTI_BACK_END_LIMIT);
      expect(dti - DTI_BACK_END_LIMIT).toBeLessThan(0.002);
    }
  });

  it("returns null when there's no income, or when other debt alone eats the target", () => {
    expect(maxPriceForDti(at({ annualIncome: 0 }), DTI_BACK_END_LIMIT)).toBeNull();
    expect(maxPriceForDti(at({ annualIncome: -1000 }), DTI_BACK_END_LIMIT)).toBeNull();
    // $40k of income against $1,500/mo of car and student loans: the back end is spent before
    // there's a mortgage to qualify.
    expect(maxPriceForDti(at({ annualIncome: 40000, otherMonthlyDebt: 1500 }), DTI_BACK_END_LIMIT)).toBeNull();
    // Same when HOA dues alone clear the line, even with no other debt at all.
    expect(maxPriceForDti(at({ annualIncome: 40000, otherMonthlyDebt: 0, hoaMonthly: 1300 }), DTI_BACK_END_LIMIT)).toBeNull();
  });

  it("stops at the search ceiling instead of running away on an unlimited income", () => {
    expect(maxPriceForDti(at({ annualIncome: 50_000_000 }), DTI_BACK_END_LIMIT)).toBe(MAX_SEARCH_PRICE);
  });
});
