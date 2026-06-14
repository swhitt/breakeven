export interface MarketData {
  asOf: string;
  mortgage: {
    rate30: number;
    rate15: number;
    // Jumbo-minus-conforming rate spread (decimal), from Optimal Blue's same-day OBMMI
    // indices, applied to the conforming rate for loans above the conforming limit. Can be
    // negative when jumbos price below conforming. Optional: older data may not carry it.
    jumboSpread?: number;
    asOf: string;
    source: string;
  };
  inflation: { rate: number; asOf: string; source: string };
  appreciation: { rate1yr: number; rate5yrCagr: number; asOf: string; source: string };
  national: { homeValue: number; rent: number; asOf: string; source: string };
}

export interface LocationData {
  id: string;
  metro: string;
  state: string;
  homeValue: number;
  rent: number;
  appreciation5yr?: number;
}

/** A per-state lookup of effective annual rates keyed by 2-letter state code. */
export type StateRateTable = Record<string, number>;
