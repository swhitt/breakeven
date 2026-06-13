import { ImageResponse } from "@vercel/og";
import cards from "./og-data.json";

// Per-metro Open Graph card. Node serverless (NOT edge): a plain Vite project's edge
// functions can't bundle any imports, but the Node runtime bundles fine. We use the
// (req, res) signature and write the PNG buffer ourselves, because Vercel's Node adapter
// doesn't accept a returned Web Response. Card strings are precomputed from the real
// engine by scripts/gen-og-data.ts (api/og-data.json).

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

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $.,/%?()'-:&";

// @vercel/og's bundled font doesn't load in a Node function, so fetch Inter ourselves.
// The old User-Agent makes Google Fonts serve TTF (Satori can't read woff2).
async function loadInter(weight: number): Promise<ArrayBuffer> {
  const css = await (
    await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&text=${encodeURIComponent(CHARS)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" },
    })
  ).text();
  const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("Inter TTF not found in Google CSS");
  return await (await fetch(url)).arrayBuffer();
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 24, color: MUTED, textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: INK }}>{value}</div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  try {
    const id = typeof req.query?.m === "string" ? req.query.m : "united-states";
    const d = data[id] ?? data["united-states"];
    const [regular, bold] = await Promise.all([loadInter(400), loadInter(800)]);

    const image = new ImageResponse(
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
            fontFamily: "Inter",
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
      {
        width: 1200,
        height: 630,
        fonts: [
          { name: "Inter", data: regular, weight: 400, style: "normal" },
          { name: "Inter", data: bold, weight: 800, style: "normal" },
        ],
      },
    );

    const png = Buffer.from(await image.arrayBuffer());
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
    res.status(200).end(png);
  } catch (err) {
    res.status(500).end(`OG render failed: ${err instanceof Error ? err.stack : String(err)}`);
  }
}
