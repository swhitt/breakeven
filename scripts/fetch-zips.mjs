#!/usr/bin/env node
// Builds public/zips.json: a zip-keyed table of { home value, rent, state, city }
// for every US ZIP that has BOTH a Zillow ZHVI home value and a ZORI rent. Rent is
// the binding constraint (~8k zips have ZORI vs ~26k with ZHVI), so the inner join
// lands around 8k zips. The app lazy-fetches this only when a user refines a metro
// by ZIP, so it is NOT bundled into the JS. The 128MB ZHVI download is a CI-time
// cost (weekly data refresh), never shipped to clients.
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
const ZORI_URL =
  "https://files.zillowstatic.com/research/public_csvs/zori/" +
  "Zip_zori_uc_sfrcondomfr_sm_month.csv";

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
  console.log(`  ${rentByZip.size} zips with rent`);

  console.log("Downloading Zillow ZHVI (zip home values, ~128MB)...");
  const zhvi = parseWide(await fetchText(ZHVI_URL));
  if (zhvi.dateCols.length === 0) throw new Error("no date columns in ZHVI zip CSV");

  const out = {};
  let n = 0;
  for (let r = 1; r < zhvi.rows.length; r++) {
    const row = zhvi.rows[r];
    const zip = (row[zhvi.idx.regionName] || "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    const rent = rentByZip.get(zip);
    if (rent == null) continue; // inner join: a verdict needs both home value and rent
    const home = latestVal(row, zhvi.dateCols);
    if (home == null || !(home > 0)) continue;
    let state = zhvi.idx.state >= 0 ? (row[zhvi.idx.state] || "").trim() : "";
    if (!/^[A-Z]{2}$/.test(state) && zhvi.idx.stateName >= 0) {
      const sn = (row[zhvi.idx.stateName] || "").trim();
      if (/^[A-Z]{2}$/.test(sn)) state = sn;
    }
    const city = zhvi.idx.city >= 0 ? (row[zhvi.idx.city] || "").trim() : "";
    out[zip] = { h: Math.round(home), r: rent, s: state, c: city };
    n++;
  }

  // Sort keys so the committed file diffs cleanly run-to-run.
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  await writeFile(OUT_PATH, JSON.stringify(sorted));
  console.log(`Wrote ${OUT_PATH}: ${n} zips with both home value + rent`);
}

main().catch((err) => {
  console.error(`[error] fetch-zips failed: ${err.message}`);
  process.exit(1);
});
