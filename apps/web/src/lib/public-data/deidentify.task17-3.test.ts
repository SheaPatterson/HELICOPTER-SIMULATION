import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  toAggregateOperationalData,
  toPublicAssetSummary,
  type PublicAssetSummary,
  type RawOperationalAsset,
  type RawOperationalMission,
} from "./deidentify";

/**
 * Task 17.3 — dedicated unit suite for public-route data de-identification
 * (Requirement 8.7).
 *
 * Requirement 8.7 (safety-sensitive): a public map/marketing route returns
 * AGGREGATE or DE-IDENTIFIED operational data ONLY — no patient, clinical, or
 * VIRS record, and NO field that identifies an individual pilot, patient, or
 * incident.
 *
 * This suite asserts the guarantee two ways for BOTH public projections:
 *  1. no forbidden KEY appears anywhere in the output (structural), and
 *  2. no raw identifying/clinical/VIRS VALUE leaks through (content),
 * even when the raw operational record carries extra unknown fields — the
 * allow-list projection must drop everything it does not explicitly copy.
 */

/** Keys that would identify a pilot/patient/incident or carry clinical/VIRS content. */
const FORBIDDEN_KEYS = [
  "pilot_id",
  "mission_id",
  "mission_code",
  "position",
  "patient",
  "patient_state",
  "clinical_summary",
  "virs",
  "narrative",
  "callsign",
  "tail_number",
  "crew",
] as const;

/** Deep-collect every object key present in a value. */
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

/** Deep-collect every primitive value (as string) present in a value. */
function collectValues(value: unknown, acc: string[] = []): string[] {
  if (value === null || value === undefined) {
    // ignore
  } else if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    acc.push(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) collectValues(item, acc);
  } else if (typeof value === "object") {
    for (const v of Object.values(value)) collectValues(v, acc);
  }
  return acc;
}

/**
 * A raw asset carrying every kind of identifying/clinical field, PLUS extra
 * unknown upstream fields, so the allow-list projection is proven to drop
 * anything it does not explicitly copy.
 */
const FULLY_IDENTIFYING_ASSET: RawOperationalAsset = {
  pilot_id: "pilot-8f2c-abc",
  mission_id: "mission-1234-incident",
  mission_code: "WPA-2024-0042",
  region: "WPA",
  airframe_model: "EC145",
  position: { lat: 40.4406, lon: -79.9959, altitude_ft: 1200 },
  // Extra identifying fields not declared in the interface — must still drop.
  callsign: "LIFEFLIGHT-2",
  tail_number: "N911WP",
  pilot_name: "Jane Q. Pilot",
  crew: ["flight-nurse-77", "medic-31"],
};

const CLINICAL_MISSION: RawOperationalMission = {
  mission_id: "mission-1234-incident",
  mission_code: "WPA-2024-0042",
  region: "WPA",
  status: "EN_ROUTE_HOSPITAL",
  patient: { age_years: 54, clinical_summary: "chest pain", baseline_gcs: 14 },
  patient_state: { priority: "PRIORITY_1", gcs: 12 },
  clinical_summary: "STEMI en route",
  virs: { record_id: "virs-99", narrative: "confidential safety report" },
};

describe("task 17.3: toPublicAssetSummary de-identifies a raw asset (8.7)", () => {
  it("emits only the region and active flag", () => {
    const summary: PublicAssetSummary =
      toPublicAssetSummary(FULLY_IDENTIFYING_ASSET);
    expect(summary).toEqual({ region: "WPA", active: true });
    expect(Object.keys(summary).sort()).toEqual(["active", "region"]);
  });

  it("carries no forbidden identifying/clinical/VIRS key", () => {
    const keys = collectKeys(toPublicAssetSummary(FULLY_IDENTIFYING_ASSET));
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("leaks none of the raw identifying values", () => {
    const values = collectValues(toPublicAssetSummary(FULLY_IDENTIFYING_ASSET));
    for (const leaked of [
      "pilot-8f2c-abc",
      "mission-1234-incident",
      "WPA-2024-0042",
      "LIFEFLIGHT-2",
      "N911WP",
      "Jane Q. Pilot",
      "flight-nurse-77",
      "medic-31",
    ]) {
      expect(values).not.toContain(leaked);
    }
  });

  it("generalizes a missing region to UNKNOWN rather than exposing detail", () => {
    expect(toPublicAssetSummary({ pilot_id: "p1" })).toEqual({
      region: "UNKNOWN",
      active: false,
    });
  });

  it("derives active from mission linkage without exposing the linkage", () => {
    expect(toPublicAssetSummary({ region: "WPA" }).active).toBe(false);
    expect(
      toPublicAssetSummary({ region: "WPA", mission_id: "m-1" }).active,
    ).toBe(true);
    expect(
      toPublicAssetSummary({ region: "WPA", mission_id_present: true }).active,
    ).toBe(true);
    expect(
      toPublicAssetSummary({ region: "WPA", mission_id_present: false }).active,
    ).toBe(false);
  });
});

describe("task 17.3: toAggregateOperationalData exposes counts only (8.7)", () => {
  it("emits exactly the four aggregate keys", () => {
    const aggregate = toAggregateOperationalData(
      "WPA",
      [FULLY_IDENTIFYING_ASSET, { region: "WPA" }],
      [CLINICAL_MISSION],
    );
    expect(aggregate).toEqual({
      region: "WPA",
      totalAssets: 2,
      activeAssets: 1,
      activeMissions: 1,
    });
    expect([...collectKeys(aggregate)].sort()).toEqual(
      ["activeAssets", "activeMissions", "region", "totalAssets"].sort(),
    );
  });

  it("carries no forbidden key even with fully identifying/clinical input", () => {
    const keys = collectKeys(
      toAggregateOperationalData(
        "WPA",
        [FULLY_IDENTIFYING_ASSET],
        [CLINICAL_MISSION],
      ),
    );
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("leaks none of the raw identifying/clinical/VIRS values", () => {
    const values = collectValues(
      toAggregateOperationalData(
        "WPA",
        [FULLY_IDENTIFYING_ASSET],
        [CLINICAL_MISSION],
      ),
    );
    for (const leaked of [
      "pilot-8f2c-abc",
      "mission-1234-incident",
      "WPA-2024-0042",
      "LIFEFLIGHT-2",
      "N911WP",
      "STEMI en route",
      "chest pain",
      "virs-99",
      "confidential safety report",
      "PRIORITY_1",
    ]) {
      expect(values).not.toContain(leaked);
    }
  });

  it("excludes terminal missions (COMPLETED/ABORTED) from the active count", () => {
    const missions: RawOperationalMission[] = [
      { region: "WPA", status: "COMPLETED" },
      { region: "WPA", status: "ABORTED" },
      { region: "WPA", status: "ON_SCENE" },
      { region: "WPA", status: "DISPATCHED" },
    ];
    expect(toAggregateOperationalData("WPA", [], missions).activeMissions).toBe(
      2,
    );
  });

  it("counts only assets and missions in the requested region", () => {
    const aggregate = toAggregateOperationalData(
      "WPA",
      [
        { region: "WPA", mission_id: "m1" },
        { region: "ATL", mission_id: "m2" },
      ],
      [
        { region: "WPA", status: "DISPATCHED" },
        { region: "ATL", status: "DISPATCHED" },
      ],
    );
    expect(aggregate).toEqual({
      region: "WPA",
      totalAssets: 1,
      activeAssets: 1,
      activeMissions: 1,
    });
  });

  it("returns a safe zeroed aggregate for an empty operational set", () => {
    expect(toAggregateOperationalData("WPA", [], [])).toEqual({
      region: "WPA",
      totalAssets: 0,
      activeAssets: 0,
      activeMissions: 0,
    });
  });

  it("property: no forbidden key and no raw value leaks, counts stay consistent", () => {
    // Identifier values are prefixed so they can never collide with the
    // numeric COUNT values the aggregate legitimately emits (e.g. "0", "1").
    // The structural key check below is the primary guarantee; this content
    // check verifies raw identifier tokens do not survive the projection.
    const idArb = fc
      .string({ minLength: 1 })
      .map((s) => `id-${s.replace(/[^a-zA-Z0-9]/g, "")}-x`);
    const rawArb = fc.record(
      {
        pilot_id: idArb,
        mission_id: idArb,
        mission_code: idArb,
        region: fc.constantFrom("WPA", "ATL", "", "UNKNOWN"),
        position: fc.record({ lat: fc.double(), lon: fc.double() }),
        patient: fc.record({ clinical_summary: fc.string() }),
        virs: fc.record({ narrative: fc.string() }),
        callsign: fc.string(),
        status: fc.constantFrom(
          "DISPATCHED",
          "ON_SCENE",
          "EN_ROUTE_HOSPITAL",
          "COMPLETED",
          "ABORTED",
        ),
      },
      { requiredKeys: [] },
    );

    fc.assert(
      fc.property(fc.array(rawArb), fc.array(rawArb), (assets, missions) => {
        const aggregate = toAggregateOperationalData(
          "WPA",
          assets as RawOperationalAsset[],
          missions as RawOperationalMission[],
        );

        // Structural: no forbidden key survives the projection.
        const keys = collectKeys(aggregate);
        for (const forbidden of FORBIDDEN_KEYS) {
          if (keys.has(forbidden)) return false;
        }

        // Content: no raw pilot/mission/clinical string value leaks.
        const emitted = collectValues(aggregate);
        for (const asset of assets) {
          if (emitted.includes(String(asset.pilot_id))) return false;
          if (emitted.includes(String(asset.mission_id))) return false;
          if (emitted.includes(String(asset.mission_code))) return false;
        }

        // Counts are non-negative and internally consistent.
        return (
          aggregate.totalAssets >= 0 &&
          aggregate.activeMissions >= 0 &&
          aggregate.activeAssets >= 0 &&
          aggregate.activeAssets <= aggregate.totalAssets
        );
      }),
    );
  });

  it("property: every asset summary carries only region + active", () => {
    const assetArb = fc.record(
      {
        pilot_id: fc.string(),
        mission_id: fc.string(),
        mission_code: fc.string(),
        region: fc.option(fc.constantFrom("WPA", "ATL", ""), { nil: undefined }),
        position: fc.record({ lat: fc.double(), lon: fc.double() }),
        patient: fc.record({ clinical_summary: fc.string() }),
      },
      { requiredKeys: [] },
    );

    fc.assert(
      fc.property(assetArb, (raw) => {
        const summary = toPublicAssetSummary(raw as RawOperationalAsset);
        const keys = Object.keys(summary).sort();
        return (
          keys.length === 2 &&
          keys[0] === "active" &&
          keys[1] === "region" &&
          typeof summary.active === "boolean" &&
          typeof summary.region === "string" &&
          summary.region.length > 0
        );
      }),
    );
  });
});
