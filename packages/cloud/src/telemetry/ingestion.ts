/**
 * Telemetry ingestion (design Section 6.1, requirements 1.1, 1.2, 1.7, 2.7).
 *
 * This module is the pure, testable core of the cloud-side telemetry ingestion
 * boundary. It authenticates and validates an incoming frame server-side,
 * persists it with source and cloud-receive timestamps recorded separately, and
 * treats a `(pilot_id, session_id, sequence_number)` collision as idempotent by
 * returning an acknowledgment equivalent to the originally persisted frame.
 *
 * The core is intentionally free of any transport (HTTP/WebSocket) or database
 * driver concern: it takes an injectable {@link TelemetryAuthenticator},
 * {@link TelemetryRepository}, and clock so it can be unit-tested without a live
 * database or Supabase session. The Next.js `/api/telemetry` route (and any
 * other server boundary) constructs the concrete dependencies and delegates
 * here.
 *
 * Validation and normalization reuse the shared `@virtualhems/contracts`
 * helpers rather than duplicating unit/normalization logic, so the bridge and
 * the cloud agree on one definition.
 */

import {
  isSimulatorEngine,
  SIMULATOR_ENGINES,
  type FlightVector,
  type PositionVector,
  type SystemsVector,
  type Timestamp,
  type Uuid,
} from "@virtualhems/contracts";

// --- Public request / result contracts -------------------------------------

/**
 * A telemetry frame submitted to the cloud for ingestion.
 *
 * This mirrors the shared `TelemetryFrame` contract but adds the `session_id`
 * that scopes idempotency and sequence monotonicity at the persistence layer
 * (the DB uniqueness key is `(pilot_id, session_id, sequence_number)`). It omits
 * `received_at`, which the cloud stamps on acceptance, and `pilot_id`, which the
 * server derives from the authenticated principal rather than trusting the
 * client-supplied body.
 */
export interface TelemetryIngestRequest {
  frame_id: Uuid;
  session_id: Uuid;
  mission_id?: Uuid;
  source_engine: string;
  source_sequence: number;
  sequence_number: number;
  observed_at: Timestamp;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
  is_delta: boolean;
  schema_version: string;
}

/** The authenticated principal resolved by the server-side auth boundary. */
export interface AuthenticatedPilot {
  pilot_id: Uuid;
}

/**
 * A persisted telemetry frame as returned by the repository. Carries the
 * cloud-assigned `received_at` and the authoritative `pilot_id`.
 */
export interface PersistedTelemetryFrame {
  frame_id: Uuid;
  pilot_id: Uuid;
  session_id: Uuid;
  sequence_number: number;
  source_engine: string;
  source_observed_at: Timestamp;
  received_at: Timestamp;
  schema_version: string;
}

/** Acknowledgment returned to the caller for an accepted or idempotent frame. */
export interface TelemetryAck {
  frame_id: Uuid;
  pilot_id: Uuid;
  session_id: Uuid;
  sequence_number: number;
  source_observed_at: Timestamp;
  received_at: Timestamp;
  /**
   * `accepted` — the frame was newly persisted.
   * `duplicate` — a frame with the same `(pilot_id, session_id, sequence_number)`
   * was already persisted; this ack is equivalent to that original (req 2.7).
   */
  disposition: "accepted" | "duplicate";
}

/** Discriminated ingestion outcome. */
export type IngestResult =
  | { ok: true; ack: TelemetryAck }
  | { ok: false; error: IngestError };

/** Machine-readable ingestion error codes. */
export type IngestErrorCode =
  | "UNAUTHENTICATED"
  | "UNSUPPORTED_ENGINE"
  | "VALIDATION_FAILED";

/**
 * A structured ingestion failure. `field` identifies the failed validation
 * field (req 1.1/design diagnostic contract); `engine` is populated for
 * `UNSUPPORTED_ENGINE` and names the unsupported value (req 1.2).
 */
export interface IngestError {
  code: IngestErrorCode;
  message: string;
  field?: string;
  engine?: string;
}

// --- Injectable dependencies ------------------------------------------------

/**
 * Server-side authentication boundary. Resolves the request credential to an
 * authenticated pilot, or `null` when the credential is missing/invalid. The
 * ingestion core never trusts a client-supplied `pilot_id`; the persisted owner
 * is always the authenticated principal.
 */
export interface TelemetryAuthenticator {
  authenticate(credential: string | undefined): Promise<AuthenticatedPilot | null>;
}

/**
 * Persistence boundary for accepted frames. Implementations back this with the
 * `flight_telemetry` table using the service role. The `(pilot_id, session_id,
 * sequence_number)` unique constraint (migration task 2.2) makes duplicate
 * inserts fail; implementations MUST surface that as a
 * {@link DuplicateFrameError} so the core can return an equivalent ack.
 */
export interface TelemetryRepository {
  /**
   * The highest `sequence_number` previously accepted for the given
   * `(pilot_id, session_id)`, or `null` when the session has no accepted frame
   * yet. Used to enforce strictly-increasing sequence (req 1.1).
   */
  latestAcceptedSequence(
    pilot_id: Uuid,
    session_id: Uuid,
  ): Promise<number | null>;

  /**
   * Persist a validated frame. Throws {@link DuplicateFrameError} when the
   * unique `(pilot_id, session_id, sequence_number)` key already exists.
   */
  persist(frame: PersistTelemetryInput): Promise<PersistedTelemetryFrame>;

  /**
   * Load an already-persisted frame by its idempotency key so the core can
   * return an acknowledgment equivalent to the original (req 2.7).
   */
  findByIdempotencyKey(
    pilot_id: Uuid,
    session_id: Uuid,
    sequence_number: number,
  ): Promise<PersistedTelemetryFrame | null>;
}

/** Fields the repository needs to persist an accepted frame. */
export interface PersistTelemetryInput {
  frame_id: Uuid;
  pilot_id: Uuid;
  session_id: Uuid;
  mission_id?: Uuid;
  source_engine: string;
  source_sequence: number;
  sequence_number: number;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
  is_delta: boolean;
  /** Source/observed timestamp — when the simulator produced the sample (req 1.7). */
  source_observed_at: Timestamp;
  /** Cloud-receive timestamp — when the cloud accepted the frame (req 1.7). */
  received_at: Timestamp;
  schema_version: string;
}

/**
 * Thrown by {@link TelemetryRepository.persist} when the idempotency key
 * collides with an already-persisted frame. The core catches this and returns a
 * `duplicate` ack equivalent to the original (req 2.7).
 */
export class DuplicateFrameError extends Error {
  constructor(message = "duplicate telemetry frame") {
    super(message);
    this.name = "DuplicateFrameError";
  }
}

/** Injectable dependencies for {@link ingestTelemetry}. */
export interface IngestDependencies {
  authenticator: TelemetryAuthenticator;
  repository: TelemetryRepository;
  /** Returns the cloud-receive instant. Injectable for deterministic tests. */
  now?: () => Date;
}

// --- Validation bounds ------------------------------------------------------

/** Max allowed schema_version length (req 1.1). */
const MAX_SCHEMA_VERSION_LENGTH = 32;

/** Observed timestamp must not be older than this many ms before receive (req 1.1). */
const MAX_PAST_MS = 60_000;

/** Observed timestamp must not be further than this many ms after receive (req 1.1). */
const MAX_FUTURE_MS = 5_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate the normalized numeric payload. Returns the failing field name, or
 * `null` when every value is finite and within the contract range (req 1.1).
 * Latitude/longitude/heading ranges mirror the DB CHECK constraints.
 */
function validateNumericPayload(req: TelemetryIngestRequest): string | null {
  const { position, flight, systems } = req;

  if (!isFiniteNumber(position.latitude_deg)) return "position.latitude_deg";
  if (position.latitude_deg < -90 || position.latitude_deg > 90) {
    return "position.latitude_deg";
  }
  if (!isFiniteNumber(position.longitude_deg)) return "position.longitude_deg";
  if (position.longitude_deg < -180 || position.longitude_deg > 180) {
    return "position.longitude_deg";
  }
  if (!isFiniteNumber(position.altitude_msl_ft)) return "position.altitude_msl_ft";
  if (!isFiniteNumber(position.altitude_agl_ft)) return "position.altitude_agl_ft";

  if (!isFiniteNumber(flight.ground_speed_kts)) return "flight.ground_speed_kts";
  if (!isFiniteNumber(flight.heading_deg)) return "flight.heading_deg";
  if (flight.heading_deg < 0 || flight.heading_deg >= 360) {
    return "flight.heading_deg";
  }
  if (!isFiniteNumber(flight.vertical_speed_fpm)) return "flight.vertical_speed_fpm";
  if (!isFiniteNumber(flight.pitch_deg)) return "flight.pitch_deg";
  if (!isFiniteNumber(flight.roll_deg)) return "flight.roll_deg";

  if (!isFiniteNumber(systems.fuel_remaining_lbs)) return "systems.fuel_remaining_lbs";
  if (!isFiniteNumber(systems.engine_torque_pct)) return "systems.engine_torque_pct";
  // Optional systems fields: reject only when present and non-finite.
  if (systems.tot_celsius !== undefined && !isFiniteNumber(systems.tot_celsius)) {
    return "systems.tot_celsius";
  }
  if (systems.rotor_rpm_pct !== undefined && !isFiniteNumber(systems.rotor_rpm_pct)) {
    return "systems.rotor_rpm_pct";
  }
  if (
    systems.outside_air_temp_c !== undefined &&
    !isFiniteNumber(systems.outside_air_temp_c)
  ) {
    return "systems.outside_air_temp_c";
  }

  return null;
}

function validationError(field: string, message: string): IngestResult {
  return { ok: false, error: { code: "VALIDATION_FAILED", message, field } };
}

// --- Ingestion core ---------------------------------------------------------

/**
 * Ingest a single telemetry frame server-side (design Section 6.1).
 *
 * Order of operations matters for the requirements:
 * 1. Authenticate (req: server-side auth boundary). The persisted owner is the
 *    authenticated principal, never a client-supplied `pilot_id`.
 * 2. Reject an unsupported engine with a named compatibility error, before any
 *    persistence, leaving prior session state unchanged (req 1.2).
 * 3. Validate schema version, timestamp window, finite/in-range numerics, and a
 *    strictly-increasing session sequence (req 1.1).
 * 4. Persist with source vs cloud-receive timestamps separate (req 1.7).
 * 5. On a `(pilot_id, session_id, sequence_number)` collision, return an ack
 *    equivalent to the original without duplicating (req 2.7).
 */
export async function ingestTelemetry(
  request: TelemetryIngestRequest,
  credential: string | undefined,
  deps: IngestDependencies,
): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date());

  // 1. Authenticate server-side.
  const principal = await deps.authenticator.authenticate(credential);
  if (principal === null) {
    return {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "missing or invalid credential",
      },
    };
  }
  const pilot_id = principal.pilot_id;

  // 2. Reject unsupported engine with a named compatibility error (req 1.2).
  //    Done before validation and persistence so prior session state is
  //    untouched and the error names the offending value.
  if (!isSimulatorEngine(request.source_engine)) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_ENGINE",
        engine: request.source_engine,
        message:
          `unsupported simulator engine "${request.source_engine}"; ` +
          `supported engines are ${SIMULATOR_ENGINES.join(", ")}`,
      },
    };
  }

  // 3. Validate the frame (req 1.1).
  const schema = request.schema_version;
  if (typeof schema !== "string" || schema.length === 0) {
    return validationError("schema_version", "schema_version must be non-empty");
  }
  if (schema.length > MAX_SCHEMA_VERSION_LENGTH) {
    return validationError(
      "schema_version",
      `schema_version must be at most ${MAX_SCHEMA_VERSION_LENGTH} characters`,
    );
  }

  if (
    !Number.isInteger(request.sequence_number) ||
    request.sequence_number < 0
  ) {
    return validationError(
      "sequence_number",
      "sequence_number must be a non-negative integer",
    );
  }

  const receivedAt = now();
  const observedMs = Date.parse(request.observed_at);
  if (Number.isNaN(observedMs)) {
    return validationError("observed_at", "observed_at is not a valid timestamp");
  }
  const skewMs = observedMs - receivedAt.getTime();
  if (skewMs < -MAX_PAST_MS || skewMs > MAX_FUTURE_MS) {
    return validationError(
      "observed_at",
      "observed_at is outside the accepted [-60s, +5s] window relative to receive time",
    );
  }

  const badField = validateNumericPayload(request);
  if (badField !== null) {
    return validationError(
      badField,
      `${badField} must be a finite value within contract range`,
    );
  }

  // Idempotency (req 2.7) takes precedence over the monotonicity rule (req
  // 1.1): a frame whose exact `(pilot_id, session_id, sequence_number)` was
  // already persisted is an idempotent replay and must return an ack equivalent
  // to the original — even when that sequence is at or below the latest
  // accepted one (e.g. replaying an earlier frame after later frames landed).
  const existing = await deps.repository.findByIdempotencyKey(
    pilot_id,
    request.session_id,
    request.sequence_number,
  );
  if (existing !== null) {
    return { ok: true, ack: toAck(existing, "duplicate") };
  }

  // No frame exists at this key: enforce strictly-increasing session sequence
  // (req 1.1). A sequence at or below the latest accepted one that is not a
  // known duplicate is a regression and is rejected without persisting.
  const latest = await deps.repository.latestAcceptedSequence(
    pilot_id,
    request.session_id,
  );
  if (latest !== null && request.sequence_number <= latest) {
    return validationError(
      "sequence_number",
      `sequence_number ${request.sequence_number} is not greater than the ` +
        `previously accepted sequence ${latest} for this session`,
    );
  }

  const receivedAtIso = receivedAt.toISOString();

  // 4. Persist with source vs cloud-receive timestamps separate (req 1.7).
  try {
    const persisted = await deps.repository.persist({
      frame_id: request.frame_id,
      pilot_id,
      session_id: request.session_id,
      mission_id: request.mission_id,
      source_engine: request.source_engine,
      source_sequence: request.source_sequence,
      sequence_number: request.sequence_number,
      position: request.position,
      flight: request.flight,
      systems: request.systems,
      is_delta: request.is_delta,
      source_observed_at: request.observed_at,
      received_at: receivedAtIso,
      schema_version: schema,
    });
    return { ok: true, ack: toAck(persisted, "accepted") };
  } catch (err) {
    // 5. Idempotency on unique-key collision (req 2.7). A concurrent insert can
    //    win the race after our latest-sequence read; the DB constraint is the
    //    source of truth, so a collision here returns the equivalent ack.
    if (err instanceof DuplicateFrameError) {
      return idempotentAck(deps.repository, pilot_id, request);
    }
    throw err;
  }
}

/**
 * Resolve the already-persisted frame for the idempotency key and return an ack
 * equivalent to it (req 2.7). If the original cannot be reloaded (it must
 * exist, since we collided on it), surface as a validation-style failure rather
 * than fabricating an ack.
 */
async function idempotentAck(
  repository: TelemetryRepository,
  pilot_id: Uuid,
  request: TelemetryIngestRequest,
): Promise<IngestResult> {
  const original = await repository.findByIdempotencyKey(
    pilot_id,
    request.session_id,
    request.sequence_number,
  );
  if (original === null) {
    return validationError(
      "sequence_number",
      "duplicate frame detected but the original could not be resolved",
    );
  }
  return { ok: true, ack: toAck(original, "duplicate") };
}

function toAck(
  frame: PersistedTelemetryFrame,
  disposition: TelemetryAck["disposition"],
): TelemetryAck {
  return {
    frame_id: frame.frame_id,
    pilot_id: frame.pilot_id,
    session_id: frame.session_id,
    sequence_number: frame.sequence_number,
    source_observed_at: frame.source_observed_at,
    received_at: frame.received_at,
    disposition,
  };
}
