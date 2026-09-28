/**
 * Clinical Golden Hour engine boundary (design Section 4.5 / 6.4).
 *
 * Task 9.1 establishes condition resolution/validation (req 4.8, 4.9) and Golden
 * Hour timer initiation (req 4.1), leaving a clean seam for the deterministic
 * deterioration / GCS-clamp / monotonic-state update (`update_patient_state`,
 * task 9.2) which extends this boundary without changing its shape.
 */

export {
  GCS_MIN,
  GCS_MAX,
  validateCondition,
  resolveCondition,
  type ConditionErrorCode,
  type ConditionError,
  type ConditionResolution,
  type UnresolvedCondition,
} from "./condition.js";

export {
  GOLDEN_HOUR_DURATION_SECONDS,
  SCENE_CALL_MISSION_TYPE,
  DISPATCH_EVENT_TYPE,
  deriveBaselineGcs,
  initiateGoldenHour,
  type GoldenHourErrorCode,
  type GoldenHourError,
  type GoldenHourTimer,
  type GoldenHourInitiation,
  type GoldenHourResult,
  type GoldenHourDispatchInput,
} from "./golden-hour.js";

export {
  DEFAULT_SCENE_TARGET_SECONDS,
  MIN_SCENE_TARGET_SECONDS,
  MAX_SCENE_TARGET_SECONDS,
  SECONDS_PER_MINUTE,
  SCENE_START_EVENT_TYPE,
  SCENE_END_EVENT_TYPE,
  DEFAULT_GCS_POINTS_PER_DECAY_UNIT,
  DEFAULT_VITAL_EFFECT_AFTER_MINUTES,
  VITAL_EFFECT_FLAG,
  secondsBetween,
  resolvePolicy,
  calculateSceneSeconds,
  calculateDecayPenalty,
  deriveFlags,
  updatePatientState,
  type ClinicalPolicy,
  type ResolvedClinicalPolicy,
  type DeteriorationErrorCode,
  type DeteriorationError,
  type DeteriorationPenalty,
  type DeteriorationResult,
  type UpdatePatientStateInput,
} from "./deterioration.js";
