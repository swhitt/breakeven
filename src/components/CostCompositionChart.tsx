import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { YearRow } from "../engine/calculator";
import { usd, usdCompact } from "../lib/format";
import { niceTicks } from "../lib/ticks";

// Owning's annual cash goes into these buckets. Interest dominates early and fades
// as principal (which builds equity, not a sunk cost) grows: the headline story.
// PMI/HOA are dropped when no year has them, like the breakdown table.
// This chart is entirely the BUYING side, so orange (= buy) reading as interest is
// fine. But teal (= rent in the other charts) must NOT appear here, so principal uses
// emerald, distinct from both the rent teal and the credit's cyan.
const BUCKETS = [
  { key: "interestPaid", label: "Interest", color: "#ea580c" },
  { key: "propertyTax", label: "Property tax", color: "#eab308" },
  { key: "insurance", label: "Insurance", color: "#3b82f6" },
  { key: "maintenance", label: "Maintenance", color: "#8b5cf6" },
  { key: "pmi", label: "PMI", color: "#ef4444" },
  { key: "hoa", label: "HOA / other", color: "#ec4899" },
  { key: "principalPaid", label: "Principal (equity)", color: "#10b981" },
] as const;

const EQUITY_COLOR = "#10b981";
const CREDIT_COLOR = "#0891b2";

type Bucket = (typeof BUCKETS)[number];

interface CompRow {
  year: number;
  taxCredit: number; // negative tax benefit, so it stacks below zero
  raw: YearRow;
  [k: string]: number | YearRow;
}

function CompositionTooltip({
  active,
  payload,
  buckets,
  showCredit,
}: {
  active?: boolean;
  payload?: { payload: CompRow }[];
  buckets: Bucket[];
  showCredit: boolean;
}) {
  if (!active || !payload?.length) return null;
  const y = payload[0].payload.raw;
  const cashOut = y.mortgagePaid + y.propertyTax + y.maintenance + y.insurance + y.pmi + y.hoa;
  const netCash = cashOut - y.taxBenefit;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-lg">
      <div className="mb-1 text-muted">Year {y.year}</div>
      {buckets.map((b) => {
        const v = y[b.key] as number;
        if (v <= 0) return null;
        return (
          <div key={b.key} className="flex items-baseline justify-between gap-6">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: b.color }} />
              {b.label}
            </span>
            <span className="tnum font-semibold text-ink">{usd(v)}</span>
          </div>
        );
      })}
      {showCredit && y.taxBenefit > 0 && (
        <div className="flex items-baseline justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: CREDIT_COLOR }} />
            Tax benefit
          </span>
          <span className="tnum font-semibold" style={{ color: CREDIT_COLOR }}>
            -{usd(y.taxBenefit)}
          </span>
        </div>
      )}
      <div className="mt-1.5 flex items-baseline justify-between gap-6 border-t border-line pt-1.5">
        <span className="text-muted">Out of pocket</span>
        <span className="tnum font-bold text-ink">{usd(netCash)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-muted">Builds equity</span>
        <span className="tnum font-semibold" style={{ color: EQUITY_COLOR }}>
          {usd(y.principalPaid)}
        </span>
      </div>
    </div>
  );
}

/**
 * Stacked composition of each year's owning payment. Costs stack up from zero;
 * principal (equity) sits on top to separate "money gone" from "money saved";
 * the tax benefit hangs below zero as a credit you net back.
 */
export function CostCompositionChart({ years }: { years: YearRow[] }) {
  // Keep only buckets that ever carry a value, so PMI/HOA vanish when irrelevant.
  const buckets = BUCKETS.filter((b) => years.some((y) => (y[b.key] as number) > 0));
  const showCredit = years.some((y) => y.taxBenefit > 0);

  const rows: CompRow[] = years.map((y) => {
    const row: CompRow = { year: y.year, taxCredit: -y.taxBenefit, raw: y };
    for (const b of buckets) row[b.key] = y[b.key] as number;
    return row;
  });

  // One x-tick per year up to ~12, then thin them so labels never crowd.
  const stride = Math.ceil(years.length / 12);
  const ticks = years.filter((_, i) => i % stride === 0).map((y) => y.year);

  // Clean, zero-anchored y-ticks across the tallest bar (and the credit dip below 0).
  const maxTotal = Math.max(...rows.map((r) => buckets.reduce((s, b) => s + (r[b.key] as number), 0)), 0);
  const minTotal = showCredit ? Math.min(...rows.map((r) => r.taxCredit), 0) : 0;
  const yTicks = niceTicks(minTotal, maxTotal);

  const legendItems = [
    ...buckets.map((b) => ({ label: b.label, color: b.color })),
    ...(showCredit ? [{ label: "Tax benefit", color: CREDIT_COLOR }] : []),
  ];

  return (
    <>
      <div
        className="h-72 w-full sm:h-80"
        role="img"
        aria-label={`Where each year's home payment goes, broken into ${buckets.map((b) => b.label).join(", ")}${showCredit ? ", less the federal tax benefit" : ""}, over ${years.length} years. Interest is largest early and shrinks as principal grows.`}
      >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
          barCategoryGap="18%"
          stackOffset="sign"
          accessibilityLayer
        >
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="year"
            ticks={ticks}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            tickFormatter={(y) => `${y}y`}
          />
          <YAxis
            domain={[minTotal, maxTotal]}
            ticks={yTicks}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
            tickFormatter={(v) => (v === 0 ? "$0" : usdCompact(v))}
          />
          <Tooltip
            cursor={{ fill: "var(--color-ink)", fillOpacity: 0.04 }}
            content={<CompositionTooltip buckets={buckets} showCredit={showCredit} />}
          />
          {showCredit && <ReferenceLine y={0} stroke="var(--color-muted)" strokeWidth={1} />}
          {buckets.map((b, i) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              stackId="c"
              fill={b.color}
              isAnimationActive={false}
              radius={i === buckets.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
          {showCredit && (
            <Bar dataKey="taxCredit" stackId="c" fill={CREDIT_COLOR} isAnimationActive={false} radius={[0, 0, 3, 3]} />
          )}
        </BarChart>
      </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {legendItems.map((it) => (
          <span key={it.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
            {it.label}
          </span>
        ))}
      </div>
    </>
  );
}
