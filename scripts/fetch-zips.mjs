#!/usr/bin/env node
// Builds public/zips.json: a zip-keyed table of { home value, rent, state, city }
// for every US ZIP that has BOTH a Zillow ZHVI home value and a ZORI rent. Rent is
// the binding constraint (~8k zips have ZORI vs ~26k with ZHVI), so the inner join
// lands around 8k zips. The app lazy-fetches this only when a user refines a metro
// by ZIP, so it is NOT bundled into the JS. The 128MB ZHVI download is a CI-time
// cost (weekly data refresh), never shipped to clients.
//
// Rent is a single-family ESTIMATE: Zillow has no single-family ZORI at the ZIP level,
// so we take the ZIP's blended rent and scale it by its state's single-family premium
// (the median single-family / blended ratio across that state's metros). It is a
// labeled estimate in the UI, not an observed figure. Metro and national rents (in
// fetch-data.mjs) use Zillow's real single-family ZORI directly, no estimation.
//
// ZERO npm dependencies, matching scripts/fetch-data.mjs: native fetch, hand-rolled CSV.
//
// Run: node scripts/fetch-zips.mjs   (from repo root)

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const OUT_PATH = join(PUBLIC_DIR, "zips.json");

const ZHVI_URL =
  "https://files.zillowstatic.com/research/public_csvs/zhvi/" +
  "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv";
// ZIP rents: Zillow only publishes the blended SFR+condo+multifamily ZORI at the ZIP
// level (no single-family-only ZIP file exists), so we read the blended rent here and
// then lift it toward a single-family estimate using each state's single-family premium.
const ZORI_URL =
  "https://files.zillowstatic.com/research/public_csvs/zori/" +
  "Zip_zori_uc_sfrcondomfr_sm_month.csv";

// Metro-level single-family and blended ZORI, used only to derive the per-state ratio
// of single-family to blended rent (the premium an apartment-heavy index hides). Small
// files (~hundreds of KB each), unlike the 128MB ZIP ZHVI.
const METRO_SFR_ZORI_URL =
  "https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfr_sm_month.csv";
const METRO_BLENDED_ZORI_URL =
  "https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv";

const USER_AGENT = "breakeven-data-fetch/1.0 (+https://github.com/swhitt/breakeven)";
const FETCH_TIMEOUT_MS = 180_000; // the ZHVI zip CSV is ~128MB

// --- CSV helpers (hand-rolled, no deps; mirrors fetch-data.mjs) -------------
function parseCsvLine(line) {
  const out = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

function parseCsv(text) {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return clean
    .split("\n")
    .filter((l) => l.length > 0)
    .map(parseCsvLine);
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Parse a wide Zillow zip CSV into rows + the column indices we need. Zip files add
// State (2-letter), City, and Metro columns beyond the metro file's schema.
function parseWide(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = {
    regionName: header.indexOf("RegionName"),
    sizeRank: header.indexOf("SizeRank"),
    state: header.indexOf("State"),
    stateName: header.indexOf("StateName"),
    city: header.indexOf("City"),
    metro: header.indexOf("Metro"),
  };
  const dateCols = [];
  for (let c = 0; c < header.length; c++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(header[c])) dateCols.push(c);
  }
  return { rows, idx, dateCols };
}

// Latest non-empty numeric value in a row's date columns.
function latestVal(row, dateCols) {
  for (let i = dateCols.length - 1; i >= 0; i--) {
    const raw = (row[dateCols[i]] || "").trim();
    if (raw && !Number.isNaN(Number(raw))) return Number(raw);
  }
  return null;
}

// Annualized home-value CAGR for a ZHVI row over ~5 years (60 months), or the longest
// available span of at least 1 year if the ZIP's history is shorter. Null if it can't be
// computed. This is offered in the UI as a one-tap alternative to the conservative default,
// never auto-filled: recent local run-ups are a poor predictor of future appreciation.
function appreciationCagr(row, dateCols) {
  let li = -1;
  let latest = null;
  for (let i = dateCols.length - 1; i >= 0; i--) {
    const raw = (row[dateCols[i]] || "").trim();
    if (raw && !Number.isNaN(Number(raw))) {
      li = i;
      latest = Number(raw);
      break;
    }
  }
  if (li < 0 || !(latest > 0)) return null;
  let bi = -1;
  let back = null;
  for (let i = Math.max(0, li - 60); i <= li - 12; i++) {
    const raw = (row[dateCols[i]] || "").trim();
    if (raw && !Number.isNaN(Number(raw))) {
      bi = i;
      back = Number(raw);
      break;
    }
  }
  if (bi < 0 || !(back > 0)) return null;
  const c = Math.pow(latest / back, 12 / (li - bi)) - 1;
  return Number.isFinite(c) ? Math.round(c * 10000) / 10000 : null;
}

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

// Single-family premium join key. The metro ZORI file names metros "Houston, TX"; the
// ZIP file's Metro column is the full CBSA title "Houston-The Woodlands-Sugar Land, TX".
// Both reduce to the principal city + the first state code, so `houston|TX` matches from
// either side. Returns null when the shape is unexpected, so the caller falls back to state.
function metroKey(name) {
  const comma = name.lastIndexOf(",");
  if (comma < 0) return null; // e.g. "United States"
  const city = name.slice(0, comma).split("-")[0].trim().toLowerCase();
  const st = name.slice(comma + 1).match(/[A-Z]{2}/)?.[0];
  return city && st ? `${city}|${st}` : null;
}

// Ratios of single-family to blended rent, from metro-level ZORI (the only geography
// where Zillow ships both). Houses rent for more than the apartment-heavy blended index,
// a median ~22% nationally and more in pricey markets, so this lifts each ZIP's blended
// rent toward what a comparable house costs. We key by metro for the closest estimate,
// fall back to the state median, then a national median, clamped to [1.0, 1.6] so a
// thin-sample outlier can't produce an absurd figure.
async function buildRentRatios() {
  const sfr = parseWide(await fetchText(METRO_SFR_ZORI_URL));
  const blended = parseWide(await fetchText(METRO_BLENDED_ZORI_URL));

  const blendedByName = new Map();
  for (let r = 1; r < blended.rows.length; r++) {
    const row = blended.rows[r];
    const name = (row[blended.idx.regionName] || "").trim();
    const v = latestVal(row, blended.dateCols);
    if (name && v != null && v > 0) blendedByName.set(name, v);
  }

  const byMetro = new Map();
  const byState = new Map();
  const all = [];
  for (let r = 1; r < sfr.rows.length; r++) {
    const row = sfr.rows[r];
    const name = (row[sfr.idx.regionName] || "").trim();
    const s = latestVal(row, sfr.dateCols);
    const b = blendedByName.get(name);
    if (s == null || b == null || !(b > 0)) continue;
    const ratio = s / b;
    if (!(ratio > 0)) continue;
    all.push(ratio);
    const mk = metroKey(name);
    if (mk) byMetro.set(mk, ratio);
    const st = name.match(/,\s*([A-Z]{2})$/)?.[1];
    if (st) {
      if (!byState.has(st)) byState.set(st, []);
      byState.get(st).push(ratio);
    }
  }

  const national = median(all) ?? 1.22;
  const stateMedian = new Map();
  for (const [st, ratios] of byState) stateMedian.set(st, median(ratios));

  const clamp = (x) => Math.min(1.6, Math.max(1.0, x));
  // Resolve the best available ratio for a ZIP, tracking which tier was used so the run
  // can report coverage. `metro` is the full CBSA title from the ZIP row; `state` its code.
  const tally = { metro: 0, state: 0, national: 0 };
  function ratioFor(metro, state) {
    const m = metro ? byMetro.get(metroKey(metro)) : undefined;
    if (m != null) {
      tally.metro++;
      return clamp(m);
    }
    const s = state ? stateMedian.get(state) : undefined;
    if (s != null) {
      tally.state++;
      return clamp(s);
    }
    tally.national++;
    return clamp(national);
  }
  return { ratioFor, national, tally };
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  console.log("Downloading Zillow ZORI (zip rents)...");
  const zori = parseWide(await fetchText(ZORI_URL));
  if (zori.dateCols.length === 0) throw new Error("no date columns in ZORI zip CSV");
  const rentByZip = new Map();
  for (let r = 1; r < zori.rows.length; r++) {
    const row = zori.rows[r];
    const zip = (row[zori.idx.regionName] || "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    const rent = latestVal(row, zori.dateCols);
    if (rent != null && rent > 0) rentByZip.set(zip, Math.round(rent));
  }
  console.log(`  ${rentByZip.size} zips with blended rent`);

  console.log("Building single-family rent premium from metro ZORI...");
  const ratios = await buildRentRatios();
  console.log(`  national single-family premium ${ratios.national.toFixed(3)}x`);

  console.log("Downloading Zillow ZHVI (zip home values, ~128MB)...");
  const zhvi = parseWide(await fetchText(ZHVI_URL));
  if (zhvi.dateCols.length === 0) throw new Error("no date columns in ZHVI zip CSV");

  const out = {};
  let n = 0;
  for (let r = 1; r < zhvi.rows.length; r++) {
    const row = zhvi.rows[r];
    const zip = (row[zhvi.idx.regionName] || "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    const blended = rentByZip.get(zip);
    if (blended == null) continue; // inner join: a verdict needs both home value and rent
    const home = latestVal(row, zhvi.dateCols);
    if (home == null || !(home > 0)) continue;
    let state = zhvi.idx.state >= 0 ? (row[zhvi.idx.state] || "").trim() : "";
    if (!/^[A-Z]{2}$/.test(state) && zhvi.idx.stateName >= 0) {
      const sn = (row[zhvi.idx.stateName] || "").trim();
      if (/^[A-Z]{2}$/.test(sn)) state = sn;
    }
    const city = zhvi.idx.city >= 0 ? (row[zhvi.idx.city] || "").trim() : "";
    const metro = zhvi.idx.metro >= 0 ? (row[zhvi.idx.metro] || "").trim() : "";
    // No single-family ZORI exists at the ZIP level, so lift the ZIP's blended rent by its
    // metro's (else state's, else national) single-family premium. See buildRentRatios.
    const rent = Math.round(blended * ratios.ratioFor(metro, state));
    // SizeRank (smaller = bigger market) lets us pick the top-N ZIPs most worth pre-rendering
    // an OG card for. Default to a large rank so a missing value sorts last.
    const k = zhvi.idx.sizeRank >= 0 ? Number(row[zhvi.idx.sizeRank]) : NaN;
    const a = appreciationCagr(row, zhvi.dateCols);
    out[zip] = {
      h: Math.round(home),
      r: rent,
      s: state,
      c: city,
      k: Number.isFinite(k) ? k : 999999,
      ...(a != null ? { a } : {}),
    };
    n++;
  }

  // Reinsert keys in sorted order for deterministic, clean run-to-run diffs. (Note: JSON
  // output isn't strictly lexical, V8 emits integer-like keys in numeric order first, then
  // the leading-zero ZIPs, but the ordering is stable, which is all the diff needs.)
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  await writeFile(OUT_PATH, JSON.stringify(sorted));
  const t = ratios.tally;
  console.log(
    `Wrote ${OUT_PATH}: ${n} zips (single-family rent estimated by ` +
      `metro ${t.metro}, state ${t.state}, national ${t.national})`,
  );
}

main().catch((err) => {
  console.error(`[error] fetch-zips failed: ${err.message}`);
  process.exit(1);
});
