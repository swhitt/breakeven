export function usd(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(Math.round(n * 10 ** fractionDigits) / 10 ** fractionDigits);
}

/** Compact dollars with the sign before the $: $1.2M, $340K, -$64K. */
export function usdCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  // 999_500+ rounds into the M branch so it reads $1.0M, not $1000K.
  if (abs >= 999_500) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function yearsLabel(years: number | null): string {
  return years == null ? "never" : years === 1 ? "1 year" : `${years} years`;
}
