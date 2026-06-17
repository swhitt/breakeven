import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Label, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { usd } from "../lib/format";
import { type SensitivityRow } from "../lib/sensitivity";
import { niceTicks } from "../lib/ticks";
import { ChartFrame, TOOLTIP_TRIGGER, TooltipCard } from "./chart/ChartFrame";

// Breakeven rents cluster in the low thousands, where usdCompact's whole-$K rounding
// collapses every tick to "$2K"; one decimal keeps them distinct ($1.6K, $1.8K).
const rentTick = (v: number) => `$${(v / 1000).toFixed(1)}K`;

const FLIP_COLOR = "var(--color-buy)"; // a factor that can flip the verdict draws attention

function SensitivityTooltip({ active, payload }: { active?: boolean; payload?: { payload: SensitivityRow }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TooltipCard>
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
    </TooltipCard>
  );
}

/**
 * Sensitivity tornado: how much each uncertain assumption moves the breakeven rent.
 * Bars are sorted widest-first (the tornado shape), and any whose range straddles your
 * actual rent (the dashed line) is highlighted, because that assumption alone could
 * flip rent vs. buy. calculate() is pure, so this is a couple-dozen cheap re-runs.
 */
export function SensitivityChart({ rows, monthlyRent }: { rows: SensitivityRow[]; monthlyRent: number }) {
  const { domain, ticks } = useMemo(() => {
    const vals = rows.flatMap((d) => d.range).concat(monthlyRent);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.08 || 100;
    const domain: [number, number] = [Math.max(0, min - pad), max + pad];
    return { domain, ticks: niceTicks(domain[0], domain[1]) };
  }, [rows, monthlyRent]);

  return (
    <>
    <ChartFrame
      ariaLabel={`Tornado chart: how far the breakeven rent moves as each assumption varies. Widest mover is ${rows[0]?.label}. The dashed line is your rent of ${usd(monthlyRent)}; a bar left of it means buying wins for that range, right of it means renting wins, and a bar crossing it could flip the verdict.`}
    >
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
        <Tooltip trigger={TOOLTIP_TRIGGER} cursor={{ fill: "var(--color-ink)", fillOpacity: 0.04 }} content={<SensitivityTooltip />} />
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
    </ChartFrame>
      {/* The x-axis is breakeven rent, so the verdict sides read off the dashed "your rent"
          line: lower breakeven (left) means buying already wins; higher (right) means renting. */}
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-medium text-buy-text">&#9664; buying wins here</span>
        <span className="font-medium text-rent-text">renting wins here &#9654;</span>
      </div>
    </>
  );
}
