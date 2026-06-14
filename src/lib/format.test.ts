import { describe, expect, it } from "vitest";
import { pct, usd, usdCompact } from "./format";

describe("usd", () => {
  it("rounds to whole dollars with a thousands separator by default", () => {
    expect(usd(2200)).toBe("$2,200");
    expect(usd(1234.56)).toBe("$1,235");
    expect(usd(-500)).toBe("-$500");
  });

  it("honors an explicit fraction-digit count", () => {
    expect(usd(6.5, 2)).toBe("$6.50");
  });
});

describe("usdCompact", () => {
  it("puts the sign before the $ and rounds K/M cleanly", () => {
    expect(usdCompact(950)).toBe("$950");
    expect(usdCompact(-64_000)).toBe("-$64K");
    // 999_500 rounds into the M branch so it reads $1.0M, never $1000K.
    expect(usdCompact(999_500)).toBe("$1.0M");
    expect(usdCompact(10_000_000)).toBe("$10M");
    expect(usdCompact(-10_000_000)).toBe("-$10M");
  });
});

describe("pct", () => {
  it("formats a fraction as a percent with the given precision", () => {
    expect(pct(0.065, 2)).toBe("6.50%");
    expect(pct(0.03)).toBe("3.0%");
  });
});
