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

export const MORTGAGE_INTEREST_DEBT_CAP = 750000;
