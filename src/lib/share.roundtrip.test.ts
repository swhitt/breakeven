import { describe, expect, it } from "vitest";
import type { AppInputs } from "../engine/defaults";
import { diffOverrides, overridesFromShare } from "./persist";
import { decodeShare, encodeShare } from "./share";

// The full share-link chain, end to end, exactly as App wires it: the encode side diffs
// the user's inputs against the metro defaults and packs them into a token (App.share),
// and the decode side validates the token's overrides back against a reference inputs
// object (App.readShareLink). share.test and persist.test each cover only one half, so a
// regression in the seam (a CostBasis that stops round-tripping, a float that rounds, a
// tampered token that slips through) would pass both and still load a wrong scenario.

const defaults: AppInputs = {
  homePrice: 400000,
  downPaymentPct: 0.2,
  mortgageRate: 0.065,
  mortgageTermYears: 30,
  homeAppreciation: 0.035,
  yearsToStay: 9,
  investmentReturn: 0.06,
  inflation: 0.024,
  propertyTax: { kind: "pctOfValue", rate: 0.011 },
  maintenance: { kind: "pctOfValue", rate: 0.01 },
  homeInsurance: { kind: "pctOfValue", rate: 0.005 },
  hoaMonthly: 0,
  buyingClosingPct: 0.03,
  sellingCostPct: 0.06,
  pmiRate: 0.0058,
  marginalTaxRate: 0.24,
  standardDeduction: 32200,
  otherSALT: 0,
  filingJointly: true,
  capitalGainsRate: 0.15,
  monthlyRent: 2200,
  rentGrowth: 0.03,
  rentersInsuranceMonthly: 15,
  securityDepositMonths: 1,
  brokerFeeMonths: 0,
  taxAuto: true,
  annualIncome: 0,
  taxState: "US",
  localTaxRate: 0,
};

// One pass through the real production chain: diff -> encode -> decode -> validate.
function roundTrip(inputs: AppInputs, metroId: string) {
  const o = diffOverrides(inputs, defaults);
  const token = encodeShare({ m: metroId, o });
  const payload = decodeShare(token);
  if (!payload) return null;
  return { m: payload.m, overrides: overridesFromShare(payload.o ?? {}, defaults) };
}

describe("share round-trip", () => {
  it("restores every changed field type and the metro, dropping the unchanged rest", () => {
    const edited: AppInputs = {
      ...defaults,
      homePrice: 525000, // number
      downPaymentPct: 0.1337, // float, exactness matters
      propertyTax: { kind: "flatAnnual", annual: 7200 }, // CostBasis (object)
      taxState: "NY", // string
      filingJointly: false, // boolean, must survive (not read as "drop")
    };

    const result = roundTrip(edited, "new-york-ny");
    expect(result).not.toBeNull();
    expect(result!.m).toBe("new-york-ny");
    expect(result!.overrides).toEqual({
      homePrice: 525000,
      downPaymentPct: 0.1337,
      propertyTax: { kind: "flatAnnual", annual: 7200 },
      taxState: "NY",
      filingJointly: false,
    });
    // The float survived bit-exact, not just close.
    expect(result!.overrides.downPaymentPct).toBe(0.1337);
    // An untouched field is absent, so it re-derives from the metro's live defaults.
    expect("monthlyRent" in result!.overrides).toBe(false);
  });

  it("emits an empty override set (just the metro) when nothing was changed", () => {
    const result = roundTrip({ ...defaults }, "houston-tx");
    expect(result!.m).toBe("houston-tx");
    expect(result!.overrides).toEqual({});
  });

  it("rejects a checksum-tampered token so App falls back to defaults", () => {
    const token = encodeShare({ m: "austin-tx", o: { homePrice: 999000 } });
    const sep = token.lastIndexOf("~");
    const tampered = token.slice(0, sep) + "~deadbeef"; // wrong checksum
    expect(decodeShare(tampered)).toBeNull();
    expect(decodeShare("not-a-real-token")).toBeNull();
  });

  it("drops unknown and mistyped fields a tampered payload tries to smuggle in", () => {
    // Hand-pack a payload with a valid field, an unknown key, and a wrong-typed known key.
    const token = encodeShare({
      m: "austin-tx",
      o: { homePrice: 480000, evil: "<script>", marginalTaxRate: "lots" },
    });
    const payload = decodeShare(token);
    const overrides = overridesFromShare(payload!.o ?? {}, defaults);
    expect(overrides).toEqual({ homePrice: 480000 }); // evil + bad marginalTaxRate dropped
  });
});
