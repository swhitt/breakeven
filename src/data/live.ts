import type { MarketData } from "./types";

// The repo's data files, served by jsDelivr's CDN straight off `main`. Fetching
// these at runtime lets the live site reflect data committed between full deploys
// (e.g. the weekly sync, or a manual "refresh data" run) without a rebuild. The
// bundled JSON remains the source of truth and the fallback, so this is always an
// upgrade, never a dependency: any failure leaves the build-time data in place.
const CDN = "https://cdn.jsdelivr.net/gh/swhitt/breakeven@main/src/data";
const TIMEOUT_MS = 6000;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Validate every numeric leaf the app actually reads off live data, not just a
// couple. A half-written commit or schema drift can yield valid JSON with one
// missing field, and clamp()/Math.max() on undefined silently produce NaN that
// then floods the whole sim, defeating the bundled-fallback guarantee.
function isMarket(v: unknown): v is MarketData {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  const mortgage = m.mortgage as Record<string, unknown> | undefined;
  const inflation = m.inflation as Record<string, unknown> | undefined;
  const national = m.national as Record<string, unknown> | undefined;
  return (
    typeof m.asOf === "string" &&
    !!mortgage &&
    num(mortgage.rate30) &&
    num(mortgage.rate15) &&
    !!inflation &&
    num(inflation.rate) &&
    !!national &&
    num(national.homeValue) &&
    num(national.rent)
  );
}

/**
 * Best-effort fetch of the freshest committed market.json. Returns null on any
 * failure (offline, blocked, slow, malformed) so the caller keeps the bundled
 * copy. Only the high-churn headline numbers (rates, inflation, national price/
 * rent, appreciation) are loaded live; the slow-moving metro/tax/insurance tables
 * ship with the build.
 */
export async function fetchLiveMarket(): Promise<MarketData | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CDN}/market.json`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return isMarket(json) ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
