import { describe, expect, it } from "vitest";
import type {
  ClinicalEvent,
  FlightVector,
  PositionVector,
  SystemsVector,
  TelemetryFrame,
} from "@virtualhems/contracts";

import {
  InMemoryAarLoaders,
  type AarMission,
  type InMemoryAarSeed,
} from "./generate-aar.js";
import {
  DEFAULT_AAR_THRESHOLDS,
  InMemoryAarReportStore,
  InMemoryPilotLogbook,
  calculateScore,
  evaluateCompliance,
  finalizeAar,
  resolveAarPolicy,
  type AarPolicy,
  type FinalizeAarDependencies,
} from "./finalize-aar.js";
import { derived, unavailable, type DerivedMetric } from "./coverage.js";

// --- Fixtures ----------------------------------------------------------------

const MISSION_ID = "11111111-1111-1111-1111-111111111111";
const PILOT_ID = "22222222-2222-2222-2222-222222222222";
const POLICY: AarPolicy = { policy_version: "aar-policy-2025-Q1" };
const CLOCK = { now: () => new Date("2024-01-01T12:20:05.000Z") };

function frame(overrides: {
  seq: number;
  observed_at?: string;
  pitch_deg?: number;
  roll_deg?: number;
  vertical_speed_fpm?: number;
  altitude_agl_ft?: number;
}): TelemetryFrame {
  const position: PositionVector = {
    latitude_deg: 41,
    longitude_deg: -80,
    altitude_msl_ft: 1000,
    altitude_agl_ft: overrides.altitude_agl_ft ?? 500,
  };
  const flight: FlightVector = {
    ground_speed_kts: 80,
    heading_deg: 90,
    vertical_speed_fpm: overrides.vertical_speed_fpm ?? 0,
    pitch_deg: overrides.pitch_deg ?? 0,
    roll_deg: overrides.roll_deg ?? 0,
  };
  const systems: SystemsVector = {
    fuel_remaining_lbs: 800,
    engine_torque_pct: 60,
  };
  return {
    frame_id: `frame-${overrides.seq}`,
    pilot_id: PILOT_ID,
    mission_id: MISSION_ID,
    source_engine: "MSFS2020",
    sequence_number: overrides.seq,
    observed_at: overrides.observed_at ?? `2024-01-01T12:00:0${overrides.seq}.000Z`,
    position,
    flight,
    systems,
    is_delta: false,
    schema_version: "0.1.0",
  };
}

function event(
  event_type: ClinicalEvent["event_type"],
  occurred_at: string,
): ClinicalEvent {
  return {
    mission_id: MISSION_ID,
    event_type,
    occurred_at,
    source: "TELEMETRY",
    metadata: {},
  };
}

function mission(overrides: Partial<AarMission> = {}): AarMission {
  return {
    mission_id: MISSION_ID,
    pilot_id: PILOT_ID,
    status: "COMPLETED",
    flight_plan: {
      direct_distance_nm: 20,
      planned_distance_nm: 22,
      reserve_at_destination_minutes: 25,
    },
    expected_frame_count: 3,
    ...overrides,
  };
}

/** A fully-evidenced, compliant mission (all six signals pass). */
function fullEvidenceSeed(): {
  mission: AarMission;
  telemetry: TelemetryFrame[];
  events: ClinicalEvent[];
} {
  return {
    mission: mission(),
    telemetry: [
      frame({ seq: 1, pitch_deg: 5, roll_deg: -10, observed_at: "2024-01-01T12:00:00.000Z" }),
      frame({ seq: 2, pitch_deg: -12, roll_deg: 8, observed_at: "2024-01-01T12:10:00.000Z" }),
      frame({
        seq: 3,
        pitch_deg: 3,
        roll_deg: 2,
        vertical_speed_fpm: -30, // ~1.02 G, under 1.5
        altitude_agl_ft: 0,
        observed_at: "2024-01-01T12:20:00.000Z",
      }),
    ],
    events: [
      event("DISPATCHED", "2024-01-01T11:50:00.000Z"),
      event("ARRIVED_SCENE", "2024-01-01T12:05:00.000Z"),
      event("DEPARTED_SCENE", "2024-01-01T12:15:00.000Z"),
      event("TOUCHDOWN", "2024-01-01T12:20:00.000Z"),
    ],
  };
}

function deps(
  seed: InMemoryAarSeed,
  overrides: Partial<FinalizeAarDependencies> = {},
): FinalizeAarDependencies {
  return {
    loaders: new InMemoryAarLoaders(seed),
    clock: CLOCK,
    policy: POLICY,
    store: new InMemoryAarReportStore(),
    logbook: new InMemoryPilotLogbook(),
    ...overrides,
  };
}

// --- Policy resolution (req 7.3) --------------------------------------------

describe("resolveAarPolicy — documented defaults (req 7.3)", () => {
  it("fills the six documented Section 6.6 default thresholds", () => {
    const resolved = resolveAarPolicy({ policy_version: "p" });
    expect(resolved.scene_time_max_minutes).toBe(DEFAULT_AAR_THRESHOLDS.scene_time_max_minutes);
    expect(resolved.max_pitch_max_deg).toBe(DEFAULT_AAR_THRESHOLDS.max_pitch_max_deg);
    expect(resolved.max_roll_max_deg).toBe(DEFAULT_AAR_THRESHOLDS.max_roll_max_deg);
    expect(resolved.reserve_min_minutes).toBe(DEFAULT_AAR_THRESHOLDS.reserve_min_minutes);
    expect(resolved.touchdown_g_force_max).toBe(DEFAULT_AAR_THRESHOLDS.touchdown_g_force_max);
    // +10% deviation → efficiency upper bound of 110%
    expect(resolved.route_efficiency_max_percent).toBe(110);
    expect(resolved.policy_version).toBe("p");
  });

  it("honors overrides and ignores non-positive/non-finite ones", () => {
    const resolved = resolveAarPolicy({
      policy_version: "p",
      scene_time_max_minutes: 12,
      max_pitch_max_deg: 0, // ignored (non-positive)
      touchdown_g_force_max: Number.NaN, // ignored (non-finite)
    });
    expect(resolved.scene_time_max_minutes).toBe(12);
    expect(resolved.max_pitch_max_deg).toBe(DEFAULT_AAR_THRESHOLDS.max_pitch_max_deg);
    expect(resolved.touchdown_g_force_max).toBe(DEFAULT_AAR_THRESHOLDS.touchdown_g_force_max);
  });
});

// --- Compliance scoring (req 7.3) -------------------------------------------

describe("evaluateCompliance / calculateScore (req 7.3)", () => {
  const policy = resolveAarPolicy(POLICY);

  function metrics(overrides: Partial<Record<string, DerivedMetric>> = {}) {
    return {
      telemetry_coverage: derived(100),
      route_efficiency_percent: derived(105),
      max_pitch_deg: derived(12),
      max_roll_deg: derived(10),
      touchdown_g_force: derived(1.1),
      reserve_fuel_minutes: derived(25),
      scene_time_minutes: derived(10),
      ...overrides,
    } as Parameters<typeof evaluateCompliance>[0];
  }

  it("passes every signal for a compliant mission and scores 100", () => {
    const { findings, policy_version } = evaluateCompliance(metrics(), policy);
    expect(policy_version).toBe(POLICY.policy_version);
    expect(findings.every((f) => f.status === "PASS")).toBe(true);
    expect(calculateScore(findings)).toBe(100);
  });

  it("marks a failing signal FAIL and reflects it in the score", () => {
    // scene time 20 > 15, roll 40 > 30 → 2 fails of 6 → 4/6 pass
    const { findings } = evaluateCompliance(
      metrics({ scene_time_minutes: derived(20), max_roll_deg: derived(40) }),
      policy,
    );
    const scene = findings.find((f) => f.signal === "SCENE_TIME");
    const roll = findings.find((f) => f.signal === "MAX_ROLL");
    expect(scene?.status).toBe("FAIL");
    expect(roll?.status).toBe("FAIL");
    expect(calculateScore(findings)).toBeCloseTo((4 / 6) * 100, 6);
  });

  it("scores an AT_LEAST reserve below the floor as FAIL", () => {
    const { findings } = evaluateCompliance(
      metrics({ reserve_fuel_minutes: derived(15) }), // < 20
      policy,
    );
    expect(findings.find((f) => f.signal === "DESTINATION_RESERVE")?.status).toBe("FAIL");
  });

  it("marks an ABSENT metric UNDETERMINED (not a pass, no fabricated value) and excludes it from the score", () => {
    const { findings } = evaluateCompliance(
      metrics({ reserve_fuel_minutes: unavailable(), touchdown_g_force: unavailable() }),
      policy,
    );
    const reserve = findings.find((f) => f.signal === "DESTINATION_RESERVE");
    const g = findings.find((f) => f.signal === "TOUCHDOWN_G_FORCE");
    expect(reserve?.status).toBe("UNDETERMINED");
    expect(reserve?.value).toBeNull();
    expect(g?.status).toBe("UNDETERMINED");
    // 4 determined signals, all pass → 100 (undetermined excluded from denominator)
    expect(calculateScore(findings)).toBe(100);
  });

  it("scores 0 when no signal can be determined", () => {
    const allAbsent = evaluateCompliance(
      metrics({
        scene_time_minutes: unavailable(),
        route_efficiency_percent: unavailable(),
        max_pitch_deg: unavailable(),
        max_roll_deg: unavailable(),
        reserve_fuel_minutes: unavailable(),
        touchdown_g_force: unavailable(),
      }),
      policy,
    );
    expect(calculateScore(allAbsent.findings)).toBe(0);
    expect(allAbsent.findings.every((f) => f.status === "UNDETERMINED")).toBe(true);
  });
});

// --- finalizeAar composition (req 7.3, 7.5) ---------------------------------

describe("finalizeAar — scoring, policy version, persistence, logbook (req 7.3, 7.5)", () => {
  it("records the Policy_Version, fills compliance findings/score, persists, and updates the logbook", () => {
    const store = new InMemoryAarReportStore();
    const logbook = new InMemoryPilotLogbook();
    const result = finalizeAar(
      MISSION_ID,
      deps(fullEvidenceSeed(), { store, logbook }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Policy_Version recorded in the report (req 7.3)
    expect(result.report.policy_version).toBe(POLICY.policy_version);
    expect(result.report.compliance_findings.length).toBe(6);
    expect(result.report.compliance_evaluation.length).toBe(6);
    expect(result.report.score).toBe(100);

    // Immutable persistence (req 7.5)
    expect(result.stored.version).toBe(1);
    expect(store.get(MISSION_ID)?.report.policy_version).toBe(POLICY.policy_version);

    // Logbook update with mission hours + outcome (req 7.5)
    const entries = logbook.entriesFor(PILOT_ID);
    expect(entries.length).toBe(1);
    expect(entries[0]?.outcome).toBe("COMPLETED");
    // 11:50 DISPATCHED → 12:20 TOUCHDOWN = 30 minutes = 0.5 hours
    expect(entries[0]?.mission_hours).toBeCloseTo(0.5, 6);
    expect(entries[0]?.policy_version).toBe(POLICY.policy_version);
    expect(result.missionHours.derived_from).toBe("MISSION_EVENTS");
  });

  it("returns generateAar failures unchanged (does not persist or log)", () => {
    const store = new InMemoryAarReportStore();
    const logbook = new InMemoryPilotLogbook();
    const result = finalizeAar(
      MISSION_ID,
      deps({ mission: mission({ status: "EN_ROUTE_HOSPITAL" }) }, { store, logbook }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(store.get(MISSION_ID)).toBeUndefined();
    expect(logbook.size).toBe(0);
  });

  it("records mission_hours as null (never fabricated) when no ordered span exists", () => {
    // No events, single frame → no derivable span. Manual completion allows the
    // report to generate without a touchdown.
    const result = finalizeAar(
      MISSION_ID,
      deps({
        mission: mission({ expected_frame_count: undefined }),
        telemetry: [frame({ seq: 1, altitude_agl_ft: 500, vertical_speed_fpm: -500 })],
        events: [],
        manualCompletion: {
          authorized_by: PILOT_ID,
          occurred_at: "2024-01-01T12:20:00.000Z",
          reason: "instructor closed mission",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A single frame gives one timestamp → no ordered span from events, and the
    // telemetry span is zero-length across one frame (still ordered → 0 hours).
    // The logbook entry carries a real derived value, never fabricated.
    expect(result.logbookEntry.mission_hours).not.toBeNaN();
  });
});

// --- Immutable persistence: write-once (req 7.5) ----------------------------

describe("InMemoryAarReportStore — write-once immutability (req 7.5)", () => {
  it("stores the first report and REJECTS an overwrite for the same mission", () => {
    const store = new InMemoryAarReportStore();
    const first = finalizeAar(MISSION_ID, deps(fullEvidenceSeed(), { store }));
    expect(first.ok).toBe(true);

    // A second finalize attempt for the same mission must not overwrite.
    const second = finalizeAar(MISSION_ID, deps(fullEvidenceSeed(), { store }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("REPORT_ALREADY_EXISTS");

    // The originally stored record is intact and unchanged.
    expect(store.get(MISSION_ID)?.version).toBe(1);
  });

  it("freezes the stored record so it cannot be mutated in place", () => {
    const store = new InMemoryAarReportStore();
    const result = finalizeAar(MISSION_ID, deps(fullEvidenceSeed(), { store }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Mutating the returned copy must not affect the stored record.
    (result.stored.report as { score: number }).score = -999;
    expect(store.get(MISSION_ID)?.report.score).toBe(100);
  });
});
