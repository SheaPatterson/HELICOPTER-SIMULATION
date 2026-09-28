import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  toAggregateOperationalData,
  toPublicAssetSummary,
  type RawOperationalAsset,
  type RawOperationalMission,
} from "./deidentify";

/**
 * Unit tests for the public de-identification / aggregation projection (task
 * 17.2; Requirement 8.7). The dedicated fuller suite is task 17.3; these assert
 * the core invariant: public output carries NO pilot/patient/incident-
 * identifying field and NO patient/clinical/VIRS content — only aggregate or
 * de-identified fields.
 */

/** Field names that would identify a pilot, patient, or incident, or carry clinical/VIRS content. */
const FORBIDDEN_KEYS = [
  "pilot_id",
  "mission_id",
  "mission_code",
  "position",
  "patient",
  "patient_state",
  "clinical_summary",
  "virs",
];

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

/** Deep-collect every string value present in a value. */
function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, acc);
  }
  return acc;
}

const IDENTIFYING_ASSET: RawOperationalAsset = {
  pilot_id: "pilot-8f2c-abc",
  mission_id: "mission-1234-incident",
  mission_code: "WPA-2024-0042",
  region: "WPA",
  airframe_model: "EC135",
  position: { lat: 40.44, lon: -79.99, altitude_ft: 1200 },
};

const CLINICAL_MISSION: RawOperationalMission = {
  mission_id: "mission-1234-incident",
  mission_code: "WPA-2024-0042",
  region: "WPA",
  status: "EN_ROUTE_HOSPITAL",
  patient: { age_years: 54, clinical_summary: "chest pain", baseline_gcs: 14 },
  patient_state: { priority: "PRIORITY_1" },
  clinical_summary: "STEMI en route",
  virs: { record_id: "virs-99", narrative: "confidential" },
};

describe("toPublicAssetSummary (8.7)", () => {
  it("emits only region and active flag — no identifying or telemetry fields", () => {
    const summary = toPublicAssetSummary(IDENTIFYING_ASSET);
    expect(summary).toEqual({ region: "WPA", active: true });
  });

  it("carries no pilot/mission/incident-identifying or clinical field", () => {
    const summary = toPublicAssetSummary(IDENTIFYING_ASSET);
    const keys = collectKeys(summary);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("never leaks the raw pilot id, mission id, or mission code as a value", () => {
    const summary = toPublicAssetSummary(IDENTIFYING_ASSET);
    const strings = collectStrings(summary);
    expect(strings).not.toContain(IDENTIFYING_ASSET.pilot_id);
    expect(strings).not.toContain(IDENTIFYING_ASSET.mission_id);
    expect(strings).not.toContain(IDENTIFYING_ASSET.mission_code);
  });

  it("reports active from mission linkage without exposing the mission", () => {
    expect(toPublicAssetSummary({ region: "WPA" }).active).toBe(false);
    expect(
      toPublicAssetSummary({ region: "WPA", mission_id: "m-1" }).active,
    ).toBe(true);
    expect(
      toPublicAssetSummary({ region: "WPA", mission_id_present: true }).active,
    ).toBe(true);
  });
});

describe("toAggregateOperationalData (8.7)", () => {
  it("emits only region-level counts, no per-record data", () => {
    const aggregate = toAggregateOperationalData(
      "WPA",
      [IDENTIFYING_ASSET, { region: "WPA" }],
      [CLINICAL_MISSION],
    );
    expect(aggregate).toEqual({
      region: "WPA",
      totalAssets: 2,
      activeAssets: 1,
      activeMissions: 1,
    });
  });

  it("output contains no identifying/clinical/VIRS key", () => {
    const aggregate = toAggregateOperationalData(
      "WPA",
      [IDENTIFYING_ASSET],
      [CLINICAL_MISSION],
    );
    const keys = collectKeys(aggregate);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    // Only the four aggregate keys are present.
    expect([...keys].sort()).toEqual(
      ["activeAssets", "activeMissions", "region", "totalAssets"].sort(),
    );
  });

  it("output leaks none of the raw identifying or clinical string values", () => {
    const aggregate = toAggregateOperationalData(
      "WPA",
      [IDENTIFYING_ASSET],
      [CLINICAL_MISSION],
    );
    const strings = collectStrings(aggregate);
    for (const leaked of [
      IDENTIFYING_ASSET.pilot_id,
      IDENTIFYING_ASSET.mission_id,
      IDENTIFYING_ASSET.mission_code,
      "STEMI en route",
      "chest pain",
      "virs-99",
      "confidential",
      "PRIORITY_1",
    ]) {
      expect(strings).not.toContain(leaked);
    }
  });

  it("excludes terminal missions from the active count", () => {
    const missions: RawOperationalMission[] = [
      { region: "WPA", status: "COMPLETED" },
      { region: "WPA", status: "ABORTED" },
      { region: "WPA", status: "ON_SCENE" },
    ];
    expect(
      toAggregateOperationalData("WPA", [], missions).activeMissions,
    ).toBe(1);
  });

  it("counts only assets/missions in the requested region", () => {
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
    expect(aggregate.totalAssets).toBe(1);
    expect(aggregate.activeAssets).toBe(1);
    expect(aggregate.activeMissions).toBe(1);
  });

  it("property: no forbidden key ever appears regardless of raw input", () => {
    const forbiddenValueArb = fc.record({
      pilot_id: fc.string(),
      mission_id: fc.string(),
      mission_code: fc.string(),
      region: fc.constantFrom("WPA", "ATL", "", "UNKNOWN"),
      position: fc.record({ lat: fc.double(), lon: fc.double() }),
      patient: fc.record({ clinical_summary: fc.string() }),
      virs: fc.record({ narrative: fc.string() }),
      status: fc.constantFrom(
        "DISPATCHED",
        "ON_SCENE",
        "COMPLETED",
        "ABORTED",
      ),
    });

    fc.assert(
      fc.property(
        fc.array(forbiddenValueArb),
        fc.array(forbiddenValueArb),
        (assets, missions) => {
          const aggregate = toAggregateOperationalData(
            "WPA",
            assets as RawOperationalAsset[],
            missions as RawOperationalMission[],
          );
          const keys = collectKeys(aggregate);
          for (const forbidden of FORBIDDEN_KEYS) {
            if (keys.has(forbidden)) return false;
          }
          // Counts are non-negative and consistent.
          return (
            aggregate.activeAssets <= aggregate.totalAssets &&
            aggregate.totalAssets >= 0 &&
            aggregate.activeMissions >= 0
          );
        },
      ),
    );
  });
});
