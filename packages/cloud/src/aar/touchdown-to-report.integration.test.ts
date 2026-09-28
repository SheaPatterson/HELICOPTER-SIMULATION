/**
 * Integration test — the full touchdown-to-report flow (task 14.4).
 *
 * This exercises the AAR engine END TO END, not a single function: a completed
 * mission is seeded with telemetry frames (including a touchdown frame), mission
 * events (DISPATCHED / ARRIVED_SCENE / DEPARTED_SCENE / TOUCHDOWN), and a flight
 * plan, then `finalizeAar` runs the whole design Section 6.6 procedure through
 * the REAL in-memory ports:
 *
 *   generateAar (metric derivation, no fabrication)          req 7.1, 7.2, 7.4
 *     → evaluateCompliance / calculateScore (Policy_Version)  req 7.3
 *     → InMemoryAarReportStore.persist (write-once immutable)  req 7.5
 *     → InMemoryPilotLogbook.append (hours + outcome + policy) req 7.5
 *
 * It asserts the report is generated with the derived metrics, that compliance
 * findings/score + Policy_Version are recorded, that the report is persisted
 * immutably (a second finalize is rejected and never overwrites), that the
 * logbook gains one entry with mission hours + outcome + Policy_Version, that
 * incomplete coverage surfaces as recorded limitations with no fabricated value
 * (req 7.4), and that the authorized manual-completion path (req 7.6) closes a
 * mission with no telemetry touchdown while marking the coverage limitation.
 * Timeliness (req 7.1) is checked by asserting the synchronous flow completes
 * far within the 30-second budget.
 *
 * Fixtures mirror the conventions in generate-aar.test.ts / finalize-aar.test.ts.
 */

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
  type ManualCompletionEvent,
} from "./generate-aar.js";
import {
  InMemoryAarReportStore,
  InMemoryPilotLogbook,
  finalizeAar,
  type AarPolicy,
  type FinalizeAarDependencies,
} from "./finalize-aar.js";

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

/**
 * A completed mission with a full evidence chain: DISPATCHED → ARRIVED_SCENE →
 * DEPARTED_SCENE → TOUCHDOWN, three telemetry frames (the last at the surface,
 * soft touchdown), and a flight plan. Every audit signal is compliant.
 */
function touchdownMissionSeed(): {
  mission: AarMission;
  telemetry: TelemetryFrame[];
  events: ClinicalEvent[];
} {
  return {
    mission: mission(),
    telemetry: [
      frame({ seq: 1, pitch_deg: 5, roll_deg: -10, observed_at: "2024-01-01T11:55:00.000Z" }),
      frame({ seq: 2, pitch_deg: -12, roll_deg: 8, observed_at: "2024-01-01T12:10:00.000Z" }),
      frame({
        seq: 3,
        pitch_deg: 3,
        roll_deg: 2,
        vertical_speed_fpm: -30, // ~1.02 G soft touchdown, under 1.5
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

// --- End-to-end: touchdown → generated, scored, persisted, logged ------------

describe("touchdown-to-report integration flow (req 7.1, 7.2, 7.3, 7.4, 7.5)", () => {
  it("generates, scores, persists immutably, and logs a report from a touchdown fixture", () => {
    const store = new InMemoryAarReportStore();
    const logbook = new InMemoryPilotLogbook();

    const result = finalizeAar(
      MISSION_ID,
      deps(touchdownMissionSeed(), { store, logbook }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // --- Metrics derived solely from recorded evidence (req 7.2) ------------
    const { report } = result;
    expect(report.mission_id).toBe(MISSION_ID);
    // coverage = 3 received / 3 expected = 100%
    expect(report.telemetry_coverage).toBe(100);
    // route efficiency = 22 / 20 * 100 = 110%
    expect(report.route_efficiency_percent).toBeCloseTo(110, 6);
    // max |pitch| across {5, -12, 3} = 12
    expect(report.max_pitch_deg).toBe(12);
    // max |roll| across {-10, 8, 2} = 10
    expect(report.max_roll_deg).toBe(10);
    // reserve straight from the flight plan
    expect(report.reserve_fuel_minutes).toBe(25);
    // scene time = 12:15 - 12:05 = 10 minutes
    expect(report.scene_time_minutes).toBe(10);
    // soft touchdown G-force from -30 fpm: 1 + (30/60)/32.174
    expect(report.touchdown_g_force).toBeCloseTo(1 + 0.5 / 32.174, 6);
    // full evidence → no coverage limitations (req 7.4)
    expect(report.coverage_limitations).toEqual([]);

    // --- Compliance findings + score + Policy_Version (req 7.3) -------------
    expect(report.policy_version).toBe(POLICY.policy_version);
    expect(report.compliance_findings.length).toBe(6);
    expect(report.compliance_evaluation.length).toBe(6);
    // every signal compliant → score 100
    expect(report.score).toBe(100);
    expect(result.findings.every((f) => f.status === "PASS")).toBe(true);

    // --- Immutable persistence (req 7.5) ------------------------------------
    expect(result.stored.version).toBe(1);
    const persisted = store.get(MISSION_ID);
    expect(persisted?.report.policy_version).toBe(POLICY.policy_version);
    expect(persisted?.report.score).toBe(100);

    // --- Pilot logbook update: hours + outcome + Policy_Version (req 7.5) ---
    const entries = logbook.entriesFor(PILOT_ID);
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(entry?.mission_id).toBe(MISSION_ID);
    expect(entry?.outcome).toBe("COMPLETED");
    // DISPATCHED 11:50 → TOUCHDOWN 12:20 = 30 minutes = 0.5 hours
    expect(entry?.mission_hours).toBeCloseTo(0.5, 6);
    expect(entry?.policy_version).toBe(POLICY.policy_version);
    expect(entry?.score).toBe(100);
    expect(result.missionHours.derived_from).toBe("MISSION_EVENTS");
  });

  it("completes the synchronous touchdown-to-report flow well within the 30s budget (req 7.1)", () => {
    const start = Date.now();
    const result = finalizeAar(MISSION_ID, deps(touchdownMissionSeed()));
    expect(result.ok).toBe(true);
    expect(Date.now() - start).toBeLessThan(30_000);
  });

  it("persists write-once: a second finalize for the same mission is rejected and the record is unchanged (req 7.5)", () => {
    const store = new InMemoryAarReportStore();
    const logbook = new InMemoryPilotLogbook();

    const first = finalizeAar(
      MISSION_ID,
      deps(touchdownMissionSeed(), { store, logbook }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstScore = first.report.score;

    // A second run through the whole flow must NOT overwrite the stored report.
    const second = finalizeAar(
      MISSION_ID,
      deps(touchdownMissionSeed(), { store, logbook }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("REPORT_ALREADY_EXISTS");

    // The original immutable record is intact.
    expect(store.get(MISSION_ID)?.version).toBe(1);
    expect(store.get(MISSION_ID)?.report.score).toBe(firstScore);
    // The rejected finalize appended no second logbook entry.
    expect(logbook.entriesFor(PILOT_ID).length).toBe(1);
  });
});

// --- Incomplete-coverage behavior end to end (req 7.4, 7.4a) -----------------

describe("touchdown-to-report with incomplete coverage (req 7.4, 7.4a)", () => {
  it("records coverage limitations, leaves metrics ABSENT (no fabrication), and marks affected signals UNDETERMINED", () => {
    const store = new InMemoryAarReportStore();
    const logbook = new InMemoryPilotLogbook();

    // Fewer frames than expected AND no flight plan: coverage < 100%, and route
    // efficiency + reserve cannot be derived.
    const seed = touchdownMissionSeed();
    const result = finalizeAar(
      MISSION_ID,
      deps(
        {
          ...seed,
          mission: mission({ expected_frame_count: 6, flight_plan: undefined }),
        },
        { store, logbook },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { report } = result;

    // Coverage derived below 100% with a limitation recorded (req 7.4).
    expect(report.telemetry_coverage).toBe(50); // 3 of 6
    expect(
      report.coverage_limitations.some((l) => l.metric === "TELEMETRY_COVERAGE"),
    ).toBe(true);

    // Missing flight plan → route efficiency & reserve ABSENT, never fabricated
    // (req 7.4a); the report carries null, not a stand-in number.
    expect(report.route_efficiency_percent).toBeNull();
    expect(report.reserve_fuel_minutes).toBeNull();
    const flightPlanLimits = report.coverage_limitations
      .filter((l) => l.source === "FLIGHT_PLAN")
      .map((l) => l.metric);
    expect(flightPlanLimits).toContain("ROUTE_EFFICIENCY_PERCENT");
    expect(flightPlanLimits).toContain("RESERVE_FUEL_MINUTES");

    // The absent metrics are scored UNDETERMINED (not passed, not fabricated).
    const routeFinding = result.findings.find((f) => f.signal === "ROUTE_DEVIATION");
    const reserveFinding = result.findings.find((f) => f.signal === "DESTINATION_RESERVE");
    expect(routeFinding?.status).toBe("UNDETERMINED");
    expect(routeFinding?.value).toBeNull();
    expect(reserveFinding?.status).toBe("UNDETERMINED");

    // The report is still generated, persisted, and logged despite the gaps.
    expect(store.get(MISSION_ID)?.version).toBe(1);
    expect(logbook.entriesFor(PILOT_ID).length).toBe(1);
  });
});

// --- Manual-completion path end to end (req 7.6) -----------------------------

describe("manual-completion touchdown-to-report flow (req 7.6)", () => {
  it("closes a mission with no telemetry touchdown, marks the coverage limitation, and still generates/persists/logs", () => {
    const store = new InMemoryAarReportStore();
    const logbook = new InMemoryPilotLogbook();

    const manualCompletion: ManualCompletionEvent = {
      authorized_by: PILOT_ID,
      occurred_at: "2024-01-01T12:20:00.000Z",
      reason: "instructor closed mission; sim exited before touchdown telemetry",
    };

    // Airborne throughout (no touchdown frame), no TOUCHDOWN event → the flow
    // proceeds only via the authorized manual completion event.
    const result = finalizeAar(
      MISSION_ID,
      deps(
        {
          mission: mission(),
          telemetry: [
            frame({
              seq: 1,
              altitude_agl_ft: 500,
              vertical_speed_fpm: -500,
              observed_at: "2024-01-01T11:55:00.000Z",
            }),
            frame({
              seq: 2,
              altitude_agl_ft: 400,
              vertical_speed_fpm: -400,
              observed_at: "2024-01-01T12:18:00.000Z",
            }),
          ],
          events: [
            event("DISPATCHED", "2024-01-01T11:50:00.000Z"),
            event("ARRIVED_SCENE", "2024-01-01T12:05:00.000Z"),
            event("DEPARTED_SCENE", "2024-01-01T12:15:00.000Z"),
          ],
          manualCompletion,
        },
        { store, logbook },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { report } = result;

    // Manual completion marks the telemetry-coverage limitation (req 7.6).
    const covLimit = report.coverage_limitations.find(
      (l) => l.metric === "TELEMETRY_COVERAGE" && l.source === "TOUCHDOWN_DETECTION",
    );
    expect(covLimit).toBeDefined();

    // No touchdown → G-force is ABSENT, never fabricated (req 7.4a).
    expect(report.touchdown_g_force).toBeUndefined();
    const gFinding = result.findings.find((f) => f.signal === "TOUCHDOWN_G_FORCE");
    expect(gFinding?.status).toBe("UNDETERMINED");

    // The report is still generated, persisted immutably, and logged (req 7.5).
    expect(report.policy_version).toBe(POLICY.policy_version);
    expect(store.get(MISSION_ID)?.version).toBe(1);
    const entries = logbook.entriesFor(PILOT_ID);
    expect(entries.length).toBe(1);
    expect(entries[0]?.outcome).toBe("COMPLETED");
    expect(entries[0]?.policy_version).toBe(POLICY.policy_version);
  });
});
