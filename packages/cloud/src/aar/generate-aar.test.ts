import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  ClinicalEvent,
  FlightVector,
  PositionVector,
  SystemsVector,
  TelemetryFrame,
} from "@virtualhems/contracts";

import {
  generateAar,
  detectFabrication,
  InMemoryAarLoaders,
  type AarMission,
  type ManualCompletionEvent,
} from "./generate-aar.js";
import { isDerived } from "./coverage.js";

// --- Fixtures ----------------------------------------------------------------

const MISSION_ID = "11111111-1111-1111-1111-111111111111";
const PILOT_ID = "22222222-2222-2222-2222-222222222222";

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

/** A fully-evidenced mission: 3 frames + touchdown + scene events. */
function fullEvidenceSeed(): {
  mission: AarMission;
  telemetry: TelemetryFrame[];
  events: ClinicalEvent[];
} {
  return {
    mission: mission(),
    telemetry: [
      frame({ seq: 1, pitch_deg: 5, roll_deg: -10 }),
      frame({ seq: 2, pitch_deg: -12, roll_deg: 8 }),
      frame({
        seq: 3,
        pitch_deg: 3,
        roll_deg: 2,
        vertical_speed_fpm: -120,
        altitude_agl_ft: 0,
        observed_at: "2024-01-01T12:20:00.000Z",
      }),
    ],
    events: [
      event("ARRIVED_SCENE", "2024-01-01T12:05:00.000Z"),
      event("DEPARTED_SCENE", "2024-01-01T12:15:00.000Z"),
      event("TOUCHDOWN", "2024-01-01T12:20:00.000Z"),
    ],
  };
}

function run(seed: {
  mission: AarMission;
  telemetry?: TelemetryFrame[];
  events?: ClinicalEvent[];
  manualCompletion?: ManualCompletionEvent;
}) {
  return generateAar(MISSION_ID, {
    loaders: new InMemoryAarLoaders(seed),
    clock: { now: () => new Date("2024-01-01T12:20:05.000Z") },
  });
}

// --- Happy path: every metric derived from evidence (req 7.2) ----------------

describe("generateAar — metric derivation (req 7.2)", () => {
  it("derives every metric solely from recorded telemetry and events", () => {
    const result = run(fullEvidenceSeed());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { report, metrics } = result;

    // coverage = 3 received / 3 expected = 100%
    expect(report.telemetry_coverage).toBe(100);
    // route efficiency = 22 / 20 * 100 = 110%
    expect(report.route_efficiency_percent).toBeCloseTo(110, 6);
    // max |pitch| across {5, -12, 3} = 12
    expect(report.max_pitch_deg).toBe(12);
    // max |roll| across {-10, 8, 2} = 10
    expect(report.max_roll_deg).toBe(10);
    // reserve straight from flight plan
    expect(report.reserve_fuel_minutes).toBe(25);
    // scene time = 12:15 - 12:05 = 10 minutes
    expect(report.scene_time_minutes).toBe(10);
    // touchdown g-force from -120 fpm descent: 1 + (120/60)/32.174
    expect(report.touchdown_g_force).toBeCloseTo(1 + 2 / 32.174, 6);

    for (const m of Object.values(metrics)) {
      expect(m.status).toBe("DERIVED");
    }
    expect(report.coverage_limitations).toEqual([]);
    expect(detectFabrication(report, metrics)).toBeUndefined();
  });

  it("generates well within the 30s budget (req 7.1)", () => {
    const start = Date.now();
    const result = run(fullEvidenceSeed());
    expect(result.ok).toBe(true);
    expect(Date.now() - start).toBeLessThan(30_000);
  });
});

// --- No-fabrication + coverage limitations (req 7.4, 7.4a) -------------------

describe("generateAar — no fabrication when evidence is incomplete (req 7.4/7.4a)", () => {
  it("leaves route efficiency & reserve ABSENT and records limitations when the flight plan is missing", () => {
    const seed = fullEvidenceSeed();
    const result = run({ ...seed, mission: mission({ flight_plan: undefined }) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.route_efficiency_percent).toBeNull();
    expect(result.report.reserve_fuel_minutes).toBeNull();
    expect(result.metrics.route_efficiency_percent.status).toBe("UNAVAILABLE");
    expect(result.metrics.reserve_fuel_minutes.status).toBe("UNAVAILABLE");

    const sources = result.limitations
      .filter((l) => l.source === "FLIGHT_PLAN")
      .map((l) => l.metric);
    expect(sources).toContain("ROUTE_EFFICIENCY_PERCENT");
    expect(sources).toContain("RESERVE_FUEL_MINUTES");
    expect(detectFabrication(result.report, result.metrics)).toBeUndefined();
  });

  it("records a coverage limitation and reports <100% when frames are missing (req 7.4)", () => {
    const seed = fullEvidenceSeed();
    const result = run({
      ...seed,
      mission: mission({ expected_frame_count: 6 }), // only 3 received
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.telemetry_coverage).toBe(50);
    expect(
      result.limitations.some((l) => l.metric === "TELEMETRY_COVERAGE"),
    ).toBe(true);
  });

  it("leaves telemetry coverage ABSENT when the expected frame count is unknown (no assumed 100%)", () => {
    const seed = fullEvidenceSeed();
    const result = run({
      ...seed,
      mission: mission({ expected_frame_count: undefined }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.telemetry_coverage).toBeNull();
    expect(result.metrics.telemetry_coverage.status).toBe("UNAVAILABLE");
  });

  it("leaves scene time ABSENT when scene events are missing", () => {
    const seed = fullEvidenceSeed();
    const result = run({
      ...seed,
      events: [event("TOUCHDOWN", "2024-01-01T12:20:00.000Z")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.scene_time_minutes).toBeNull();
    expect(
      result.limitations.some(
        (l) => l.metric === "SCENE_TIME_MINUTES" && l.source === "MISSION_EVENTS",
      ),
    ).toBe(true);
  });
});

// --- Touchdown detection + manual completion (req 7.6) -----------------------

describe("generateAar — touchdown detection & manual completion (req 7.6)", () => {
  it("refuses to generate when no touchdown is detected and no manual completion exists", () => {
    const seed = fullEvidenceSeed();
    const result = run({
      ...seed,
      telemetry: [frame({ seq: 1, altitude_agl_ft: 500, vertical_speed_fpm: -500 })],
      events: [
        event("ARRIVED_SCENE", "2024-01-01T12:05:00.000Z"),
        event("DEPARTED_SCENE", "2024-01-01T12:15:00.000Z"),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_TOUCHDOWN_WITHOUT_MANUAL_COMPLETION");
  });

  it("generates via authorized manual completion and marks the telemetry-coverage limitation", () => {
    const seed = fullEvidenceSeed();
    const manualCompletion: ManualCompletionEvent = {
      authorized_by: PILOT_ID,
      occurred_at: "2024-01-01T12:20:00.000Z",
      reason: "instructor closed mission; sim exited before touchdown telemetry",
    };
    const result = run({
      ...seed,
      telemetry: [frame({ seq: 1, altitude_agl_ft: 500, vertical_speed_fpm: -500 })],
      events: [
        event("ARRIVED_SCENE", "2024-01-01T12:05:00.000Z"),
        event("DEPARTED_SCENE", "2024-01-01T12:15:00.000Z"),
      ],
      manualCompletion,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // touchdown G-force is ABSENT (no touchdown), never fabricated
    expect(result.report.touchdown_g_force).toBeUndefined();
    expect(result.metrics.touchdown_g_force.status).toBe("UNAVAILABLE");

    // telemetry-coverage limitation is marked with the manual-completion cause
    const covLimit = result.limitations.find(
      (l) => l.metric === "TELEMETRY_COVERAGE" && l.source === "TOUCHDOWN_DETECTION",
    );
    expect(covLimit).toBeDefined();
    expect(result.touchdown.detected).toBe(false);
  });

  it("rejects a non-completed mission", () => {
    const seed = fullEvidenceSeed();
    const result = run({ ...seed, mission: mission({ status: "EN_ROUTE_HOSPITAL" }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSION_NOT_COMPLETED");
  });
});

// --- No-fabrication guard (detectFabrication) --------------------------------

describe("detectFabrication guard (req 7.4a)", () => {
  it("flags a fabricated number on an unavailable metric", () => {
    const result = run({
      ...fullEvidenceSeed(),
      mission: mission({ flight_plan: undefined }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Tamper: inject a fabricated value where the metric is UNAVAILABLE.
    const tampered = { ...result.report, reserve_fuel_minutes: 20 };
    expect(detectFabrication(tampered, result.metrics)).toContain(
      "reserve_fuel_minutes",
    );
  });

  it("flags a report number that does not match its derived value", () => {
    const result = run(fullEvidenceSeed());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tampered = { ...result.report, max_pitch_deg: 999 };
    expect(detectFabrication(tampered, result.metrics)).toContain("max_pitch_deg");
  });
});

// --- Property: no-fabrication holds across arbitrary evidence (req 7.4a) ------
// Validates: Requirements 7.4a

describe("property: no reported metric is ever fabricated (req 7.4a)", () => {
  it("every present numeric metric equals its derived value; absent metrics carry no number", () => {
    const angle = fc.double({ min: -180, max: 180, noNaN: true });
    const frameArb = fc.record({
      seq: fc.integer({ min: 1, max: 10_000 }),
      pitch_deg: angle,
      roll_deg: angle,
      vertical_speed_fpm: fc.double({ min: -2000, max: 2000, noNaN: true }),
      altitude_agl_ft: fc.double({ min: 0, max: 5000, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.array(frameArb, { maxLength: 12 }),
        fc.boolean(), // include a touchdown event?
        fc.boolean(), // include scene events?
        fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }), // expected count
        fc.option(
          fc.record({
            direct: fc.double({ min: 1, max: 200, noNaN: true }),
            planned: fc.double({ min: 0, max: 400, noNaN: true }),
            reserve: fc.double({ min: 0, max: 120, noNaN: true }),
          }),
          { nil: undefined },
        ),
        (frameSpecs, hasTouchdown, hasScene, expectedCount, fp) => {
          const telemetry = frameSpecs.map((f, i) =>
            frame({
              seq: f.seq + i,
              pitch_deg: f.pitch_deg,
              roll_deg: f.roll_deg,
              vertical_speed_fpm: f.vertical_speed_fpm,
              altitude_agl_ft: f.altitude_agl_ft,
              observed_at: `2024-01-01T12:${String(10 + (i % 40)).padStart(2, "0")}:00.000Z`,
            }),
          );
          const events: ClinicalEvent[] = [];
          if (hasScene) {
            events.push(event("ARRIVED_SCENE", "2024-01-01T12:05:00.000Z"));
            events.push(event("DEPARTED_SCENE", "2024-01-01T12:15:00.000Z"));
          }
          if (hasTouchdown) {
            events.push(event("TOUCHDOWN", "2024-01-01T12:20:00.000Z"));
          }

          const seededMission = mission({
            expected_frame_count: expectedCount,
            flight_plan: fp
              ? {
                  direct_distance_nm: fp.direct,
                  planned_distance_nm: fp.planned,
                  reserve_at_destination_minutes: fp.reserve,
                }
              : undefined,
          });

          // Always provide a manual completion so generation is allowed even
          // when no touchdown is detected (keeps the property focused on
          // no-fabrication rather than the touchdown gate).
          const manualCompletion: ManualCompletionEvent = {
            authorized_by: PILOT_ID,
            occurred_at: "2024-01-01T12:20:00.000Z",
            reason: "property test",
          };

          const result = generateAar(MISSION_ID, {
            loaders: new InMemoryAarLoaders({
              mission: seededMission,
              telemetry,
              events,
              manualCompletion,
            }),
            clock: { now: () => new Date("2024-01-01T12:20:05.000Z") },
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // The engine's own guard must never fire on legitimately generated
          // reports, and every present number must be a finite derived value.
          expect(detectFabrication(result.report, result.metrics)).toBeUndefined();

          for (const [key, metric] of Object.entries(result.metrics)) {
            if (isDerived(metric)) {
              expect(Number.isFinite(metric.value)).toBe(true);
            } else {
              // Absent metric: the flattened report must not carry a number.
              const reported = (result.report as Record<string, unknown>)[key];
              expect(typeof reported === "number").toBe(false);
            }
          }
        },
      ),
    );
  });
});
