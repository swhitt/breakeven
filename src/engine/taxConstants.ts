/**
 * US federal tax constants, tax year 2026.
 *
 * Keep these in one place so the engine, defaults, and UI can't drift, and so
 * the annual refresh is a single edit. Update each tax year.
 *
 * - Standard deduction: IRS 2026 inflation-adjusted amounts.
 * - SALT cap: the One Big Beautiful Bill Act raised it to $40,000 (2025) and
 *   $40,400 (2026), then +1%/yr through 2029, reverting to $10,000 in 2030
 *   absent new legislation.
 * - Mortgage-interest acquisition-debt cap: interest is deductible only on the
 *   first $750k of acquisition debt under IRC 163(h)(3); OBBBA made it permanent.
 *   The $750k cap applies to single, head-of-household, AND married-filing-jointly
 *   alike; only married-filing-separately is $375k, which this model doesn't
 *   distinguish (our "single" means single/HoH), so we use a single $750k figure.
 */
export const TAX_YEAR = 2026;

export const STANDARD_DEDUCTION = { joint: 32200, single: 16100 } as const;

export const SALT_CAP = 40400;

/**
 * SALT cap for a given calendar year. OBBBA set $40,400 for 2026, +1%/yr through
 * 2029, then a hard revert to $10,000 in 2030 absent new legislation. A horizon
 * that starts in 2026 and runs past 2030 (the default 9-year stay does) must drop
 * to the $10k cliff in its later years, or it overstates the buyer's tax benefit
 * for high-property-tax metros. Years before TAX_YEAR clamp to the entry value.
 */
export function saltCapForYear(calendarYear: number): number {
  if (calendarYear <= TAX_YEAR) return SALT_CAP;
  if (calendarYear >= 2030) return 10000;
  // 2027-2029: +1%/yr off the 2026 base.
  return Math.round(SALT_CAP * Math.pow(1.01, calendarYear - TAX_YEAR));
}

export const MORTGAGE_INTEREST_DEBT_CAP = 750000;

/** IRC 121 capital-gains exclusion on a primary-residence sale, by filing status. */
export const CAPITAL_GAINS_EXCLUSION = { joint: 500000, single: 250000 } as const;
