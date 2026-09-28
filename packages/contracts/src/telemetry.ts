/**
 * Telemetry contract (design Sections 4.1 and 4.3).
 *
 * This is the single normalized telemetry definition shared by the simulator
 * adapters, the desktop bridge, cloud ingestion, and the web terminal. The Rust
 * bridge crate mirrors these structures field-for-field so that both sides of
 * the uplink agree on one versioned contract.
 *
 * Unit conventions (the shared contract units all adapters normalize to):
 * - latitude_deg / longitude_deg: decimal degrees, WGS84 (EPSG:4326)
 * - altitude_msl_ft / altitude_agl_ft: feet
 * - ground_speed_kts: knots
 * - heading_deg: degrees true, 0 (inclusive) .. 360 (exclusive)
 * - vertical_speed_fpm: feet per minute
 * - pitch_deg / roll_deg: degrees
 * - fuel_remaining_lbs: pounds
 * - engine_torque_pct / rotor_rpm_pct: percent
 * - tot_celsius / outside_air_temp_c: degrees Celsius
 */

/**
 * Supported simulator engines (design Section 4.3).
 *
 * Modeled as a `const` object plus a union type rather than a TypeScript `enum`
 * so it works under `isolatedModules` / `verbatimModuleSyntax` and serializes as
 * a plain string across the wire and into the Rust mirror.
 */
export const SIMULATOR_ENGINES = [
  "MSFS2020",
  "MSFS2024",
  "XPLANE11",
  "XPLANE12",
] as const;

export type SimulatorEngine = (typeof SIMULATOR_ENGINES)[number];

/** ISO 8601 UTC timestamp string (e.g. `2024-01-01T00:00:00.000Z`). */
export type Timestamp = string;

/** UUID string. */
export type Uuid = string;

/** Geographic point in WGS84 decimal degrees (PostGIS `GEOGRAPHY(POINT, 4326)`). */
export interface GeoPoint {
  latitude_deg: number;
  longitude_deg: number;
}

/** Normalized position (design Section 4.3). */
export interface PositionVector {
  latitude_deg: number;
  longitude_deg: number;
  altitude_msl_ft: number;
  altitude_agl_ft: number;
}

/** Normalized flight kinematics (design Section 4.3). */
export interface FlightVector {
  ground_speed_kts: number;
  heading_deg: number;
  vertical_speed_fpm: number;
  pitch_deg: number;
  roll_deg: number;
}

/**
 * Normalized systems state (design Section 4.3).
 *
 * `tot_celsius`, `rotor_rpm_pct`, and `outside_air_temp_c` are optional because
 * not every airframe/adapter exposes them.
 */
export interface SystemsVector {
  fuel_remaining_lbs: number;
  engine_torque_pct: number;
  tot_celsius?: number;
  rotor_rpm_pct?: number;
  outside_air_temp_c?: number;
}

/**
 * A raw normalized sample produced by a {@link SimulatorEngine} adapter before
 * the bridge stamps it with session sequence, frame id, and schema version
 * (design Section 4.1).
 */
export interface TelemetrySample {
  source_engine: SimulatorEngine;
  source_sequence: number;
  observed_at: Timestamp;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
}

/**
 * The versioned telemetry frame persisted and fanned out by the cloud
 * (design Section 4.3). `schema_version` is stamped from the package
 * `SCHEMA_VERSION` constant.
 */
export interface TelemetryFrame {
  frame_id: Uuid;
  pilot_id: Uuid;
  mission_id?: Uuid;
  source_engine: SimulatorEngine;
  sequence_number: number;
  observed_at: Timestamp;
  received_at?: Timestamp;
  position: PositionVector;
  flight: FlightVector;
  systems: SystemsVector;
  is_delta: boolean;
  schema_version: string;
}

/** Narrowing guard: is `value` one of the supported simulator engines? */
export function isSimulatorEngine(value: unknown): value is SimulatorEngine {
  return (
    typeof value === "string" &&
    (SIMULATOR_ENGINES as readonly string[]).includes(value)
  );
}
