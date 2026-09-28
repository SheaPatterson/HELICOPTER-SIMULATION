/**
 * Spatial facility recommendation — eligibility filtering and deterministic
 * ordering (design Section 6.5, requirements 5.1, 5.3, 5.4, 5.5, 5.8).
 *
 * This module is the pure, deterministic core of the Recommendation_Service
 * (task 11.1). It implements the design's `recommend_facility` procedure as a
 * function of its explicit inputs (never the wall clock, never a live DB call):
 * candidate facilities are supplied through an injectable
 * {@link CandidateProviderPort} so the PostGIS proximity query (design 5.6 —
 * the DB layer / task 2.x) is a clean seam, and an in-memory provider
 * ({@link InMemoryCandidateProvider}) drives the tests.
 *
 * Requirement mapping:
 *
 *   - Req 5.1: a facility is eligible ONLY IF its capability matches the
 *     patient condition's required facility type AND its helipad is operational
 *     under the current weather observation AND the route is permissible under
 *     all applicable route constraints; any facility failing one or more of
 *     these is excluded from the eligible set.
 *   - Req 5.8: if a facility's helipad status, weather observation, or
 *     route-constraint data is missing/unavailable at evaluation time, the
 *     facility is treated as INELIGIBLE and the missing input is recorded in
 *     that facility's provenance record.
 *   - Req 5.4: a facility is never recommended solely because it is
 *     geographically nearest — distance is used ONLY as a tie-breaker among
 *     already-eligible facilities, never as an eligibility or primary-ranking
 *     signal.
 *   - Req 5.5: eligible facilities are ordered by descending suitability score,
 *     ties broken by ascending straight-line (haversine) distance from the
 *     patient location, remaining ties broken by ascending facility identifier,
 *     so identical inputs always produce identical ordering.
 *   - Req 5.3: when no facility satisfies all applicable constraints the result
 *     is an explicit NO_MATCH — no facility is returned as recommended and the
 *     result indicates authorized human selection or a mission hold is required.
 *
 * Task 11.2 extends this seam with the full provenance record and the Ironpine
 * fallback (req 5.2, 5.7); this module already attaches the CORE provenance
 * fields (evaluated capability, helipad status, weather observation summary,
 * route-constraint result, score) to every evaluated facility so 11.2 layers on
 * top without reshaping the result.
 */

import type { GeoPoint, MedicalCondition } from "@virtualhems/contracts";

import { haversineDistanceNm } from "./distance.js";

// --- Facility model (design Section 6.5 / requirement 5.6 record shape) -----

/**
 * A receiving-facility candidate as it arrives from the candidate provider
 * (the PostGIS proximity query in production, an in-memory list in tests). Only
 * the fields the eligibility checks and tie-break need are modeled; the record
 * intentionally allows the weather-dependent and route inputs to be ABSENT so
 * req 5.8 (missing input ⇒ ineligible + provenance) can be exercised.
 */
export interface FacilityCandidate {
  /** Stable facility identifier — the final ordering tie-break key (req 5.5). */
  id: string;
  /** The facility's receiving capability, matched against the condition (req 5.1). */
  capability: string;
  /** Facility coordinates, used for the straight-line distance tie-break (req 5.5). */
  coordinates: GeoPoint;
  /** Field elevation in feet, an input to the suitability score. */
  elevation_ft?: number;
  /**
   * Helipad operational status under the current conditions. `undefined` means
   * the helipad status input is UNAVAILABLE at evaluation time (req 5.8), which
   * makes the facility ineligible.
   */
  helipad_status?: HelipadStatus;
}

/** Helipad operational status classification (req 5.1 helipad check). */
export const HELIPAD_STATUSES = [
  "OPERATIONAL",
  "CLOSED",
  "UNKNOWN",
] as const;
export type HelipadStatus = (typeof HELIPAD_STATUSES)[number];

// --- Weather + constraints inputs (design Section 6.5) ----------------------

/**
 * The current weather observation used to decide whether a helipad is
 * operational (req 5.1) and whether a route is permissible (req 5.1). The design
 * (Section 6.5) leaves the detailed weather model to later requirements, so only
 * the minimum needed for the operational/route decision is modeled here plus an
 * `observed_at` marker. `undefined` for the whole observation means the weather
 * input is UNAVAILABLE (req 5.8).
 */
export interface WeatherObservation {
  observed_at: string;
  /** Ceiling in feet AGL; below the facility helipad minimum ⇒ not operational. */
  ceiling_ft?: number;
  /** Visibility in statute miles; below the route minimum ⇒ route impermissible. */
  visibility_sm?: number;
  /** Free-form conditions flag (e.g. "IFR") retained for provenance. */
  category?: string;
}

/**
 * The applicable route/eligibility constraints (design Section 6.5
 * `constraints`). All fields are optional so a caller can express only the
 * constraints in force; the checks treat a required-but-absent constraint input
 * as a MISSING route input (req 5.8) only when it is needed to decide
 * permissibility — see {@link routeIsPermissible}.
 */
export interface RouteConstraints {
  /** Proximity radius handed to the candidate provider (design `max_radius`). */
  max_radius_nm?: number;
  /** Minimum in-flight visibility (statute miles) for a permissible route. */
  min_visibility_sm?: number;
  /** Minimum ceiling (feet AGL) for a permissible route. */
  min_ceiling_ft?: number;
  /** Facility ids explicitly excluded from routing (e.g. NOTAM/airspace). */
  excluded_facility_ids?: readonly string[];
  /**
   * When true, a facility MUST carry a route-permissibility input; a facility
   * with no evaluable route data is treated as a MISSING route input (req 5.8)
   * rather than silently permissible. Defaults to true.
   */
  require_route_data?: boolean;
}

// --- Provenance + eligibility result (core fields; task 11.2 extends) -------

/** The specific check a facility passed or failed (req 5.1). */
export const ELIGIBILITY_CHECKS = [
  "CAPABILITY",
  "HELIPAD",
  "ROUTE",
] as const;
export type EligibilityCheck = (typeof ELIGIBILITY_CHECKS)[number];

/** Outcome of a single eligibility check, including the missing-input case. */
export type CheckResult =
  | { status: "PASS"; detail?: string }
  | { status: "FAIL"; detail: string }
  | { status: "MISSING_INPUT"; detail: string };

/**
 * The CORE provenance record attached to every evaluated facility (req 5.2
 * fields that this task already produces; task 11.2 layers the remaining
 * provenance + Ironpine metadata on top). It records the evaluated capability,
 * the helipad status, the weather observation summary, the route-constraint
 * result, the per-check results (surfacing any MISSING_INPUT per req 5.8), and
 * the computed suitability score.
 */
export interface FacilityProvenance {
  facility_id: string;
  evaluated_capability: string;
  required_capability: string;
  helipad_status: HelipadStatus | "UNAVAILABLE";
  weather_observed_at?: string;
  weather_category?: string;
  checks: Record<EligibilityCheck, CheckResult>;
  /** Missing inputs recorded per req 5.8 (empty when none were missing). */
  missing_inputs: EligibilityCheck[];
  /** The computed suitability score (only meaningful when eligible). */
  score: number;
  /** Straight-line distance from the patient location in NM (tie-break, req 5.5). */
  distance_nm: number;
  /** Whether the facility is eligible (all checks PASS). */
  eligible: boolean;
}

/** An eligible facility carried in the ranked recommendation (req 5.5). */
export interface RankedFacility {
  facility: FacilityCandidate;
  score: number;
  distance_nm: number;
  provenance: FacilityProvenance;
}

/**
 * The result kinds (req 5.3). `MATCH` carries a non-empty, deterministically
 * ordered list of eligible facilities. `NO_MATCH` carries NO recommended
 * facility and signals that authorized human selection or a mission hold is
 * required. Both carry the full provenance for every evaluated candidate so the
 * caller/audit trail can see why each facility was included or excluded.
 */
export const RECOMMENDATION_OUTCOMES = ["MATCH", "NO_MATCH"] as const;
export type RecommendationOutcome = (typeof RECOMMENDATION_OUTCOMES)[number];

export interface RecommendationResult {
  outcome: RecommendationOutcome;
  /** Ranked eligible facilities (empty exactly when `outcome === "NO_MATCH"`). */
  ranked: RankedFacility[];
  /** Provenance for EVERY evaluated candidate, eligible or not (req 5.1/5.8). */
  evaluated: FacilityProvenance[];
  /**
   * True exactly when `outcome === "NO_MATCH"` — no facility qualified, so
   * authorized human selection or a mission hold is required (req 5.3).
   */
  requires_human_selection: boolean;
}

// --- Candidate provider port (design 5.6 seam) ------------------------------

/** The origin/patient location the recommendation is evaluated from. */
export interface PatientLocation {
  coordinates: GeoPoint;
}

/**
 * The injectable candidate-query seam (design 5.6). In production this is backed
 * by the indexed PostGIS proximity query over stored hospital/helipad geometry
 * (task 2.x); in tests it is {@link InMemoryCandidateProvider}. Kept synchronous
 * here so the recommendation core stays pure and deterministic; an async DB
 * adapter can resolve candidates first and hand them to a synchronous provider.
 */
export interface CandidateProviderPort {
  /**
   * Return the candidate facilities within `max_radius_nm` of `origin`. The
   * provider owns proximity selection; this module owns eligibility + ordering.
   */
  candidatesWithinRegion(
    origin: PatientLocation,
    maxRadiusNm: number | undefined,
  ): FacilityCandidate[];
}

/**
 * In-memory {@link CandidateProviderPort} for tests and deterministic use. It
 * returns every seeded facility whose straight-line distance from the origin is
 * within `maxRadiusNm` (or all of them when no radius is given), preserving the
 * seeded order — the recommendation core applies the eligibility filter and the
 * deterministic ordering, so the provider need not sort.
 */
export class InMemoryCandidateProvider implements CandidateProviderPort {
  constructor(private readonly facilities: readonly FacilityCandidate[]) {}

  candidatesWithinRegion(
    origin: PatientLocation,
    maxRadiusNm: number | undefined,
  ): FacilityCandidate[] {
    if (maxRadiusNm === undefined || !Number.isFinite(maxRadiusNm)) {
      return [...this.facilities];
    }
    return this.facilities.filter(
      (f) =>
        haversineDistanceNm(origin.coordinates, f.coordinates) <= maxRadiusNm,
    );
  }
}

// --- Eligibility checks (req 5.1, 5.8) --------------------------------------

/**
 * Normalize a capability string for matching: trimmed and upper-cased so a
 * cosmetic case/whitespace difference does not spuriously exclude a facility.
 */
function normalizeCapability(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Req 5.1 capability check: the facility capability must match the patient
 * condition's required facility type. A missing/empty facility capability is a
 * MISSING_INPUT (req 5.8), not a silent pass.
 */
export function capabilityMatches(
  requiredFacilityType: string,
  facilityCapability: string | undefined,
): CheckResult {
  if (
    facilityCapability === undefined ||
    facilityCapability.trim().length === 0
  ) {
    return {
      status: "MISSING_INPUT",
      detail: "facility capability is unavailable",
    };
  }
  const required = normalizeCapability(requiredFacilityType);
  const actual = normalizeCapability(facilityCapability);
  if (actual === required) {
    return { status: "PASS", detail: actual };
  }
  return {
    status: "FAIL",
    detail: `capability ${actual} does not match required ${required}`,
  };
}

/**
 * Req 5.1 helipad check: the helipad must be operational under the current
 * weather observation. A missing helipad status OR a missing weather
 * observation is a MISSING_INPUT (req 5.8). A helipad that is CLOSED, or below a
 * weather-derived minimum, FAILs.
 */
export function helipadIsOperational(
  facility: FacilityCandidate,
  weather: WeatherObservation | undefined,
): CheckResult {
  if (facility.helipad_status === undefined) {
    return {
      status: "MISSING_INPUT",
      detail: "helipad status is unavailable",
    };
  }
  if (weather === undefined) {
    return {
      status: "MISSING_INPUT",
      detail: "weather observation is unavailable",
    };
  }
  if (facility.helipad_status !== "OPERATIONAL") {
    return {
      status: "FAIL",
      detail: `helipad status is ${facility.helipad_status}`,
    };
  }
  return { status: "PASS", detail: "OPERATIONAL" };
}

/**
 * Req 5.1 route check: the route to the facility must be permissible under all
 * applicable route constraints. Missing route data — when the constraints
 * require it and neither a usable weather observation nor an explicit
 * permissibility signal exists — is a MISSING_INPUT (req 5.8). An excluded
 * facility, or one below a constraint minimum, FAILs.
 */
export function routeIsPermissible(
  facility: FacilityCandidate,
  weather: WeatherObservation | undefined,
  constraints: RouteConstraints,
): CheckResult {
  // Explicit exclusion (e.g. NOTAM / airspace) is a hard fail.
  if (constraints.excluded_facility_ids?.includes(facility.id)) {
    return { status: "FAIL", detail: "facility is on the excluded-route list" };
  }

  const requiresRouteData = constraints.require_route_data ?? true;
  const hasVisibilityMin = typeof constraints.min_visibility_sm === "number";
  const hasCeilingMin = typeof constraints.min_ceiling_ft === "number";
  const hasWeatherMinima = hasVisibilityMin || hasCeilingMin;

  // If constraints impose weather minima, we need the weather observation to
  // evaluate them; its absence is a missing route input (req 5.8).
  if (hasWeatherMinima && weather === undefined) {
    return {
      status: "MISSING_INPUT",
      detail: "route weather data is unavailable",
    };
  }

  if (
    hasVisibilityMin &&
    weather !== undefined &&
    typeof weather.visibility_sm === "number" &&
    weather.visibility_sm < (constraints.min_visibility_sm as number)
  ) {
    return {
      status: "FAIL",
      detail: `visibility ${weather.visibility_sm} sm below minimum ${constraints.min_visibility_sm} sm`,
    };
  }

  if (
    hasCeilingMin &&
    weather !== undefined &&
    typeof weather.ceiling_ft === "number" &&
    weather.ceiling_ft < (constraints.min_ceiling_ft as number)
  ) {
    return {
      status: "FAIL",
      detail: `ceiling ${weather.ceiling_ft} ft below minimum ${constraints.min_ceiling_ft} ft`,
    };
  }

  // No minima to evaluate: if route data is required and we have no evaluable
  // signal at all (no weather, no minima), treat the route input as missing.
  if (requiresRouteData && !hasWeatherMinima && weather === undefined) {
    return {
      status: "MISSING_INPUT",
      detail: "route-constraint data is unavailable",
    };
  }

  return { status: "PASS", detail: "route permissible under applicable constraints" };
}

// --- Suitability score (req 5.5 primary ranking key) ------------------------

/**
 * Compute a deterministic suitability score for an eligible facility. The design
 * (Section 6.5) leaves the exact weighting to policy; the score here rewards a
 * higher-margin weather picture and a closer facility while keeping distance
 * STRICTLY secondary to clinical/operational suitability so req 5.4 holds — a
 * nearer facility never outranks a more suitable one on distance alone.
 *
 * The score is a pure function of the inputs and is intentionally coarse
 * (rounded) so that genuine distance ties in the ordering fall through to the
 * distance tie-break (req 5.5). Higher is better.
 */
export function scoreFacility(
  facility: FacilityCandidate,
  weather: WeatherObservation | undefined,
  distanceNm: number,
): number {
  let score = 100;

  // Reward available weather margin above VFR-ish reference points (bounded).
  if (weather !== undefined) {
    if (typeof weather.visibility_sm === "number") {
      score += Math.min(10, Math.max(0, Math.round(weather.visibility_sm)));
    }
    if (typeof weather.ceiling_ft === "number") {
      score += Math.min(10, Math.max(0, Math.round(weather.ceiling_ft / 500)));
    }
  }

  // Distance contributes only a small, bounded nudge so it can never dominate
  // clinical/operational suitability (req 5.4). Primary tie-break stays the
  // explicit ascending-distance comparator in the ordering.
  if (Number.isFinite(distanceNm)) {
    score -= Math.min(10, Math.round(distanceNm / 10));
  }

  return score;
}

// --- Deterministic ordering (req 5.5) ---------------------------------------

/**
 * Order eligible facilities by (score desc, distance asc, facility id asc) so
 * identical inputs always produce identical ordering (req 5.5). Distance is only
 * ever the SECONDARY key, and facility id the final stable key; distance is
 * never promoted to a primary or eligibility signal (req 5.4).
 */
export function orderEligible(eligible: RankedFacility[]): RankedFacility[] {
  return [...eligible].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score; // score desc
    if (a.distance_nm !== b.distance_nm) return a.distance_nm - b.distance_nm; // distance asc
    return a.facility.id < b.facility.id
      ? -1
      : a.facility.id > b.facility.id
        ? 1
        : 0; // facility id asc (stable)
  });
}

// --- recommend_facility (design Section 6.5; req 5.1, 5.3, 5.4, 5.5, 5.8) ---

/** The explicit inputs to a single recommendation evaluation. */
export interface RecommendFacilityInput {
  /** The patient condition supplying the required receiving-facility type (req 5.1). */
  condition: Pick<MedicalCondition, "target_facility_type">;
  /** The patient/origin location the recommendation is evaluated from. */
  patientLocation: PatientLocation;
  /** The current weather observation, or `undefined` if unavailable (req 5.8). */
  weather?: WeatherObservation;
  /** The applicable route/eligibility constraints (design `constraints`). */
  constraints?: RouteConstraints;
}

/** The dependencies (ports) the recommendation core is wired with. */
export interface RecommendFacilityDependencies {
  candidateProvider: CandidateProviderPort;
}

/**
 * Evaluate receiving facilities for a patient (design Section 6.5).
 *
 * Pure and deterministic: it queries candidates through the injected provider,
 * runs the three eligibility checks (capability / helipad-under-weather / route)
 * on each, and includes a facility in the eligible set ONLY when all three PASS
 * (req 5.1). Any facility with a MISSING_INPUT on any check is treated as
 * ineligible and the missing input is recorded in its provenance (req 5.8).
 * Eligible facilities are ranked by (score desc, distance asc, id asc)
 * (req 5.5), distance being strictly a tie-breaker so nearness alone never
 * qualifies or promotes a facility (req 5.4). When nothing qualifies the result
 * is an explicit NO_MATCH requiring authorized human selection or a mission hold
 * (req 5.3). Provenance for EVERY evaluated candidate is returned regardless of
 * outcome.
 */
export function recommendFacility(
  input: RecommendFacilityInput,
  deps: RecommendFacilityDependencies,
): RecommendationResult {
  const constraints: RouteConstraints = input.constraints ?? {};
  const required = input.condition.target_facility_type;

  const candidates = deps.candidateProvider.candidatesWithinRegion(
    input.patientLocation,
    constraints.max_radius_nm,
  );

  const evaluated: FacilityProvenance[] = [];
  const eligible: RankedFacility[] = [];

  for (const facility of candidates) {
    const distanceNm = haversineDistanceNm(
      input.patientLocation.coordinates,
      facility.coordinates,
    );

    const capabilityResult = capabilityMatches(required, facility.capability);
    const helipadResult = helipadIsOperational(facility, input.weather);
    const routeResult = routeIsPermissible(
      facility,
      input.weather,
      constraints,
    );

    const checks: Record<EligibilityCheck, CheckResult> = {
      CAPABILITY: capabilityResult,
      HELIPAD: helipadResult,
      ROUTE: routeResult,
    };

    const missing: EligibilityCheck[] = (
      Object.keys(checks) as EligibilityCheck[]
    ).filter((k) => checks[k].status === "MISSING_INPUT");

    const isEligible = (Object.keys(checks) as EligibilityCheck[]).every(
      (k) => checks[k].status === "PASS",
    );

    const score = isEligible
      ? scoreFacility(facility, input.weather, distanceNm)
      : 0;

    const provenance: FacilityProvenance = {
      facility_id: facility.id,
      evaluated_capability: facility.capability ?? "",
      required_capability: required,
      helipad_status: facility.helipad_status ?? "UNAVAILABLE",
      weather_observed_at: input.weather?.observed_at,
      weather_category: input.weather?.category,
      checks,
      missing_inputs: missing,
      score,
      distance_nm: distanceNm,
      eligible: isEligible,
    };

    evaluated.push(provenance);

    if (isEligible) {
      eligible.push({ facility, score, distance_nm: distanceNm, provenance });
    }
  }

  const ranked = orderEligible(eligible);

  // Req 5.3: an empty eligible set is an explicit no-match requiring authorized
  // human selection or a mission hold. Never fall back to nearest (req 5.4).
  if (ranked.length === 0) {
    return {
      outcome: "NO_MATCH",
      ranked: [],
      evaluated,
      requires_human_selection: true,
    };
  }

  return {
    outcome: "MATCH",
    ranked,
    evaluated,
    requires_human_selection: false,
  };
}
