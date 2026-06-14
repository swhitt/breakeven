import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// zips.ts caches the fetched table in a module-level variable, so reset the module before
// each test to get a clean cache and import a fresh copy of lookupZip.
let lookupZip: typeof import("./zips").lookupZip;

const table = {
  "77002": { h: 300000, r: 1600, s: "TX", c: "Houston" },
  "10001": { h: 1700000, r: 6000, s: "NY", c: "New York", a: 0.052 },
};

beforeEach(async () => {
  vi.resetModules();
  ({ lookupZip } = await import("./zips"));
});
afterEach(() => vi.unstubAllGlobals());

const okOnce = () => vi.fn(async () => ({ ok: true, json: async () => table }));

describe("lookupZip", () => {
  it("maps the compact on-disk shape to ZipData", async () => {
    vi.stubGlobal("fetch", okOnce());
    expect(await lookupZip("77002")).toEqual({
      homeValue: 300000,
      rent: 1600,
      state: "TX",
      city: "Houston",
    });
  });

  it("carries the 5-year appreciation when present", async () => {
    vi.stubGlobal("fetch", okOnce());
    expect(await lookupZip("10001")).toMatchObject({ appreciation5yr: 0.052 });
  });

  it("returns null for a ZIP not in the table", async () => {
    vi.stubGlobal("fetch", okOnce());
    expect(await lookupZip("99999")).toBeNull();
  });

  it("fetches the table once and serves later lookups from cache", async () => {
    const fetchMock = okOnce();
    vi.stubGlobal("fetch", fetchMock);
    await lookupZip("77002");
    await lookupZip("10001");
    await lookupZip("99999");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects on a non-ok response and clears the cache so a retry refetches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => table });
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupZip("77002")).rejects.toThrow();
    // Cache was cleared, so the next lookup tries again and succeeds.
    expect(await lookupZip("77002")).toMatchObject({ city: "Houston" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when the fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(lookupZip("77002")).rejects.toThrow();
  });
});
