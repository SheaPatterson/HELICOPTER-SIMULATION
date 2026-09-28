/**
 * Straight-line (great-circle) distance helper for facility recommendation
 * tie-breaking (design Section 6.5, requirement 5.5).
 *
 * Requirement 5.5 breaks suitability-score ties by "ascending straight-line
 * distance from the patient location". That is a pure geometric quantity over
 * the stored `GEOGRAPHY(POINT, 4326)` coordinates and must be deterministic for
 * identical inputs, so it lives here as a self-contained haversine computation
 * rather than depending on the PostGIS layer (design 5.6 / task 2.x). The DB's
 * indexed proximity query is the candidate-selection seam (see the
 * candidate-provider port in `./recommendation.ts`); this function is only the
 * deterministic tie-breaker applied to the already-selected candidates.
 *
 * The result is in nautical miles to match the flight-plan distance units used
 * elsewhere in the contracts (`FlightPlan.direct_distance_nm`), though only the
 * ORDERING of the values matters for the tie-break, not the unit.
 */

import type { GeoPoint } from "@virtualhems/contracts";

/** Mean Earth radius in nautical miles (WGS84 sphere approximation). */
export const EARTH_RADIUS_NM = 3440.065;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle (haversine) distance between two WGS84 points in nautical miles.
 *
 * Pure and deterministic: identical inputs always yield an identical value, so
 * it is a stable tie-breaker (req 5.5). Returns `Number.POSITIVE_INFINITY` for a
 * point carrying a non-finite coordinate so such a facility sorts last rather
 * than corrupting the ordering with `NaN` comparisons.
 */
export function haversineDistanceNm(a: GeoPoint, b: GeoPoint): number {
  if (
    !Number.isFinite(a.latitude_deg) ||
    !Number.isFinite(a.longitude_deg) ||
    !Number.isFinite(b.latitude_deg) ||
    !Number.isFinite(b.longitude_deg)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const lat1 = toRadians(a.latitude_deg);
  const lat2 = toRadians(b.latitude_deg);
  const dLat = toRadians(b.latitude_deg - a.latitude_deg);
  const dLon = toRadians(b.longitude_deg - a.longitude_deg);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_NM * c;
}
