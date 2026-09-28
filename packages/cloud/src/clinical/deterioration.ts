/**
 * Deterministic Golden Hour deterioration / GCS clamp / monotonic state update
 * (design Section 6.4, requirements 4.2–4.7).
 *
 * This module is the back half of the clinical Golden Hour engine (task 9.2). It
 * advances the initial {@link PatientState} seam produced by
 * {@link ./golden-hour.js#initiateGoldenHour} to any later event time, applying
 * the design's `update_patient_state` procedure as a pure, deterministic
 * function of its inputs (never the wall clock):
 *
 *   - Req 4.2: elapsed Golden Hour time (from the dispatch anchor) and elapsed
 *     scene time (from the recorded mission events) are computed deterministically
 *     in WHOLE SECONDS under the effective {@link ClinicalPolicy}; identical
 *     inputs always yield identical elapsed values.
 *   - Req 4.3: WHILE on-scene elapsed time exceeds the configured scene target
 *     (default {@link DEFAULT_SCENE_TARGET_SECONDS}, clamped to
 *     [{@link MIN_SCENE_TARGET_SECONDS}, {@link MAX_SCENE_TARGET_SECONDS}]), a
 *     deterioration penalty derived from the condition decay rate and the policy
 *     is applied ONCE PER elapsed whole minute beyond the target.
 *   - Req 4.4: current GCS is clamped to the integer range
 *     [{@link GCS_MIN}, {@link GCS_MAX}].
 *   - Req 4.5: `deteriorated` is true WHERE current GCS < baseline GCS OR a
 *     vital-sign effect is present; false otherwise.
 *   - Req 4.6: an event whose time precedes the last recorded update time is
 *     rejected — the prior monotonic state is preserved and an error identifying
 *     the out-of-order event is returned.
 *   - Req 4.7: the Policy_Version used to derive the state is recorded on the
 *     result.
 *
 * The design (Section 6.4) leaves the precise decay granularity and vital-sign
 * model as policy inputs, so those knobs live on the {@link ClinicalPolicy}
 * object rather than being hard-coded: the penalty is `floor(excess_scene / 60)`
 * whole minutes times the condition decay rate times the policy's
 * `gcs_points_per_decay_unit`, rounded deterministically to whole GCS points,
 * and a vital-sign effect is declared once the over-target minutes reach the
 * policy's `vital_effect_after_minutes` threshold. Every arithmetic step is on
 * whole seconds / whole minutes / integers so the function is reproducible.
 *
 * The shared {@link PatientState} contract has no policy-version field, so the
 * Policy_Version (req 4.7) is returned on the accompanying result record rather
 * than mutating the contract.
 */

import type {
  ClinicalEvent,
  MedicalCondition,
  PatientState,
  Timestamp,
} from "@virtualhems/contracts";

import { GCS_MAX, GCS_MIN } from "./condition.js";

// --- Scene-target policy bounds (req 4.3) -----------------------------------

/** Default on-scene target before deterioration accrues: 1200 s (req 4.3). */
export const DEFAULT_SCENE_TARGET_SECONDS = 1200;

/** Inclusive lower bound of a configurable scene target: 300 s (req 4.3). */
export const MIN_SCENE_TARGET_SECONDS = 300;

/** Inclusive upper bound of a configurable scene target: 3600 s (req 4.3). */
export const MAX_SCENE_TARGET_SECONDS = 3600;

/** Number of whole seconds in one whole minute (penalty granularity, req 4.3). */
export const SECONDS_PER_MINUTE = 60;

// --- Scene-time event types -------------------------------------------------

/** Marks the start of an on-scene interval (req 4.2 scene-time accounting). */
export const SCENE_START_EVENT_TYPE = "ARRIVED_SCENE" as const;

/** Marks the end of an on-scene interval (req 4.2 scene-time accounting). */
export const SCENE_END_EVENT_TYPE = "DEPARTED_SCENE" as const;

// --- Policy model (req 4.3, 4.5, 4.7) ---------------------------------------

/**
 * The effective clinical policy in force for a mission (req 4.7 Policy_Version).
 * Carries the identified policy version plus the tunable deterioration knobs the
 * design (Section 6.4) leaves to policy: the scene target, how condition decay
 * rate translates into whole GCS points per over-target minute, and when a
 * vital-sign effect is declared. Missing tunables fall back to defaults via
 * {@link resolvePolicy} so a caller can supply only `policy_version`.
 */
export interface ClinicalPolicy {
  /** The Policy_Version recorded with the derived state (req 4.7). */
  policy_version: string;
  /**
   * On-scene target in whole seconds before a penalty accrues (req 4.3).
   * Defaults to {@link DEFAULT_SCENE_TARGET_SECONDS}; values outside
   * [{@link MIN_SCENE_TARGET_SECONDS}, {@link MAX_SCENE_TARGET_SECONDS}] are
   * clamped into range by {@link resolvePolicy}.
   */
  scene_target_seconds?: number;
  /**
   * GCS points lost per (over-target whole minute × condition
   * `decay_rate_per_minute`) before rounding (req 4.3). Defaults to
   * {@link DEFAULT_GCS_POINTS_PER_DECAY_UNIT}.
   */
  gcs_points_per_decay_unit?: number;
  /**
   * Number of over-target whole minutes at which a vital-sign effect is present
   * (req 4.5). Defaults to {@link DEFAULT_VITAL_EFFECT_AFTER_MINUTES}. A
   * non-positive value means a vital effect is present as soon as any over-target
   * minute accrues.
   */
  vital_effect_after_minutes?: number;
}

/** Default GCS points per (over-target minute × decay rate) (req 4.3). */
export const DEFAULT_GCS_POINTS_PER_DECAY_UNIT = 1;

/** Default over-target minutes before a vital-sign effect is present (req 4.5). */
export const DEFAULT_VITAL_EFFECT_AFTER_MINUTES = 10;

/** A physiological flag raised once a vital-sign effect is present (req 4.5). */
export const VITAL_EFFECT_FLAG = "VITAL_SIGN_EFFECT";

/**
 * A {@link ClinicalPolicy} with every tunable resolved to a concrete value and
 * `scene_target_seconds` clamped to the configurable range (req 4.3).
 */
export interface ResolvedClinicalPolicy {
  policy_version: string;
  scene_target_seconds: number;
  gcs_points_per_decay_unit: number;
  vital_effect_after_minutes: number;
}

// --- Error model (req 4.6) --------------------------------------------------

/**
 * Reasons a state update is rejected. `OUT_OF_ORDER_EVENT` is the req 4.6 guard;
 * the remaining codes reject inputs that would make the update non-deterministic
 * or violate the design preconditions (baseline GCS in [3,15], valid times).
 */
export type DeteriorationErrorCode =
  | "OUT_OF_ORDER_EVENT"
  | "BASELINE_GCS_OUT_OF_RANGE"
  | "INVALID_EVENT_TIME"
  | "INVALID_STATE_TIME"
  | "INVALID_DISPATCH_ANCHOR";

/** A single reason {@link updatePatientState} rejected an update. */
export interface DeteriorationError {
  code: DeteriorationErrorCode;
  message: string;
  detail?: string;
}

// --- Penalty model (design Section 6.4) -------------------------------------

/**
 * The deterioration penalty derived for an update (design Section 6.4). All
 * fields are deterministic functions of the whole-second inputs: `over_minutes`
 * is the number of whole minutes beyond the scene target, `gcs_points` the whole
 * GCS points to subtract from baseline (before clamping), and `has_vital_effect`
 * whether a vital-sign effect is present (req 4.5).
 */
export interface DeteriorationPenalty {
  /** Whole minutes on-scene beyond the scene target (req 4.3). */
  over_minutes: number;
  /** Whole GCS points to subtract from baseline before clamping (req 4.3/4.4). */
  gcs_points: number;
  /** Whether a vital-sign effect is present (req 4.5). */
  has_vital_effect: boolean;
}

// --- Result model (req 4.6, 4.7) --------------------------------------------

/**
 * The outcome of {@link updatePatientState}. On success it carries the advanced
 * {@link PatientState}, the derived {@link DeteriorationPenalty}, and the
 * Policy_Version recorded with the state (req 4.7, kept alongside the contract
 * since {@link PatientState} has no policy-version field). On failure it carries
 * the prior state UNCHANGED (req 4.6 monotonic preservation) and the errors.
 */
export type DeteriorationResult =
  | {
      ok: true;
      patient: PatientState;
      penalty: DeteriorationPenalty;
      /** The Policy_Version used to derive this state (req 4.7). */
      policy_version: string;
    }
  | {
      ok: false;
      /** The prior state, preserved unchanged (req 4.6). */
      patient: PatientState;
      errors: DeteriorationError[];
    };

// --- Inputs -----------------------------------------------------------------

/**
 * The inputs to a single deterministic state update (design Section 6.4). The
 * dispatch anchor supplies the Golden Hour origin; the events supply scene time;
 * the condition supplies the decay rate; the policy supplies the tunables and
 * Policy_Version. Everything is passed explicitly so the update is a pure
 * function of its arguments (req 4.2 determinism).
 */
export interface UpdatePatientStateInput {
  /** The prior patient state to advance (its `updated_at` is the monotonic ref). */
  patient: PatientState;
  /** The event time to derive state at (ISO 8601). */
  eventTime: Timestamp;
  /**
   * The Golden Hour dispatch anchor (ISO 8601) — the origin for elapsed Golden
   * Hour seconds (req 4.2). This is {@link ./golden-hour.js#GoldenHourTimer}'s
   * `anchoredAt`.
   */
  dispatchTime: Timestamp;
  /**
   * The recorded mission events used to compute elapsed scene time (req 4.2).
   * Only {@link SCENE_START_EVENT_TYPE}/{@link SCENE_END_EVENT_TYPE} events
   * affect scene time; order is derived from `occurred_at`, not array order, so
   * the result is deterministic regardless of how the caller collected them.
   */
  events: ReadonlyArray<Pick<ClinicalEvent, "event_type" | "occurred_at">>;
  /** The resolved, validated condition supplying the decay rate (req 4.3). */
  condition: Pick<MedicalCondition, "decay_rate_per_minute">;
  /** The effective clinical policy, including Policy_Version (req 4.3, 4.7). */
  policy: ClinicalPolicy;
}

// --- Helpers ----------------------------------------------------------------

function isValidTimestamp(value: unknown): value is Timestamp {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * Whole seconds between two ISO 8601 timestamps, `to − from`, truncated toward
 * zero (req 4.2 whole-second determinism). Negative when `to` precedes `from`.
 */
export function secondsBetween(from: Timestamp, to: Timestamp): number {
  return Math.trunc((Date.parse(to) - Date.parse(from)) / 1000);
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Resolve a {@link ClinicalPolicy} to concrete values, clamping the scene target
 * to the configurable range (req 4.3) and filling defaults for any omitted
 * tunable. A non-finite or missing scene target falls back to the default.
 */
export function resolvePolicy(policy: ClinicalPolicy): ResolvedClinicalPolicy {
  const rawTarget = policy.scene_target_seconds;
  const target =
    typeof rawTarget === "number" && Number.isFinite(rawTarget)
      ? clampInt(
          Math.trunc(rawTarget),
          MIN_SCENE_TARGET_SECONDS,
          MAX_SCENE_TARGET_SECONDS,
        )
      : DEFAULT_SCENE_TARGET_SECONDS;

  const pointsPerUnit =
    typeof policy.gcs_points_per_decay_unit === "number" &&
    Number.isFinite(policy.gcs_points_per_decay_unit) &&
    policy.gcs_points_per_decay_unit >= 0
      ? policy.gcs_points_per_decay_unit
      : DEFAULT_GCS_POINTS_PER_DECAY_UNIT;

  const vitalAfter =
    typeof policy.vital_effect_after_minutes === "number" &&
    Number.isFinite(policy.vital_effect_after_minutes)
      ? Math.trunc(policy.vital_effect_after_minutes)
      : DEFAULT_VITAL_EFFECT_AFTER_MINUTES;

  return {
    policy_version: policy.policy_version,
    scene_target_seconds: target,
    gcs_points_per_decay_unit: pointsPerUnit,
    vital_effect_after_minutes: vitalAfter,
  };
}

/**
 * Compute elapsed on-scene whole seconds from the recorded mission events up to
 * `eventTime` (req 4.2). Sums each ARRIVED_SCENE → DEPARTED_SCENE interval; an
 * open interval (arrived but not yet departed) is counted up to `eventTime`.
 * Events are ordered by `occurred_at` (not array order) so the result is
 * deterministic regardless of collection order, and every interval is clamped
 * to `eventTime` so a departure recorded after the derivation point cannot leak
 * future time into the elapsed value.
 */
export function calculateSceneSeconds(
  events: ReadonlyArray<Pick<ClinicalEvent, "event_type" | "occurred_at">>,
  eventTime: Timestamp,
): number {
  const eventMs = Date.parse(eventTime);

  const scene = events
    .filter(
      (e) =>
        (e.event_type === SCENE_START_EVENT_TYPE ||
          e.event_type === SCENE_END_EVENT_TYPE) &&
        isValidTimestamp(e.occurred_at),
    )
    .map((e) => ({ type: e.event_type, ms: Date.parse(e.occurred_at) }))
    // Deterministic ordering: by time, then arrivals before departures at the
    // same instant so a zero-length interval never consumes a later departure.
    .sort((a, b) => {
      if (a.ms !== b.ms) return a.ms - b.ms;
      const rank = (t: string) => (t === SCENE_START_EVENT_TYPE ? 0 : 1);
      return rank(a.type) - rank(b.type);
    });

  let totalMs = 0;
  let openArrivalMs: number | null = null;

  for (const e of scene) {
    if (e.ms > eventMs) break; // ignore events after the derivation point
    if (e.type === SCENE_START_EVENT_TYPE) {
      if (openArrivalMs === null) openArrivalMs = e.ms;
    } else if (openArrivalMs !== null) {
      totalMs += Math.max(0, e.ms - openArrivalMs);
      openArrivalMs = null;
    }
  }

  // Still on scene at the derivation point: count up to eventTime.
  if (openArrivalMs !== null) {
    totalMs += Math.max(0, eventMs - openArrivalMs);
  }

  return Math.trunc(totalMs / 1000);
}

/**
 * Derive the deterioration penalty for an update (design Section 6.4, req 4.3).
 * The penalty accrues ONCE PER whole minute beyond the scene target:
 * `over_minutes = floor(excess_scene / 60)`, and `gcs_points =
 * round(over_minutes × decay_rate_per_minute × gcs_points_per_decay_unit)`, a
 * whole non-negative number. A vital-sign effect is present once `over_minutes`
 * reaches the policy's `vital_effect_after_minutes` threshold (req 4.5).
 */
export function calculateDecayPenalty(
  excessSceneSeconds: number,
  decayRatePerMinute: number,
  policy: ResolvedClinicalPolicy,
): DeteriorationPenalty {
  const excess = Math.max(0, Math.trunc(excessSceneSeconds));
  const overMinutes = Math.floor(excess / SECONDS_PER_MINUTE);

  const rate =
    Number.isFinite(decayRatePerMinute) && decayRatePerMinute > 0
      ? decayRatePerMinute
      : 0;

  const gcsPoints = Math.max(
    0,
    Math.round(overMinutes * rate * policy.gcs_points_per_decay_unit),
  );

  const hasVitalEffect =
    overMinutes > 0 && overMinutes >= policy.vital_effect_after_minutes;

  return { over_minutes: overMinutes, gcs_points: gcsPoints, has_vital_effect: hasVitalEffect };
}

/**
 * Derive the physiological flags for the updated state (design Section 6.4,
 * req 4.5). The vital-sign effect flag is present exactly when the penalty
 * declares a vital-sign effect. Deterministic and free of duplicates.
 */
export function deriveFlags(penalty: DeteriorationPenalty): string[] {
  return penalty.has_vital_effect ? [VITAL_EFFECT_FLAG] : [];
}

// --- updatePatientState (design Section 6.4; req 4.2–4.7) -------------------

/**
 * Advance patient state to `eventTime` deterministically (design Section 6.4,
 * requirements 4.2–4.7).
 *
 * Preconditions (design Section 6.4):
 *   - baseline GCS is in [{@link GCS_MIN}, {@link GCS_MAX}];
 *   - the event time is not before the prior `updated_at` (req 4.6).
 *
 * On success the returned {@link PatientState} has elapsed Golden Hour seconds
 * (from the dispatch anchor) and elapsed scene seconds (from the events)
 * recomputed in whole seconds (req 4.2); current GCS set to
 * `clamp(baseline − penalty.gcs_points, 3, 15)` (req 4.3/4.4); physiological
 * flags derived from the penalty; the `deteriorated` flag set to
 * `current_gcs < baseline_gcs OR penalty.has_vital_effect` (req 4.5); and
 * `updated_at` advanced to `eventTime`. The Policy_Version is returned alongside
 * the state (req 4.7).
 *
 * On an out-of-order event (`eventTime` before the prior `updated_at`) the prior
 * state is preserved UNCHANGED and an `OUT_OF_ORDER_EVENT` error identifying the
 * offending event time is returned (req 4.6). The function never reads the wall
 * clock and mutates nothing it is given: the returned state is a fresh object.
 */
export function updatePatientState(
  input: UpdatePatientStateInput,
): DeteriorationResult {
  const { patient, eventTime, dispatchTime, events, condition, policy } = input;
  const errors: DeteriorationError[] = [];

  // Precondition: baseline GCS in [3,15] (design Section 6.4).
  if (
    !Number.isInteger(patient.baseline_gcs) ||
    patient.baseline_gcs < GCS_MIN ||
    patient.baseline_gcs > GCS_MAX
  ) {
    errors.push({
      code: "BASELINE_GCS_OUT_OF_RANGE",
      message: `baseline GCS must be an integer within [${GCS_MIN}, ${GCS_MAX}]`,
      detail: String(patient.baseline_gcs),
    });
  }

  if (!isValidTimestamp(eventTime)) {
    errors.push({
      code: "INVALID_EVENT_TIME",
      message: "event time is not a valid timestamp",
      detail: String(eventTime),
    });
  }
  if (!isValidTimestamp(patient.updated_at)) {
    errors.push({
      code: "INVALID_STATE_TIME",
      message: "prior state updated_at is not a valid timestamp",
      detail: String(patient.updated_at),
    });
  }
  if (!isValidTimestamp(dispatchTime)) {
    errors.push({
      code: "INVALID_DISPATCH_ANCHOR",
      message: "dispatch anchor is not a valid timestamp",
      detail: String(dispatchTime),
    });
  }

  // Req 4.6: an event before the last recorded update is rejected; prior state
  // is preserved unchanged. Only checked once both times are valid.
  if (
    isValidTimestamp(eventTime) &&
    isValidTimestamp(patient.updated_at) &&
    Date.parse(eventTime) < Date.parse(patient.updated_at)
  ) {
    errors.push({
      code: "OUT_OF_ORDER_EVENT",
      message:
        "event time precedes the last recorded update; monotonic state preserved",
      detail: `event ${eventTime} < updated_at ${patient.updated_at}`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, patient, errors };
  }

  const resolved = resolvePolicy(policy);

  // Req 4.2: elapsed Golden Hour and scene time in whole seconds, deterministic.
  const elapsedTotal = Math.max(0, secondsBetween(dispatchTime, eventTime));
  const elapsedScene = calculateSceneSeconds(events, eventTime);

  // Req 4.3: penalty once per whole minute beyond the scene target.
  const excessScene = Math.max(0, elapsedScene - resolved.scene_target_seconds);
  const penalty = calculateDecayPenalty(
    excessScene,
    condition.decay_rate_per_minute,
    resolved,
  );

  // Req 4.4: clamp current GCS to [3,15].
  const currentGcs = clampInt(
    patient.baseline_gcs - penalty.gcs_points,
    GCS_MIN,
    GCS_MAX,
  );

  // Req 4.5: deteriorated when GCS dropped below baseline OR a vital effect.
  const deteriorated =
    currentGcs < patient.baseline_gcs || penalty.has_vital_effect;

  const updated: PatientState = {
    ...patient,
    current_gcs: currentGcs,
    elapsed_golden_hour_seconds: elapsedTotal,
    elapsed_scene_seconds: elapsedScene,
    physiological_flags: deriveFlags(penalty),
    deteriorated,
    updated_at: eventTime,
  };

  // Req 4.7: record the Policy_Version used to derive this state.
  return {
    ok: true,
    patient: updated,
    penalty,
    policy_version: resolved.policy_version,
  };
}
