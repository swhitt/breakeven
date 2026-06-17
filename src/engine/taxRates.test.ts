import { describe, expect, it } from "vitest";
import {
  estimateFederalIncomeTax,
  estimateFica,
  estimateMarginalRate,
  estimateStateIncomeTax,
  estimateTakeHome,
  FICA,
  STATE_TAX,
  STATE_OPTIONS,
} from "./taxRates";

describe("estimateMarginalRate", () => {
  it("adds federal and state marginal rates net of the standard deduction", () => {
    // Single, $100k income: taxable = 100,000 - 16,100 = $83,900 -> 22% federal.
    // Colorado is flat 4.4%. Combined 26.4%.
    const e = estimateMarginalRate(100_000, false, "CO");
    expect(e.federal).toBeCloseTo(0.22, 6);
    expect(e.state).toBeCloseTo(0.044, 6);
    expect(e.combined).toBeCloseTo(0.264, 6);
  });

  it("treats no-income-tax states (and the US sentinel) as zero state tax", () => {
    expect(estimateMarginalRate(80_000, false, "TX").state).toBe(0);
    expect(estimateMarginalRate(80_000, false, "US").state).toBe(0);
    expect(estimateMarginalRate(80_000, false, "ZZ").state).toBe(0); // unknown code
  });

  it("adds an optional local rate on top", () => {
    const base = estimateMarginalRate(100_000, false, "CO");
    const withLocal = estimateMarginalRate(100_000, false, "CO", 0.01);
    expect(withLocal.combined).toBeCloseTo(base.combined + 0.01, 6);
  });

  it("lands in the top brackets for very high incomes", () => {
    const e = estimateMarginalRate(2_000_000, false, "CA");
    expect(e.federal).toBeCloseTo(0.37, 6); // top federal bracket
    expect(e.state).toBeCloseTo(0.133, 6); // CA top incl. 1% MHST
    expect(e.combined).toBeCloseTo(0.503, 6);
  });

  it("uses joint brackets and thresholds when filing jointly", () => {
    // $250k joint: taxable = 250,000 - 32,200 = $217,800 -> 24% federal (the
    // joint 22% bracket tops out at $211,400, so this just crosses into 24%).
    const e = estimateMarginalRate(250_000, true, "TX");
    expect(e.federal).toBeCloseTo(0.24, 6);
  });

  it("clamps a stacked combined rate below 100%", () => {
    const e = estimateMarginalRate(5_000_000, false, "CA", 0.5);
    expect(e.combined).toBeLessThanOrEqual(0.99);
  });

  it("totals state (and local) income tax for the SALT base", () => {
    // CO flat 4.4% on taxable = 100,000 - 16,100 = $83,900 -> $3,692.
    expect(estimateStateIncomeTax(100_000, false, "CO")).toBe(3692);
    // No-tax state and the US sentinel owe nothing.
    expect(estimateStateIncomeTax(100_000, false, "TX")).toBe(0);
    expect(estimateStateIncomeTax(100_000, false, "US")).toBe(0);
    // A 1% local income tax adds 1% of the same taxable base ($839).
    expect(estimateStateIncomeTax(100_000, false, "CO", 0.01)).toBe(4531);
  });

  it("totals a progressive schedule as the area under the brackets, not the top rate", () => {
    // CA single $60k taxable spans several 1-9.3% brackets, so the effective
    // total is well below the marginal rate times income.
    const taxable = 60_000;
    const total = estimateStateIncomeTax(taxable + 16_100, false, "CA");
    const marginal = estimateMarginalRate(taxable + 16_100, false, "CA").state;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(marginal * taxable); // progressive < flat-at-top
  });

  it("covers all 50 states + DC with single and joint schedules", () => {
    expect(STATE_OPTIONS).toHaveLength(51);
    for (const { code } of STATE_OPTIONS) {
      const s = STATE_TAX[code];
      expect(s.single.length).toBeGreaterThan(0);
      expect(s.joint.length).toBeGreaterThan(0);
      // Top bracket of every schedule is open-ended.
      expect(s.single[s.single.length - 1].upTo).toBeNull();
      expect(s.joint[s.joint.length - 1].upTo).toBeNull();
    }
  });
});

describe("estimateFederalIncomeTax", () => {
  it("sums the brackets on income net of the standard deduction", () => {
    // Joint $180k: taxable = 180,000 - 32,200 = 147,800.
    // 10%*24,800 + 12%*76,000 + 22%*47,000 = 2,480 + 9,120 + 10,340 = 21,940.
    expect(estimateFederalIncomeTax(180_000, true)).toBe(21_940);
    // Single $100k: taxable = 83,900. 1,240 + 4,560 + 7,370 = 13,170.
    expect(estimateFederalIncomeTax(100_000, false)).toBe(13_170);
  });

  it("is zero when income is under the standard deduction", () => {
    expect(estimateFederalIncomeTax(10_000, false)).toBe(0);
  });
});

describe("estimateFica", () => {
  it("is Social Security plus Medicare on full wages below the thresholds", () => {
    // $180k joint: 6.2%*180,000 + 1.45%*180,000 = 11,160 + 2,610 = 13,770 (no surtax under $250k).
    expect(estimateFica(180_000, true)).toBe(13_770);
  });

  it("caps Social Security at the wage base", () => {
    // Above the base, the SS piece is fixed at 6.2% * wage base; two incomes past it (but both
    // under the joint $250k surtax line) differ by Medicare only, never by more SS.
    const ssAtBase = Math.round(FICA.ssRate * FICA.ssWageBase);
    const a = estimateFica(FICA.ssWageBase, true);
    const b = estimateFica(FICA.ssWageBase + 50_000, true); // 234,500 < 250k, so no surtax yet
    expect(b - a).toBeCloseTo(50_000 * FICA.medicareRate, 0);
    expect(a).toBe(ssAtBase + Math.round(FICA.medicareRate * FICA.ssWageBase));
  });

  it("adds the 0.9% Additional Medicare surtax over the filing-status threshold", () => {
    // Single $300k: SS 6.2%*184,500 = 11,439; Medicare 1.45%*300,000 = 4,350;
    // surtax 0.9%*(300,000-200,000) = 900. Total 16,689. Joint's $250k line => 450 surtax.
    expect(estimateFica(300_000, false)).toBe(16_689);
    expect(estimateFica(300_000, true)).toBe(16_239);
  });
});

describe("estimateTakeHome", () => {
  it("subtracts income tax (federal + state + local) and FICA from gross", () => {
    // Joint $180k, no state tax: 180,000 - 21,940 - 13,770 = 144,290.
    const us = estimateTakeHome(180_000, true, "US");
    expect(us.incomeTax).toBe(21_940);
    expect(us.fica).toBe(13_770);
    expect(us.takeHome).toBe(144_290);
  });

  it("folds state and local income tax into the income-tax line", () => {
    const us = estimateTakeHome(180_000, true, "US");
    const co = estimateTakeHome(180_000, true, "CO", 0.01);
    // The CO income tax is exactly the federal piece plus the SALT-base state+local figure.
    expect(co.incomeTax).toBe(us.incomeTax + estimateStateIncomeTax(180_000, true, "CO", 0.01));
    expect(co.takeHome).toBeLessThan(us.takeHome); // state tax reduces take-home
  });

  it("never returns negative take-home", () => {
    expect(estimateTakeHome(0, false, "US").takeHome).toBe(0);
  });
});
