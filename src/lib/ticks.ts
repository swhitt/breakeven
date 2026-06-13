/** A 1/2/5-rounded step so axis labels land on clean numbers (and on zero). */
export function niceStep(range: number, target = 5): number {
  const raw = Math.max(range, 1) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
}

/** Evenly-spaced ticks across [min, max]; always hits zero when the range spans it. */
export function niceTicks(min: number, max: number): number[] {
  const step = niceStep(max - min);
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) out.push(Math.round(t));
  return out;
}
