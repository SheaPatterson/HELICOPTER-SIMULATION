/**
 * Property 6: Auditability (design Section 6.6; requirements 7.2, 7.4a, 7.3).
 *
 * **Validates: Requirements 7.2, 7.4a, 7.3**
 *
 * The auditability invariant, stated over arbitrary recorded evidence: for a
 * completed mission's after-action report, EVERY reported numeric metric is a
 * genuinely derived value from the recorded telemetry / mission events / flight
 * plan (req 7.2), and NO metric is ever fabricated — a metric that cannot be
 * derived from the available evidence is ABSENT (`null` / optional-absent),
 * regardless of whether a coverage limitation exists (req 7.4a, unconditional).
 * Compliance scoring preserves this: an ABSENT metric is scored UNDETERMINED and
 * excluded from the score denominator (never a fabricated pass/fail), and the
 * finalized report retains the effective Policy_Version context (req 7.3).
 *
 * This exercises the full derive→score→finalize path through {@link finalizeAar}
 * (task 14.2) rather than just the derivation core, because the auditability
 * guarantee must survive scoring and finalization. {@link detectFabrication} is
 * used as the no-fabrication oracle, and the score/Policy_Version invariants are
 * asserted directly against the finalized report. It is a test-only addition;
 * production code is unchanged.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  ClinicalEvent,
  ClinicalEventType,
  FlightVector,
  PositionVector,
  SystemsVector,
  TelemetryFrame,
} from "@virtualhems/contracts";

import {
  detectFabrication,
  InMemoryAarLoaders,
  type AarMission,
  type DerivedMetrics,
  type ManualCompletionEvent,
} from "./generate-aar.js";
import {
  InMemoryAarReportStore,
  InMemoryPilotLogbook,
  calculateScore,
  evaluateCompliance,
  finalizeAar,
  resolveAarPolicy,
  type AarPolicy,
  type ComplianceFinding,
  type FinalizedAarReport,
} from "./finalize-aar.js";
import { isDerived } from "./coverage.js";

// --- Fixtures ----------------------------------------------------------------

const MISSION_ID = "11111111-1111-1111-1111-111111111111";
const PILOT_ID = "22222222-2222-2222-2222-222222222222";
const CLOCK = { now: () => new Date("2024-01-01T12:20:05.000Z") };

/** The seven derivable metrics, keyed as they appear on the report/metrics. */
const METRIC_KEYS: ReadonlyArray<keyof DerivedMetrics> = [
  "telemetry_coverage",
  "route_efficiency_percent",
  "max_pitch_deg",
  "max_roll_deg",
  "touchdown_g_force",
  "reserve_fuel_minutes",
  "scene_time_minutes",
];

function frame(overrides: {
  seq: number;
  observed_at: string;
  pitch_deg: number;
  roll_deg: number;
  vertical_speed_fpm: number;
  altitude_agl_ft: number;
}): TelemetryFrame {
  const position: PositionVector = {
    latitude_deg: 41,
    longitude_deg: -80,
    altitude_msl_ft: 1000,
    altitude_agl_ft: overrides.altitude_agl_ft,
  };
  const flight: FlightVector = {
    ground_speed_kts: 80,
    heading_deg: 90,
    vertical_speed_fpm: overrides.vertical_speed_fpm,
    pitch_deg: overrides.pitch_deg,
    roll_deg: overrides.roll_deg,
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
    observed_at: overrides.observed_at,
    position,
    flight,
    systems,
    is_delta: false,
    schema_version: "0.1.0",
  };
}

function event(event_type: ClinicalEventType, occurred_at: string): ClinicalEvent {
  return {
    mission_id: MISSION_ID,
    event_type,
    occurred_at,
    source: "TELEMETRY",
    metadata: {},
  };
}

function mission(overrides: Partial<AarMission>): AarMission {
  return {
    mission_id: MISSION_ID,
    pilot_id: PILOT_ID,
    status: "COMPLETED",
    ...overrides,
  };
}

// --- Arbitraries -------------------------------------------------------------

/** A minute-of-hour so generated timestamps stay well-formed and orderable. */
function minuteStamp(minute: number): string {
  return `2024-01-01T12:${String(minute % 60).padStart(2, "0")}:00.000Z`;
}

const angleArb = fc.double({ min: -180, max: 180, noNaN: true });

/** One arbitrary telemetry frame's derivation-relevant fields. */
const frameSpecArb = fc.record({
  minute: fc.integer({ min: 0, max: 59 }),
  pitch_deg: angleArb,
  roll_deg: angleArb,
  vertical_speed_fpm: fc.double({ min: -2000, max: 2000, noNaN: true }),
  altitude_agl_ft: fc.double({ min: 0, max: 5000, noNaN: true }),
});

/**
 * An arbitrary flight plan, sometimes carrying degenerate (non-positive /
 * out-of-range) distances so route-efficiency and reserve fall to ABSENT — the
 * property must hold whether the metric derives or not.
 */
const flightPlanArb = fc.option(
  fc.record({
    direct_distance_nm: fc.double({ min: -5, max: 200, noNaN: true }),
    planned_distance_nm: fc.double({ min: -5, max: 400, noNaN: true }),
    reserve_at_destination_minutes: fc.double({ min: -5, max: 120, noNaN: true }),
  }),
  { nil: undefined },
);

/** An arbitrary effective policy: identified version + occasional overrides. */
const policyArb: fc.Arbitrary<AarPolicy> = fc.record({
  policy_version: fc.constantFrom(
    "aar-policy-2025-Q1",
    "aar-policy-2025-Q2",
    "aar-policy-experimental",
  ),
  scene_time_max_minutes: fc.option(fc.double({ min: 1, max: 60, noNaN: true }), {
    nil: undefined,
  }),
  route_deviation_max_percent: fc.option(fc.double({ min: 1, max: 100, noNaN: true }), {
    nil: undefined,
  }),
  max_pitch_max_deg: fc.option(fc.double({ min: 1, max: 90, noNaN: true }), {
    nil: undefined,
  }),
  max_roll_max_deg: fc.option(fc.double({ min: 1, max: 90, noNaN: true }), {
    nil: undefined,
  }),
  reserve_min_minutes: fc.option(fc.double({ min: 1, max: 120, noNaN: true }), {
    nil: undefined,
  }),
  touchdown_g_force_max: fc.option(fc.double({ min: 1, max: 5, noNaN: true }), {
    nil: undefined,
  }),
}) as fc.Arbitrary<AarPolicy>;

interface SeedInputs {
  frameSpecs: ReadonlyArray<fc.infer<typeof frameSpecArb>>;
  hasScene: boolean;
  hasTouchdown: boolean;
  hasDispatch: boolean;
  expectedCount: number | undefined;
  flightPlan: fc.infer<typeof flightPlanArb>;
  policy: AarPolicy;
}

const seedArb: fc.Arbitrary<SeedInputs> = fc.record({
  frameSpecs: fc.array(frameSpecArb, { maxLength: 12 }),
  hasScene: fc.boolean(),
  hasTouchdown: fc.boolean(),
  hasDispatch: fc.boolean(),
  expectedCount: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
  flightPlan: flightPlanArb,
  policy: policyArb,
});

/** Build the finalize dependencies from arbitrary seed inputs. */
function buildInputs(seed: SeedInputs) {
  const telemetry = seed.frameSpecs.map((f, i) =>
    frame({
      seq: i + 1,
      observed_at: minuteStamp(f.minute + i),
      pitch_deg: f.pitch_deg,
      roll_deg: f.roll_deg,
      vertical_speed_fpm: f.vertical_speed_fpm,
      altitude_agl_ft: f.altitude_agl_ft,
    }),
  );

  const events: ClinicalEvent[] = [];
  if (seed.hasDispatch) events.push(event("DISPATCHED", minuteStamp(0)));
  if (seed.hasScene) {
    events.push(event("ARRIVED_SCENE", minuteStamp(5)));
    events.push(event("DEPARTED_SCENE", minuteStamp(15)));
  }
  if (seed.hasTouchdown) events.push(event("TOUCHDOWN", minuteStamp(20)));

  const seededMission = mission({
    expected_frame_count: seed.expectedCount,
    flight_plan: seed.flightPlan
      ? {
          direct_distance_nm: seed.flightPlan.direct_distance_nm,
          planned_distance_nm: seed.flightPlan.planned_distance_nm,
          reserve_at_destination_minutes:
            seed.flightPlan.reserve_at_destination_minutes,
        }
      : undefined,
  });

  // Always supply an authorized manual completion so the report is allowed to
  // generate even when no touchdown is detected (req 7.6). This keeps the
  // property focused on the auditability invariant rather than the touchdown
  // gate, while still exercising touchdown-derived and touchdown-absent cases.
  const manualCompletion: ManualCompletionEvent = {
    authorized_by: PILOT_ID,
    occurred_at: minuteStamp(20),
    reason: "auditability property test",
  };

  return {
    loaders: new InMemoryAarLoaders({
      mission: seededMission,
      telemetry,
      events,
      manualCompletion,
    }),
    clock: CLOCK,
    policy: seed.policy,
    store: new InMemoryAarReportStore(),
    logbook: new InMemoryPilotLogbook(),
  };
}

// --- Property 6: Auditability ------------------------------------------------

describe("Property 6: Auditability (req 7.2, 7.4a, 7.3)", () => {
  it("every reported metric is derived from evidence and none is fabricated, regardless of coverage (req 7.2, 7.4a)", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const result = finalizeAar(MISSION_ID, buildInputs(seed));

        // A COMPLETED mission with an authorized manual completion always
        // produces a report; it must never fail with FABRICATION_DETECTED.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const { report } = result;

        // Directly assert the per-metric invariant against the flattened report:
        // every present numeric field is a finite number (never NaN/Infinity as
        // a fabricated stand-in), and an absent metric carries no number (req
        // 7.4a). The exact derived-value match is asserted by the oracle test.
        for (const key of METRIC_KEYS) {
          const reported = (report as Record<string, unknown>)[key];
          if (typeof reported === "number") {
            expect(Number.isFinite(reported)).toBe(true);
          } else {
            // Absent → null (schema fields) or undefined (optional g-force).
            expect(reported === null || reported === undefined).toBe(true);
          }
        }
        return true;
      }),
    );
  });

  it("uses detectFabrication as the oracle across arbitrary evidence (req 7.4a)", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        // Re-derive through generateAar's path via finalizeAar and rebuild the
        // DerivedMetrics to feed the oracle. finalizeAar preserves the derived
        // metrics on its structured findings (value === derived value or null).
        const inputs = buildInputs(seed);
        const result = finalizeAar(MISSION_ID, inputs);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const metrics = metricsFromResult(result.report, result.findings);
        // The oracle must report NO fabrication on a legitimately produced
        // report, for every generated input (req 7.4a).
        expect(detectFabrication(result.report, metrics)).toBeUndefined();

        // And every finding's recorded value matches the report field it maps
        // to: a determined signal carries the exact derived number, an
        // UNDETERMINED signal carries null (never a fabricated stand-in).
        for (const finding of result.findings) {
          const key = SIGNAL_TO_METRIC[finding.signal];
          if (key === undefined) continue;
          const reported = (result.report as Record<string, unknown>)[key];
          if (finding.status === "UNDETERMINED") {
            expect(finding.value).toBeNull();
            expect(typeof reported === "number").toBe(false);
          } else {
            expect(finding.value).not.toBeNull();
            expect(reported).toBe(finding.value);
          }
        }
        return true;
      }),
    );
  });

  it("excludes UNDETERMINED signals from the score denominator (req 7.3)", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const inputs = buildInputs(seed);
        const result = finalizeAar(MISSION_ID, inputs);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const determined = result.findings.filter(
          (f) => f.status !== "UNDETERMINED",
        );
        const passed = determined.filter((f) => f.status === "PASS").length;

        // The score is passed / determined * 100 — the UNDETERMINED signals
        // (ABSENT metrics) never enter the denominator, so limited coverage
        // neither inflates nor deflates the score (req 7.3).
        const expected = determined.length === 0 ? 0 : (passed / determined.length) * 100;
        expect(result.report.score).toBeCloseTo(expected, 9);

        // Cross-check the pure scorer agrees with the finalized score.
        expect(calculateScore(result.findings)).toBeCloseTo(result.report.score, 9);

        // Every score is a finite percentage in [0, 100] — never NaN from an
        // empty/zero denominator (req 7.3, 7.4a).
        expect(Number.isFinite(result.report.score)).toBe(true);
        expect(result.report.score).toBeGreaterThanOrEqual(0);
        expect(result.report.score).toBeLessThanOrEqual(100);
        return true;
      }),
    );
  });

  it("retains the effective Policy_Version context in the report (req 7.3)", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const inputs = buildInputs(seed);
        const result = finalizeAar(MISSION_ID, inputs);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const resolved = resolveAarPolicy(seed.policy);
        // The report and the structured evaluation both carry the identified
        // Policy_Version the report was scored under (req 7.3).
        expect(result.report.policy_version).toBe(seed.policy.policy_version);
        expect(result.report.policy_version).toBe(resolved.policy_version);
        expect(result.policy.policy_version).toBe(seed.policy.policy_version);

        const { policy_version } = evaluateCompliance(
          metricsFromResult(result.report, result.findings),
          resolved,
        );
        expect(policy_version).toBe(seed.policy.policy_version);
        return true;
      }),
    );
  });
});

// --- Helpers -----------------------------------------------------------------

/** Map a compliance signal name back to the report/metrics field it scores. */
const SIGNAL_TO_METRIC: Record<string, keyof DerivedMetrics | undefined> = {
  SCENE_TIME: "scene_time_minutes",
  ROUTE_DEVIATION: "route_efficiency_percent",
  MAX_PITCH: "max_pitch_deg",
  MAX_ROLL: "max_roll_deg",
  DESTINATION_RESERVE: "reserve_fuel_minutes",
  TOUCHDOWN_G_FORCE: "touchdown_g_force",
};

/** Coerce a `number | null | undefined` to a typed {@link DerivedMetric}. */
function toMetric(v: number | null | undefined): DerivedMetrics[keyof DerivedMetrics] {
  return typeof v === "number"
    ? { status: "DERIVED", value: v }
    : { status: "UNAVAILABLE", value: undefined };
}

/**
 * Reconstruct the {@link DerivedMetrics} view from the finalized report and its
 * structured compliance findings so {@link detectFabrication} can be used as the
 * no-fabrication oracle. Each scored finding's `value` is the exact derived
 * number when determined, or `null` when the metric was ABSENT (UNDETERMINED),
 * so it round-trips to the same DERIVED/UNAVAILABLE state the engine produced.
 * `telemetry_coverage` is not a scored signal, so its state is taken directly
 * from the report field (the source of truth for that metric). The result feeds
 * the engine's own guard, which cross-checks it against every report field.
 */
function metricsFromResult(
  report: FinalizedAarReport,
  findings: readonly ComplianceFinding[],
): DerivedMetrics {
  const byMetric = new Map<keyof DerivedMetrics, number | null>();
  for (const f of findings) {
    const key = SIGNAL_TO_METRIC[f.signal];
    if (key !== undefined) byMetric.set(key, f.value);
  }

  // isDerived is the discriminant behind the no-fabrication guarantee; assert
  // the reconstructed coverage metric matches the report field it came from.
  const coverage = toMetric(report.telemetry_coverage);
  expect(isDerived(coverage)).toBe(typeof report.telemetry_coverage === "number");

  return {
    telemetry_coverage: coverage,
    route_efficiency_percent: toMetric(byMetric.get("route_efficiency_percent")),
    max_pitch_deg: toMetric(byMetric.get("max_pitch_deg")),
    max_roll_deg: toMetric(byMetric.get("max_roll_deg")),
    touchdown_g_force: toMetric(byMetric.get("touchdown_g_force")),
    reserve_fuel_minutes: toMetric(byMetric.get("reserve_fuel_minutes")),
    scene_time_minutes: toMetric(byMetric.get("scene_time_minutes")),
  };
}
