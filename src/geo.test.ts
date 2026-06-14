import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationData } from "./data/types";
import { detectMetro } from "./geo";

// Ordered largest-first within a state, the way locations.json is, so inState[0] is the
// "largest metro in your state" fallback. Winston-Salem exercises the contains (not
// startsWith) branch, since "salem" is inside the name but not its leading city.
const locs: LocationData[] = [
  { id: "united-states", metro: "United States", state: "US", homeValue: 368000, rent: 1930 },
  { id: "houston-tx", metro: "Houston, TX", state: "TX", homeValue: 300000, rent: 1600 },
  { id: "dallas-tx", metro: "Dallas, TX", state: "TX", homeValue: 350000, rent: 1700 },
  { id: "winston-salem-nc", metro: "Winston-Salem, NC", state: "NC", homeValue: 250000, rent: 1300 },
];

const mockGeo = (geo: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => geo })));

afterEach(() => vi.unstubAllGlobals());

describe("detectMetro", () => {
  it("matches a metro whose principal city is the user's city", async () => {
    mockGeo({ country_code: "US", region_code: "TX", city: "Houston" });
    expect(await detectMetro(locs)).toMatchObject({ id: "houston-tx" });
  });

  it("falls back to a substring match when no city starts the name", async () => {
    mockGeo({ country_code: "US", region_code: "NC", city: "Salem" });
    expect(await detectMetro(locs)).toMatchObject({ id: "winston-salem-nc" });
  });

  it("falls back to the largest metro in the state when the city is unknown", async () => {
    mockGeo({ country_code: "US", region_code: "TX", city: "Katy" });
    expect(await detectMetro(locs)).toMatchObject({ id: "houston-tx" });
  });

  it("uses the largest in state when no city is provided at all", async () => {
    mockGeo({ country_code: "US", region_code: "TX" });
    expect(await detectMetro(locs)).toMatchObject({ id: "houston-tx" });
  });

  it("treats a missing country_code as US (the API omits it sometimes)", async () => {
    mockGeo({ region_code: "TX", city: "Dallas" });
    expect(await detectMetro(locs)).toMatchObject({ id: "dallas-tx" });
  });

  it("returns null outside the US", async () => {
    mockGeo({ country_code: "CA", region_code: "ON", city: "Toronto" });
    expect(await detectMetro(locs)).toBeNull();
  });

  it("returns null when no region/state comes back", async () => {
    mockGeo({ country_code: "US", city: "Houston" });
    expect(await detectMetro(locs)).toBeNull();
  });

  it("returns null when the state has no metros in the table", async () => {
    mockGeo({ country_code: "US", region_code: "WY", city: "Cheyenne" });
    expect(await detectMetro(locs)).toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    mockGeo({ country_code: "US", region_code: "TX", city: "Houston" }, false);
    expect(await detectMetro(locs)).toBeNull();
  });

  it("returns null when the fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await detectMetro(locs)).toBeNull();
  });

  it("returns null when the body isn't valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    expect(await detectMetro(locs)).toBeNull();
  });
});
