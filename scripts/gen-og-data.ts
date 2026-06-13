// Precompute every metro's OG-card display strings (verdict, takeaway, key numbers)
// into api/og-data.json, so the edge OG function is self-contained: a plain Vite
// project's edge functions can't bundle imports from outside api/, so the engine and
// market data can't live in the function. Runs in the build (data refreshes weekly).
import { writeFileSync } from "node:fs";
import { calculate } from "../src/engine/calculator";
import { buildInputs } from "../src/engine/defaults";
import { usd } from "../src/lib/format";
import type { LocationData, MarketData, StateRateTable } from "../src/data/types";
import locations from "../src/data/locations.json";
import market from "../src/data/market.json";
import propertyTax from "../src/data/propertyTax.json";
import insurance from "../src/data/insurance.json";

interface Card {
  metro: string;
  word: string;
  color: string;
  takeaway: string;
  breakeven: string;
  homePrice: string;
  rent: string;
}

const out: Record<string, Card> = {};
for (const loc of locations as LocationData[]) {
  const inputs = buildInputs(
    loc,
    market as unknown as MarketData,
    propertyTax as unknown as StateRateTable,
    insurance as unknown as StateRateTable,
  );
  const r = calculate(inputs);
  const closeCall = Math.abs(r.monthlyDifference) < inputs.monthlyRent * 0.05;
  const renting = r.verdict === "rent";
  const breakeven = usd(r.breakevenRent);
  out[loc.id] = {
    metro: loc.metro,
    word: closeCall ? "Toss-up" : renting ? "Rent" : "Buy",
    color: closeCall ? "#1a1a16" : renting ? "#0d9488" : "#ea580c",
    takeaway: closeCall
      ? `Basically a wash, within ${usd(Math.abs(r.monthlyDifference))}/mo of the breakeven.`
      : renting
        ? `Renting wins. Buying needs a comparable rent above ${breakeven}/mo to pull ahead.`
        : `Buying wins. Your rent clears the ${breakeven}/mo breakeven, so owning is cheaper.`,
    breakeven: `${breakeven}/mo`,
    homePrice: usd(inputs.homePrice),
    rent: `${usd(inputs.monthlyRent)}/mo`,
  };
}

writeFileSync(new URL("../api/og-data.json", import.meta.url), JSON.stringify(out));
console.log(`gen-og-data: wrote ${Object.keys(out).length} metros to api/og-data.json`);
