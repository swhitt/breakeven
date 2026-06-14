// On-demand Open Graph card for a ZIP, cached durably in Vercel Blob so a hit is a pure
// redirect (zero render compute). The ZIP page bakes the verdict into this URL's query, so
// the function imports ONLY @vercel/og and @vercel/blob (both edge-safe) and never the app's
// engine or data, which is what made earlier serverless attempts fail to bundle.
//
// Flow: parse the card from the query, hash it into a deterministic Blob path, and if that
// blob already exists, 302 to it without rendering. Otherwise render once, store it, and 302.
// A changed verdict (after a data refresh) hashes to a new path, so cards never go stale.
import { ImageResponse } from "@vercel/og";
import { head, put } from "@vercel/blob";

export const config = { runtime: "edge" };

const INK = "#1a1a16";
const MUTED = "#6b6a61";
const PAPER = "#faf9f5";
const RENT = "#0d9488";
const BUY = "#ea580c";

// Inter, fetched once per warm instance via Google's old-UA TTF trick (woff2 can't be parsed
// by satori). Only paid on a cache miss, since a hit never reaches the render path.
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $.,/%?()'-:&";
let fonts: Promise<[ArrayBuffer, ArrayBuffer]> | null = null;
async function loadInter(weight: number): Promise<ArrayBuffer> {
  const css = await (
    await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&text=${encodeURIComponent(CHARS)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" },
    })
  ).text();
  const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("Inter TTF not found");
  return await (await fetch(url)).arrayBuffer();
}
function getFonts() {
  if (!fonts) fonts = Promise.all([loadInter(400), loadInter(800)]);
  return fonts;
}

// djb2, just enough to fold the card's contents into a short, stable cache key.
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 24, color: MUTED, textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: INK }}>{value}</div>
    </div>
  );
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const metro = searchParams.get("m") ?? "the U.S.";
    const word = searchParams.get("w") ?? "Toss-up"; // Rent | Buy | Toss-up
    const breakeven = searchParams.get("be") ?? "";
    const home = searchParams.get("hp") ?? "";
    const rent = searchParams.get("rt") ?? "";
    const zip = searchParams.get("z") ?? "";

    const tossup = word === "Toss-up";
    const renting = word === "Rent";
    const color = tossup ? INK : renting ? RENT : BUY;
    const takeaway = tossup
      ? `Rent and buy break even near ${breakeven}, so your ${rent} is basically a coin flip.`
      : `Rent and buy break even at a rent of ${breakeven}. At ${rent}, ${renting ? "renting" : "buying"} wins.`;

    // Same card contents always map to the same Blob path; a refresh that changes the verdict
    // changes the hash, so we render the new one and leave the old behind.
    const path = `zip-og/${zip || "x"}-${hash(`${metro}|${word}|${breakeven}|${home}|${rent}`)}.png`;

    const existing = await head(path).catch(() => null);
    if (existing) return Response.redirect(existing.url, 302);

    const [regular, bold] = await getFonts();
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
            <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: INK }}>
              {metro}
              {zip ? ` (${zip})` : ""}?
            </div>
            <div style={{ display: "flex", fontSize: 92, fontWeight: 800, color, marginTop: 12 }}>{word}</div>
            <div style={{ display: "flex", fontSize: 34, color: INK, marginTop: 8, maxWidth: 1040 }}>{takeaway}</div>
          </div>
          <div style={{ display: "flex", gap: 64 }}>
            <Stat label="Breakeven rent" value={breakeven} />
            <Stat label="Home price" value={home} />
            <Stat label="Comparable rent" value={rent} />
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

    const png = await image.arrayBuffer();
    const blob = await put(path, png, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
    });
    return Response.redirect(blob.url, 302);
  } catch (err) {
    return new Response(`og error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
  }
}
