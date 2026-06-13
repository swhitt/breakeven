import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Label, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calculate, type CalcInputs } from "../engine/calculator";
import { pct, usd } from "../lib/format";
import { niceTicks } from "../lib/ticks";

// Breakeven rents cluster in the low thousands, where usdCompact's whole-$K rounding
// collapses every tick to "$2K"; one decimal keeps them distinct ($1.6K, $1.8K).
const rentTick = (v: number) => `$${(v / 1000).toFixed(1)}K`;

// Each row sweeps one uncertain input across a plausible band, holding the rest at
// today's values, and reports how far the breakeven rent moves. The widest swings
// are the assumptions your answer is most hostage to.
interface Factor {
  key: keyof CalcInputs;
  label: string;
  lo: number;
  hi: number;
  fmt: (n: number) => string;
}

function buildFactors(inp: CalcInputs): Factor[] {
  const p1 = (n: number) => pct(n, 1);
  return [
    { key: "mortgageRate", label: "Mortgage rate", lo: Math.max(0, inp.mortgageRate - 0.015), hi: inp.mortgageRate + 0.015, fmt: (n) => pct(n, 2) },
    { key: "investmentReturn", label: "Investment return", lo: Math.max(0, inp.investmentReturn - 0.02), hi: inp.investmentReturn + 0.02, fmt: p1 },
    { key: "homeAppreciation", label: "Home appreciation", lo: inp.homeAppreciation - 0.02, hi: inp.homeAppreciation + 0.02, fmt: p1 },
    { key: "yearsToStay", label: "Years you stay", lo: Math.max(1, inp.yearsToStay - 3), hi: inp.yearsToStay + 3, fmt: (n) => `${Math.round(n)}y` },
    { key: "rentGrowth", label: "Rent growth", lo: Math.max(0, inp.rentGrowth - 0.015), hi: inp.rentGrowth + 0.015, fmt: p1 },
    { key: "inflation", label: "Inflation", lo: Math.max(0, inp.inflation - 0.015), hi: inp.inflation + 0.015, fmt: p1 },
  ];
}

interface Row {
  label: string;
  range: [number, number]; // [low, high] breakeven rent, for the floating bar
  swing: number;
  loBreakeven: number; // breakeven rent at the factor's low end (and high end)
  hiBreakeven: number;
  factor: Factor;
  flips: boolean; // does the range straddle your actual rent?
}

const FLIP_COLOR = "var(--color-buy)"; // a factor that can flip the verdict draws attention

function SensitivityTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-lg">
      <div className="mb-1 font-semibold text-ink">{r.label}</div>
      <div className="flex items-baseline justify-between gap-6 text-muted">
        <span>{r.factor.fmt(r.factor.lo)}</span>
        <span className="tnum font-semibold text-ink">{usd(r.loBreakeven)}/mo</span>
      </div>
      <div className="flex items-baseline justify-between gap-6 text-muted">
        <span>{r.factor.fmt(r.factor.hi)}</span>
        <span className="tnum font-semibold text-ink">{usd(r.hiBreakeven)}/mo</span>
      </div>
      <div className="mt-1.5 border-t border-line pt-1.5 text-muted">
        {r.flips ? (
          <span style={{ color: FLIP_COLOR }}>Can flip the verdict on its own.</span>
        ) : (
          "Doesn't change the answer over this range."
        )}
      </div>
    </div>
  );
}

/**
 * Sensitivity tornado: how much each uncertain assumption moves the breakeven rent.
 * Bars are sorted widest-first (the tornado shape), and any whose range straddles your
 * actual rent (the dashed line) is highlighted, because that assumption alone could
 * flip rent vs. buy. calculate() is pure, so this is a couple-dozen cheap re-runs.
 */
export function SensitivityChart({ inputs, monthlyRent }: { inputs: CalcInputs; monthlyRent: number }) {
  const { rows, domain, ticks } = useMemo(() => {
    const data: Row[] = buildFactors(inputs)
      .map((factor) => {
        const loBreakeven = calculate({ ...inputs, [factor.key]: factor.lo }).breakevenRent;
        const hiBreakeven = calculate({ ...inputs, [factor.key]: factor.hi }).breakevenRent;
        const lo = Math.min(loBreakeven, hiBreakeven);
        const hi = Math.max(loBreakeven, hiBreakeven);
        return { label: factor.label, range: [lo, hi] as [number, number], swing: hi - lo, loBreakeven, hiBreakeven, factor, flips: lo <= monthlyRent && monthlyRent <= hi };
      })
      .sort((a, b) => b.swing - a.swing);

    const vals = data.flatMap((d) => d.range).concat(monthlyRent);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.08 || 100;
    const domain: [number, number] = [Math.max(0, min - pad), max + pad];
    return { rows: data, domain, ticks: niceTicks(domain[0], domain[1]) };
  }, [inputs, monthlyRent]);

  return (
    <>
    <div
      className="h-72 w-full sm:h-80"
      role="img"
      aria-label={`Tornado chart: how far the breakeven rent moves as each assumption varies. Widest mover is ${rows[0]?.label}. The dashed line is your rent of ${usd(monthlyRent)}; a bar left of it means buying wins for that range, right of it means renting wins, and a bar crossing it could flip the verdict.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 24, right: 12, left: 4, bottom: 0 }} barCategoryGap="28%" accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--color-line)" />
          <XAxis
            type="number"
            domain={domain}
            ticks={ticks}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            tickFormatter={rentTick}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={108}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--color-ink)" }}
          />
          <Tooltip cursor={{ fill: "var(--color-ink)", fillOpacity: 0.04 }} content={<SensitivityTooltip />} />
          {/* Your actual rent: the verdict threshold. Bars that cross it can flip the answer. */}
          <ReferenceLine x={monthlyRent} stroke="var(--color-rent)" strokeWidth={2} strokeDasharray="6 4">
            <Label value={`your rent ${usd(monthlyRent)}`} position="top" fontSize={11} fill="var(--color-rent-text)" />
          </ReferenceLine>
          {/* minPointSize keeps a near-zero swing (e.g. inflation) visible as a small nub
              that reads "negligible" instead of vanishing into a 1px sliver. */}
          <Bar dataKey="range" radius={4} minPointSize={3} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.label} fill={r.flips ? FLIP_COLOR : "var(--color-muted)"} fillOpacity={r.flips ? 1 : 0.4} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
      {/* The x-axis is breakeven rent, so the verdict sides read off the dashed "your rent"
          line: lower breakeven (left) means buying already wins; higher (right) means renting. */}
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-medium text-buy-text">&#9664; buying wins here</span>
        <span className="font-medium text-rent-text">renting wins here &#9654;</span>
      </div>
    </>
  );
}
