/**
 * A 1/2/5/10-rounded step so axis labels land on clean numbers (and on zero).
 * Rounds the ideal step to the NEAREST nice value, not down: flooring (e.g. norm 4
 * picking 2) doubles the tick count and crowds the axis on large ranges.
 */
export function niceStep(range: number, target = 5): number {
  const raw = Math.max(range, 1) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag; // in [1, 10)
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

/** Evenly-spaced ticks across [min, max]; always hits zero when the range spans it. */
export function niceTicks(min: number, max: number): number[] {
  const step = niceStep(max - min);
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) out.push(Math.round(t));
  return out;
}
