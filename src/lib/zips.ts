// Lazy-loaded zip-level home value + rent table (public/zips.json, ~8k zips that have
// both a Zillow ZHVI value and a ZORI rent). Deliberately kept OUT of the JS bundle and
// fetched only when a user refines a metro by ZIP, then cached for the session. A failed
// load clears the cache so the next attempt can retry.

export interface ZipData {
  homeValue: number;
  rent: number;
  state: string;
  city: string;
  appreciation5yr?: number; // local 5yr home-value CAGR, when available
}

// Compact on-disk shape, terse keys to keep the file small: { "77002": { h, r, s, c, k, a } }.
interface RawZip {
  h: number;
  r: number;
  s: string;
  c: string;
  a?: number; // 5yr appreciation CAGR
}

let cache: Promise<Record<string, RawZip>> | null = null;

function load(): Promise<Record<string, RawZip>> {
  if (!cache) {
    cache = fetch("/zips.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Record<string, RawZip>>;
      })
      .catch((err) => {
        cache = null; // let the next lookup retry instead of caching the failure
        throw err;
      });
  }
  return cache;
}

/** Look up a 5-digit ZIP; null if it isn't in the table (no rent or no value data). */
export async function lookupZip(zip: string): Promise<ZipData | null> {
  const table = await load();
  const z = table[zip];
  return z ? { homeValue: z.h, rent: z.r, state: z.s, city: z.c, appreciation5yr: z.a } : null;
}
