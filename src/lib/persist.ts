import type { CostBasis } from "../engine/calculator";
import type { AppInputs } from "../engine/defaults";

// Pure persistence/share validation. App.tsx owns the IO (localStorage, the URL); this
// owns the rules: which fields we remember, how to coerce untrusted values by kind, and
// how to diff inputs against a metro's defaults for a short share link. Pure so it's
// testable without a DOM.

export type FieldKind = "number" | "boolean" | "string" | "costBasis";

// Manual edits we remember across reloads, each tagged with the kind we validate on load
// so corrupted storage can't reach the engine (a bad number renders $NaN, a bad shape
// breaks a control).
export const PERSIST_SPEC = {
  homePrice: "number",
  monthlyRent: "number",
  downPaymentPct: "number",
  propertyTax: "costBasis",
  maintenance: "costBasis",
  homeInsurance: "costBasis",
  marginalTaxRate: "number",
  filingJointly: "boolean",
  standardDeduction: "number",
  taxAuto: "boolean",
  annualIncome: "number",
  taxState: "string",
  localTaxRate: "number",
  otherMonthlyDebt: "number",
} as const satisfies Partial<Record<keyof AppInputs, FieldKind>>;

export const PERSIST_KEYS = Object.keys(PERSIST_SPEC) as (keyof typeof PERSIST_SPEC)[];

// Place-specific overrides: cleared when you pick a new metro so they revert to that
// metro's default. A flat-dollar figure the user typed is personal and survives a
// location switch (it's a CostBasis, kept), see selectLocation.
export const LOCATION_FIELDS: (keyof AppInputs)[] = ["homePrice", "monthlyRent", "propertyTax", "homeInsurance", "taxState"];

// Validate a value as a CostBasis (an object, unlike the other fields) so a tampered
// token can't smuggle a bad shape into the engine.
export function parseCostBasis(v: unknown): CostBasis | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "pctOfValue" && typeof o.rate === "number" && Number.isFinite(o.rate)) {
    return { kind: "pctOfValue", rate: o.rate };
  }
  if (o.kind === "flatAnnual" && typeof o.annual === "number" && Number.isFinite(o.annual)) {
    return { kind: "flatAnnual", annual: o.annual };
  }
  return null;
}

// Deep-equal for the override diff: CostBasis fields are objects, so === would always
// read as "changed" and bloat the share link with unchanged defaults.
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

// TS can't correlate the runtime kind-check with the key's type, so the one unavoidable
// index-write cast is localized here.
function setOverride(o: Partial<AppInputs>, k: keyof AppInputs, v: unknown): void {
  (o as Record<string, unknown>)[k] = v;
}

// The single validator both untrusted paths (localStorage + share link) run values
// through, so they can't drift apart. Returns the validated value, or undefined to drop it.
export function coerceByKind(kind: FieldKind, v: unknown): number | boolean | string | CostBasis | undefined {
  switch (kind) {
    case "number": {
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      return typeof v === "boolean" ? v : undefined;
    case "string":
      return typeof v === "string" ? v : undefined;
    case "costBasis":
      return parseCostBasis(v) ?? undefined;
  }
}

// The kind of a reference (default) value, so a share link validates against the shape of
// buildInputs() without a second copy of the field-kind knowledge.
function kindOf(v: unknown): FieldKind | undefined {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return "string";
  if (v !== null && typeof v === "object") return "costBasis";
  return undefined;
}

// Whitelist a parsed localStorage blob to known fields, validated by kind, so corrupted
// storage can't reach the engine.
export function cleanOverrides(parsed: Record<string, unknown>): Partial<AppInputs> {
  const clean: Partial<AppInputs> = {};
  for (const k of PERSIST_KEYS) {
    const val = coerceByKind(PERSIST_SPEC[k], parsed[k]);
    if (val !== undefined) setOverride(clean, k, val);
  }
  return clean;
}

// Validate a share payload's overrides against a reference (default) inputs object, so a
// tampered ?s= token can only set known fields to type-correct values.
export function overridesFromShare(o: Record<string, unknown>, ref: AppInputs): Partial<AppInputs> {
  const overrides: Partial<AppInputs> = {};
  for (const k of Object.keys(ref) as (keyof AppInputs)[]) {
    if (!(k in o)) continue;
    const kind = kindOf(ref[k]);
    if (!kind) continue;
    const val = coerceByKind(kind, o[k]);
    if (val !== undefined) setOverride(overrides, k, val);
  }
  return overrides;
}

// The fields that differ from the metro's defaults, for the share link: only what the
// user changed (so it stays short and the rest re-derives from live data on open).
export function diffOverrides(inputs: AppInputs, defaults: AppInputs): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(inputs) as (keyof AppInputs)[]) {
    if (!valuesEqual(inputs[k], defaults[k])) o[k] = inputs[k];
  }
  return o;
}

// Copy a patch's persistable fields into the remembered overrides; returns whether any changed.
export function rememberOverrides(overrides: Partial<AppInputs>, patch: Partial<AppInputs>): boolean {
  let changed = false;
  for (const k of PERSIST_KEYS) {
    if (k in patch) {
      setOverride(overrides, k, patch[k]);
      changed = true;
    }
  }
  return changed;
}

// Drop place-specific overrides on a metro switch; returns whether any were removed.
export function pruneLocationOverrides(overrides: Partial<AppInputs>): boolean {
  let changed = false;
  for (const k of LOCATION_FIELDS) {
    if (k in overrides) {
      delete overrides[k];
      changed = true;
    }
  }
  return changed;
}
