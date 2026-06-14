// How stale the live market data is. The header shows "data fresh as of <asOf>", but the
// weekly refresh cron's push step is continue-on-error, so a broken run otherwise serves
// week-old data still labeled fresh. Past a threshold we downgrade the badge to a warning.

export interface Freshness {
  asOf: string;
  ageDays: number;
  stale: boolean;
}

// The refresh cron runs every Friday, so one missed run is normal slack. Flag stale only
// past ~4 weeks, when several runs have failed and the numbers are genuinely suspect.
export const STALE_AFTER_DAYS = 28;

// Whole days between an asOf date (YYYY-MM-DD, UTC) and now. An unparseable date returns
// Infinity so a malformed asOf trips the warning rather than masquerading as fresh.
export function dataAgeDays(asOf: string, now: Date): number {
  const then = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

export function freshness(asOf: string, now: Date): Freshness {
  const ageDays = dataAgeDays(asOf, now);
  return { asOf, ageDays, stale: ageDays >= STALE_AFTER_DAYS };
}
