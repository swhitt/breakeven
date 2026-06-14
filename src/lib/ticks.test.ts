import { describe, expect, it } from "vitest";
import { breakevenLabelPosition, niceStep, niceTicks, yearTicks } from "./ticks";

describe("niceStep", () => {
  it("rounds the ideal step to a 1/2/5/10 * magnitude value", () => {
    // range 40 over the default 5 targets => raw 8, which rounds UP to 10 (not down to 5).
    expect(niceStep(40)).toBe(10);
    // range 4 => raw 0.8 => 1, per the comment that flooring here doubles the tick count.
    expect(niceStep(4)).toBe(1);
    expect(niceStep(100)).toBe(20);
  });

  it("never returns a non-positive step for a degenerate range", () => {
    expect(niceStep(0)).toBeGreaterThan(0);
  });
});

describe("niceTicks", () => {
  it("includes zero when the range straddles it", () => {
    expect(niceTicks(-100, 200)).toContain(0);
  });

  it("spans the full range and stays sorted ascending", () => {
    const ticks = niceTicks(0, 1000);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1000);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it("handles a degenerate min === max without throwing or emptying", () => {
    const ticks = niceTicks(5, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks.every(Number.isFinite)).toBe(true);
  });
});

describe("yearTicks", () => {
  it("caps the shared 1/5/10/.../30 ticks at the data length", () => {
    expect(yearTicks(12)).toEqual([1, 5, 10]);
    expect(yearTicks(30)).toEqual([1, 5, 10, 15, 20, 25, 30]);
    expect(yearTicks(1)).toEqual([1]);
  });
});

describe("breakevenLabelPosition", () => {
  it("anchors left once the year passes ~62% of the x-range, else right", () => {
    expect(breakevenLabelPosition(5, 30)).toBe("right");
    expect(breakevenLabelPosition(25, 30)).toBe("left");
  });
});
