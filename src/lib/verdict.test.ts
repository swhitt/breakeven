import { describe, expect, it } from "vitest";
import type { CalcResult } from "../engine/calculator";
import {
  CLOSE_CALL_FRACTION,
  isCloseCall,
  TOSS_UP_FLIP_COUNT,
  verdictConfidence,
  verdictLabel,
} from "./verdict";

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

describe("verdictConfidence", () => {
  // Phoenix-shaped: a $500 gap on $2000 rent is four times the close-call band, so the band
  // stays quiet, but three sensitivity factors each straddle the rent on their own. The site
  // used to print a confident "Buy it" over a footnote that said the opposite.
  it("is a toss-up on flip count alone, with the gap well outside the band", () => {
    const inputs = { monthlyRent: 2000 };
    expect(isCloseCall(result("buy", 500), inputs)).toBe(false);
    expect(verdictConfidence(result("buy", 500), inputs, 3)).toBe("toss-up");
  });

  it("names the winner when the gap is wide and few assumptions flip it", () => {
    const inputs = { monthlyRent: 2000 };
    expect(verdictConfidence(result("buy", 500), inputs, 0)).toBe("buy");
    expect(verdictConfidence(result("rent", 500), inputs, TOSS_UP_FLIP_COUNT - 1)).toBe("rent");
  });

  it("still calls the band a toss-up however robust the sweep looks", () => {
    expect(verdictConfidence(result("buy", 10), { monthlyRent: 2000 }, 0)).toBe("toss-up");
  });

  it("treats an omitted flip count as band-only", () => {
    expect(verdictConfidence(result("buy", 500), { monthlyRent: 2000 })).toBe("buy");
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

  it("speaks the same word for a flip-count toss-up", () => {
    expect(verdictLabel(result("buy", 500), { monthlyRent: 2000 }, TOSS_UP_FLIP_COUNT)).toBe("Toss-up");
  });

  // App.tsx still calls the two-arg form, so the flipCount-free path has to keep producing
  // byte-identical copy. Pinned against the pre-flipCount expression rather than a literal
  // list, so a later edit to either branch of the label has to be a deliberate one.
  it("is unchanged from the pre-flipCount behaviour when flipCount is omitted", () => {
    const legacyLabel = (r: CalcResult, i: { monthlyRent: number }) =>
      isCloseCall(r, i) ? "Toss-up" : r.verdict === "rent" ? "Rent it" : "Buy it";
    const inputs = { monthlyRent: 2000 };
    const edge = inputs.monthlyRent * CLOSE_CALL_FRACTION;
    const cases: CalcResult[] = [
      result("buy", 0),
      result("rent", 0),
      result("buy", edge - 1),
      result("rent", -(edge - 1)),
      result("buy", edge),
      result("rent", edge + 1),
      result("buy", 500),
      result("rent", -500),
    ];
    for (const r of cases) expect(verdictLabel(r, inputs)).toBe(legacyLabel(r, inputs));
  });
});
