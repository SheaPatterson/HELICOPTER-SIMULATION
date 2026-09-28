/**
 * Public-surface operational-data de-identification (design Section 5.3 public
 * data policy; task 17.2; Requirement 8.7).
 *
 * PURE, framework-free projection that a public map / marketing route MUST run
 * over any operational data before it leaves the server. Requirement 8.7:
 * WHERE a public route requests operational data, it returns AGGREGATE or
 * DE-IDENTIFIED operational data ONLY — containing no patient, clinical, or
 * VIRS record, and NO field that identifies an individual pilot, patient, or
 * incident.
 *
 * The projection is deliberately ALLOW-LIST based: rather than trying to strip
 * known-bad fields off an arbitrary record (which fails open the moment an
 * upstream shape gains a new identifying field), it constructs the public output
 * from ONLY the handful of fields that are safe by construction. Anything not
 * explicitly copied is dropped. That way a raw operational record can never leak
 * a pilot id, mission code, patient/clinical detail, or a VIRS record through a
 * public route.
 *
 * Two projections are provided:
 *  - {@link toPublicAssetSummary} — a per-asset public view: coarse region and
 *    an operational activity flag only, no pilot identity, no mission linkage,
 *    no position/telemetry that could single out an aircraft or incident.
 *  - {@link toAggregateOperationalData} — a region-level rollup: counts only, no
 *    per-asset or per-mission records at all. This is the recommended shape for
 *    a public map/marketing surface.
 */

/**
 * Raw operational asset shape the projection accepts as input. This is a
 * superset that intentionally INCLUDES identifying/clinical fields so the
 * projection can be proven to drop them — callers pass whatever operational
 * record they hold; the projection copies only safe fields out.
 */
export interface RawOperationalAsset {
  /** Identifies an individual pilot — MUST NOT appear in public output (8.7). */
  readonly pilot_id?: string;
  /** Singles out an incident/mission — MUST NOT appear in public output (8.7). */
  readonly mission_id?: string;
  /** Human mission code — singles out an incident — MUST NOT appear (8.7). */
  readonly mission_code?: string;
  /** Operational region — safe to expose at region granularity. */
  readonly region?: string;
  /** Airframe/model class — safe (marketing/fleet-level, not an identity). */
  readonly airframe_model?: string;
  /** Precise position — could single out an incident — MUST NOT appear (8.7). */
  readonly position?: unknown;
  /** Whether the asset is currently flying a mission (activity, not identity). */
  readonly mission_id_present?: boolean;
  /** Arbitrary extra fields an upstream record may carry — never copied out. */
  readonly [extra: string]: unknown;
}

/**
 * Raw operational mission shape the projection accepts as input. Includes
 * patient/clinical/VIRS-bearing fields precisely so the projection can be shown
 * to omit them.
 */
export interface RawOperationalMission {
  readonly mission_id?: string;
  readonly mission_code?: string;
  readonly region?: string;
  /** Mission status — safe only in aggregate; never emitted per-mission. */
  readonly status?: string;
  /** Patient/clinical payload — MUST NOT appear in public output (8.7). */
  readonly patient?: unknown;
  readonly patient_state?: unknown;
  readonly clinical_summary?: unknown;
  /** VIRS record — MUST NOT appear in public output (8.7). */
  readonly virs?: unknown;
  readonly [extra: string]: unknown;
}

/**
 * The ONLY per-asset fields a public route may emit (8.7). Coarse region and an
 * activity flag — nothing that identifies a pilot, patient, or incident, and no
 * position/telemetry.
 */
export interface PublicAssetSummary {
  /** Operational region at region granularity (e.g. "WPA"). */
  readonly region: string;
  /** Whether an asset is currently active on a mission — a boolean, not a link. */
  readonly active: boolean;
}

/**
 * Region-level aggregate operational data — counts only, no per-record data.
 * This is the safe shape for a public map/marketing surface (8.7): it answers
 * "how busy is the network" without exposing any individual asset, pilot,
 * mission, patient, incident, or VIRS record.
 */
export interface AggregateOperationalData {
  /** Region this rollup covers. */
  readonly region: string;
  /** Total assets operating in the region. */
  readonly totalAssets: number;
  /** How many of those assets are currently active on a mission. */
  readonly activeAssets: number;
  /** Count of in-progress missions in the region. No per-mission detail. */
  readonly activeMissions: number;
}

/** Normalize a region value to a non-empty string, defaulting to "UNKNOWN". */
function safeRegion(region: unknown): string {
  return typeof region === "string" && region.trim().length > 0
    ? region.trim()
    : "UNKNOWN";
}

/**
 * Derive whether a raw asset is active on a mission WITHOUT copying the mission
 * linkage out. Presence of a mission id (or an explicit activity flag) means
 * active; the id itself is never emitted.
 */
function assetIsActive(asset: RawOperationalAsset): boolean {
  if (typeof asset.mission_id_present === "boolean") {
    return asset.mission_id_present;
  }
  return typeof asset.mission_id === "string" && asset.mission_id.length > 0;
}

/**
 * Project a single raw operational asset to its public summary (8.7).
 *
 * Allow-list projection: constructs the output from ONLY {@link PublicAssetSummary}
 * fields. Pilot id, mission id/code, position, and any extra upstream field are
 * dropped by construction — they are never read into the output object.
 */
export function toPublicAssetSummary(
  asset: RawOperationalAsset,
): PublicAssetSummary {
  return {
    region: safeRegion(asset.region),
    active: assetIsActive(asset),
  };
}

/**
 * A raw mission counts as "in progress" (for aggregate counts only) when its
 * status is a non-terminal operational status. Terminal statuses (COMPLETED,
 * ABORTED) are excluded. The status string itself is never emitted per-mission.
 */
const TERMINAL_MISSION_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "ABORTED",
]);

function missionIsInProgress(mission: RawOperationalMission): boolean {
  const status = typeof mission.status === "string" ? mission.status : "";
  return status.length > 0 && !TERMINAL_MISSION_STATUSES.has(status);
}

/**
 * Project raw operational data (assets + missions) for a region into an
 * AGGREGATE rollup (8.7) — counts only, no per-record data.
 *
 * This is the recommended projection for a public map/marketing route: it emits
 * no per-asset, per-pilot, per-mission, patient, clinical, incident, or VIRS
 * field at all. Missions from a different region are ignored for the count.
 *
 * @param region the region this rollup is for.
 * @param assets raw operational assets (any region; only `region`-matching and
 *   region-less assets are counted).
 * @param missions raw operational missions used only to count in-progress
 *   missions in `region`.
 */
export function toAggregateOperationalData(
  region: string,
  assets: readonly RawOperationalAsset[],
  missions: readonly RawOperationalMission[] = [],
): AggregateOperationalData {
  const target = safeRegion(region);

  const regionalAssets = assets.filter((a) => {
    const r = safeRegion(a.region);
    return r === target || (typeof a.region !== "string" && target === "UNKNOWN");
  });

  const activeAssets = regionalAssets.reduce(
    (n, a) => (assetIsActive(a) ? n + 1 : n),
    0,
  );

  const activeMissions = missions.reduce((n, m) => {
    if (safeRegion(m.region) !== target) return n;
    return missionIsInProgress(m) ? n + 1 : n;
  }, 0);

  return {
    region: target,
    totalAssets: regionalAssets.length,
    activeAssets,
    activeMissions,
  };
}
