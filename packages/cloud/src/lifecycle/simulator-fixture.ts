/**
 * Simulator fixture → bridge → normalized telemetry (task 19.1).
 *
 * The Rust desktop bridge (apps/bridge-desktop) is CI-only: there is no cargo
 * toolchain in this environment, so the TypeScript lifecycle path cannot invoke
 * the real bridge. Instead this module models the first hop of the end-to-end
 * flow — "simulator fixture → bridge → normalized telemetry" — as a pure,
 * deterministic in-memory telemetry source that emits the SAME normalized
 * {@link TelemetryFrame} contract shape the bridge's adapters + normalization
 * pipeline produce (design Section 4.1/4.3, req 1.1).
 *
 * Each produced frame is a fully-normalized frame with a supported engine,
 * finite in-range values, a strictly increasing session sequence, a schema
 * version, and observed/received timestamps — exactly what ingestion (task 7.1)
 * validates and accepts. The fixture therefore stands in for the bridge output
 * boundary without re-implementing any bridge concern: it is a fixture, not a
 * simulator adapter.
 */

import {
  SCHEMA_VERSION,
  type FlightVector,
  type PositionVector,
  type SimulatorEngine,
  type SystemsVector,
  type TelemetryFrame,
  type Timestamp,
  type Uuid,
} from "@virtualhems/contracts";

/** A single scripted point along the fixture flight profile. */
export interface FixtureWaypoint {
  /** Seconds elapsed from the session start (deterministic offset). */
  offset_seconds: number;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
}

/** Configuration for a deterministic simulator-fixture telemetry source. */
export interface SimulatorFixtureConfig {
  pilot_id: Uuid;
  session_id: Uuid;
  mission_id?: Uuid;
  /** The declared source engine (a supported {@link SimulatorEngine}). */
  source_engine: SimulatorEngine;
  /** ISO-8601 session start instant; frame observed_at = start + offset. */
  session_start: Timestamp;
  /** The scripted flight profile, in offset order. */
  waypoints: FixtureWaypoint[];
  /** Deterministic frame-id builder; defaults to `${session_id}-${seq}`. */
  frameId?: (session_id: Uuid, sequence_number: number) => Uuid;
}

/**
 * A frame emitted by the fixture, carrying the session scope ingestion needs
 * (session_id scopes idempotency/monotonicity) alongside the normalized
 * {@link TelemetryFrame} body.
 */
export interface FixtureFrame {
  session_id: Uuid;
  frame: TelemetryFrame;
}

function defaultFrameId(session_id: Uuid, sequence_number: number): Uuid {
  return `${session_id}-${sequence_number}`;
}

/**
 * A deterministic, in-memory simulator telemetry source. Models the bridge's
 * output boundary: given a scripted flight profile it emits normalized
 * {@link TelemetryFrame}s with strictly increasing session sequence numbers and
 * offset-anchored observed timestamps. Pure and reproducible — no wall clock,
 * no network, no simulator process.
 */
export class SimulatorFixtureSource {
  private readonly config: SimulatorFixtureConfig;
  private readonly startMs: number;

  constructor(config: SimulatorFixtureConfig) {
    this.config = config;
    this.startMs = Date.parse(config.session_start);
  }

  /** The normalized frames for the scripted profile, in ascending sequence. */
  frames(): FixtureFrame[] {
    const buildId = this.config.frameId ?? defaultFrameId;
    return this.config.waypoints.map((wp, index) => {
      const sequence_number = index + 1;
      const observedMs = this.startMs + wp.offset_seconds * 1000;
      const observed_at = new Date(observedMs).toISOString();
      const frame: TelemetryFrame = {
        frame_id: buildId(this.config.session_id, sequence_number),
        pilot_id: this.config.pilot_id,
        ...(this.config.mission_id !== undefined
          ? { mission_id: this.config.mission_id }
          : {}),
        source_engine: this.config.source_engine,
        sequence_number,
        observed_at,
        position: wp.position,
        flight: wp.flight,
        systems: wp.systems,
        is_delta: false,
        schema_version: SCHEMA_VERSION,
      };
      return { session_id: this.config.session_id, frame };
    });
  }
}
