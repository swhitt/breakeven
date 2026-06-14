import { describe, expect, it } from "vitest";
import { dataAgeDays, freshness, STALE_AFTER_DAYS } from "./freshness";

// A fixed "now" so the age math is deterministic.
const now = new Date("2026-06-14T12:00:00Z");

describe("dataAgeDays", () => {
  it("is 0 the same day and counts whole days back", () => {
    expect(dataAgeDays("2026-06-14", now)).toBe(0);
    expect(dataAgeDays("2026-06-07", now)).toBe(7);
    expect(dataAgeDays("2026-05-05", now)).toBe(40);
  });

  it("treats an unparseable date as infinitely stale, not fresh", () => {
    expect(dataAgeDays("not-a-date", now)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("freshness", () => {
  it("stays fresh inside the threshold and flips stale at the boundary", () => {
    expect(freshness("2026-06-07", now).stale).toBe(false);
    expect(freshness("2026-05-17", now).ageDays).toBe(STALE_AFTER_DAYS);
    expect(freshness("2026-05-17", now).stale).toBe(true);
    expect(freshness("2026-05-05", now).stale).toBe(true);
  });

  it("flags a malformed asOf as stale", () => {
    expect(freshness("garbage", now).stale).toBe(true);
  });
});
