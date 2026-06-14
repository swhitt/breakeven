import { Fragment, useState, type ReactNode } from "react";
import {
  grossOwningCost,
  netOwningCost,
  RECURRING_COSTS,
  type CalcResult,
  type HorizonPoint,
  type YearRow,
} from "../engine/calculator";
import type { AppInputs } from "../engine/defaults";
import { usd } from "../lib/format";
import { triggerCsvDownload } from "../lib/exportCsv";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={"inline h-4 w-4 transition-transform " + (open ? "rotate-180" : "")}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// One labelled figure in the expander. `sub` indents it as a child of the line above;
// `good` tints it as wealth/credit; `strong` is the cluster's reconciling total.
function Line({
  label,
  value,
  sub,
  good,
  strong,
  signed,
  hint,
}: {
  label: string;
  value: number;
  sub?: boolean;
  good?: boolean;
  strong?: boolean;
  signed?: boolean;
  hint?: string;
}) {
  const text = signed ? (value <= 0 ? "text-buy-text" : "text-rent-text") : good ? "text-rent-text" : "text-ink";
  return (
    <div className={"flex items-baseline justify-between gap-3 " + (sub ? "pl-3" : "")}>
      <dt className={"text-xs " + (hint ? "cursor-help text-muted underline decoration-dotted" : "text-muted")} title={hint}>
        {label}
      </dt>
      <dd className={"tnum text-sm " + (strong ? "font-bold " : "font-medium ") + text}>
        {good && value > 0 ? `+${usd(value)}` : usd(value)}
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</div>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

// The full audit trail for one year, grouped so each cluster reconciles to a visible column.
function Detail({ y, pv }: { y: YearRow; pv?: HorizonPoint }) {
  const buyCosts = RECURRING_COSTS.filter((c) => c.side === "buy" && y.costs[c.key] > 0);
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      <Group title="Payment this year">
        <Line label="Mortgage P&I" value={y.mortgagePaid} />
        <Line label="Interest" value={y.interestPaid} sub />
        <Line label="Principal (builds equity)" value={y.principalPaid} sub good />
        {buyCosts.map((c) => (
          <Line key={c.key} label={c.label} value={y.costs[c.key]} />
        ))}
        <Line
          label="Tax benefit"
          value={y.taxBenefit}
          good
          hint="Federal tax saved by itemizing (mortgage interest + SALT) vs. the standard deduction."
        />
        <Line label="Net cost to own" value={netOwningCost(y)} strong />
      </Group>

      <Group title="Tax detail">
        <Line
          label="Deductible interest"
          value={y.deductibleInterest}
          hint="Mortgage interest still deductible after the $750k acquisition-debt cap (rises toward 100% as the loan amortizes)."
        />
        <Line label="SALT used" value={y.saltUsed} hint="Property tax + other state/local tax counted, after the $10k SALT cap." />
        <Line label="Gross cost (pre-tax-benefit)" value={grossOwningCost(y)} />
      </Group>

      <Group title="Position (end of year)">
        <Line label="Home value" value={y.homeValue} />
        <Line label="Loan balance" value={y.loanBalance} />
        <Line label="Equity (before selling costs)" value={y.equity} good strong />
      </Group>

      <Group title="Cumulative (today's dollars)">
        {pv && (
          <>
            <Line label="Cost to own so far" value={pv.buyNetCost} />
            <Line label="Cost to rent so far" value={pv.rentNetCost} />
            <Line label="Buy minus rent" value={pv.buyNetCost - pv.rentNetCost} signed strong />
          </>
        )}
        <Line label="Rent paid this year" value={y.rentPaid} />
      </Group>

      <Group title="Net worth if you exit now">
        <Line label="Buyer (equity after selling)" value={y.buyerNetWorth} good />
        <Line label="Renter (invested difference)" value={y.renterNetWorth} good />
        <Line label="Buy minus rent" value={y.buyerNetWorth - y.renterNetWorth} signed strong />
      </Group>
    </div>
  );
}

export function Breakdown({
  result,
  inputs,
  placeLabel,
  placeId,
  dataAsOf,
}: {
  result: CalcResult;
  inputs: AppInputs;
  placeLabel: string;
  placeId: string;
  dataAsOf: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (year: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });

  const years = result.years;
  const pvByYear = new Map(result.horizon.map((h) => [h.year, h]));
  // Sums for the footer (flow columns only); the cumulative columns already carry running totals.
  const totalOwn = years.reduce((s, y) => s + netOwningCost(y), 0);
  const totalRent = years.reduce((s, y) => s + y.rentPaid, 0);
  const last = years[years.length - 1];
  const lastPv = last ? pvByYear.get(last.year) : undefined;
  const nwDiff = last ? last.buyerNetWorth - last.renterNetWorth : 0;

  function download() {
    triggerCsvDownload({
      inputs,
      result,
      placeLabel,
      placeId,
      dataAsOf,
      generatedDate: new Date().toISOString().slice(0, 10),
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Cumulative columns are in today's dollars. Tap any year for the full line-by-line math.
        </p>
        <button
          type="button"
          onClick={download}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-ink"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Download CSV
        </button>
      </div>

      {last && (
        <div className="mb-4 rounded-xl border border-line bg-paper px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted">
            Net worth after {last.year} {last.year === 1 ? "year" : "years"}, if you sell and move out
          </div>
          <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted">Buying (home equity, after selling)</span>
              <span className="tnum font-bold text-ink">{usd(last.buyerNetWorth)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted">Renting + investing the difference</span>
              <span className="tnum font-bold text-ink">{usd(last.renterNetWorth)}</span>
            </div>
          </div>
          <p className={"mt-2 text-sm font-medium " + (nwDiff >= 0 ? "text-buy-text" : "text-rent-text")}>
            {nwDiff >= 0
              ? `Buying leaves you about ${usd(nwDiff)} wealthier.`
              : `Renting and investing the difference leaves you about ${usd(-nwDiff)} wealthier.`}{" "}
            <span className="font-normal text-muted">
              The renter's portfolio is the down payment plus closing the buyer sank into the home, plus each year's
              cash-flow difference, compounded at your investment return.
            </span>
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="tnum w-full min-w-[680px] border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 text-left font-semibold">Year</th>
              <th
                className="cursor-help px-3 py-2 font-semibold"
                title="Mortgage + property tax + maintenance + insurance + PMI/HOA, less the tax benefit."
              >
                Cost to own
              </th>
              <th className="px-3 py-2 font-semibold">Rent</th>
              <th className="cursor-help px-3 py-2 font-semibold" title="Cumulative cost of owning so far, in today's dollars.">
                Own so far
              </th>
              <th className="cursor-help px-3 py-2 font-semibold" title="Cumulative cost of renting so far, in today's dollars.">
                Rent so far
              </th>
              <th
                className="cursor-help px-3 py-2 font-semibold"
                title="Owning minus renting, cumulative in today's dollars. When it crosses below zero, buying has overtaken renting."
              >
                Buy &minus; rent
              </th>
              <th className="px-3 py-2 font-semibold">Equity</th>
              <th className="w-7" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const isOpen = open.has(y.year);
              const pv = pvByYear.get(y.year);
              const delta = pv ? pv.buyNetCost - pv.rentNetCost : 0;
              const isBreakeven = result.breakevenYear === y.year;
              return (
                <Fragment key={y.year}>
                  <tr
                    onClick={() => toggle(y.year)}
                    className={
                      "group cursor-pointer border-b border-line/60 hover:bg-paper " +
                      (isBreakeven ? "border-l-2 border-l-buy bg-buy-soft/30" : "")
                    }
                  >
                    <td className="py-2 pr-3 text-left font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        {y.year}
                        {isBreakeven && (
                          <span className="rounded bg-buy/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-buy-text">
                            breakeven
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink">{usd(netOwningCost(y))}</td>
                    <td className="px-3 py-2 text-muted">{usd(y.rentPaid)}</td>
                    <td className="px-3 py-2 text-muted">{pv ? usd(pv.buyNetCost) : "-"}</td>
                    <td className="px-3 py-2 text-muted">{pv ? usd(pv.rentNetCost) : "-"}</td>
                    <td className={"px-3 py-2 font-medium " + (delta <= 0 ? "text-buy-text" : "text-rent-text")}>
                      {pv ? usd(delta) : "-"}
                    </td>
                    <td className="px-3 py-2 text-rent-text">{usd(y.equity)}</td>
                    <td className="pr-1 text-right">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`Year ${y.year} breakdown`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(y.year);
                        }}
                        className="text-muted transition-colors hover:text-ink"
                      >
                        <Chevron open={isOpen} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line/60 bg-surface/60">
                      {/* The summary table scrolls horizontally on narrow screens (min-w-[680px]),
                          which otherwise drags the expanded detail and its labels off-screen,
                          leaving a column of unlabelled numbers. Pin the detail to the left of the
                          scroll viewport and clamp it to the visible width (viewport minus the
                          nested main + disclosure padding) so it stays fully readable without any
                          horizontal scrolling. Past md the table fits, so revert to a normal
                          full-width inline cell. */}
                      <td colSpan={8} className="p-0 text-left">
                        <div className="sticky left-0 w-[calc(100vw-66px)] px-3 py-3 sm:w-[calc(100vw-82px)] md:static md:w-full">
                          <Detail y={y} pv={pv} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line text-xs font-semibold uppercase tracking-wide">
              <td className="py-2 pr-3 text-left text-muted">Total</td>
              <td className="px-3 py-2 text-ink">{usd(totalOwn)}</td>
              <td className="px-3 py-2 text-ink">{usd(totalRent)}</td>
              <td className="px-3 py-2 text-muted">{lastPv ? usd(lastPv.buyNetCost) : "-"}</td>
              <td className="px-3 py-2 text-muted">{lastPv ? usd(lastPv.rentNetCost) : "-"}</td>
              <td
                className={
                  "px-3 py-2 " +
                  (lastPv && lastPv.buyNetCost - lastPv.rentNetCost <= 0 ? "text-buy-text" : "text-rent-text")
                }
              >
                {lastPv ? usd(lastPv.buyNetCost - lastPv.rentNetCost) : "-"}
              </td>
              <td className="px-3 py-2 text-rent-text">{last ? usd(last.equity) : "-"}</td>
              <td aria-hidden />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
