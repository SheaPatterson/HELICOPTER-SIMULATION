/**
 * Clinical condition resolution and validation (design Section 4.5 / 6.4,
 * requirements 4.8, 4.9).
 *
 * This module is the pure, deterministic front half of the clinical Golden Hour
 * engine (task 9.1): it validates that a resolved {@link MedicalCondition}
 * record is complete and well-formed before any timer initiation
 * ({@link ../golden-hour.js#initiateGoldenHour}) or state derivation
 * (`update_patient_state`, task 9.2) is allowed to use it.
 *
 * Two requirements drive the checks here:
 *
 *   - Req 4.8 (matrix well-formedness): each condition is categorized as
 *     exactly one of the 8 defined {@link MEDICAL_CONDITION_CATEGORIES}, its
 *     baseline GCS range lies within the integer interval [3, 15] and is not
 *     inverted, and it maps to exactly one required receiving-facility
 *     capability.
 *   - Req 4.9 (incomplete-record rejection): if a resolved condition is missing
 *     its category, baseline GCS range, decay rate, or required facility
 *     capability (or any of these is invalid), reject use of that condition and
 *     return an error indication that identifies the incomplete record.
 *
 * The module reuses the shared `@virtualhems/contracts` clinical types rather
 * than redefining them, and is free of any transport/database concern: a caller
 * resolves the record (from the `medical_conditions` table, a seed fixture, or a
 * request) and passes it here for validation.
 */

import {
  MEDICAL_CONDITION_CATEGORIES,
  type MedicalCondition,
} from "@virtualhems/contracts";

// --- GCS bounds (req 4.8) ---------------------------------------------------

/** Inclusive lower bound of a valid baseline GCS value (req 4.8). */
export const GCS_MIN = 3;

/** Inclusive upper bound of a valid baseline GCS value (req 4.8). */
export const GCS_MAX = 15;

// --- Error model ------------------------------------------------------------

/**
 * Machine-readable codes for each specific way a resolved condition record can
 * be incomplete or malformed (req 4.9 / 4.8). Each names the offending field so
 * the caller/audit trail can identify precisely why the record was rejected.
 */
export type ConditionErrorCode =
  // Category (req 4.8: exactly one of the 8 defined categories).
  | "CATEGORY_MISSING"
  | "CATEGORY_INVALID"
  // Baseline GCS range (req 4.8: within [3,15], not inverted).
  | "GCS_RANGE_MISSING"
  | "GCS_RANGE_NOT_INTEGER"
  | "GCS_RANGE_OUT_OF_BOUNDS"
  | "GCS_RANGE_INVERTED"
  // Decay rate (req 4.9: present and non-negative).
  | "DECAY_RATE_MISSING"
  | "DECAY_RATE_INVALID"
  // Required receiving-facility capability (req 4.8: exactly one).
  | "FACILITY_CAPABILITY_MISSING";

/**
 * A single reason a resolved condition record was rejected. `field` names the
 * offending property; `detail` carries a human-readable specifics string (e.g.
 * the invalid category value, the offending numeric value).
 */
export interface ConditionError {
  code: ConditionErrorCode;
  message: string;
  field: string;
  detail?: string;
}

// --- Result model -----------------------------------------------------------

/**
 * The outcome of {@link resolveCondition}: either a validated condition or the
 * list of every reason it was rejected together with the id/name of the
 * incomplete record so it can be identified (req 4.9). The `condition` on the
 * failure branch is the raw record as supplied, retained for the audit trail.
 */
export type ConditionResolution =
  | { ok: true; condition: MedicalCondition }
  | {
      ok: false;
      /** The id of the incomplete record, when present (req 4.9). */
      conditionId?: string;
      /** The name of the incomplete record, when present (req 4.9). */
      conditionName?: string;
      errors: ConditionError[];
    };

// --- Helpers ----------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A resolved condition record as it may arrive from persistence or a request:
 * every field is loosely typed so a partial or malformed record can be
 * validated field-by-field. A caller cannot be trusted to have already produced
 * a well-formed {@link MedicalCondition} (req 4.9 exists precisely because the
 * record may be incomplete).
 */
export type UnresolvedCondition = Partial<
  Record<keyof MedicalCondition, unknown>
>;

// --- Validation (req 4.8 / 4.9) ---------------------------------------------

/**
 * Validate a resolved medical condition record (req 4.8, 4.9). Returns EVERY
 * failed condition, never short-circuiting on the first, so the caller/audit
 * trail sees the complete list of reasons the record is unusable.
 *
 * Checks:
 *   - category present and one of the 8 defined categories (req 4.8);
 *   - baseline GCS range present, integer, within [3, 15], and min ≤ max
 *     (req 4.8);
 *   - decay rate present and a finite, non-negative number (req 4.9);
 *   - exactly one required receiving-facility capability, present and
 *     non-empty (req 4.8).
 */
export function validateCondition(
  condition: UnresolvedCondition,
): ConditionError[] {
  const errors: ConditionError[] = [];

  // Category: present and one of the 8 defined categories (req 4.8).
  const category = condition.category;
  if (category === undefined || category === null || category === "") {
    errors.push({
      code: "CATEGORY_MISSING",
      field: "category",
      message: "medical condition is missing its category",
    });
  } else if (
    !(MEDICAL_CONDITION_CATEGORIES as readonly string[]).includes(
      category as string,
    )
  ) {
    errors.push({
      code: "CATEGORY_INVALID",
      field: "category",
      message: `medical condition category "${String(category)}" is not one of the ${MEDICAL_CONDITION_CATEGORIES.length} defined categories`,
      detail: String(category),
    });
  }

  // Baseline GCS range: present, integer, within [3,15], not inverted (req 4.8).
  const min = condition.baseline_gcs_min;
  const max = condition.baseline_gcs_max;
  const minPresent = min !== undefined && min !== null;
  const maxPresent = max !== undefined && max !== null;

  if (!minPresent || !maxPresent) {
    errors.push({
      code: "GCS_RANGE_MISSING",
      field: !minPresent ? "baseline_gcs_min" : "baseline_gcs_max",
      message: "medical condition is missing its baseline GCS range",
    });
  } else if (!isFiniteNumber(min) || !isFiniteNumber(max)) {
    errors.push({
      code: "GCS_RANGE_NOT_INTEGER",
      field: "baseline_gcs_min/baseline_gcs_max",
      message: "baseline GCS range bounds must be finite numbers",
      detail: `${String(min)}..${String(max)}`,
    });
  } else if (!Number.isInteger(min) || !Number.isInteger(max)) {
    errors.push({
      code: "GCS_RANGE_NOT_INTEGER",
      field: "baseline_gcs_min/baseline_gcs_max",
      message: "baseline GCS range bounds must be integers",
      detail: `${min}..${max}`,
    });
  } else {
    // Both are finite integers: bounds and ordering.
    if (min < GCS_MIN || min > GCS_MAX || max < GCS_MIN || max > GCS_MAX) {
      errors.push({
        code: "GCS_RANGE_OUT_OF_BOUNDS",
        field: "baseline_gcs_min/baseline_gcs_max",
        message: `baseline GCS range must lie within [${GCS_MIN}, ${GCS_MAX}]`,
        detail: `${min}..${max}`,
      });
    }
    if (min > max) {
      errors.push({
        code: "GCS_RANGE_INVERTED",
        field: "baseline_gcs_min/baseline_gcs_max",
        message: "baseline GCS range is inverted (min exceeds max)",
        detail: `${min}..${max}`,
      });
    }
  }

  // Decay rate: present and a finite, non-negative number (req 4.9).
  const decay = condition.decay_rate_per_minute;
  if (decay === undefined || decay === null) {
    errors.push({
      code: "DECAY_RATE_MISSING",
      field: "decay_rate_per_minute",
      message: "medical condition is missing its decay rate",
    });
  } else if (!isFiniteNumber(decay) || decay < 0) {
    errors.push({
      code: "DECAY_RATE_INVALID",
      field: "decay_rate_per_minute",
      message: "decay rate must be a finite, non-negative number",
      detail: String(decay),
    });
  }

  // Required receiving-facility capability: exactly one, present and non-empty
  // (req 4.8). The contract models this as a single `target_facility_type`
  // string, so "exactly one" reduces to "present and non-empty".
  if (!isNonEmptyString(condition.target_facility_type)) {
    errors.push({
      code: "FACILITY_CAPABILITY_MISSING",
      field: "target_facility_type",
      message:
        "medical condition is missing its required receiving-facility capability",
    });
  }

  return errors;
}

/**
 * Resolve a medical condition record for clinical use (req 4.9). On success the
 * record is a well-formed {@link MedicalCondition}. On failure the resolution
 * carries EVERY reason the record was rejected plus the id/name of the
 * incomplete record so it can be identified in an error indication and the
 * audit trail; the condition is NOT usable by the Golden Hour timer or the
 * state-derivation step (task 9.2).
 */
export function resolveCondition(
  condition: UnresolvedCondition,
): ConditionResolution {
  const errors = validateCondition(condition);
  if (errors.length > 0) {
    return {
      ok: false,
      conditionId: isNonEmptyString(condition.id)
        ? (condition.id as string)
        : undefined,
      conditionName: isNonEmptyString(condition.name)
        ? (condition.name as string)
        : undefined,
      errors,
    };
  }

  // Every field validated above; the record is a well-formed MedicalCondition.
  return { ok: true, condition: condition as MedicalCondition };
}
