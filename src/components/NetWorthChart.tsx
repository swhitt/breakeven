import { memo } from "react";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NetWorthPoint } from "../engine/calculator";
import { usd, usdCompact } from "../lib/format";
import { breakevenLabelPosition, niceTicks, yearTicks } from "../lib/ticks";
import { ChartFrame, TOOLTIP_TRIGGER, TooltipCard } from "./chart/ChartFrame";

/** Wealth card: the two totals plus who's ahead, leaning hard on dollars-in-pocket so it
 *  reads as a different question than the cost chart, not the same data twice. */
function NetWorthTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: NetWorthPoint }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const gap = row.buyerNetWorth - row.renterNetWorth;
  const buyAhead = gap >= 0;
  return (
    <TooltipCard>
      <div className="mb-1 text-muted">
        After {label} year{label === 1 ? "" : "s"}
      </div>
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-buy-text">Buying (equity if you sell)</span>
        <span className="tnum font-semibold text-ink">{usd(row.buyerNetWorth)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-rent-text">Renting (invested difference)</span>
        <span className="tnum font-semibold text-ink">{usd(row.renterNetWorth)}</span>
      </div>
      <div className="mt-1.5 border-t border-line pt-1.5">
        <span className={buyAhead ? "text-buy-text" : "text-rent-text"}>
          {buyAhead ? "Buying" : "Renting"} wealthier by{" "}
        </span>
        <span className="tnum font-bold text-ink">{usd(Math.abs(gap))}</span>
      </div>
    </TooltipCard>
  );
}

/**
 * Net worth over time: home equity if you buy versus the invest-the-difference portfolio if
 * you rent, plotted as two lines that cross in the exact breakeven year (by construction).
 * This answers "how rich am I if I leave in year N" that the cost charts only imply, off the
 * engine's net-worth array (which spans the full horizon, not just the stay). Plain lines, not
 * filled areas, so the crossing, the whole point, stays sharp.
 */
export const NetWorthChart = memo(function NetWorthChart({
  data,
  breakevenYear,
  yearsToStay,
}: {
  data: NetWorthPoint[];
  breakevenYear: number | null;
  yearsToStay: number;
}) {
  const rows = data;
  const cross = breakevenYear != null ? rows.find((r) => r.year === breakevenYear) : undefined;
  const stay = rows.find((r) => r.year === Math.round(yearsToStay));

  const vals = rows.flatMap((r) => [r.buyerNetWorth, r.renterNetWorth]);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  // Hug the data (don't force a zero floor) so the crossover isn't flattened against a huge
  // axis. Net worth can dip negative in the first year or two (selling costs eat thin equity),
  // so the domain follows the data down and a faint zero rule marks "underwater" when present.
  const pad = Math.max(dataMax - dataMin, 1) * 0.08;
  const domainMin = dataMin - pad;
  const domainMax = dataMax + pad;
  const showZero = domainMin < 0;

  const stayGap = stay ? stay.buyerNetWorth - stay.renterNetWorth : 0;

  const ariaLabel =
    breakevenYear != null
      ? `Net worth over ${rows.length} years if you sell and move out each year: home equity if you buy versus the invested-difference portfolio if you rent. The two cross at year ${breakevenYear}, after which buying leaves you wealthier.`
      : `Net worth over ${rows.length} years if you sell and move out each year: home equity if you buy versus the invested-difference portfolio if you rent. Renting stays ahead the whole time at this rent.`;

  return (
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
          tickFormatter={(v) => (v === 0 ? "$0" : usdCompact(v))}
        />
        <Tooltip
          trigger={TOOLTIP_TRIGGER}
          cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }}
          content={<NetWorthTooltip />}
        />
        {/* Zero rule only when the data actually goes underwater, so it isn't dead chrome. */}
        {showZero && <ReferenceLine y={0} stroke="var(--color-line)" strokeWidth={1.5} />}
        {/* Renting is dashed so the two series differ by pattern, not just hue (matches the cost chart). */}
        <Line
          type="monotone"
          dataKey="renterNetWorth"
          name="renterNetWorth"
          stroke="var(--color-rent)"
          strokeWidth={2.5}
          strokeDasharray="6 4"
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="buyerNetWorth"
          name="buyerNetWorth"
          stroke="var(--color-buy)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
        {/* Breakeven: full-height guide plus a labeled dot riding the buyer line at the crossing. */}
        {breakevenYear != null && (
          <ReferenceLine x={breakevenYear} stroke="var(--color-muted)" strokeDasharray="4 4" />
        )}
        {cross && (
          // Sit the marker between the two lines at the breakeven year rather than on the buyer
          // line. The lines cross at a fractional year, so the buyer value at the integer year is
          // already a touch above the renter's; the midpoint reads as "they meet around here".
          <ReferenceDot
            x={cross.year}
            y={(cross.buyerNetWorth + cross.renterNetWorth) / 2}
            r={5}
            fill="var(--color-ink)"
            stroke="var(--color-paper)"
            strokeWidth={2}
          >
            <Label
              value={`breakeven ${breakevenYear}y`}
              position={breakevenLabelPosition(breakevenYear!, rows.length)}
              fontSize={11}
              fill="var(--color-muted)"
            />
          </ReferenceDot>
        )}
        {/* The user's chosen horizon, ringed in paper, annotated with the wealth gap there. */}
        {stay && (
          <ReferenceDot
            x={stay.year}
            y={stay.buyerNetWorth}
            r={4.5}
            fill={stayGap >= 0 ? "var(--color-buy)" : "var(--color-rent)"}
            stroke="var(--color-paper)"
            strokeWidth={2}
          >
            <Label
              value={`your stay · ${usdCompact(Math.abs(stayGap))} ${stayGap >= 0 ? "ahead" : "behind"}`}
              position={stayGap >= 0 ? "top" : "bottom"}
              fontSize={11}
              fill="var(--color-muted)"
            />
          </ReferenceDot>
        )}
      </LineChart>
    </ChartFrame>
  );
});
