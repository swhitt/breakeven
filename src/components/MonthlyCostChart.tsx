import { memo } from "react";
import { CartesianGrid, Label, Line, LineChart, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { grossOwningCost, netOwningCost, type YearRow } from "../engine/calculator";
import { usd } from "../lib/format";
import { breakevenLabelPosition, niceTicks, yearTicks } from "../lib/ticks";
import { ChartFrame, TOOLTIP_TRIGGER, TooltipCard } from "./chart/ChartFrame";

interface Row {
  year: number;
  own: number; // all-in monthly cost of owning (net or gross per the toggle)
  rent: number; // that year's monthly rent
}

// Monthly costs sit in the low thousands, where usdCompact's whole-$K rounding collapses
// adjacent ticks ($2.5K and $3.0K both read "$3K"). Show a decimal unless the tick is a round
// thousand, so the axis labels stay distinct.
const moneyTick = (v: number): string => {
  if (v === 0) return "$0";
  if (v < 1000) return `$${Math.round(v)}`;
  return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
};

function MonthlyCostTooltip({
  active,
  payload,
  label,
  net,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
  label?: number;
  net: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const ownCheaper = row.own <= row.rent;
  return (
    <TooltipCard>
      <div className="mb-1 text-muted">
        Year {label}
      </div>
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-buy-text">Owning{net ? " (after tax)" : ""}</span>
        <span className="tnum font-semibold text-ink">{usd(row.own)}/mo</span>
      </div>
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-rent-text">Renting</span>
        <span className="tnum font-semibold text-ink">{usd(row.rent)}/mo</span>
      </div>
      <div className="mt-1.5 border-t border-line pt-1.5">
        <span className={ownCheaper ? "text-buy-text" : "text-rent-text"}>
          {ownCheaper ? "Owning" : "Renting"} cheaper by{" "}
        </span>
        <span className="tnum font-bold text-ink">{usd(Math.abs(row.own - row.rent))}/mo</span>
      </div>
    </TooltipCard>
  );
}

/**
 * Monthly cost of owning vs renting across the horizon. The owning line is the all-in monthly
 * carrying cost (mortgage + tax + insurance + maintenance + HOA/PMI), net or gross of the tax
 * benefit per the toggle; it holds roughly flat (fixed P&I, a PMI drop-off, slow cost creep)
 * while rent climbs with rent growth. The whole point is where they cross: the year renting
 * starts costing more per month. The net line equals the breakdown table's "Cost to own" / 12.
 */
export const MonthlyCostChart = memo(function MonthlyCostChart({ years, net }: { years: YearRow[]; net: boolean }) {
  const rows: Row[] = years.map((y) => ({
    year: y.year,
    own: (net ? netOwningCost(y) : grossOwningCost(y)) / 12,
    rent: y.rentPaid / 12,
  }));

  // The crossover: the first year the cheaper side flips. Renting usually starts cheaper and
  // climbs past the flat owning line; if they never swap order, there's no marker.
  let cross: Row | undefined;
  for (let i = 1; i < rows.length; i++) {
    const wasRentCheaper = rows[i - 1].rent < rows[i - 1].own;
    const isRentCheaper = rows[i].rent < rows[i].own;
    if (wasRentCheaper !== isRentCheaper) {
      cross = rows[i];
      break;
    }
  }

  const vals = rows.flatMap((r) => [r.own, r.rent]);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  const pad = Math.max(dataMax - dataMin, 1) * 0.08;
  const domainMin = Math.max(0, dataMin - pad);
  const domainMax = dataMax + pad;

  const last = rows[rows.length - 1];
  const endsRentCheaper = last ? last.rent < last.own : false;
  const ariaLabel = cross
    ? `Monthly cost of owning versus renting over ${rows.length} years. They cross around year ${cross.year}, after which ${endsRentCheaper ? "owning" : "renting"} costs more per month.`
    : `Monthly cost of owning versus renting over ${rows.length} years. ${endsRentCheaper ? "Renting" : "Owning"} stays cheaper per month the whole time at these numbers.`;

  return (
    <>
      <ChartFrame ariaLabel={ariaLabel}>
        <LineChart data={rows} margin={{ top: 16, right: 8, left: 4, bottom: 0 }} accessibilityLayer>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="year"
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            tickFormatter={(y) => `${y}y`}
            ticks={yearTicks(rows.length)}
          />
          <YAxis
            domain={[domainMin, domainMax]}
            ticks={niceTicks(domainMin, domainMax)}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            tickFormatter={moneyTick}
          />
          <Tooltip
            trigger={TOOLTIP_TRIGGER}
            cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }}
            content={<MonthlyCostTooltip net={net} />}
          />
          {/* Renting dashed, owning solid, matching the net-worth chart so the pair reads by
              pattern as well as hue. */}
          <Line
            type="monotone"
            dataKey="rent"
            name="rent"
            stroke="var(--color-rent)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="own"
            name="own"
            stroke="var(--color-buy)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          {/* Reference elements are separate siblings, not wrapped in a Fragment: Recharts
              walks the chart's direct children by type and skips anything nested in a <>. */}
          {cross && <ReferenceLine x={cross.year} stroke="var(--color-muted)" strokeDasharray="4 4" />}
          {cross && (
            // Midpoint of the two lines at the crossing year: they meet between integer years,
            // so this reads as "around here" rather than a false-precise point.
            <ReferenceDot
              x={cross.year}
              y={(cross.own + cross.rent) / 2}
              r={4}
              fill="var(--color-ink)"
              stroke="var(--color-paper)"
              strokeWidth={2}
            >
              <Label
                value={`crossover ~ ${cross.year}y`}
                position={breakevenLabelPosition(cross.year, rows.length)}
                fontSize={11}
                fill="var(--color-muted)"
              />
            </ReferenceDot>
          )}
        </LineChart>
      </ChartFrame>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-buy" /> Owning
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-rent" /> Renting
        </span>
      </div>
    </>
  );
});
