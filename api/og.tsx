import { ImageResponse } from "@vercel/og";
import { calculate } from "../src/engine/calculator";
import { buildInputs } from "../src/engine/defaults";
import { usd } from "../src/lib/format";
import type { LocationData, MarketData, StateRateTable } from "../src/data/types";
import locations from "../src/data/locations.json";
import market from "../src/data/market.json";
import propertyTax from "../src/data/propertyTax.json";
import insurance from "../src/data/insurance.json";

// Renders a per-metro Open Graph card from the actual engine verdict, so a shared
// /houston-tx link unfurls with Houston's real numbers instead of a generic image.
// Node serverless (not edge): a plain Vite project's edge functions can't bundle
// imports from outside api/, but the Node runtime can.

const INK = "#1a1a16";
const MUTED = "#6b6a61";
const PAPER = "#faf9f5";
const RENT = "#0d9488";
const BUY = "#ea580c";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 24, color: MUTED, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: INK }}>{value}</div>
    </div>
  );
}

export default function handler(req: Request) {
  try {
    return render(req);
  } catch (err) {
    return new Response(`OG render failed: ${err instanceof Error ? err.stack : String(err)}`, {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }
}

function render(req: Request) {
  // req.url is absolute on a Web request but relative on Node serverless; a base makes
  // new URL() safe either way.
  const id = new URL(req.url ?? "/", "https://breakeven.rent").searchParams.get("m") ?? "united-states";
  const locs = locations as LocationData[];
  const loc = locs.find((l) => l.id === id) ?? locs[0];
  const inputs = buildInputs(
    loc,
    market as unknown as MarketData,
    propertyTax as unknown as StateRateTable,
    insurance as unknown as StateRateTable,
  );
  const r = calculate(inputs);
  const closeCall = Math.abs(r.monthlyDifference) < inputs.monthlyRent * 0.05;
  const renting = r.verdict === "rent";
  const word = closeCall ? "Toss-up" : renting ? "Rent" : "Buy";
  const color = closeCall ? INK : renting ? RENT : BUY;
  const breakeven = usd(r.breakevenRent);
  const takeaway = closeCall
    ? `Basically a wash, within ${usd(Math.abs(r.monthlyDifference))}/mo of the breakeven.`
    : renting
      ? `Renting wins. Buying needs a comparable rent above ${breakeven}/mo to pull ahead.`
      : `Buying wins. Your rent clears the ${breakeven}/mo breakeven, so owning is cheaper.`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: PAPER,
          padding: 72,
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>
            <span style={{ color: RENT }}>break</span>
            <span style={{ color: BUY }}>Even</span>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: MUTED }}>rent vs. buy, with the math shown</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 32, color: MUTED }}>Should you rent or buy in</div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: INK }}>{loc.metro}?</div>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, color, marginTop: 12 }}>{word}</div>
          <div style={{ display: "flex", fontSize: 34, color: INK, marginTop: 8, maxWidth: 1000 }}>{takeaway}</div>
        </div>

        <div style={{ display: "flex", gap: 64 }}>
          <Stat label="Breakeven rent" value={`${breakeven}/mo`} />
          <Stat label="Home price" value={usd(inputs.homePrice)} />
          <Stat label="Comparable rent" value={`${usd(inputs.monthlyRent)}/mo`} />
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
