/**
 * Property 4: Clinical monotonicity (design Correctness Property 4; requirements
 * 4.2, 4.4, 4.6).
 *
 * This is the dedicated property-based test for the deterministic Golden Hour
 * deterioration engine ({@link ./deterioration.js#updatePatientState}). It
 * asserts the universal invariants that must hold for EVERY generated event
 * schedule, condition decay rate, and (fixed-per-run) clinical policy — not just
 * the hand-picked examples covered by `deterioration.test.ts`.
 *
 * Invariants under test:
 *   - Determinism (req 4.2): identical inputs always yield deep-equal output,
 *     and derived elapsed Golden Hour / scene seconds are whole-second integers.
 *   - GCS bounds (req 4.4): current GCS is always an integer within [3, 15] for
 *     every accepted update, regardless of penalty magnitude.
 *   - Monotonic advance (req 4.2 / 4.6): applying an IN-ORDER sequence of event
 *     times (each >= the prior updated_at) against a fixed policy/condition and
 *     a fixed open scene interval produces monotonically non-decreasing
 *     updated_at, elapsed_golden_hour_seconds, and elapsed_scene_seconds; a
 *     monotonically NON-INCREASING current GCS (deterioration never reverses
 *     within a run); and a stable recorded policy_version. An OUT-OF-ORDER event
 *     (eventTime < updated_at) is always rejected and leaves the prior state
 *     exactly unchanged (req 4.6).
 *
 * **Validates: Requirements 4.2, 4.4**
 * **Validates: Requirements 4.6**
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ClinicalEvent, PatientState } from "@virtualhems/contracts";
import {
  GCS_MAX,
  GCS_MIN,
} from "./condition.js";
import {
  MAX_SCENE_TARGET_SECONDS,
  MIN_SCENE_TARGET_SECONDS,
  SCENE_START_EVENT_TYPE,
  updatePatientState,
  type ClinicalPolicy,
  type UpdatePatientStateInput,
} from "./deterioration.js";

// --- Fixtures / anchors ------------------------------------------------------

const MISSION_ID = "11111111-0000-0000-0000-000000000001";
/** Fixed Golden Hour dispatch anchor; every event time is dispatch + offset. */
const DISPATCH_TIME = "2024-01-01T12:00:00.000Z";
const DISPATCH_MS = Date.parse(DISPATCH_TIME);

/** ISO 8601 timestamp `seconds` whole seconds after the dispatch anchor. */
function at(seconds: number): string {
  return new Date(DISPATCH_MS + seconds * 1000).toISOString();
}

function initialPatient(baselineGcs: number): PatientState {
  return {
    mission_id: MISSION_ID,
    baseline_gcs: baselineGcs,
    current_gcs: baselineGcs,
    elapsed_golden_hour_seconds: 0,
    elapsed_scene_seconds: 0,
    physiological_flags: [],
    deteriorated: false,
    updated_at: DISPATCH_TIME,
  };
}

/** A single scene ARRIVED at the dispatch anchor, left open for the whole run. */
const OPEN_SCENE_EVENTS: ReadonlyArray<
  Pick<ClinicalEvent, "event_type" | "occurred_at">
> = [{ event_type: SCENE_START_EVENT_TYPE, occurred_at: at(0) }];

// --- Generators --------------------------------------------------------------

/** A finite, non-negative decay rate (whole and fractional rates alike). */
const decayRateArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 10 }),
  fc
    .float({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true })
    .filter((n) => Number.isFinite(n) && n >= 0),
);

/** A fixed-per-run clinical policy: scene target within [300, 3600] + version. */
const policyArb: fc.Arbitrary<ClinicalPolicy> = fc.record({
  policy_version: fc
    .integer({ min: 0, max: 9999 })
    .map((n) => `policy-v${n}`),
  scene_target_seconds: fc.integer({
    min: MIN_SCENE_TARGET_SECONDS,
    max: MAX_SCENE_TARGET_SECONDS,
  }),
  gcs_points_per_decay_unit: fc.integer({ min: 0, max: 3 }),
  vital_effect_after_minutes: fc.integer({ min: 0, max: 30 }),
});

/** A valid baseline GCS in the integer range [3, 15]. */
const baselineGcsArb = fc.integer({ min: GCS_MIN, max: GCS_MAX });

/**
 * A strictly increasing sequence of whole-second offsets from the dispatch
 * anchor — an IN-ORDER schedule. Built from positive gaps so each event time is
 * >= the prior one and scene time strictly accrues between steps.
 */
const inOrderScheduleArb: fc.Arbitrary<number[]> = fc
  .array(fc.integer({ min: 1, max: 600 }), { minLength: 1, maxLength: 12 })
  .map((gaps) => {
    const offsets: number[] = [];
    let acc = 0;
    for (const gap of gaps) {
      acc += gap;
      offsets.push(acc);
    }
    return offsets;
  });

function baseInput(
  baselineGcs: number,
  decayRate: number,
  policy: ClinicalPolicy,
): UpdatePatientStateInput {
  return {
    patient: initialPatient(baselineGcs),
    eventTime: at(0),
    dispatchTime: DISPATCH_TIME,
    events: OPEN_SCENE_EVENTS,
    condition: { decay_rate_per_minute: decayRate },
    policy,
  };
}

// --- Property 4 --------------------------------------------------------------

describe("Property 4: Clinical monotonicity (req 4.2, 4.4, 4.6)", () => {
  it("determinism: identical inputs yield deep-equal output with integer elapsed values (req 4.2)", () => {
    fc.assert(
      fc.property(
        baselineGcsArb,
        decayRateArb,
        policyArb,
        fc.integer({ min: 0, max: 6000 }),
        (baselineGcs, decayRate, policy, offset) => {
          const input = {
            ...baseInput(baselineGcs, decayRate, policy),
            eventTime: at(offset),
          };
          const a = updatePatientState(input);
          const b = updatePatientState(input);

          // Identical inputs -> identical output (req 4.2 determinism).
          expect(a).toEqual(b);

          expect(a.ok).toBe(true);
          if (a.ok) {
            // Elapsed values are whole-second integers (req 4.2).
            expect(Number.isInteger(a.patient.elapsed_golden_hour_seconds)).toBe(
              true,
            );
            expect(Number.isInteger(a.patient.elapsed_scene_seconds)).toBe(true);
            expect(a.patient.elapsed_golden_hour_seconds).toBeGreaterThanOrEqual(
              0,
            );
            expect(a.patient.elapsed_scene_seconds).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("GCS bounds: current GCS is always an integer within [3, 15] (req 4.4)", () => {
    fc.assert(
      fc.property(
        baselineGcsArb,
        decayRateArb,
        policyArb,
        fc.integer({ min: 0, max: 100000 }),
        (baselineGcs, decayRate, policy, offset) => {
          const result = updatePatientState({
            ...baseInput(baselineGcs, decayRate, policy),
            eventTime: at(offset),
          });

          expect(result.ok).toBe(true);
          if (result.ok) {
            const gcs = result.patient.current_gcs;
            // Integer in [3, 15] regardless of penalty magnitude (req 4.4).
            expect(Number.isInteger(gcs)).toBe(true);
            expect(gcs).toBeGreaterThanOrEqual(GCS_MIN);
            expect(gcs).toBeLessThanOrEqual(GCS_MAX);
            // Never exceeds baseline (deterioration only lowers GCS).
            expect(gcs).toBeLessThanOrEqual(baselineGcs);
          }
        },
      ),
    );
  });

  it("monotonic advance: an in-order schedule never reverses time, elapsed, or GCS, and keeps policy_version stable (req 4.2, 4.6)", () => {
    fc.assert(
      fc.property(
        baselineGcsArb,
        decayRateArb,
        policyArb,
        inOrderScheduleArb,
        (baselineGcs, decayRate, policy, offsets) => {
          let patient = initialPatient(baselineGcs);

          let prevUpdatedMs = Date.parse(patient.updated_at);
          let prevGoldenHour = patient.elapsed_golden_hour_seconds;
          let prevScene = patient.elapsed_scene_seconds;
          let prevGcs = patient.current_gcs;

          for (const offset of offsets) {
            const result = updatePatientState({
              ...baseInput(baselineGcs, decayRate, policy),
              patient,
              eventTime: at(offset),
            });

            // In-order events are always accepted.
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const next = result.patient;

            // updated_at advances monotonically (req 4.6 monotonic state).
            const nextUpdatedMs = Date.parse(next.updated_at);
            expect(nextUpdatedMs).toBeGreaterThanOrEqual(prevUpdatedMs);

            // Elapsed Golden Hour / scene seconds are non-decreasing (req 4.2).
            expect(next.elapsed_golden_hour_seconds).toBeGreaterThanOrEqual(
              prevGoldenHour,
            );
            expect(next.elapsed_scene_seconds).toBeGreaterThanOrEqual(prevScene);

            // current GCS is monotonically non-increasing: deterioration never
            // reverses within a run for a fixed policy/condition (req 4.2/4.6).
            expect(next.current_gcs).toBeLessThanOrEqual(prevGcs);
            expect(next.current_gcs).toBeGreaterThanOrEqual(GCS_MIN);

            // Policy_Version is stable for a fixed policy (req 4.2 / 4.7 seam).
            expect(result.policy_version).toBe(policy.policy_version);

            prevUpdatedMs = nextUpdatedMs;
            prevGoldenHour = next.elapsed_golden_hour_seconds;
            prevScene = next.elapsed_scene_seconds;
            prevGcs = next.current_gcs;
            patient = next;
          }
        },
      ),
    );
  });

  it("out-of-order: an event before updated_at is rejected and leaves prior state exactly unchanged (req 4.6)", () => {
    fc.assert(
      fc.property(
        baselineGcsArb,
        decayRateArb,
        policyArb,
        // Advance to some accepted state, then rewind by a positive amount.
        fc.integer({ min: 1, max: 6000 }),
        fc.integer({ min: 1, max: 6000 }),
        (baselineGcs, decayRate, policy, advanceOffset, rewind) => {
          // First, produce a valid advanced prior state.
          const advanced = updatePatientState({
            ...baseInput(baselineGcs, decayRate, policy),
            eventTime: at(advanceOffset),
          });
          expect(advanced.ok).toBe(true);
          if (!advanced.ok) return;

          const prior = advanced.patient;
          // Snapshot for exact-preservation comparison.
          const snapshot: PatientState = {
            ...prior,
            physiological_flags: [...prior.physiological_flags],
          };

          const outOfOrderOffset = advanceOffset - rewind; // strictly before updated_at
          const result = updatePatientState({
            ...baseInput(baselineGcs, decayRate, policy),
            patient: prior,
            eventTime: at(outOfOrderOffset),
          });

          // Rejected with an OUT_OF_ORDER_EVENT error (req 4.6).
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.errors.map((e) => e.code)).toContain(
              "OUT_OF_ORDER_EVENT",
            );
            // Prior monotonic state preserved EXACTLY unchanged (req 4.6).
            expect(result.patient).toEqual(snapshot);
          }
        },
      ),
    );
  });
});
