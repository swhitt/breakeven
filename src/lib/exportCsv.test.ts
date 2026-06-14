import { describe, expect, it } from "vitest";
import { calculate } from "../engine/calculator";
import { buildInputs } from "../engine/defaults";
import type { MarketData } from "../data/types";
import { insurance, locations, propertyTax } from "../data/rates";
import market from "../data/market.json";
import { buildBreakdownCsv, csvFilename } from "./exportCsv";

function fixture() {
  const loc = locations.find((l) => l.id !== "united-states") ?? locations[0];
  const inputs = buildInputs(loc, market as unknown as MarketData, propertyTax, insurance);
  const result = calculate(inputs);
  const csv = buildBreakdownCsv({
    inputs,
    result,
    placeLabel: loc.metro,
    placeId: loc.id,
    dataAsOf: market.asOf,
    generatedDate: "2026-06-13",
  });
  return { inputs, result, csv };
}

describe("buildBreakdownCsv", () => {
  it("has the 28-column header and one data row per year plus a TOTALS row", () => {
    const { result, csv } = fixture();
    const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    const headerIdx = lines.findIndex((l) => l.startsWith("Year,"));
    expect(headerIdx).toBeGreaterThan(0); // metadata block precedes it
    expect(lines[headerIdx].split(",").length).toBe(31);

    const dataRows = lines.slice(headerIdx + 1);
    // one row per simulated year + the TOTALS row
    expect(dataRows.length).toBe(result.years.length + 1);
    expect(dataRows[dataRows.length - 1].startsWith('"TOTALS"')).toBe(true);
  });

  it("emits machine-readable numbers (no $ or thousands commas) in the data grid", () => {
    const { csv } = fixture();
    const lines = csv.split("\r\n");
    const firstData = lines[lines.findIndex((l) => l.startsWith("Year,")) + 1];
    expect(firstData).not.toMatch(/\$/);
    // every cell is a bare number with up to 2 decimals
    for (const cell of firstData.split(",")) expect(cell).toMatch(/^-?\d+(\.\d{1,2})?$/);
  });

  it("Buy - Rent equals Own-so-far minus Rent-so-far each year (PV crossover)", () => {
    const { csv } = fixture();
    const lines = csv.split("\r\n");
    const headerIdx = lines.findIndex((l) => l.startsWith("Year,"));
    const row = lines[headerIdx + 3].split(","); // a few years in
    const buyPV = Number(row[25]);
    const rentPV = Number(row[26]);
    const delta = Number(row[27]);
    expect(delta).toBeCloseTo(buyPV - rentPV, 1);
  });

  it("metadata block carries the scenario and parses as quoted key/value pairs", () => {
    const { csv } = fixture();
    expect(csv.startsWith("﻿")).toBe(true); // Excel BOM
    expect(csv).toContain('"Verdict",');
    expect(csv).toContain('"Breakeven rent",');
    expect(csv).toContain('"Investment return / discount rate",');
  });

  it("filenames are slug-safe and dated", () => {
    expect(csvFilename("houston-tx", "2026-06-13")).toBe("breakeven_houston-tx_2026-06-13.csv");
    expect(csvFilename("77002", "2026-06-13")).toBe("breakeven_77002_2026-06-13.csv");
  });
});
