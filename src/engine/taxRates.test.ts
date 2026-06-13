import { describe, expect, it } from "vitest";
import { estimateMarginalRate, STATE_TAX, STATE_OPTIONS } from "./taxRates";

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
