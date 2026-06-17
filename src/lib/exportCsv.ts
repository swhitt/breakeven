import { grossOwningCost, netOwningCost, sumCosts, type CalcResult } from "../engine/calculator";
import type { AppInputs } from "../engine/defaults";
import { saltCapForYear, TAX_YEAR } from "../engine/taxConstants";
import { pct, usd } from "./format";

// Builds the full, auditable year-by-year dataset as CSV: a quoted key/value metadata block
// (scenario inputs + provenance, so the file is self-documenting and reopens cleanly in Excel/
// Sheets/pandas), a blank separator, then a 28-column superset of every per-year field plus
// derived cumulatives and the present-value crossover, then a labelled TOTALS row. Pure so it
// can be unit-tested; the DOM download lives in triggerCsvDownload below.

export interface CsvContext {
  inputs: AppInputs;
  result: CalcResult;
  placeLabel: string; // "Houston, TX" or "ZIP 77079 (Houston, TX)"
  placeId: string; // slug for the filename: "houston-tx" or "77079"
  dataAsOf: string;
  generatedDate: string; // YYYY-MM-DD; the caller stamps it (keeps this function pure)
}

// "-" not the unicode minus, and no other non-ASCII, so a BOM-less reader can't mangle it.
const HEADERS = [
  "Year",
  "Mortgage P&I ($)",
  "Interest Paid ($)",
  "Principal Paid ($)",
  "Property Tax ($)",
  "Maintenance ($)",
  "Insurance ($)",
  "PMI ($)",
  "HOA / Other ($)",
  "Recurring Costs ($)",
  "Gross Owning Cost ($)",
  "Deductible Interest ($)",
  "SALT Used ($)",
  "Tax Benefit ($)",
  "Net Owning Cost ($)",
  "Home Value ($)",
  "Loan Balance ($)",
  "Equity ($)",
  "Rent Paid ($)",
  "Cum. Interest ($)",
  "Cum. Principal ($)",
  "Cum. Recurring Costs ($)",
  "Cum. Tax Benefit ($)",
  "Cum. Net Owning Cost (nominal $)",
  "Cum. Rent Paid (nominal $)",
  "Buy Net Cost (PV todays $)",
  "Rent Net Cost (PV todays $)",
  "Buy - Rent (PV todays $)",
  "Buyer Net Worth ($)",
  "Renter Net Worth ($)",
  "Net Worth Buy - Rent ($)",
];

// RFC 4180 quote: wrap and double internal quotes. Used for the metadata block (free text +
// commas); the numeric data grid stays bare so it parses as numbers.
const q = (v: string | number): string => `"${String(v).replace(/"/g, '""')}"`;
const n2 = (x: number): string => (Number.isFinite(x) ? (Math.round(x * 100) / 100).toFixed(2) : "");

export function buildBreakdownCsv(ctx: CsvContext): string {
  const { inputs, result, placeLabel, dataAsOf, generatedDate } = ctx;
  const down = inputs.homePrice * inputs.downPaymentPct;
  const breakevenYear = result.breakevenYear == null ? "never" : String(result.breakevenYear);

  const meta: [string, string][] = [
    ["breakEven - Rent vs Buy", ""],
    ["Generated", generatedDate],
    ["Data as of", dataAsOf],
    ["Source", "https://breakeven.rent"],
    ["", ""],
    ["Location", placeLabel],
    ["Home price", usd(inputs.homePrice)],
    ["Down payment", `${pct(inputs.downPaymentPct, 0)} (${usd(down)})`],
    ["Loan amount", usd(result.loanAmount)],
    ["Mortgage rate", pct(inputs.mortgageRate, 2)],
    ["Mortgage term", `${inputs.mortgageTermYears} yr`],
    ["Buying closing costs", pct(inputs.buyingClosingPct, 1)],
    ["Selling costs", pct(inputs.sellingCostPct, 1)],
    ["Home appreciation", pct(inputs.homeAppreciation, 1)],
    ["Rent growth", pct(inputs.rentGrowth, 1)],
    ["Inflation", pct(inputs.inflation, 1)],
    ["Investment return / discount rate", pct(inputs.investmentReturn, 1)],
    ["PMI rate", pct(inputs.pmiRate, 2)],
    ["Tax state", inputs.taxState || "US"],
    ["Filing status", inputs.filingJointly ? "Married/joint" : "Single"],
    ["Marginal tax rate", pct(inputs.marginalTaxRate, 1)],
    ["Standard deduction", usd(inputs.standardDeduction)],
    // The cap the engine actually applies in the first year; it steps down per saltCapForYear
    // over the horizon, so this is the entry-year value, not a fixed figure.
    ["SALT cap (entry year)", usd(saltCapForYear(TAX_YEAR))],
    ["Monthly rent", `${usd(inputs.monthlyRent)}/mo`],
    ["Renters insurance", `${usd(inputs.rentersInsuranceMonthly)}/mo`],
    ["Years you stay", `${inputs.yearsToStay}`],
    ["Verdict", result.verdict === "rent" ? "Renting wins" : "Buying wins"],
    ["Breakeven rent", `${usd(result.breakevenRent)}/mo`],
    ["Breakeven year", breakevenYear],
    ["Buy net cost at horizon (PV)", usd(result.buyNetCost)],
    ["Rent net cost at horizon (PV)", usd(result.rentNetCost)],
    ["", ""],
    [
      "Note",
      "PV columns are discounted to todays dollars at the investment-return rate and include the upfront outlay and the modeled sale at the horizon; nominal columns are undiscounted current-year cash. All dollar columns are positive magnitudes except Buy - Rent (PV), where <= 0 means buying has overtaken renting. Equity is gross (home value - loan balance), before selling costs.",
    ],
    ["", ""],
  ];

  const lines: string[] = meta.map(([k, v]) => `${q(k)},${q(v)}`);
  lines.push(HEADERS.join(","));

  const pvByYear = new Map(result.horizon.map((h) => [h.year, h]));
  let cumInt = 0;
  let cumPrin = 0;
  let cumRec = 0;
  let cumTax = 0;
  let cumNet = 0;
  let cumRent = 0;
  // Running sums for the flow columns, reused as the TOTALS row.
  const tot = { mort: 0, int: 0, prin: 0, pt: 0, maint: 0, ins: 0, pmi: 0, hoa: 0, rec: 0, gross: 0, tax: 0, net: 0, rent: 0 };

  for (const y of result.years) {
    const rec = sumCosts(y);
    const gross = grossOwningCost(y);
    const net = netOwningCost(y);
    cumInt += y.interestPaid;
    cumPrin += y.principalPaid;
    cumRec += rec;
    cumTax += y.taxBenefit;
    cumNet += net;
    cumRent += y.rentPaid;
    tot.mort += y.mortgagePaid;
    tot.int += y.interestPaid;
    tot.prin += y.principalPaid;
    tot.pt += y.costs.propertyTax;
    tot.maint += y.costs.maintenance;
    tot.ins += y.costs.insurance;
    tot.pmi += y.costs.pmi;
    tot.hoa += y.costs.hoa;
    tot.rec += rec;
    tot.gross += gross;
    tot.tax += y.taxBenefit;
    tot.net += net;
    tot.rent += y.rentPaid;
    const pv = pvByYear.get(y.year);
    const buyPV = pv ? pv.buyNetCost : NaN;
    const rentPV = pv ? pv.rentNetCost : NaN;

    lines.push(
      [
        String(y.year),
        n2(y.mortgagePaid),
        n2(y.interestPaid),
        n2(y.principalPaid),
        n2(y.costs.propertyTax),
        n2(y.costs.maintenance),
        n2(y.costs.insurance),
        n2(y.costs.pmi),
        n2(y.costs.hoa),
        n2(rec),
        n2(gross),
        n2(y.deductibleInterest),
        n2(y.saltUsed),
        n2(y.taxBenefit),
        n2(net),
        n2(y.homeValue),
        n2(y.loanBalance),
        n2(y.equity),
        n2(y.rentPaid),
        n2(cumInt),
        n2(cumPrin),
        n2(cumRec),
        n2(cumTax),
        n2(cumNet),
        n2(cumRent),
        n2(buyPV),
        n2(rentPV),
        n2(buyPV - rentPV),
        n2(y.buyerNetWorth),
        n2(y.renterNetWorth),
        n2(y.buyerNetWorth - y.renterNetWorth),
      ].join(","),
    );
  }

  // TOTALS: sum the flow columns, leave point-in-time stocks blank, and carry the PV pair at
  // the horizon (PV series are already cumulative, so summing them would double-count).
  lines.push(
    [
      q("TOTALS"),
      n2(tot.mort),
      n2(tot.int),
      n2(tot.prin),
      n2(tot.pt),
      n2(tot.maint),
      n2(tot.ins),
      n2(tot.pmi),
      n2(tot.hoa),
      n2(tot.rec),
      n2(tot.gross),
      "",
      "",
      n2(tot.tax),
      n2(tot.net),
      "",
      "",
      "",
      n2(tot.rent),
      n2(cumInt),
      n2(cumPrin),
      n2(cumRec),
      n2(cumTax),
      n2(cumNet),
      n2(cumRent),
      n2(result.buyNetCost),
      n2(result.rentNetCost),
      n2(result.buyNetCost - result.rentNetCost),
      "",
      "",
      "",
    ].join(","),
  );

  // UTF-8 BOM (Excel) + CRLF (RFC 4180).
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvFilename(placeId: string, generatedDate: string): string {
  const slug = placeId.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "custom";
  return `breakeven_${slug}_${generatedDate}.csv`;
}

/** Trigger a client-side download of the CSV (the only impure part). */
export function triggerCsvDownload(ctx: CsvContext): void {
  const blob = new Blob([buildBreakdownCsv(ctx)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFilename(ctx.placeId, ctx.generatedDate);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
