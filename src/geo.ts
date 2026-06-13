import type { LocationData } from "./data/types";

/**
 * Best-effort IP geolocation to auto-pick the user's metro on first load.
 *
 * Privacy/architecture note: this is the only runtime network call the site
 * makes (everything else is baked at build time). It hits a free, keyless IP
 * geo API, sends no PII we control, and degrades silently to the national
 * default if anything fails or the visitor is outside the US. The resolved
 * metro is cached in localStorage so we don't call it again.
 */
export async function detectMetro(locations: LocationData[]): Promise<LocationData | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://ipapi.co/json/", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const geo = (await res.json()) as { country_code?: string; region_code?: string; city?: string };
    if (geo.country_code && geo.country_code !== "US") return null;

    const state = (geo.region_code || "").toUpperCase();
    if (!state) return null;
    const city = (geo.city || "").toLowerCase().trim();

    const inState = locations.filter((l) => l.state === state);
    if (inState.length === 0) return null;

    // Prefer a metro whose principal city is the user's city, else the largest
    // metro in their state (locations are ordered largest-first within a state).
    if (city) {
      const exact = inState.find((l) => l.metro.toLowerCase().startsWith(`${city},`));
      if (exact) return exact;
      const contains = inState.find((l) => l.metro.toLowerCase().includes(city));
      if (contains) return contains;
    }
    return inState[0];
  } catch {
    return null;
  }
}
