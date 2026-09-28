/**
 * Golden Hour timer initiation (design Section 6.4, requirement 4.1).
 *
 * This module is the timer-initiation portion of the clinical Golden Hour
 * engine (task 9.1). When a mission is dispatched for a scene call, it creates a
 * 3600-second Golden Hour timer anchored to the dispatch event time (req 4.1)
 * and derives the initial {@link PatientState} that the deterministic
 * deterioration / GCS-clamp / monotonic-update step (`update_patient_state`,
 * task 9.2) will advance from.
 *
 * It is pure and deterministic: the anchor comes from the DISPATCHED
 * {@link ClinicalEvent}'s `occurred_at`, never from the wall clock, so identical
 * inputs always produce identical output. The seam for task 9.2 is the returned
 * {@link GoldenHourTimer} (which carries the anchor and duration 9.2 needs to
 * compute elapsed Golden Hour seconds) plus the initial {@link PatientState}
 * (`current_gcs == baseline_gcs`, zero elapsed, not deteriorated), which 9.2
 * takes as the starting point for its monotonic updates.
 *
 * Reuses the shared `@virtualhems/contracts` clinical/mission types; the
 * condition is expected to have already been validated by
 * {@link ./condition.js#resolveCondition} (req 4.8, 4.9).
 */

import type {
  ClinicalEvent,
  MedicalCondition,
  MissionType,
  PatientState,
  Timestamp,
  Uuid,
} from "@virtualhems/contracts";

// --- Timer constants (req 4.1) ----------------------------------------------

/** The Golden Hour timer duration: 3600 seconds (req 4.1). */
export const GOLDEN_HOUR_DURATION_SECONDS = 3600;

/** The mission type that initiates a Golden Hour timer (req 4.1: scene call). */
export const SCENE_CALL_MISSION_TYPE: MissionType = "SCENE_CALL";

/** The clinical event type that anchors the Golden Hour timer (req 4.1). */
export const DISPATCH_EVENT_TYPE = "DISPATCHED" as const;

// --- Error model ------------------------------------------------------------

/**
 * Reasons a Golden Hour timer cannot be initiated. A non-scene-call mission
 * simply does not start a Golden Hour timer (req 4.1 scopes the timer to scene
 * calls); a missing/invalid dispatch anchor is a hard error because the timer
 * must be anchored to the dispatch event time.
 */
export type GoldenHourErrorCode =
  | "NOT_A_SCENE_CALL"
  | "DISPATCH_EVENT_MISSING"
  | "DISPATCH_EVENT_INVALID_TIME"
  | "MISSION_ID_MISSING";

/** A single reason Golden Hour initiation was rejected. */
export interface GoldenHourError {
  code: GoldenHourErrorCode;
  message: string;
  detail?: string;
}

// --- Timer + state model ----------------------------------------------------

/**
 * A running Golden Hour timer (req 4.1). `anchoredAt` is the dispatch event
 * time; `durationSeconds` is always {@link GOLDEN_HOUR_DURATION_SECONDS}. This
 * is the seam task 9.2 reads to compute elapsed Golden Hour seconds at any later
 * event time (elapsed = seconds_between(anchoredAt, event_time), clamped/handled
 * per its policy).
 */
export interface GoldenHourTimer {
  mission_id: Uuid;
  /** ISO 8601 dispatch event time the timer is anchored to (req 4.1). */
  anchoredAt: Timestamp;
  /** Fixed 3600-second Golden Hour duration (req 4.1). */
  durationSeconds: number;
}

/**
 * The successful outcome of {@link initiateGoldenHour}: the running timer plus
 * the initial patient state derived from the validated condition. The initial
 * state is the task 9.2 seam — its baseline GCS is chosen deterministically from
 * the condition's baseline range and it is not yet deteriorated.
 */
export interface GoldenHourInitiation {
  timer: GoldenHourTimer;
  patient: PatientState;
}

/** The outcome of {@link initiateGoldenHour}. */
export type GoldenHourResult =
  | { ok: true; initiation: GoldenHourInitiation }
  | { ok: false; errors: GoldenHourError[] };

// --- Inputs -----------------------------------------------------------------

/**
 * The dispatch context needed to initiate a Golden Hour timer. The mission type
 * gates whether a timer starts (req 4.1); the DISPATCHED event supplies the
 * anchor time; the (already validated) condition supplies the baseline GCS the
 * initial patient state starts from.
 */
export interface GoldenHourDispatchInput {
  mission_id?: Uuid;
  mission_type?: MissionType | string;
  /**
   * The DISPATCHED clinical event whose `occurred_at` anchors the timer
   * (req 4.1). Passed explicitly rather than searched from a list so this stays
   * a pure function of its inputs.
   */
  dispatchEvent?: Pick<ClinicalEvent, "event_type" | "occurred_at"> | undefined;
  /**
   * The resolved, validated medical condition (req 4.8/4.9 handled upstream by
   * {@link ./condition.js#resolveCondition}). Its baseline GCS range seeds the
   * initial patient state.
   */
  condition: MedicalCondition;
}

// --- Helpers ----------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Derive the deterministic baseline GCS the initial patient state starts from.
 * The condition carries a range; the initial baseline is the higher (best)
 * bound, representing the patient's condition at dispatch before any on-scene
 * deterioration. Deterministic: identical conditions yield identical baselines.
 * (Task 9.2 owns the subsequent decay from this baseline.)
 */
export function deriveBaselineGcs(condition: MedicalCondition): number {
  return condition.baseline_gcs_max;
}

// --- initiateGoldenHour (req 4.1) -------------------------------------------

/**
 * Initiate the Golden Hour timer for a dispatched mission (req 4.1).
 *
 * For a SCENE_CALL dispatch, creates a 3600-second Golden Hour timer anchored to
 * the DISPATCHED event's `occurred_at`, and derives the initial
 * {@link PatientState} (baseline == current GCS, zero elapsed Golden Hour and
 * scene time, no physiological flags, not deteriorated, `updated_at` == the
 * dispatch time) as the seam for task 9.2's `update_patient_state`.
 *
 * A non-scene-call mission does not start a Golden Hour timer and returns a
 * `NOT_A_SCENE_CALL` result (req 4.1 scopes the timer to scene calls); this is a
 * rejection, not a thrown error, so an inter-facility transfer flows through the
 * same call site cleanly. A scene-call dispatch missing its mission id or a
 * valid dispatch anchor is rejected with the specific reason.
 *
 * Pure and deterministic: no wall clock is read — the anchor is the dispatch
 * event time.
 */
export function initiateGoldenHour(
  input: GoldenHourDispatchInput,
): GoldenHourResult {
  const errors: GoldenHourError[] = [];

  // Req 4.1: the timer is initiated only for a scene call.
  if (input.mission_type !== SCENE_CALL_MISSION_TYPE) {
    return {
      ok: false,
      errors: [
        {
          code: "NOT_A_SCENE_CALL",
          message:
            "Golden Hour timer is initiated only for a scene-call dispatch",
          detail:
            input.mission_type === undefined
              ? undefined
              : String(input.mission_type),
        },
      ],
    };
  }

  if (!isNonEmptyString(input.mission_id)) {
    errors.push({
      code: "MISSION_ID_MISSING",
      message: "a mission id is required to initiate a Golden Hour timer",
    });
  }

  // The timer must be anchored to the dispatch event time (req 4.1).
  const event = input.dispatchEvent;
  let anchoredAt: Timestamp | undefined;
  if (
    event === undefined ||
    event === null ||
    event.event_type !== DISPATCH_EVENT_TYPE
  ) {
    errors.push({
      code: "DISPATCH_EVENT_MISSING",
      message:
        "a DISPATCHED clinical event is required to anchor the Golden Hour timer",
      detail: event?.event_type,
    });
  } else if (
    !isNonEmptyString(event.occurred_at) ||
    Number.isNaN(Date.parse(event.occurred_at))
  ) {
    errors.push({
      code: "DISPATCH_EVENT_INVALID_TIME",
      message: "the dispatch event has no valid occurred_at timestamp",
      detail: isNonEmptyString(event.occurred_at)
        ? event.occurred_at
        : undefined,
    });
  } else {
    anchoredAt = event.occurred_at;
  }

  if (errors.length > 0 || anchoredAt === undefined) {
    return { ok: false, errors };
  }

  const baselineGcs = deriveBaselineGcs(input.condition);
  const missionId = input.mission_id as Uuid;

  const timer: GoldenHourTimer = {
    mission_id: missionId,
    anchoredAt,
    durationSeconds: GOLDEN_HOUR_DURATION_SECONDS,
  };

  // Initial patient-state seam for task 9.2: nothing has elapsed yet, so current
  // equals baseline, elapsed counters are zero, and the patient is not
  // deteriorated. `updated_at` is the anchor so 9.2's monotonic out-of-order
  // guard (req 4.6) has a starting reference.
  const patient: PatientState = {
    mission_id: missionId,
    baseline_gcs: baselineGcs,
    current_gcs: baselineGcs,
    elapsed_golden_hour_seconds: 0,
    elapsed_scene_seconds: 0,
    physiological_flags: [],
    deteriorated: false,
    updated_at: anchoredAt,
  };

  return { ok: true, initiation: { timer, patient } };
}
