/**
 * Realtime asset-state fanout (design Section 3.4 map fanout; Section 5.3
 * authorization model; requirement 6.3).
 *
 * This module is the pure, testable core of the cloud-side realtime fanout
 * boundary. Its job is to take an accepted telemetry frame or a mission update
 * and (a) derive the operational broadcast payload clients render, and (b)
 * compute the authorized channels a payload is published on — scoped by region,
 * mission, and role — so only authorized subscribers receive a given update.
 *
 * Like the telemetry ingestion core, this module is intentionally free of any
 * transport concern. It never imports the Supabase client directly; instead it
 * takes an injectable {@link RealtimeBroadcaster} port so it can be unit-tested
 * without a live realtime backend. The production wiring constructs a concrete
 * broadcaster backed by Supabase Realtime and delegates here.
 *
 * The channel-naming/authorization-scoping logic is a set of pure functions
 * ({@link channelsForAssetState}, {@link channelsForMissionUpdate},
 * {@link canSubscribe}) that map (region, mission_id, role) to the channel(s) a
 * payload is published on and that a subscriber is allowed to join. Keeping
 * these pure makes "who receives what" directly testable.
 *
 * Contract reuse: payloads reuse `@virtualhems/contracts` types
 * (`PositionVector`, `FlightVector`, `SystemsVector`, `MissionStatus`,
 * `PatientState`, `Timestamp`, `Uuid`) rather than redefining telemetry or
 * mission shapes.
 */

import type {
  FlightVector,
  MissionStatus,
  PatientState,
  PositionVector,
  SystemsVector,
  Timestamp,
  Uuid,
} from "@virtualhems/contracts";

// --- Operational roles ------------------------------------------------------

/**
 * Operational roles that can subscribe to realtime channels (design Section 7:
 * "least privilege for trainee, officer, captain, instructor, and admin
 * roles"). The subscribing pilot's role, together with region and mission
 * membership, determines which channels they may join (design Section 5.3).
 */
export const OPERATIONAL_ROLES = [
  "TRAINEE",
  "OFFICER",
  "CAPTAIN",
  "INSTRUCTOR",
  "ADMIN",
] as const;
export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

/**
 * Roles with broad operational visibility. Per design Section 5.3, dispatcher/
 * instructor/admin roles "may view broader operational data according to
 * policy"; here INSTRUCTOR and ADMIN are granted cross-mission visibility within
 * a region, while operational crew (TRAINEE/OFFICER/CAPTAIN) see only the
 * missions they are a member of. Role expansion is explicit (design Section 5.3).
 */
const BROAD_VISIBILITY_ROLES: ReadonlySet<OperationalRole> = new Set<OperationalRole>([
  "INSTRUCTOR",
  "ADMIN",
]);

/** Narrowing guard: is `value` a known operational role? */
export function isOperationalRole(value: unknown): value is OperationalRole {
  return (
    typeof value === "string" &&
    (OPERATIONAL_ROLES as readonly string[]).includes(value)
  );
}

// --- Broadcast payloads (reuse contracts) -----------------------------------

/**
 * Current asset state broadcast to authorized clients (requirement 6.3, design
 * Section 3.4). This is the operational subset the command map and EFB render:
 * where the aircraft is, how it is flying, its systems state, and which mission
 * it is flying. It deliberately excludes patient/clinical detail — those are
 * carried on the more tightly scoped mission channel via {@link PatientState}.
 */
export interface AssetStateUpdate {
  kind: "ASSET_STATE";
  /** The aircraft/asset this state belongs to (the authenticated pilot). */
  pilot_id: Uuid;
  /** The mission this asset is flying, when assigned. */
  mission_id?: Uuid;
  /** Operational region the asset is operating in (scopes region channels). */
  region: string;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
  /** Source/observed instant of the underlying telemetry sample. */
  observed_at: Timestamp;
  /** Cloud-receive instant of the underlying telemetry frame. */
  received_at: Timestamp;
  /** Sequence of the underlying frame, so clients can drop stale updates. */
  sequence_number: number;
}

/**
 * A mission lifecycle / patient-state update broadcast to a mission's crew and
 * to broad-visibility roles in the region (requirement 6.3). `patient_state` is
 * present when the update carries derived clinical state; it is only ever
 * published on the mission-scoped channel, never a region-wide channel.
 */
export interface MissionUpdate {
  kind: "MISSION_UPDATE";
  mission_id: Uuid;
  region: string;
  status: MissionStatus;
  patient_state?: PatientState;
  updated_at: Timestamp;
}

/** Any payload the fanout can broadcast. */
export type RealtimeUpdate = AssetStateUpdate | MissionUpdate;

// --- Inputs to payload derivation -------------------------------------------

/**
 * The accepted-frame view the fanout derives an {@link AssetStateUpdate} from.
 * This mirrors the fields the ingestion core has after acceptance plus the
 * operational `region`; it intentionally does not depend on the ingestion
 * module so the coupling stays optional (the integration adapter maps an
 * ingestion result onto this shape).
 */
export interface AcceptedFrameView {
  pilot_id: Uuid;
  mission_id?: Uuid;
  region: string;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
  observed_at: Timestamp;
  received_at: Timestamp;
  sequence_number: number;
}

/** The mission-update view the fanout derives a {@link MissionUpdate} from. */
export interface MissionUpdateInput {
  mission_id: Uuid;
  region: string;
  status: MissionStatus;
  patient_state?: PatientState;
  updated_at: Timestamp;
}

// --- Injectable broadcaster port --------------------------------------------

/**
 * Transport-agnostic realtime publisher. Production backs this with Supabase
 * Realtime (`channel(name).send(...)`); tests use an in-memory fake. The core
 * never constructs the Supabase client itself, so it stays unit-testable and
 * the transport stays swappable.
 */
export interface RealtimeBroadcaster {
  /** Publish `payload` on `channel`. */
  publish(channel: string, payload: RealtimeUpdate): Promise<void>;
}

/** The result of a fanout: the payload and the channels it was published on. */
export interface FanoutResult {
  payload: RealtimeUpdate;
  channels: string[];
}

// --- Pure channel-naming / authorization-scoping ----------------------------

/**
 * Channel name prefixes. The naming scheme encodes the scope directly in the
 * channel name so a subscriber's authorization ({@link canSubscribe}) can be
 * decided from the name plus the subscriber's (region, mission, role) context
 * without a side lookup.
 *
 * - `region:{region}:assets` — asset-state fanout for a whole operational
 *   region. Any authenticated role in that region may join (the command map
 *   renders regional assets); it carries no patient/clinical data.
 * - `mission:{mission_id}` — mission-scoped channel carrying mission lifecycle
 *   and patient state. Only the mission's own crew and broad-visibility roles
 *   (INSTRUCTOR/ADMIN) may join.
 */
const REGION_PREFIX = "region:";
const REGION_ASSETS_SUFFIX = ":assets";
const MISSION_PREFIX = "mission:";

/** Build the region-wide asset-state channel name for `region`. */
export function regionAssetsChannel(region: string): string {
  return `${REGION_PREFIX}${region}${REGION_ASSETS_SUFFIX}`;
}

/** Build the mission-scoped channel name for `mission_id`. */
export function missionChannel(mission_id: Uuid): string {
  return `${MISSION_PREFIX}${mission_id}`;
}

/**
 * The channels an {@link AssetStateUpdate} is published on. Asset state always
 * goes to the region assets channel (so the regional command map updates) and,
 * when the asset is flying a mission, also to that mission's channel (so the
 * assigned crew's EFB gets it even if their map viewport differs). Deterministic
 * order: region channel first, then mission channel.
 */
export function channelsForAssetState(update: AssetStateUpdate): string[] {
  const channels = [regionAssetsChannel(update.region)];
  if (update.mission_id !== undefined) {
    channels.push(missionChannel(update.mission_id));
  }
  return channels;
}

/**
 * The channels a {@link MissionUpdate} is published on. Mission updates —
 * including patient state — are published only on the mission-scoped channel,
 * never region-wide, so patient/clinical data stays confined to authorized
 * mission subscribers (design Section 5.3: patient/clinical records are not
 * broadly exposed).
 */
export function channelsForMissionUpdate(update: MissionUpdate): string[] {
  return [missionChannel(update.mission_id)];
}

/** Context describing a subscriber requesting to join a channel. */
export interface SubscriberContext {
  role: OperationalRole;
  /** The subscriber's operational region. */
  region: string;
  /** Mission ids the subscriber is a crew member of. */
  mission_ids: readonly Uuid[];
}

/**
 * Decide whether `subscriber` is authorized to join `channel` (design Section
 * 5.3 authorization model). This is the single source of truth for realtime
 * subscription authorization and is intentionally pure so "who may join what"
 * is directly testable.
 *
 * Rules:
 * - Region assets channel `region:{r}:assets`: any authenticated role may join
 *   the channel for their own region only. It carries no patient data.
 * - Mission channel `mission:{m}`: the subscriber may join when they are a crew
 *   member of mission `m`, or when they hold a broad-visibility role
 *   (INSTRUCTOR/ADMIN). Broad-visibility roles are additionally region-scoped:
 *   they may only observe missions in their own region, enforced by the caller
 *   supplying the subscriber's region alongside the mission's region context.
 * - An unrecognized channel name is denied (fail closed).
 */
export function canSubscribe(
  subscriber: SubscriberContext,
  channel: string,
): boolean {
  // Region assets channel: same-region membership is sufficient.
  if (channel.startsWith(REGION_PREFIX) && channel.endsWith(REGION_ASSETS_SUFFIX)) {
    const region = channel.slice(
      REGION_PREFIX.length,
      channel.length - REGION_ASSETS_SUFFIX.length,
    );
    return region.length > 0 && region === subscriber.region;
  }

  // Mission channel: crew membership OR a broad-visibility role.
  if (channel.startsWith(MISSION_PREFIX)) {
    const missionId = channel.slice(MISSION_PREFIX.length);
    if (missionId.length === 0) return false;
    if (subscriber.mission_ids.includes(missionId)) return true;
    return BROAD_VISIBILITY_ROLES.has(subscriber.role);
  }

  // Unknown channel shape — deny by default.
  return false;
}

// --- Payload derivation ------------------------------------------------------

/**
 * Derive the {@link AssetStateUpdate} broadcast payload from an accepted frame
 * view. Pure and total: it copies the operational subset and drops nothing that
 * the map/EFB needs, while carrying no fields beyond the operational contract.
 */
export function deriveAssetStateUpdate(frame: AcceptedFrameView): AssetStateUpdate {
  const update: AssetStateUpdate = {
    kind: "ASSET_STATE",
    pilot_id: frame.pilot_id,
    region: frame.region,
    position: frame.position,
    flight: frame.flight,
    systems: frame.systems,
    observed_at: frame.observed_at,
    received_at: frame.received_at,
    sequence_number: frame.sequence_number,
  };
  if (frame.mission_id !== undefined) {
    update.mission_id = frame.mission_id;
  }
  return update;
}

/** Derive a {@link MissionUpdate} broadcast payload from a mission-update input. */
export function deriveMissionUpdate(input: MissionUpdateInput): MissionUpdate {
  const update: MissionUpdate = {
    kind: "MISSION_UPDATE",
    mission_id: input.mission_id,
    region: input.region,
    status: input.status,
    updated_at: input.updated_at,
  };
  if (input.patient_state !== undefined) {
    update.patient_state = input.patient_state;
  }
  return update;
}

// --- Fanout service ----------------------------------------------------------

/**
 * Realtime fanout service. Wraps an injectable {@link RealtimeBroadcaster} and
 * publishes derived payloads on their authorized channels. This is the object
 * the ingestion path (or the mission service) calls after a frame is accepted
 * or a mission changes.
 */
export class RealtimeFanout {
  constructor(private readonly broadcaster: RealtimeBroadcaster) {}

  /**
   * Broadcast current asset state derived from an accepted frame. Returns the
   * derived payload and the channels it was published on so callers/tests can
   * assert scoping. Publishing to the channels happens in the deterministic
   * order returned by {@link channelsForAssetState}.
   */
  async broadcastAssetState(frame: AcceptedFrameView): Promise<FanoutResult> {
    const payload = deriveAssetStateUpdate(frame);
    const channels = channelsForAssetState(payload);
    for (const channel of channels) {
      await this.broadcaster.publish(channel, payload);
    }
    return { payload, channels };
  }

  /** Broadcast a mission lifecycle / patient-state update to the mission channel. */
  async broadcastMissionUpdate(input: MissionUpdateInput): Promise<FanoutResult> {
    const payload = deriveMissionUpdate(input);
    const channels = channelsForMissionUpdate(payload);
    for (const channel of channels) {
      await this.broadcaster.publish(channel, payload);
    }
    return { payload, channels };
  }
}
