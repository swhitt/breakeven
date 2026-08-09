import { describe, expect, it } from "vitest";
import type { NetWorthPoint } from "../engine/calculator";
import { clipNetWorth, netWorthWindowYears, NET_WORTH_MAX_YEARS } from "./netWorthWindow";

const series = (years: number): NetWorthPoint[] =>
  Array.from({ length: years }, (_, i) => ({ year: i + 1, buyerNetWorth: 0, renterNetWorth: 0 }));

describe("netWorthWindowYears", () => {
  // The late-breakeven case (a San Francisco ZIP runs 27 years against the 9-year default stay).
  // Clipping to the stay would cut the crossing off the chart entirely.
  it("keeps the full span when the breakeven lands past the stay", () => {
    expect(netWorthWindowYears(9, 30)).toBe(30);
  });

  it("clips to the stay plus runway when the breakeven lands inside it", () => {
    expect(netWorthWindowYears(9, 5)).toBe(11);
  });

  it("clips to the stay plus runway when buying never breaks even", () => {
    expect(netWorthWindowYears(9, null)).toBe(11);
  });

  it("never exceeds the engine's simulated span", () => {
    expect(netWorthWindowYears(30, 30)).toBe(NET_WORTH_MAX_YEARS);
  });
});

describe("clipNetWorth", () => {
  it("returns years 1..n of the engine's full series", () => {
    const clipped = clipNetWorth(series(30), 9, 5);
    expect(clipped).toHaveLength(11);
    expect(clipped[0].year).toBe(1);
    expect(clipped[clipped.length - 1].year).toBe(11);
  });
});
