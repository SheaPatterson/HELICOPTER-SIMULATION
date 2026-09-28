/**
 * `GET /api/public/operations` — the public operational-data endpoint the
 * marketing/map surface calls (design Section 5.3; task 17.2; Requirement 8.7).
 *
 * This is the representative public data seam. Requirement 8.7: a public route
 * that requests operational data returns AGGREGATE or DE-IDENTIFIED operational
 * data ONLY. This route NEVER returns a raw operational record — every response
 * is produced by the pure {@link toAggregateOperationalData} projection, which
 * emits region-level counts and nothing that identifies a pilot, patient, or
 * incident and no patient/clinical/VIRS content.
 *
 * The upstream operational data source (the realtime asset/mission state in
 * `@virtualhems/cloud`) is deferred to the persistence/realtime wiring; until
 * then this route returns a zeroed aggregate for the region rather than exposing
 * any record. Wiring the real source MUST keep the raw records BEHIND the
 * {@link toAggregateOperationalData} projection — the projection is the guard,
 * not an optional step.
 */

import {
  toAggregateOperationalData,
  type AggregateOperationalData,
  type RawOperationalAsset,
  type RawOperationalMission,
} from "@/lib/public-data";

// Aggregate operational counts are time-varying; never statically cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Default region for the public regional map surface (design Section 5.3). */
const DEFAULT_REGION = "WPA";

/**
 * Load raw operational assets/missions for a region.
 *
 * Deferred to the realtime/persistence wiring. Returns empty collections for now
 * so the endpoint yields a safe zeroed aggregate rather than exposing records.
 * When wired, the raw records returned here MUST still flow only through
 * {@link toAggregateOperationalData} below — never serialized directly.
 */
async function loadRawOperationalData(_region: string): Promise<{
  assets: RawOperationalAsset[];
  missions: RawOperationalMission[];
}> {
  return { assets: [], missions: [] };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get("region")?.trim() || DEFAULT_REGION;

  const { assets, missions } = await loadRawOperationalData(region);

  // The ONLY thing that leaves this route: the aggregate projection (8.7).
  const aggregate: AggregateOperationalData = toAggregateOperationalData(
    region,
    assets,
    missions,
  );

  return Response.json(aggregate, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
