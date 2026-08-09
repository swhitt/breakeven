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
import {
  CAPITAL_GAINS_EXCLUSION,
  MORTGAGE_INTEREST_DEBT_CAP,
  saltCapForYear,
  TAX_YEAR,
} from "../engine/taxConstants";
import { pct, usd } from "../lib/format";
import { triggerCsvDownload } from "../lib/exportCsv";
import { InfoTip } from "../ui";

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
      <dt className="flex items-center text-xs text-muted">
        {label}
        {hint && <InfoTip text={hint} />}
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

/**
 * What the engine quietly nets out of the buyer's sale proceeds, in words, for a sale at the
 * end of `holdYears`. Mirrors buyerNetWorthAt's basis (price + buying closing, value less
 * selling costs) so the copy can't promise a shield the engine didn't apply. Worth saying out
 * loud because `capitalGainsRate` is a flat assumption (15%) with no control anywhere in the UI:
 * a gain past the IRC 121 exclusion silently shrinks every "after selling" figure below.
 * Returns null when the sale is clear of it, which is the common case.
 */
function capitalGainsNote(inputs: AppInputs, homeValue: number, holdYears: number): string | null {
  const gain = homeValue * (1 - inputs.sellingCostPct) - inputs.homePrice * (1 + inputs.buyingClosingPct);
  if (gain <= 0) return null;
  const rate = pct(inputs.capitalGainsRate, 0);
  // IRC 121 needs 2 of the last 5 years of ownership and use, so a sale inside two years gets
  // no exclusion at all: the harsher case, and the one nobody expects.
  if (holdYears < 2)
    return `Selling inside two years forfeits the IRC 121 exclusion, so the whole ${usd(gain)} gain is taxed here, at an assumed ${rate}.`;
  const exclusion = inputs.filingJointly ? CAPITAL_GAINS_EXCLUSION.joint : CAPITAL_GAINS_EXCLUSION.single;
  if (gain <= exclusion) return null;
  return `Projected gain at sale is ${usd(gain)}, past the ${usd(exclusion)} IRC 121 exclusion for ${
    inputs.filingJointly ? "joint" : "single"
  } filers. The ${usd(gain - exclusion)} above it is taxed at an assumed ${rate}, which is already netted out above.`;
}

// The full audit trail for one year, grouped so each cluster reconciles to a visible column.
function Detail({ y, pv, inputs }: { y: YearRow; pv?: HorizonPoint; inputs: AppInputs }) {
  const buyCosts = RECURRING_COSTS.filter((c) => c.side === "buy" && y.costs[c.key] > 0);
  // The engine caps SALT at THIS row's calendar year (the OBBBA schedule steps up 1%/yr through
  // 2029, then reverts to $10,000 in 2030), so the hint has to quote the same year's cap:
  // quoting the entry-year constant on every row claims a cap the engine never applied there.
  const calendarYear = TAX_YEAR + y.year - 1;
  const saltCap = saltCapForYear(calendarYear);
  // Call out the year the cap actually falls, on that row only: it's the reason the tax benefit
  // steps down there, and unexplained it reads as a bug in the table.
  const capDrops = saltCap < saltCapForYear(calendarYear - 1);
  // ...but only blame the benefit on it when the cap is what's binding; under it, the drop
  // changes nothing for this buyer. saltUsed is min(base, cap), so equality means clipped.
  const capBinds = y.saltUsed >= saltCap - 0.5;
  const capGains = capitalGainsNote(inputs, y.homeValue, y.year);
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
          hint={`Mortgage interest still deductible after the ${usd(MORTGAGE_INTEREST_DEBT_CAP)} acquisition-debt cap (rises toward 100% as the loan amortizes).`}
        />
        <Line
          label="SALT used"
          value={y.saltUsed}
          hint={`Property tax + other state/local tax counted, after this year's SALT cap (${usd(saltCap)} in ${calendarYear}).`}
        />
        {capDrops && (
          <div className="pl-3 text-[11px] leading-snug text-muted">
            The SALT cap falls to {usd(saltCap)} in {calendarYear} under current law
            {capBinds ? ", which is why the tax benefit drops this year" : ""}.
          </div>
        )}
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
        {/* The cap-gains haircut is inside this number and nowhere else in the row, so it gets a
            visible note rather than an infotip: an unexplained shortfall against Equity above
            reads as an arithmetic error. */}
        {capGains && <div className="pl-3 text-[11px] leading-snug text-muted">{capGains}</div>}
        {/* Not "invested difference": this is the savings the renter kept, compounded, plus every
            month of owning-minus-rent, so it turns negative once rent outgrows owning. */}
        <Line label="Renter (savings, net of rent)" value={y.renterNetWorth} good />
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
  // The headline sale figure is already net of capital-gains tax, so the exclusion overflow has
  // to be stated here too, not only on the year row somebody may never expand.
  const capGainsAtHorizon = last ? capitalGainsNote(inputs, last.homeValue, last.year) : null;

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
          Cumulative columns are in today's dollars. The <span className="font-medium text-ink">Buy &minus; rent</span>{" "}
          column is owning minus renting, so it stays positive while renting is still cheaper and turns negative the year
          buying pulls ahead. Tap any year for the full line-by-line math.{" "}
          <span className="md:hidden">Scroll the table sideways to see every column.</span>
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
              cash-flow difference, compounded at your investment return. It goes negative if rent outgrows the cost of
              owning: by then the savings are spent and the balance is cumulative cash drained.
            </span>
          </p>
          {capGainsAtHorizon && <p className="mt-2 text-xs text-muted">{capGainsAtHorizon}</p>}
        </div>
      )}

      <div className="relative">
        <div className="overflow-x-auto">
          <table className="tnum w-full min-w-[680px] border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pl-3 pr-3 text-left font-semibold">Year</th>
              <th className="px-3 py-2 font-semibold">
                <span className="inline-flex items-center">
                  Cost to own
                  <InfoTip text="Mortgage + property tax + maintenance + insurance + PMI/HOA, less the tax benefit." />
                </span>
              </th>
              <th className="px-3 py-2 font-semibold">Rent</th>
              <th className="px-3 py-2 font-semibold">
                <span className="inline-flex items-center">
                  Own so far
                  <InfoTip text="Cumulative cost of owning so far, in today's dollars." />
                </span>
              </th>
              <th className="px-3 py-2 font-semibold">
                <span className="inline-flex items-center">
                  Rent so far
                  <InfoTip text="Cumulative cost of renting so far, in today's dollars." />
                </span>
              </th>
              <th className="px-3 py-2 font-semibold">
                <span className="inline-flex items-center">
                  Buy &minus; rent
                  <InfoTip text="Owning minus renting, cumulative in today's dollars. When it crosses below zero, buying has overtaken renting." />
                </span>
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
                    <td className="py-2 pl-3 pr-3 text-left font-semibold">
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
                        className="-my-1 inline-flex items-center justify-center p-1.5 text-muted transition-colors hover:text-ink"
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
                          <Detail y={y} pv={pv} inputs={inputs} />
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
              <td className="py-2 pl-3 pr-3 text-left text-muted">Total</td>
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
        {/* On phones the table is wider than the screen; a right-edge fade signals there's more
            to scroll to, so half-cut numbers at the edge don't read as a rendering bug. Hidden
            once the table fits the column (md+). Also hidden while any year is expanded: the
            pinned detail isn't horizontally scrollable, so the fade would just wash out its
            right-column figures instead of hinting at off-screen content. */}
        {open.size === 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface to-transparent md:hidden"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
