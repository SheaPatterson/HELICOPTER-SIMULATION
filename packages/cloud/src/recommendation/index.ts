/**
 * Spatial facility recommendation boundary (design Section 4.6 / Section 6.5).
 *
 * Task 11.1 establishes the deterministic core: eligibility filtering
 * (capability / helipad-under-weather / route, req 5.1), missing-input
 * ineligibility with provenance (req 5.8), deterministic ordering by
 * (score desc, distance asc, id asc, req 5.5) with a straight-line haversine
 * tie-break, and an explicit no-match result requiring authorized human
 * selection or a mission hold (req 5.3). Distance is only ever a tie-breaker so
 * a facility is never recommended solely for being nearest (req 5.4).
 *
 * The candidate query is injected through {@link CandidateProviderPort} so the
 * PostGIS proximity query (design 5.6, task 2.x) is a clean seam; task 11.2
 * layers the full provenance record + Ironpine fallback (req 5.2, 5.7) on top of
 * the core provenance fields produced here.
 */

export { EARTH_RADIUS_NM, haversineDistanceNm } from "./distance.js";

export {
  HELIPAD_STATUSES,
  ELIGIBILITY_CHECKS,
  RECOMMENDATION_OUTCOMES,
  InMemoryCandidateProvider,
  capabilityMatches,
  helipadIsOperational,
  routeIsPermissible,
  scoreFacility,
  orderEligible,
  recommendFacility,
  type FacilityCandidate,
  type HelipadStatus,
  type WeatherObservation,
  type RouteConstraints,
  type EligibilityCheck,
  type CheckResult,
  type FacilityProvenance,
  type RankedFacility,
  type RecommendationOutcome,
  type RecommendationResult,
  type PatientLocation,
  type CandidateProviderPort,
  type RecommendFacilityInput,
  type RecommendFacilityDependencies,
} from "./recommendation.js";

// Task 11.2: complete recommended-facility provenance (req 5.2) + the Ironpine
// tactical-briefing boundary with a deterministic spatial-only fallback that
// marks the AI recommendation absent when Ironpine is unavailable (req 5.7).
export {
  recommendWithBriefing,
  UnavailableIronpineBriefing,
  ThrowingIronpineBriefing,
  InMemoryIronpineBriefing,
  type RecommendedFacilityProvenance,
  type RecommendedFacility,
  type IronpineBriefingContext,
  type IronpineBriefingPort,
  type IronpineBriefingOutcome,
  type BriefedRecommendationResult,
  type RecommendWithBriefingDependencies,
} from "./briefing.js";
