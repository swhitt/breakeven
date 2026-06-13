import { ImageResponse } from "@vercel/og";
import cards from "./og-data.json";

// Per-metro Open Graph card. Edge runtime + a single local JSON (precomputed by
// scripts/gen-og-data.ts), so the function is self-contained: a plain Vite project's
// edge functions can't bundle imports from outside api/, and @vercel/og's default
// font only loads on edge. Verdict/numbers come from the real engine at build time.
export const config = { runtime: "edge" };

const INK = "#1a1a16";
const MUTED = "#6b6a61";
const PAPER = "#faf9f5";
const RENT = "#0d9488";
const BUY = "#ea580c";

interface Card {
  metro: string;
  word: string;
  color: string;
  takeaway: string;
  breakeven: string;
  homePrice: string;
  rent: string;
}
const data = cards as Record<string, Card>;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 24, color: MUTED, textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: INK }}>{value}</div>
    </div>
  );
}

export default function handler(req: Request) {
  const id = new URL(req.url, "https://breakeven.rent").searchParams.get("m") ?? "united-states";
  const d = data[id] ?? data["united-states"];

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
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: INK }}>{d.metro}?</div>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, color: d.color, marginTop: 12 }}>{d.word}</div>
          <div style={{ display: "flex", fontSize: 34, color: INK, marginTop: 8, maxWidth: 1000 }}>{d.takeaway}</div>
        </div>

        <div style={{ display: "flex", gap: 64 }}>
          <Stat label="Breakeven rent" value={d.breakeven} />
          <Stat label="Home price" value={d.homePrice} />
          <Stat label="Comparable rent" value={d.rent} />
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
