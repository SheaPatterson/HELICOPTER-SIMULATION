/**
 * Mission dispatch state machine (design Section 6.3, requirements 3.1, 3.2,
 * 3.3, 3.3a, 3.8).
 *
 * This module is the pure, testable core of the cloud-side four-stage dispatch
 * workflow: DETAILS → CREW → PATIENT_INFO → FLIGHT_PLAN. Task 8.1 implements the
 * Stage 1 (Details) and Stage 2 (Crew) gating plus the stage-advance restriction
 * (req 3.8); task 8.2 adds Stage 3 (Patient Info, req 3.4) and Stage 4 (Flight
 * Plan, req 3.5) validation; mission authorization / audit-event emission is
 * task 8.3. This module leaves clean seams for the last of these:
 *
 *   - {@link advanceDispatch} dispatches on the requested stage and handles all
 *     four stages. A successful FLIGHT_PLAN submission stops short of
 *     authorizing: it returns `readyToAuthorize: true` with the computed
 *     {@link PAVERisk} / {@link FlightPlan} so the authorization/audit layer
 *     (task 8.3) can set DISPATCHED, issue an authorization code, publish to the
 *     EFB, and append the mission event without this core reaching into that
 *     concern.
 *   - The result type is a discriminated success/failure that carries the
 *     retained input values, so an authorization/audit layer (task 8.3) can wrap
 *     this core and append mission events on each accepted transition.
 *
 * Stage 3's medical-condition resolution and baseline-GCS derivation go through
 * an injectable {@link ConditionResolverPort} rather than importing the parallel
 * clinical engine (`src/clinical/`, task 9.1), so this module compiles and is
 * tested independently and the two tasks do not collide.
 *
 * The core is intentionally free of any transport (HTTP/WebSocket) or database
 * driver concern: reference-existence checks (base / airframe / facility) are
 * performed through an injectable {@link DispatchLookupPort} so the state
 * machine can be unit-tested without a live database. It reuses the shared
 * `@virtualhems/contracts` mission/dispatch types rather than redefining them.
 *
 * Two requirements-critical behaviors distinguish this module from a naive
 * validator:
 *
 *   1. Multi-error reporting (req 3.2, 3.3a): validation collects EVERY failed
 *      field/condition, not just the first, and returns them together.
 *   2. Value retention (req 3.2, 3.3a): a failure result echoes back the input
 *      the caller submitted so the UI can re-render the stage with the entered
 *      values intact and the next stage kept closed.
 */

import {
  MISSION_TYPES,
  type CrewRoster,
  type DispatchDetails,
  type FlightPlan,
  type GeoPoint,
  type MedicalCondition,
  type PatientInput,
  type PaveDisposition,
  type PAVERisk,
  type Uuid,
} from "@virtualhems/contracts";

// --- Stage model ------------------------------------------------------------

/**
 * The four ordered dispatch stages (design Section 6.3). The array order is the
 * canonical stage sequence and is used to compute "current or previously
 * completed" for the advance restriction (req 3.8).
 */
export const DISPATCH_STAGES = [
  "DETAILS",
  "CREW",
  "PATIENT_INFO",
  "FLIGHT_PLAN",
] as const;

export type DispatchStage = (typeof DISPATCH_STAGES)[number];

/** Zero-based index of a stage in the canonical {@link DISPATCH_STAGES} order. */
export function stageIndex(stage: DispatchStage): number {
  return DISPATCH_STAGES.indexOf(stage);
}

// --- Injectable lookup port -------------------------------------------------

/**
 * Reference-existence port for the reference records a dispatch stage validates
 * against (req 3.1: base/airframe/facility "reference an existing configured
 * record"). Implementations back this with the `hems_bases` / airframe config /
 * `hospitals` tables; tests inject an in-memory set. Each method answers only
 * "does a configured record with this id exist?" — capability/eligibility
 * scoring is the recommendation engine's concern (task 11), not dispatch
 * gating.
 */
export interface DispatchLookupPort {
  /** True when a configured HEMS base with this id exists. */
  baseExists(base_id: Uuid): boolean;
  /** True when a configured airframe with this id exists. */
  airframeExists(airframe_id: Uuid): boolean;
  /** True when a configured facility (hospital/helipad) with this id exists. */
  facilityExists(facility_id: Uuid): boolean;
}

/**
 * Resolves a Stage 3 medical-condition reference to its configured record
 * (req 3.4: "resolve the selected medical condition to an existing condition
 * record"). This is deliberately a narrow injectable port rather than a direct
 * dependency on the clinical engine (`src/clinical/`, task 9.1, built in
 * parallel): Stage 3 needs exactly one capability from the clinical domain —
 * look up a `MedicalCondition` by id so a baseline GCS can be derived — and
 * modeling it as a port lets this module compile and be unit-tested
 * independently of the clinical module and avoids a merge-conflict-prone import.
 * In production this port is backed by the `medical_conditions` table / the
 * clinical engine's resolver; tests inject {@link InMemoryConditionResolver}.
 */
export interface ConditionResolverPort {
  /**
   * Return the configured {@link MedicalCondition} with this id, or `undefined`
   * when no such condition record exists.
   */
  resolveCondition(condition_id: Uuid): MedicalCondition | undefined;
}

// --- Error model ------------------------------------------------------------

/**
 * Machine-readable codes for each specific failed dispatch condition. The
 * Stage 1 codes name a field (req 3.2); the Stage 2 codes name a specific crew
 * condition (req 3.3a). `STAGE_ADVANCE_NOT_PERMITTED` covers the advance
 * restriction (req 3.8).
 */
export type DispatchErrorCode =
  // Stage-advance restriction (req 3.8).
  | "STAGE_ADVANCE_NOT_PERMITTED"
  // Stage 1 Details (req 3.1 / 3.2).
  | "MISSION_TYPE_INVALID"
  | "BASE_MISSING"
  | "BASE_NOT_FOUND"
  | "AIRFRAME_MISSING"
  | "AIRFRAME_NOT_FOUND"
  | "ORIGIN_MISSING"
  | "ORIGIN_NOT_FOUND"
  | "DESTINATION_MISSING"
  | "DESTINATION_NOT_FOUND"
  | "ORIGIN_DESTINATION_IDENTICAL"
  | "WEATHER_SNAPSHOT_MISSING"
  | "WEATHER_SNAPSHOT_INVALID"
  | "WEATHER_SNAPSHOT_STALE"
  // Stage 2 Crew (req 3.3 / 3.3a).
  | "PIC_MISSING"
  | "PIC_MULTIPLE"
  | "CREW_ROSTER_TOO_SMALL"
  | "CREW_ROSTER_TOO_LARGE"
  | "CREW_DUPLICATE_MEMBER"
  | "CREW_MEMBER_MISSING_ROLE"
  // Stage 3 Patient Info (req 3.4).
  | "PATIENT_MISSING"
  | "PATIENT_ID_MISSING"
  | "PATIENT_AGE_INVALID"
  | "PATIENT_GENDER_MISSING"
  | "PATIENT_WEIGHT_INVALID"
  | "PATIENT_CONDITION_MISSING"
  | "PATIENT_CONDITION_NOT_FOUND"
  | "PATIENT_CLINICAL_SUMMARY_MISSING"
  | "PATIENT_INTERVENTIONS_MISSING"
  | "PATIENT_CONDITION_GCS_RANGE_INVALID"
  | "PATIENT_BASELINE_GCS_OUT_OF_RANGE"
  // Stage 4 Flight Plan (req 3.5).
  | "FLIGHT_PLAN_ROUTE_MISSING"
  | "FLIGHT_PLAN_ROUTE_INVALID"
  | "PAVE_SCORES_MISSING"
  | "PAVE_SCORE_INVALID"
  | "RESERVE_POLICY_MISSING"
  | "RESERVE_POLICY_INVALID"
  | "RESERVE_MARGIN_INSUFFICIENT"
  | "DISPATCH_DISPOSITION_NO_GO"
  // Later tasks (seam).
  | "STAGE_NOT_IMPLEMENTED";

/**
 * A single failed dispatch condition. `field` names the offending Details field
 * (req 3.2). `detail` carries a human-readable specifics string (e.g. the
 * duplicated member id, the incomplete target stage) for the UI/audit trail.
 */
export interface DispatchError {
  code: DispatchErrorCode;
  message: string;
  field?: string;
  detail?: string;
}

// --- Result model -----------------------------------------------------------

/**
 * Outcome of {@link advanceDispatch}.
 *
 * On success, `stage` is the newly opened stage. On failure, `errors` names
 * EVERY failed condition (req 3.2 / 3.3a — not just the first) and
 * `retainedInput` echoes back the caller's submitted values so the stage can be
 * re-rendered with entered data intact and the next stage kept closed.
 */
export type AdvanceResult<TInput> =
  | AdvanceSuccess
  | { ok: false; errors: DispatchError[]; retainedInput: TInput };

/**
 * Success outcome of {@link advanceDispatch}.
 *
 * `openedStage` is the stage the workflow opens next (DETAILS opens CREW, CREW
 * opens PATIENT_INFO, PATIENT_INFO opens FLIGHT_PLAN). The final FLIGHT_PLAN
 * stage does not open a further dispatch stage; instead it produces a
 * `readyToAuthorize` marker plus the derived, validated artifacts (the derived
 * `PatientInput` from Stage 3 and the computed {@link PAVERisk} /
 * {@link FlightPlan} from Stage 4). Authorization itself — issuing an
 * authorization code, setting DISPATCHED, publishing to the EFB, and appending
 * the audit event — is task 8.3 and is intentionally NOT performed here; a
 * `readyToAuthorize: true` result is the seam the authorization layer wraps.
 */
export interface AdvanceSuccess {
  ok: true;
  /**
   * The next opened stage, when advancing DETAILS → CREW → PATIENT_INFO →
   * FLIGHT_PLAN. `undefined` on a successful FLIGHT_PLAN submission, which opens
   * no further stage and instead marks the mission ready to authorize.
   */
  openedStage?: DispatchStage;
  /**
   * True on a successful FLIGHT_PLAN submission: all four stages have passed and
   * the mission is ready for the authorization/audit layer (task 8.3). The
   * dispatch core deliberately stops short of authorizing.
   */
  readyToAuthorize?: boolean;
  /**
   * The Stage 3 patient input with the derived baseline GCS applied, produced on
   * a successful PATIENT_INFO submission so callers can persist `mission.patient`.
   */
  patient?: PatientInput;
  /** The computed PAVE risk, produced on a successful FLIGHT_PLAN submission. */
  risk?: PAVERisk;
  /** The computed flight plan, produced on a successful FLIGHT_PLAN submission. */
  flightPlan?: FlightPlan;
}

// --- Stage inputs -----------------------------------------------------------

/**
 * Stage 1 Details submission. Reuses the shared {@link DispatchDetails} contract
 * shape but every field is optional/loosely typed at the boundary so a partial
 * or malformed submission can be validated field-by-field (a caller cannot be
 * trusted to have already produced a well-formed `DispatchDetails`).
 */
export interface DetailsInput {
  mission_type?: string;
  assigned_base_id?: Uuid;
  assigned_airframe_id?: Uuid;
  origin_hospital_id?: Uuid;
  scene_coordinates?: DispatchDetails["scene_coordinates"];
  destination_hospital_id?: Uuid;
  weather_snapshot?: { observed_at?: string } | undefined;
}

/**
 * A Stage 2 crew member with an explicitly assigned role. Requirement 3.3
 * requires "each member assigned a defined role"; the {@link CrewRoster}
 * contract models the PIC plus optional nurse/paramedic slots, but the roster
 * as submitted is a membership list where each entry names a member and its
 * role, so we validate that list here and can project it onto `CrewRoster`.
 */
export interface CrewMemberInput {
  member_id?: Uuid;
  role?: string;
  is_pilot_in_command?: boolean;
}

/** Stage 2 Crew submission: the full roster as a membership list. */
export interface CrewInput {
  members?: CrewMemberInput[];
}

/**
 * Stage 3 Patient Info submission. Reuses the shape of the {@link PatientInput}
 * contract, but every field is optional/loosely typed at the boundary so a
 * partial or malformed submission can be validated field-by-field (req 3.4: the
 * planner validates that the simulated patient input "is present and complete").
 *
 * `baseline_gcs` is intentionally optional on input: the state machine DERIVES
 * the baseline GCS from the resolved condition (req 3.4), so a caller-supplied
 * value is only an optional hint that, when present, must fall inside the
 * resolved condition's range.
 */
export interface PatientInfoInput {
  simulated_patient_id?: Uuid;
  age_years?: number;
  gender?: string;
  weight_lbs?: number;
  condition_id?: Uuid;
  clinical_summary?: string;
  interventions?: string;
  baseline_gcs?: number;
}

/**
 * The pilot/aircraft/environment/external PAVE component scores for a Stage 4
 * submission, plus the disposition thresholds. Scores are deterministic inputs
 * to the dispatch core (the design leaves the upstream scoring model to the
 * recommendation/weather layers); the core sums them and maps the total to a
 * {@link PaveDisposition} using the injected thresholds so the calculation is
 * deterministic and unit-testable. Each component score is expected to be a
 * finite number in the inclusive 0..`max_component_score` range.
 */
export interface PaveScoreInput {
  pilot_score?: number;
  aircraft_score?: number;
  environment_score?: number;
  external_score?: number;
}

/**
 * Deterministic thresholds mapping a summed PAVE score to a disposition. A total
 * at or below `go_max` is GO; a total at or below `conditional_max` (but above
 * `go_max`) is CONDITIONAL; anything higher is NO_GO. Injected so the mapping is
 * policy-driven rather than hard-coded.
 */
export interface PavePolicy {
  /** Inclusive upper bound of a total score that still yields GO. */
  go_max: number;
  /** Inclusive upper bound of a total score that yields CONDITIONAL. */
  conditional_max: number;
  /** Inclusive maximum any single component score may take (default 4). */
  max_component_score?: number;
}

/**
 * Stage 4 Flight Plan submission. The route is the ordered list of waypoints the
 * planner flies; the planner computes direct/planned distance, fuel burn, and
 * the reserve margin from it deterministically. The PAVE component scores and
 * the reserve policy are injected via {@link AdvanceDispatchDependencies} rather
 * than trusted from raw input, but the caller supplies the route and optionally
 * overrides fuel parameters here.
 */
export interface FlightPlanInput {
  /** Ordered route waypoints (origin → … → destination), min length 2. */
  route?: GeoPoint[];
  /** PAVE component scores for this submission (see {@link PaveScoreInput}). */
  pave?: PaveScoreInput;
  /**
   * Cruise ground speed (kts) used to convert planned distance to endurance
   * minutes. Defaults to {@link DEFAULT_CRUISE_SPEED_KTS} when omitted.
   */
  cruise_speed_kts?: number;
  /**
   * Fuel burn rate (lbs/hour) used to estimate fuel burn over the planned
   * distance. Defaults to {@link DEFAULT_FUEL_BURN_LBS_PER_HOUR} when omitted.
   */
  fuel_burn_lbs_per_hour?: number;
  /**
   * Usable fuel aboard (lbs) at departure, used to compute endurance and thus
   * the reserve minutes remaining at destination. Defaults to
   * {@link DEFAULT_USABLE_FUEL_LBS} when omitted.
   */
  usable_fuel_lbs?: number;
}

/**
 * Reserve fuel policy (req 3.5). `required_reserve_minutes` is the minimum
 * reserve, expressed in minutes of endurance, that must remain at the
 * destination for the flight plan to pass. Injected so the threshold is
 * policy-driven.
 */
export interface ReservePolicy {
  required_reserve_minutes: number;
}

// --- Validation bounds ------------------------------------------------------

/** Weather snapshot must be no older than this at submission (req 3.1: 60 min). */
export const MAX_WEATHER_AGE_MS = 60 * 60 * 1000;

/** Inclusive crew roster size bounds (req 3.3: 2–6 members). */
export const MIN_CREW_MEMBERS = 2;
export const MAX_CREW_MEMBERS = 6;

/** Inclusive Glasgow Coma Scale bounds (design: GCS is an integer 3..15). */
export const MIN_GCS = 3;
export const MAX_GCS = 15;

/** Minimum number of route waypoints for a Stage 4 flight plan (origin+dest). */
export const MIN_ROUTE_WAYPOINTS = 2;

/** Default cruise ground speed (kts) when a Stage 4 submission omits one. */
export const DEFAULT_CRUISE_SPEED_KTS = 130;

/** Default fuel burn (lbs/hour) when a Stage 4 submission omits one. */
export const DEFAULT_FUEL_BURN_LBS_PER_HOUR = 600;

/** Default usable fuel aboard (lbs) when a Stage 4 submission omits one. */
export const DEFAULT_USABLE_FUEL_LBS = 1400;

/** Default inclusive maximum for any single PAVE component score. */
export const DEFAULT_MAX_PAVE_COMPONENT_SCORE = 4;

/** Mean Earth radius in nautical miles, for great-circle distance. */
const EARTH_RADIUS_NM = 3440.065;

// --- Helpers ----------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A finite number strictly greater than zero. */
function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** A finite (not NaN/Infinity) number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Clamp `value` into [min, max] and round to the nearest integer. */
function clampToIntegerRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Great-circle distance in nautical miles between two WGS84 points (haversine).
 * Deterministic and dependency-free; used to size the flight-plan distances.
 */
function greatCircleDistanceNm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude_deg - a.latitude_deg);
  const dLon = toRad(b.longitude_deg - a.longitude_deg);
  const lat1 = toRad(a.latitude_deg);
  const lat2 = toRad(b.latitude_deg);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A geo point with finite latitude in [-90,90] and longitude in [-180,180]. */
function isValidGeoPoint(point: unknown): point is GeoPoint {
  if (typeof point !== "object" || point === null) {
    return false;
  }
  const p = point as { latitude_deg?: unknown; longitude_deg?: unknown };
  return (
    isFiniteNumber(p.latitude_deg) &&
    isFiniteNumber(p.longitude_deg) &&
    p.latitude_deg >= -90 &&
    p.latitude_deg <= 90 &&
    p.longitude_deg >= -180 &&
    p.longitude_deg <= 180
  );
}

// --- Stage 1: Details validation --------------------------------------------

/**
 * Validate a Stage 1 Details submission (req 3.1). Returns EVERY failed field
 * (req 3.2), never short-circuiting on the first. The caller decides whether to
 * open the next stage based on an empty error list.
 *
 * @param now Injectable clock for the weather-freshness gate (deterministic in
 *   tests).
 */
export function validateDetails(
  input: DetailsInput,
  lookup: DispatchLookupPort,
  now: Date,
): DispatchError[] {
  const errors: DispatchError[] = [];

  // Mission type must be one of the defined types.
  if (!isNonEmptyString(input.mission_type)) {
    errors.push({
      code: "MISSION_TYPE_INVALID",
      field: "mission_type",
      message: "mission type is required",
    });
  } else if (!(MISSION_TYPES as readonly string[]).includes(input.mission_type)) {
    errors.push({
      code: "MISSION_TYPE_INVALID",
      field: "mission_type",
      message: `mission type "${input.mission_type}" is not a defined mission type`,
      detail: input.mission_type,
    });
  }

  // Assigned base: present and references an existing configured record.
  if (!isNonEmptyString(input.assigned_base_id)) {
    errors.push({
      code: "BASE_MISSING",
      field: "assigned_base_id",
      message: "assigned base is required",
    });
  } else if (!lookup.baseExists(input.assigned_base_id)) {
    errors.push({
      code: "BASE_NOT_FOUND",
      field: "assigned_base_id",
      message: "assigned base does not reference an existing configured record",
      detail: input.assigned_base_id,
    });
  }

  // Assigned airframe: present and references an existing configured record.
  if (!isNonEmptyString(input.assigned_airframe_id)) {
    errors.push({
      code: "AIRFRAME_MISSING",
      field: "assigned_airframe_id",
      message: "assigned airframe is required",
    });
  } else if (!lookup.airframeExists(input.assigned_airframe_id)) {
    errors.push({
      code: "AIRFRAME_NOT_FOUND",
      field: "assigned_airframe_id",
      message: "assigned airframe does not reference an existing configured record",
      detail: input.assigned_airframe_id,
    });
  }

  // Origin facility: present and references an existing facility.
  const originPresent = isNonEmptyString(input.origin_hospital_id);
  if (!originPresent) {
    errors.push({
      code: "ORIGIN_MISSING",
      field: "origin_hospital_id",
      message: "origin facility is required",
    });
  } else if (!lookup.facilityExists(input.origin_hospital_id as Uuid)) {
    errors.push({
      code: "ORIGIN_NOT_FOUND",
      field: "origin_hospital_id",
      message: "origin does not reference an existing facility",
      detail: input.origin_hospital_id,
    });
  }

  // Destination facility: present and references an existing facility.
  const destinationPresent = isNonEmptyString(input.destination_hospital_id);
  if (!destinationPresent) {
    errors.push({
      code: "DESTINATION_MISSING",
      field: "destination_hospital_id",
      message: "destination facility is required",
    });
  } else if (!lookup.facilityExists(input.destination_hospital_id as Uuid)) {
    errors.push({
      code: "DESTINATION_NOT_FOUND",
      field: "destination_hospital_id",
      message: "destination does not reference an existing facility",
      detail: input.destination_hospital_id,
    });
  }

  // Origin and destination must not be identical (only meaningful when both
  // are present; a missing-field error already covers the absent case).
  if (
    originPresent &&
    destinationPresent &&
    input.origin_hospital_id === input.destination_hospital_id
  ) {
    errors.push({
      code: "ORIGIN_DESTINATION_IDENTICAL",
      field: "destination_hospital_id",
      message: "origin and destination facilities must not be identical",
      detail: input.destination_hospital_id,
    });
  }

  // Weather snapshot: captured with an age of 60 minutes or less.
  const weather = input.weather_snapshot;
  if (weather === undefined || weather === null) {
    errors.push({
      code: "WEATHER_SNAPSHOT_MISSING",
      field: "weather_snapshot",
      message: "a weather snapshot is required",
    });
  } else if (!isNonEmptyString(weather.observed_at)) {
    errors.push({
      code: "WEATHER_SNAPSHOT_INVALID",
      field: "weather_snapshot.observed_at",
      message: "weather snapshot is missing an observed_at timestamp",
    });
  } else {
    const observedMs = Date.parse(weather.observed_at);
    if (Number.isNaN(observedMs)) {
      errors.push({
        code: "WEATHER_SNAPSHOT_INVALID",
        field: "weather_snapshot.observed_at",
        message: "weather snapshot observed_at is not a valid timestamp",
      });
    } else {
      const ageMs = now.getTime() - observedMs;
      // A future-dated snapshot (ageMs < 0) has age 0 or less, which is within
      // the freshness window; only a snapshot older than the window fails.
      if (ageMs > MAX_WEATHER_AGE_MS) {
        errors.push({
          code: "WEATHER_SNAPSHOT_STALE",
          field: "weather_snapshot.observed_at",
          message: "weather snapshot is older than 60 minutes at submission",
          detail: weather.observed_at,
        });
      }
    }
  }

  return errors;
}

// --- Stage 2: Crew validation -----------------------------------------------

/**
 * Validate a Stage 2 Crew submission (req 3.3). Returns EVERY failed condition
 * (req 3.3a) — multiple PICs, no PIC, duplicate member, member with no role, or
 * roster size outside 2–6 — never short-circuiting on the first.
 */
export function validateCrew(input: CrewInput): DispatchError[] {
  const errors: DispatchError[] = [];
  const members = input.members ?? [];

  // Roster size must be within 2..6 inclusive.
  if (members.length < MIN_CREW_MEMBERS) {
    errors.push({
      code: "CREW_ROSTER_TOO_SMALL",
      field: "members",
      message: `crew roster must contain at least ${MIN_CREW_MEMBERS} members (has ${members.length})`,
      detail: String(members.length),
    });
  } else if (members.length > MAX_CREW_MEMBERS) {
    errors.push({
      code: "CREW_ROSTER_TOO_LARGE",
      field: "members",
      message: `crew roster must contain at most ${MAX_CREW_MEMBERS} members (has ${members.length})`,
      detail: String(members.length),
    });
  }

  // Exactly one pilot in command.
  const picCount = members.filter((m) => m.is_pilot_in_command === true).length;
  if (picCount === 0) {
    errors.push({
      code: "PIC_MISSING",
      field: "members",
      message: "exactly one crew member must be designated pilot in command; none was",
    });
  } else if (picCount > 1) {
    errors.push({
      code: "PIC_MULTIPLE",
      field: "members",
      message: `exactly one crew member must be designated pilot in command; ${picCount} were`,
      detail: String(picCount),
    });
  }

  // Each member must be assigned a defined role.
  for (let i = 0; i < members.length; i++) {
    const member = members[i]!;
    if (!isNonEmptyString(member.role)) {
      errors.push({
        code: "CREW_MEMBER_MISSING_ROLE",
        field: `members[${i}].role`,
        message: `crew member at index ${i} has no defined role`,
        detail: member.member_id,
      });
    }
  }

  // No duplicate member (same member_id appearing more than once). Members
  // without an id are handled as their own concern; a missing id is not a
  // duplicate but does mean the entry cannot be uniquely identified — flag it
  // once as a duplicate-detection failure so it is never silently accepted.
  const seen = new Set<string>();
  const reportedDuplicates = new Set<string>();
  for (let i = 0; i < members.length; i++) {
    const id = members[i]!.member_id;
    if (!isNonEmptyString(id)) {
      errors.push({
        code: "CREW_DUPLICATE_MEMBER",
        field: `members[${i}].member_id`,
        message: `crew member at index ${i} is missing an identifier and cannot be de-duplicated`,
      });
      continue;
    }
    if (seen.has(id)) {
      if (!reportedDuplicates.has(id)) {
        errors.push({
          code: "CREW_DUPLICATE_MEMBER",
          field: "members",
          message: `crew member "${id}" appears more than once in the roster`,
          detail: id,
        });
        reportedDuplicates.add(id);
      }
    } else {
      seen.add(id);
    }
  }

  return errors;
}

/**
 * Project a validated crew membership list onto the {@link CrewRoster} contract.
 * Call this only after {@link validateCrew} returns no errors. The projection is
 * intentionally minimal: PIC id plus the nurse/paramedic ids resolved by role,
 * so the mission package (task 8.3) can persist a `CrewRoster`.
 */
export function toCrewRoster(input: CrewInput): CrewRoster {
  const members = input.members ?? [];
  const pic = members.find((m) => m.is_pilot_in_command === true);
  const byRole = (needle: string): Uuid | undefined =>
    members.find(
      (m) =>
        m.is_pilot_in_command !== true &&
        typeof m.role === "string" &&
        m.role.trim().toUpperCase().includes(needle),
    )?.member_id;

  return {
    pilot_in_command_id: pic?.member_id as Uuid,
    flight_nurse_id: byRole("NURSE"),
    flight_paramedic_id: byRole("PARAMEDIC"),
  };
}

// --- Stage 3: Patient Info validation (req 3.4) -----------------------------

/**
 * Derive a baseline GCS as an integer in 3..15 (req 3.4) from a resolved
 * {@link MedicalCondition}. The condition carries a `[baseline_gcs_min,
 * baseline_gcs_max]` range; the derived baseline is deterministic:
 *
 *   - If the caller supplied a `baseline_gcs` hint that already falls inside the
 *     condition's range (and the GCS bounds), it is used verbatim (rounded to an
 *     integer). This lets a dispatcher record a specific presentation.
 *   - Otherwise the baseline is the condition-range midpoint (rounded), which is
 *     a stable, reproducible representative value.
 *
 * The result is always clamped into the absolute GCS bounds 3..15 so it can
 * never fall outside the scale even if a condition record's range is wider.
 */
export function deriveDispatchBaselineGcs(
  condition: MedicalCondition,
  suppliedBaselineGcs?: number,
): number {
  const lo = clampToIntegerRange(condition.baseline_gcs_min, MIN_GCS, MAX_GCS);
  const hi = clampToIntegerRange(condition.baseline_gcs_max, MIN_GCS, MAX_GCS);
  const rangeLo = Math.min(lo, hi);
  const rangeHi = Math.max(lo, hi);

  if (
    isFiniteNumber(suppliedBaselineGcs) &&
    Math.round(suppliedBaselineGcs) >= rangeLo &&
    Math.round(suppliedBaselineGcs) <= rangeHi
  ) {
    return clampToIntegerRange(suppliedBaselineGcs, MIN_GCS, MAX_GCS);
  }

  const midpoint = (rangeLo + rangeHi) / 2;
  return clampToIntegerRange(midpoint, MIN_GCS, MAX_GCS);
}

/**
 * Validate a Stage 3 Patient Info submission (req 3.4). Returns EVERY failed
 * condition — missing/incomplete patient fields, an unresolvable condition, or a
 * condition whose GCS range is itself invalid — never short-circuiting on the
 * first. Resolution of the medical condition goes through the injected
 * {@link ConditionResolverPort} so this module stays independent of the clinical
 * engine.
 *
 * On an empty error list, the caller can derive the baseline GCS with
 * {@link deriveDispatchBaselineGcs} and open Stage 4 (see {@link advanceDispatch}).
 */
export function validatePatientInfo(
  input: PatientInfoInput,
  resolver: ConditionResolverPort,
): DispatchError[] {
  const errors: DispatchError[] = [];

  if (input === undefined || input === null) {
    return [
      {
        code: "PATIENT_MISSING",
        field: "patient",
        message: "a simulated patient submission is required",
      },
    ];
  }

  if (!isNonEmptyString(input.simulated_patient_id)) {
    errors.push({
      code: "PATIENT_ID_MISSING",
      field: "simulated_patient_id",
      message: "simulated patient id is required",
    });
  }

  // Age: a finite, non-negative number (a simulated patient may be an infant,
  // so 0 is permitted; a negative or non-finite age is not).
  if (!isFiniteNumber(input.age_years) || input.age_years < 0) {
    errors.push({
      code: "PATIENT_AGE_INVALID",
      field: "age_years",
      message: "patient age must be a non-negative number of years",
    });
  }

  if (!isNonEmptyString(input.gender)) {
    errors.push({
      code: "PATIENT_GENDER_MISSING",
      field: "gender",
      message: "patient gender is required",
    });
  }

  if (!isPositiveFiniteNumber(input.weight_lbs)) {
    errors.push({
      code: "PATIENT_WEIGHT_INVALID",
      field: "weight_lbs",
      message: "patient weight must be a positive number of pounds",
    });
  }

  if (!isNonEmptyString(input.clinical_summary)) {
    errors.push({
      code: "PATIENT_CLINICAL_SUMMARY_MISSING",
      field: "clinical_summary",
      message: "a clinical summary is required",
    });
  }

  if (!isNonEmptyString(input.interventions)) {
    errors.push({
      code: "PATIENT_INTERVENTIONS_MISSING",
      field: "interventions",
      message: "an interventions description is required",
    });
  }

  // Condition: present and resolvable to an existing condition record.
  if (!isNonEmptyString(input.condition_id)) {
    errors.push({
      code: "PATIENT_CONDITION_MISSING",
      field: "condition_id",
      message: "a medical condition is required",
    });
  } else {
    const condition = resolver.resolveCondition(input.condition_id);
    if (condition === undefined) {
      errors.push({
        code: "PATIENT_CONDITION_NOT_FOUND",
        field: "condition_id",
        message:
          "selected medical condition does not resolve to an existing condition record",
        detail: input.condition_id,
      });
    } else if (
      !isFiniteNumber(condition.baseline_gcs_min) ||
      !isFiniteNumber(condition.baseline_gcs_max) ||
      condition.baseline_gcs_min > condition.baseline_gcs_max
    ) {
      // A resolvable condition whose GCS range is missing/inverted cannot yield
      // a defensible baseline; surface it rather than silently mid-pointing.
      errors.push({
        code: "PATIENT_CONDITION_GCS_RANGE_INVALID",
        field: "condition_id",
        message:
          "resolved medical condition has an invalid baseline GCS range",
        detail: input.condition_id,
      });
    } else if (
      isFiniteNumber(input.baseline_gcs) &&
      (Math.round(input.baseline_gcs) < MIN_GCS ||
        Math.round(input.baseline_gcs) > MAX_GCS)
    ) {
      // A supplied baseline hint outside the absolute 3..15 scale is rejected;
      // an omitted or in-range hint is fine (the derivation handles both).
      errors.push({
        code: "PATIENT_BASELINE_GCS_OUT_OF_RANGE",
        field: "baseline_gcs",
        message: `supplied baseline GCS must be an integer between ${MIN_GCS} and ${MAX_GCS}`,
        detail: String(input.baseline_gcs),
      });
    }
  }

  return errors;
}

/**
 * Project a validated Stage 3 submission onto the {@link PatientInput} contract,
 * applying the derived baseline GCS. Call only after {@link validatePatientInfo}
 * returns no errors (the condition is guaranteed resolvable and its range valid).
 */
export function toPatientInput(
  input: PatientInfoInput,
  resolver: ConditionResolverPort,
): PatientInput {
  const condition = resolver.resolveCondition(input.condition_id as Uuid)!;
  return {
    simulated_patient_id: input.simulated_patient_id as Uuid,
    age_years: input.age_years as number,
    gender: input.gender as string,
    weight_lbs: input.weight_lbs as number,
    condition_id: input.condition_id as Uuid,
    clinical_summary: input.clinical_summary as string,
    interventions: input.interventions as string,
    baseline_gcs: deriveDispatchBaselineGcs(condition, input.baseline_gcs),
  };
}

// --- Stage 4: Flight Plan calculation & validation (req 3.5) ----------------

/**
 * Compute a deterministic {@link PAVERisk} from injected component scores and a
 * {@link PavePolicy}. The total is the sum of the four components; the
 * disposition maps the total against the policy thresholds (≤ go_max → GO, ≤
 * conditional_max → CONDITIONAL, else NO_GO). Rationale strings record each
 * component and the threshold decision so the result is explainable.
 */
export function calculatePaveRisk(
  scores: PaveScoreInput,
  policy: PavePolicy,
): PAVERisk {
  const pilot = isFiniteNumber(scores.pilot_score) ? scores.pilot_score : 0;
  const aircraft = isFiniteNumber(scores.aircraft_score)
    ? scores.aircraft_score
    : 0;
  const environment = isFiniteNumber(scores.environment_score)
    ? scores.environment_score
    : 0;
  const external = isFiniteNumber(scores.external_score)
    ? scores.external_score
    : 0;
  const total = pilot + aircraft + environment + external;

  let disposition: PaveDisposition;
  if (total <= policy.go_max) {
    disposition = "GO";
  } else if (total <= policy.conditional_max) {
    disposition = "CONDITIONAL";
  } else {
    disposition = "NO_GO";
  }

  return {
    pilot_score: pilot,
    aircraft_score: aircraft,
    environment_score: environment,
    external_score: external,
    total_score: total,
    disposition,
    rationale: [
      `pilot=${pilot}`,
      `aircraft=${aircraft}`,
      `environment=${environment}`,
      `external=${external}`,
      `total=${total}`,
      `disposition=${disposition} (go_max=${policy.go_max}, conditional_max=${policy.conditional_max})`,
    ],
  };
}

/**
 * Compute a deterministic {@link FlightPlan} from a validated route and the
 * fuel/speed parameters. Distances use the great-circle (haversine) length:
 * `direct_distance_nm` is origin→destination; `planned_distance_nm` is the sum
 * of consecutive route legs. Fuel burn and the reserve-at-destination endurance
 * follow from the planned distance, cruise speed, and usable fuel. Call only
 * after {@link validateFlightPlan} confirms the route and parameters are valid.
 */
export function calculateFlightPlan(
  input: FlightPlanInput,
  reservePolicy: ReservePolicy,
): FlightPlan {
  const route = (input.route ?? []) as GeoPoint[];
  const cruiseSpeed = isPositiveFiniteNumber(input.cruise_speed_kts)
    ? input.cruise_speed_kts
    : DEFAULT_CRUISE_SPEED_KTS;
  const burnRate = isPositiveFiniteNumber(input.fuel_burn_lbs_per_hour)
    ? input.fuel_burn_lbs_per_hour
    : DEFAULT_FUEL_BURN_LBS_PER_HOUR;
  const usableFuel = isPositiveFiniteNumber(input.usable_fuel_lbs)
    ? input.usable_fuel_lbs
    : DEFAULT_USABLE_FUEL_LBS;

  const origin = route[0]!;
  const destination = route[route.length - 1]!;
  const directDistanceNm = greatCircleDistanceNm(origin, destination);

  let plannedDistanceNm = 0;
  for (let i = 1; i < route.length; i++) {
    plannedDistanceNm += greatCircleDistanceNm(route[i - 1]!, route[i]!);
  }

  // Endurance in minutes at cruise for the planned distance, and total usable
  // endurance from fuel aboard. Reserve at destination is the endurance left
  // once the planned leg is flown.
  const plannedTimeHours = plannedDistanceNm / cruiseSpeed;
  const estimatedFuelBurnLbs = plannedTimeHours * burnRate;
  const totalEnduranceMinutes = (usableFuel / burnRate) * 60;
  const plannedTimeMinutes = plannedTimeHours * 60;
  const reserveAtDestinationMinutes = totalEnduranceMinutes - plannedTimeMinutes;

  return {
    route,
    direct_distance_nm: directDistanceNm,
    planned_distance_nm: plannedDistanceNm,
    estimated_fuel_burn_lbs: estimatedFuelBurnLbs,
    reserve_requirement_minutes: reservePolicy.required_reserve_minutes,
    reserve_at_destination_minutes: reserveAtDestinationMinutes,
  };
}

/**
 * Validate a Stage 4 Flight Plan submission (req 3.5). Returns EVERY failed
 * condition, never short-circuiting. Validation is structural (route present and
 * well-formed, PAVE scores present and in range, reserve policy present and
 * well-formed) plus the two req-3.5 gates computed from the deterministic
 * calculations:
 *
 *   - the reserve margin at destination must be ≥ the policy's required reserve
 *     (RESERVE_MARGIN_INSUFFICIENT), and
 *   - the PAVE disposition must not be NO_GO (DISPATCH_DISPOSITION_NO_GO).
 *
 * A GO or CONDITIONAL disposition passes the disposition gate; the design's
 * `require_dispatch_disposition` rejects only a NO_GO.
 */
export function validateFlightPlan(
  input: FlightPlanInput,
  reservePolicy: ReservePolicy | undefined,
  pavePolicy: PavePolicy,
): DispatchError[] {
  const errors: DispatchError[] = [];
  const maxComponent =
    pavePolicy.max_component_score ?? DEFAULT_MAX_PAVE_COMPONENT_SCORE;

  // Route: present, an array of at least two valid geo points.
  const route = input.route;
  if (route === undefined || route === null) {
    errors.push({
      code: "FLIGHT_PLAN_ROUTE_MISSING",
      field: "route",
      message: "a flight-plan route is required",
    });
  } else if (!Array.isArray(route) || route.length < MIN_ROUTE_WAYPOINTS) {
    errors.push({
      code: "FLIGHT_PLAN_ROUTE_INVALID",
      field: "route",
      message: `route must contain at least ${MIN_ROUTE_WAYPOINTS} waypoints`,
      detail: Array.isArray(route) ? String(route.length) : undefined,
    });
  } else {
    const badIndex = route.findIndex((p) => !isValidGeoPoint(p));
    if (badIndex !== -1) {
      errors.push({
        code: "FLIGHT_PLAN_ROUTE_INVALID",
        field: `route[${badIndex}]`,
        message: `route waypoint at index ${badIndex} is not a valid coordinate`,
      });
    }
  }

  // PAVE component scores: present and each finite in 0..maxComponent.
  const pave = input.pave;
  if (pave === undefined || pave === null) {
    errors.push({
      code: "PAVE_SCORES_MISSING",
      field: "pave",
      message: "PAVE component scores are required",
    });
  } else {
    const components: [string, unknown][] = [
      ["pilot_score", pave.pilot_score],
      ["aircraft_score", pave.aircraft_score],
      ["environment_score", pave.environment_score],
      ["external_score", pave.external_score],
    ];
    for (const [name, value] of components) {
      if (!isFiniteNumber(value) || value < 0 || value > maxComponent) {
        errors.push({
          code: "PAVE_SCORE_INVALID",
          field: `pave.${name}`,
          message: `PAVE ${name} must be a finite number between 0 and ${maxComponent}`,
        });
      }
    }
  }

  // Reserve policy: present with a finite non-negative required reserve.
  if (reservePolicy === undefined || reservePolicy === null) {
    errors.push({
      code: "RESERVE_POLICY_MISSING",
      field: "reserve_policy",
      message: "a reserve policy is required to evaluate the flight plan",
    });
  } else if (
    !isFiniteNumber(reservePolicy.required_reserve_minutes) ||
    reservePolicy.required_reserve_minutes < 0
  ) {
    errors.push({
      code: "RESERVE_POLICY_INVALID",
      field: "reserve_policy.required_reserve_minutes",
      message: "reserve policy required reserve minutes must be a non-negative number",
    });
  }

  // The two computed req-3.5 gates only run once the structural inputs are
  // sound enough to compute deterministically.
  const structurallyValid = errors.length === 0;
  if (structurallyValid && reservePolicy !== undefined) {
    const plan = calculateFlightPlan(input, reservePolicy);
    if (
      plan.reserve_at_destination_minutes < reservePolicy.required_reserve_minutes
    ) {
      errors.push({
        code: "RESERVE_MARGIN_INSUFFICIENT",
        field: "route",
        message:
          `computed reserve at destination (${plan.reserve_at_destination_minutes.toFixed(1)} min) ` +
          `is below the required reserve (${reservePolicy.required_reserve_minutes} min)`,
        detail: plan.reserve_at_destination_minutes.toFixed(1),
      });
    }

    const risk = calculatePaveRisk(input.pave!, pavePolicy);
    if (risk.disposition === "NO_GO") {
      errors.push({
        code: "DISPATCH_DISPOSITION_NO_GO",
        field: "pave",
        message: `PAVE disposition is NO_GO (total score ${risk.total_score}); dispatch is not permitted`,
        detail: risk.disposition,
      });
    }
  }

  return errors;
}

// --- Stage-advance restriction (req 3.8) ------------------------------------

/**
 * Determine whether advancing to `requested` is permitted given the mission's
 * current stage (design 6.3: `requested IS CURRENT_STAGE OR requested IS
 * PREVIOUS_STAGE`; req 3.8). A request is permitted only for the current stage
 * or a previously completed (earlier-index) stage. A request targeting a stage
 * beyond the current one — which would skip an incomplete stage — is rejected,
 * and the error names the first incomplete stage that would be skipped.
 */
export function checkStageAdvancePermitted(
  currentStage: DispatchStage,
  requested: DispatchStage,
): DispatchError | null {
  const currentIdx = stageIndex(currentStage);
  const requestedIdx = stageIndex(requested);

  if (requestedIdx <= currentIdx) {
    return null;
  }

  // The current stage is the first incomplete stage; any target beyond it skips
  // the current (incomplete) stage. Name that incomplete stage (req 3.8).
  return {
    code: "STAGE_ADVANCE_NOT_PERMITTED",
    field: "requested_stage",
    message:
      `cannot advance to ${requested}: stage ${currentStage} is incomplete and ` +
      `may not be skipped`,
    detail: currentStage,
  };
}

// --- advance_dispatch (design Section 6.3) ----------------------------------

/** The mission context the state machine reads/advances. */
export interface DispatchMissionContext {
  /** The first not-yet-completed stage — the stage currently open for input. */
  currentStage: DispatchStage;
}

/** Injectable dependencies for {@link advanceDispatch}. */
export interface AdvanceDispatchDependencies {
  lookup: DispatchLookupPort;
  /** Returns "now" for the weather-freshness gate. Injectable for tests. */
  now?: () => Date;
  /**
   * Resolves the Stage 3 medical condition (req 3.4). Required to validate a
   * PATIENT_INFO submission; omit it only when advancing DETAILS/CREW.
   */
  conditionResolver?: ConditionResolverPort;
  /**
   * Reserve fuel policy for the Stage 4 reserve-margin gate (req 3.5). Required
   * to validate a FLIGHT_PLAN submission.
   */
  reservePolicy?: ReservePolicy;
  /**
   * PAVE disposition thresholds for the Stage 4 risk calculation (req 3.5).
   * Required to validate a FLIGHT_PLAN submission.
   */
  pavePolicy?: PavePolicy;
}

/**
 * Advance a mission to `requestedStage` with the submitted `input`
 * (design Section 6.3).
 *
 * Guarding order:
 *   1. Stage-advance restriction (req 3.8): reject a request that would skip the
 *      current incomplete stage, before any stage-specific validation.
 *   2. Stage-specific validation (Stage 1 → req 3.1/3.2; Stage 2 → req
 *      3.3/3.3a). On failure the next stage stays closed and EVERY failed
 *      condition is returned with the input retained.
 *
 * On success the returned `openedStage` is the stage the workflow opens next
 * (design 6.3: DETAILS opens CREW, CREW opens PATIENT_INFO, PATIENT_INFO opens
 * FLIGHT_PLAN). A successful FLIGHT_PLAN submission opens no further stage;
 * instead it returns `readyToAuthorize: true` with the computed {@link PAVERisk}
 * and {@link FlightPlan}. Authorization/audit (setting DISPATCHED, issuing a
 * code, publishing to the EFB) is task 8.3 and is deliberately left as a seam
 * here.
 */
export type DispatchStageInput =
  | DetailsInput
  | CrewInput
  | PatientInfoInput
  | FlightPlanInput;

export function advanceDispatch(
  mission: DispatchMissionContext,
  requestedStage: DispatchStage,
  input: DispatchStageInput,
  deps: AdvanceDispatchDependencies,
): AdvanceResult<DispatchStageInput> {
  const now = (deps.now ?? (() => new Date()))();

  // 1. Stage-advance restriction (req 3.8).
  const advanceError = checkStageAdvancePermitted(
    mission.currentStage,
    requestedStage,
  );
  if (advanceError !== null) {
    return { ok: false, errors: [advanceError], retainedInput: input };
  }

  // 2. Stage-specific validation.
  switch (requestedStage) {
    case "DETAILS": {
      const detailsInput = input as DetailsInput;
      const errors = validateDetails(detailsInput, deps.lookup, now);
      if (errors.length > 0) {
        return { ok: false, errors, retainedInput: detailsInput };
      }
      // Success opens the CREW stage (design 6.3).
      return { ok: true, openedStage: "CREW" };
    }

    case "CREW": {
      const crewInput = input as CrewInput;
      const errors = validateCrew(crewInput);
      if (errors.length > 0) {
        return { ok: false, errors, retainedInput: crewInput };
      }
      // Success opens the PATIENT_INFO stage (design 6.3).
      return { ok: true, openedStage: "PATIENT_INFO" };
    }

    case "PATIENT_INFO": {
      const patientInput = input as PatientInfoInput;
      if (deps.conditionResolver === undefined) {
        return {
          ok: false,
          errors: [
            {
              code: "PATIENT_CONDITION_NOT_FOUND",
              field: "condition_id",
              message:
                "no condition resolver is configured; cannot resolve the medical condition",
            },
          ],
          retainedInput: patientInput,
        };
      }
      const errors = validatePatientInfo(patientInput, deps.conditionResolver);
      if (errors.length > 0) {
        return { ok: false, errors, retainedInput: patientInput };
      }
      // Success derives the baseline GCS and opens the FLIGHT_PLAN stage
      // (design 6.3). The derived patient is returned so the caller can persist
      // `mission.patient`.
      const patient = toPatientInput(patientInput, deps.conditionResolver);
      return { ok: true, openedStage: "FLIGHT_PLAN", patient };
    }

    case "FLIGHT_PLAN": {
      const flightPlanInput = input as FlightPlanInput;
      if (deps.reservePolicy === undefined || deps.pavePolicy === undefined) {
        return {
          ok: false,
          errors: [
            {
              code: "RESERVE_POLICY_MISSING",
              field: "reserve_policy",
              message:
                "reserve policy and PAVE policy are required to evaluate the flight plan",
            },
          ],
          retainedInput: flightPlanInput,
        };
      }
      const errors = validateFlightPlan(
        flightPlanInput,
        deps.reservePolicy,
        deps.pavePolicy,
      );
      if (errors.length > 0) {
        return { ok: false, errors, retainedInput: flightPlanInput };
      }
      // All four stages have passed. Compute the validated artifacts and mark
      // the mission ready to authorize. Authorization (issuing a code, setting
      // DISPATCHED, publishing to the EFB, appending the audit event) is task
      // 8.3 and is intentionally NOT performed here — this is the seam that
      // layer wraps (design 6.3).
      const risk = calculatePaveRisk(flightPlanInput.pave!, deps.pavePolicy);
      const flightPlan = calculateFlightPlan(
        flightPlanInput,
        deps.reservePolicy,
      );
      return { ok: true, readyToAuthorize: true, risk, flightPlan };
    }

    default: {
      // Exhaustiveness guard — unreachable for a valid DispatchStage.
      const _exhaustive: never = requestedStage;
      return {
        ok: false,
        errors: [
          {
            code: "STAGE_NOT_IMPLEMENTED",
            field: "requested_stage",
            message: `unknown stage ${String(_exhaustive)}`,
          },
        ],
        retainedInput: input,
      };
    }
  }
}
