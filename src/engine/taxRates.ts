/**
 * US marginal income tax estimator: 2026 federal ordinary-income brackets plus a
 * per-state table (50 states + DC). Turns income + filing status + state into an
 * effective marginal rate for valuing the mortgage-interest and property-tax
 * (SALT) deductions, so a user who doesn't know their bracket can still see the
 * deduction's impact.
 *
 * Sources: IRS Rev. Proc. 2025-32 (federal); Tax Foundation 2026 state tables
 * cross-checked against each state Dept. of Revenue, including mid-2026
 * retroactive cuts (AR 3.7%, GA 4.99%, NC 3.99%, OH flat 2.75%, SC/WV/MT reforms)
 * and surtaxes baked into the brackets (CA 1% MHST over $1M, MA 4% over ~$1.1M).
 * Brackets are on TAXABLE income; the estimator approximates state taxable income
 * with the federal standard deduction (each state's own deductions vary, so this
 * is an estimate). City/county income taxes (NYC, Yonkers, OH/PA municipalities)
 * are NOT in the state number — enter those via the separate local-tax field.
 * Update each tax year alongside taxConstants.ts. Not tax advice.
 */
import { STANDARD_DEDUCTION } from "./taxConstants";

export interface Bracket {
  rate: number;
  upTo: number | null; // upper bound of taxable income for this rate; null = top
}

export interface StateTax {
  name: string;
  single: Bracket[];
  joint: Bracket[];
}

export const FEDERAL_BRACKETS: { single: Bracket[]; joint: Bracket[] } = {
  single: [{ rate: 0.1, upTo: 12400 }, { rate: 0.12, upTo: 50400 }, { rate: 0.22, upTo: 105700 }, { rate: 0.24, upTo: 201775 }, { rate: 0.32, upTo: 256225 }, { rate: 0.35, upTo: 640600 }, { rate: 0.37, upTo: null }],
  joint: [{ rate: 0.1, upTo: 24800 }, { rate: 0.12, upTo: 100800 }, { rate: 0.22, upTo: 211400 }, { rate: 0.24, upTo: 403550 }, { rate: 0.32, upTo: 512450 }, { rate: 0.35, upTo: 768700 }, { rate: 0.37, upTo: null }],
};

// 2-letter code -> schedule. No-income-tax states are a single 0% bracket.
// "US" (national) is intentionally absent: an unknown code => no state tax.
export const STATE_TAX: Record<string, StateTax> = {
  AK: { name: "Alaska", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  AL: { name: "Alabama", single: [{ rate: 0.02, upTo: 500 }, { rate: 0.04, upTo: 3000 }, { rate: 0.05, upTo: null }], joint: [{ rate: 0.02, upTo: 1000 }, { rate: 0.04, upTo: 6000 }, { rate: 0.05, upTo: null }] },
  AR: { name: "Arkansas", single: [{ rate: 0, upTo: 5599 }, { rate: 0.02, upTo: 11199 }, { rate: 0.03, upTo: 15999 }, { rate: 0.034, upTo: 26399 }, { rate: 0.037, upTo: null }], joint: [{ rate: 0, upTo: 5599 }, { rate: 0.02, upTo: 11199 }, { rate: 0.03, upTo: 15999 }, { rate: 0.034, upTo: 26399 }, { rate: 0.037, upTo: null }] },
  AZ: { name: "Arizona", single: [{ rate: 0.025, upTo: null }], joint: [{ rate: 0.025, upTo: null }] },
  CA: { name: "California", single: [{ rate: 0.01, upTo: 11079 }, { rate: 0.02, upTo: 26264 }, { rate: 0.04, upTo: 41452 }, { rate: 0.06, upTo: 57542 }, { rate: 0.08, upTo: 72724 }, { rate: 0.093, upTo: 371479 }, { rate: 0.103, upTo: 445771 }, { rate: 0.113, upTo: 742953 }, { rate: 0.123, upTo: 1000000 }, { rate: 0.133, upTo: null }], joint: [{ rate: 0.01, upTo: 22158 }, { rate: 0.02, upTo: 52528 }, { rate: 0.04, upTo: 82904 }, { rate: 0.06, upTo: 115084 }, { rate: 0.08, upTo: 145448 }, { rate: 0.093, upTo: 742958 }, { rate: 0.103, upTo: 891542 }, { rate: 0.113, upTo: 1000000 }, { rate: 0.123, upTo: 1485906 }, { rate: 0.133, upTo: null }] },
  CO: { name: "Colorado", single: [{ rate: 0.044, upTo: null }], joint: [{ rate: 0.044, upTo: null }] },
  CT: { name: "Connecticut", single: [{ rate: 0.02, upTo: 10000 }, { rate: 0.045, upTo: 50000 }, { rate: 0.055, upTo: 100000 }, { rate: 0.06, upTo: 200000 }, { rate: 0.065, upTo: 250000 }, { rate: 0.069, upTo: 500000 }, { rate: 0.0699, upTo: null }], joint: [{ rate: 0.02, upTo: 20000 }, { rate: 0.045, upTo: 100000 }, { rate: 0.055, upTo: 200000 }, { rate: 0.06, upTo: 400000 }, { rate: 0.065, upTo: 500000 }, { rate: 0.069, upTo: 1000000 }, { rate: 0.0699, upTo: null }] },
  DC: { name: "District of Columbia", single: [{ rate: 0.04, upTo: 10000 }, { rate: 0.06, upTo: 40000 }, { rate: 0.065, upTo: 60000 }, { rate: 0.085, upTo: 250000 }, { rate: 0.0925, upTo: 500000 }, { rate: 0.0975, upTo: 1000000 }, { rate: 0.1075, upTo: null }], joint: [{ rate: 0.04, upTo: 10000 }, { rate: 0.06, upTo: 40000 }, { rate: 0.065, upTo: 60000 }, { rate: 0.085, upTo: 250000 }, { rate: 0.0925, upTo: 500000 }, { rate: 0.0975, upTo: 1000000 }, { rate: 0.1075, upTo: null }] },
  DE: { name: "Delaware", single: [{ rate: 0, upTo: 2000 }, { rate: 0.022, upTo: 5000 }, { rate: 0.039, upTo: 10000 }, { rate: 0.048, upTo: 20000 }, { rate: 0.052, upTo: 25000 }, { rate: 0.0555, upTo: 60000 }, { rate: 0.066, upTo: null }], joint: [{ rate: 0, upTo: 2000 }, { rate: 0.022, upTo: 5000 }, { rate: 0.039, upTo: 10000 }, { rate: 0.048, upTo: 20000 }, { rate: 0.052, upTo: 25000 }, { rate: 0.0555, upTo: 60000 }, { rate: 0.066, upTo: null }] },
  FL: { name: "Florida", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  GA: { name: "Georgia", single: [{ rate: 0.0499, upTo: null }], joint: [{ rate: 0.0499, upTo: null }] },
  HI: { name: "Hawaii", single: [{ rate: 0.014, upTo: 9600 }, { rate: 0.032, upTo: 14400 }, { rate: 0.055, upTo: 19200 }, { rate: 0.064, upTo: 24000 }, { rate: 0.068, upTo: 36000 }, { rate: 0.072, upTo: 48000 }, { rate: 0.076, upTo: 125000 }, { rate: 0.079, upTo: 175000 }, { rate: 0.0825, upTo: 225000 }, { rate: 0.09, upTo: 275000 }, { rate: 0.1, upTo: 325000 }, { rate: 0.11, upTo: null }], joint: [{ rate: 0.014, upTo: 19200 }, { rate: 0.032, upTo: 28800 }, { rate: 0.055, upTo: 38400 }, { rate: 0.064, upTo: 48000 }, { rate: 0.068, upTo: 72000 }, { rate: 0.072, upTo: 96000 }, { rate: 0.076, upTo: 250000 }, { rate: 0.079, upTo: 350000 }, { rate: 0.0825, upTo: 450000 }, { rate: 0.09, upTo: 550000 }, { rate: 0.1, upTo: 650000 }, { rate: 0.11, upTo: null }] },
  IA: { name: "Iowa", single: [{ rate: 0.038, upTo: null }], joint: [{ rate: 0.038, upTo: null }] },
  ID: { name: "Idaho", single: [{ rate: 0.053, upTo: null }], joint: [{ rate: 0.053, upTo: null }] },
  IL: { name: "Illinois", single: [{ rate: 0.0495, upTo: null }], joint: [{ rate: 0.0495, upTo: null }] },
  IN: { name: "Indiana", single: [{ rate: 0.0295, upTo: null }], joint: [{ rate: 0.0295, upTo: null }] },
  KS: { name: "Kansas", single: [{ rate: 0.052, upTo: 23000 }, { rate: 0.0558, upTo: null }], joint: [{ rate: 0.052, upTo: 46000 }, { rate: 0.0558, upTo: null }] },
  KY: { name: "Kentucky", single: [{ rate: 0.035, upTo: null }], joint: [{ rate: 0.035, upTo: null }] },
  LA: { name: "Louisiana", single: [{ rate: 0.03, upTo: null }], joint: [{ rate: 0.03, upTo: null }] },
  MA: { name: "Massachusetts", single: [{ rate: 0.05, upTo: 1107750 }, { rate: 0.09, upTo: null }], joint: [{ rate: 0.05, upTo: 1107750 }, { rate: 0.09, upTo: null }] },
  MD: { name: "Maryland", single: [{ rate: 0.02, upTo: 1000 }, { rate: 0.03, upTo: 2000 }, { rate: 0.04, upTo: 3000 }, { rate: 0.0475, upTo: 100000 }, { rate: 0.05, upTo: 125000 }, { rate: 0.0525, upTo: 150000 }, { rate: 0.055, upTo: 250000 }, { rate: 0.0575, upTo: 500000 }, { rate: 0.0625, upTo: 1000000 }, { rate: 0.065, upTo: null }], joint: [{ rate: 0.02, upTo: 1000 }, { rate: 0.03, upTo: 2000 }, { rate: 0.04, upTo: 3000 }, { rate: 0.0475, upTo: 150000 }, { rate: 0.05, upTo: 175000 }, { rate: 0.0525, upTo: 225000 }, { rate: 0.055, upTo: 300000 }, { rate: 0.0575, upTo: 600000 }, { rate: 0.0625, upTo: 1200000 }, { rate: 0.065, upTo: null }] },
  ME: { name: "Maine", single: [{ rate: 0.058, upTo: 27400 }, { rate: 0.0675, upTo: 64850 }, { rate: 0.0715, upTo: 1000000 }, { rate: 0.0915, upTo: null }], joint: [{ rate: 0.058, upTo: 54850 }, { rate: 0.0675, upTo: 129750 }, { rate: 0.0715, upTo: 1500000 }, { rate: 0.0915, upTo: null }] },
  MI: { name: "Michigan", single: [{ rate: 0.0425, upTo: null }], joint: [{ rate: 0.0425, upTo: null }] },
  MN: { name: "Minnesota", single: [{ rate: 0.0535, upTo: 33310 }, { rate: 0.068, upTo: 109430 }, { rate: 0.0785, upTo: 203150 }, { rate: 0.0985, upTo: null }], joint: [{ rate: 0.0535, upTo: 48700 }, { rate: 0.068, upTo: 193480 }, { rate: 0.0785, upTo: 337930 }, { rate: 0.0985, upTo: null }] },
  MO: { name: "Missouri", single: [{ rate: 0, upTo: 1348 }, { rate: 0.02, upTo: 2696 }, { rate: 0.025, upTo: 4044 }, { rate: 0.03, upTo: 5392 }, { rate: 0.035, upTo: 6740 }, { rate: 0.04, upTo: 8088 }, { rate: 0.045, upTo: 9436 }, { rate: 0.047, upTo: null }], joint: [{ rate: 0, upTo: 1348 }, { rate: 0.02, upTo: 2696 }, { rate: 0.025, upTo: 4044 }, { rate: 0.03, upTo: 5392 }, { rate: 0.035, upTo: 6740 }, { rate: 0.04, upTo: 8088 }, { rate: 0.045, upTo: 9436 }, { rate: 0.047, upTo: null }] },
  MS: { name: "Mississippi", single: [{ rate: 0, upTo: 10000 }, { rate: 0.04, upTo: null }], joint: [{ rate: 0, upTo: 10000 }, { rate: 0.04, upTo: null }] },
  MT: { name: "Montana", single: [{ rate: 0.047, upTo: 47500 }, { rate: 0.0565, upTo: null }], joint: [{ rate: 0.047, upTo: 95000 }, { rate: 0.0565, upTo: null }] },
  NC: { name: "North Carolina", single: [{ rate: 0.0399, upTo: null }], joint: [{ rate: 0.0399, upTo: null }] },
  ND: { name: "North Dakota", single: [{ rate: 0, upTo: 48475 }, { rate: 0.0195, upTo: 244825 }, { rate: 0.025, upTo: null }], joint: [{ rate: 0, upTo: 80975 }, { rate: 0.0195, upTo: 298075 }, { rate: 0.025, upTo: null }] },
  NE: { name: "Nebraska", single: [{ rate: 0.0246, upTo: 4130 }, { rate: 0.0351, upTo: 24760 }, { rate: 0.0455, upTo: null }], joint: [{ rate: 0.0246, upTo: 8250 }, { rate: 0.0351, upTo: 49530 }, { rate: 0.0455, upTo: null }] },
  NH: { name: "New Hampshire", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  NJ: { name: "New Jersey", single: [{ rate: 0.014, upTo: 20000 }, { rate: 0.0175, upTo: 35000 }, { rate: 0.035, upTo: 40000 }, { rate: 0.0553, upTo: 75000 }, { rate: 0.0637, upTo: 500000 }, { rate: 0.0897, upTo: 1000000 }, { rate: 0.1075, upTo: null }], joint: [{ rate: 0.014, upTo: 20000 }, { rate: 0.0175, upTo: 50000 }, { rate: 0.0245, upTo: 70000 }, { rate: 0.035, upTo: 80000 }, { rate: 0.0553, upTo: 150000 }, { rate: 0.0637, upTo: 500000 }, { rate: 0.0897, upTo: 1000000 }, { rate: 0.1075, upTo: null }] },
  NM: { name: "New Mexico", single: [{ rate: 0.015, upTo: 5500 }, { rate: 0.032, upTo: 16500 }, { rate: 0.043, upTo: 33500 }, { rate: 0.047, upTo: 66500 }, { rate: 0.049, upTo: 210000 }, { rate: 0.059, upTo: null }], joint: [{ rate: 0.015, upTo: 8000 }, { rate: 0.032, upTo: 25000 }, { rate: 0.043, upTo: 50000 }, { rate: 0.047, upTo: 100000 }, { rate: 0.049, upTo: 315000 }, { rate: 0.059, upTo: null }] },
  NV: { name: "Nevada", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  NY: { name: "New York", single: [{ rate: 0.039, upTo: 8500 }, { rate: 0.044, upTo: 11700 }, { rate: 0.0515, upTo: 13900 }, { rate: 0.054, upTo: 80650 }, { rate: 0.059, upTo: 215400 }, { rate: 0.0685, upTo: 1077550 }, { rate: 0.0965, upTo: 5000000 }, { rate: 0.103, upTo: 25000000 }, { rate: 0.109, upTo: null }], joint: [{ rate: 0.039, upTo: 17150 }, { rate: 0.044, upTo: 23600 }, { rate: 0.0515, upTo: 27900 }, { rate: 0.054, upTo: 161550 }, { rate: 0.059, upTo: 323200 }, { rate: 0.0685, upTo: 2155350 }, { rate: 0.0965, upTo: 5000000 }, { rate: 0.103, upTo: 25000000 }, { rate: 0.109, upTo: null }] },
  OH: { name: "Ohio", single: [{ rate: 0, upTo: 26050 }, { rate: 0.0275, upTo: null }], joint: [{ rate: 0, upTo: 26050 }, { rate: 0.0275, upTo: null }] },
  OK: { name: "Oklahoma", single: [{ rate: 0, upTo: 3750 }, { rate: 0.025, upTo: 4900 }, { rate: 0.035, upTo: 7200 }, { rate: 0.045, upTo: null }], joint: [{ rate: 0, upTo: 7500 }, { rate: 0.025, upTo: 9800 }, { rate: 0.035, upTo: 14400 }, { rate: 0.045, upTo: null }] },
  OR: { name: "Oregon", single: [{ rate: 0.0475, upTo: 4050 }, { rate: 0.0675, upTo: 10200 }, { rate: 0.0875, upTo: 125000 }, { rate: 0.099, upTo: null }], joint: [{ rate: 0.0475, upTo: 8100 }, { rate: 0.0675, upTo: 20400 }, { rate: 0.0875, upTo: 250000 }, { rate: 0.099, upTo: null }] },
  PA: { name: "Pennsylvania", single: [{ rate: 0.0307, upTo: null }], joint: [{ rate: 0.0307, upTo: null }] },
  RI: { name: "Rhode Island", single: [{ rate: 0.0375, upTo: 82050 }, { rate: 0.0475, upTo: 186450 }, { rate: 0.0599, upTo: null }], joint: [{ rate: 0.0375, upTo: 82050 }, { rate: 0.0475, upTo: 186450 }, { rate: 0.0599, upTo: null }] },
  SC: { name: "South Carolina", single: [{ rate: 0.0199, upTo: 30000 }, { rate: 0.0521, upTo: null }], joint: [{ rate: 0.0199, upTo: 30000 }, { rate: 0.0521, upTo: null }] },
  SD: { name: "South Dakota", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  TN: { name: "Tennessee", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  TX: { name: "Texas", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  UT: { name: "Utah", single: [{ rate: 0.0445, upTo: null }], joint: [{ rate: 0.0445, upTo: null }] },
  VA: { name: "Virginia", single: [{ rate: 0.02, upTo: 3000 }, { rate: 0.03, upTo: 5000 }, { rate: 0.05, upTo: 17000 }, { rate: 0.0575, upTo: null }], joint: [{ rate: 0.02, upTo: 3000 }, { rate: 0.03, upTo: 5000 }, { rate: 0.05, upTo: 17000 }, { rate: 0.0575, upTo: null }] },
  VT: { name: "Vermont", single: [{ rate: 0.0335, upTo: 49400 }, { rate: 0.066, upTo: 119700 }, { rate: 0.076, upTo: 249700 }, { rate: 0.0875, upTo: null }], joint: [{ rate: 0.0335, upTo: 82500 }, { rate: 0.066, upTo: 199450 }, { rate: 0.076, upTo: 304000 }, { rate: 0.0875, upTo: null }] },
  WA: { name: "Washington", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
  WI: { name: "Wisconsin", single: [{ rate: 0.035, upTo: 15110 }, { rate: 0.044, upTo: 51950 }, { rate: 0.053, upTo: 332720 }, { rate: 0.0765, upTo: null }], joint: [{ rate: 0.035, upTo: 20150 }, { rate: 0.044, upTo: 69260 }, { rate: 0.053, upTo: 443630 }, { rate: 0.0765, upTo: null }] },
  WV: { name: "West Virginia", single: [{ rate: 0.0211, upTo: 10000 }, { rate: 0.0281, upTo: 25000 }, { rate: 0.0316, upTo: 40000 }, { rate: 0.0422, upTo: 60000 }, { rate: 0.0458, upTo: null }], joint: [{ rate: 0.0211, upTo: 10000 }, { rate: 0.0281, upTo: 25000 }, { rate: 0.0316, upTo: 40000 }, { rate: 0.0422, upTo: 60000 }, { rate: 0.0458, upTo: null }] },
  WY: { name: "Wyoming", single: [{ rate: 0, upTo: null }], joint: [{ rate: 0, upTo: null }] },
};

/** Jurisdictions for the state picker, by name; pair with a "none" sentinel in UI. */
export const STATE_OPTIONS: { code: string; name: string }[] = Object.entries(STATE_TAX)
  .map(([code, s]) => ({ code, name: s.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Marginal rate on the next taxable dollar for an ascending bracket schedule. */
function marginalRate(brackets: Bracket[], taxable: number): number {
  for (const b of brackets) {
    if (b.upTo == null || taxable <= b.upTo) return b.rate;
  }
  return brackets.length ? brackets[brackets.length - 1].rate : 0;
}

export interface MarginalEstimate {
  federal: number;
  state: number;
  local: number;
  combined: number;
}

/**
 * Estimate the combined marginal rate on the next dollar of income. Federal and
 * state brackets are applied to income net of the federal standard deduction (a
 * documented simplification for the state side); the optional local rate is added
 * flat. Combined is clamped to a sane ceiling.
 */
export function estimateMarginalRate(
  income: number,
  filingJointly: boolean,
  stateCode: string,
  localRate = 0,
): MarginalEstimate {
  const status = filingJointly ? "joint" : "single";
  const taxable = Math.max(0, income - STANDARD_DEDUCTION[status]);
  const federal = marginalRate(FEDERAL_BRACKETS[status], taxable);
  const st = STATE_TAX[stateCode];
  const state = st ? marginalRate(st[status], taxable) : 0;
  const local = Number.isFinite(localRate) && localRate > 0 ? localRate : 0;
  const combined = Math.min(0.99, federal + state + local);
  return { federal, state, local, combined };
}
