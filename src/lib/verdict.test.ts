import { describe, expect, it } from "vitest";
import type { CalcResult } from "../engine/calculator";
import { CLOSE_CALL_FRACTION, isCloseCall, verdictLabel } from "./verdict";

// Only the fields the verdict helpers read; the rest of CalcResult is irrelevant here.
const result = (verdict: "buy" | "rent", monthlyDifference: number): CalcResult =>
  ({ verdict, monthlyDifference }) as CalcResult;

describe("isCloseCall", () => {
  it("is true just inside the close-call band and false just outside", () => {
    const rent = 2000;
    const edge = rent * CLOSE_CALL_FRACTION;
    expect(isCloseCall(result("rent", edge - 1), { monthlyRent: rent })).toBe(true);
    expect(isCloseCall(result("rent", edge + 1), { monthlyRent: rent })).toBe(false);
  });

  it("uses the magnitude of the difference, either direction", () => {
    expect(isCloseCall(result("buy", -10), { monthlyRent: 2000 })).toBe(true);
  });
});

describe("verdictLabel", () => {
  it("calls a toss-up before naming a winner", () => {
    expect(verdictLabel(result("rent", 10), { monthlyRent: 2000 })).toBe("Toss-up");
  });

  it("names the cheaper side once the gap clears the band", () => {
    expect(verdictLabel(result("rent", 500), { monthlyRent: 2000 })).toBe("Rent it");
    expect(verdictLabel(result("buy", 500), { monthlyRent: 2000 })).toBe("Buy it");
  });
});
