//! Telemetry contract mirror (design Sections 4.1 and 4.3).
//!
//! These structures mirror `@virtualhems/contracts` (packages/contracts) so the
//! Rust adapters and cloud ingestion share one versioned definition. Field
//! names and serialized enum values match the TypeScript contract exactly so a
//! frame produced by the bridge deserializes on the cloud without translation.
//!
//! Unit conventions (the shared contract units all adapters normalize to):
//! - `latitude_deg` / `longitude_deg`: decimal degrees, WGS84 (EPSG:4326)
//! - `altitude_msl_ft` / `altitude_agl_ft`: feet
//! - `ground_speed_kts`: knots
//! - `heading_deg`: degrees true, 0 (inclusive)..360 (exclusive)
//! - `vertical_speed_fpm`: feet per minute
//! - `pitch_deg` / `roll_deg`: degrees
//! - `fuel_remaining_lbs`: pounds
//! - `engine_torque_pct` / `rotor_rpm_pct`: percent
//! - `tot_celsius` / `outside_air_temp_c`: degrees Celsius

use serde::{Deserialize, Serialize};

/// Supported simulator engines (design Section 4.3).
///
/// Serializes as the bare screaming-case string (e.g. `"MSFS2020"`) to match the
/// TypeScript `SimulatorEngine` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimulatorEngine {
    #[serde(rename = "MSFS2020")]
    Msfs2020,
    #[serde(rename = "MSFS2024")]
    Msfs2024,
    #[serde(rename = "XPLANE11")]
    Xplane11,
    #[serde(rename = "XPLANE12")]
    Xplane12,
}

/// Geographic point in WGS84 decimal degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GeoPoint {
    pub latitude_deg: f64,
    pub longitude_deg: f64,
}

/// Normalized position (design Section 4.3).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PositionVector {
    pub latitude_deg: f64,
    pub longitude_deg: f64,
    pub altitude_msl_ft: f64,
    pub altitude_agl_ft: f64,
}

/// Normalized flight kinematics (design Section 4.3).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FlightVector {
    pub ground_speed_kts: f64,
    pub heading_deg: f64,
    pub vertical_speed_fpm: f64,
    pub pitch_deg: f64,
    pub roll_deg: f64,
}

/// Normalized systems state (design Section 4.3).
///
/// Optional fields are skipped when absent so the serialized shape matches the
/// optional TypeScript fields (which are simply omitted).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SystemsVector {
    pub fuel_remaining_lbs: f64,
    pub engine_torque_pct: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tot_celsius: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotor_rpm_pct: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outside_air_temp_c: Option<f64>,
}

/// A raw normalized sample produced by an adapter before the bridge stamps it
/// with session sequence, frame id, and schema version (design Section 4.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TelemetrySample {
    pub source_engine: SimulatorEngine,
    pub source_sequence: u64,
    /// ISO 8601 UTC timestamp string.
    pub observed_at: String,
    pub position: PositionVector,
    pub flight: FlightVector,
    pub systems: SystemsVector,
}

/// The versioned telemetry frame persisted and fanned out by the cloud
/// (design Section 4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TelemetryFrame {
    pub frame_id: String,
    pub pilot_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    pub source_engine: SimulatorEngine,
    pub sequence_number: u64,
    pub observed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received_at: Option<String>,
    pub position: PositionVector,
    pub flight: FlightVector,
    pub systems: SystemsVector,
    pub is_delta: bool,
    pub schema_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulator_engine_serializes_to_contract_string() {
        let json = serde_json::to_string(&SimulatorEngine::Msfs2020).unwrap();
        assert_eq!(json, "\"MSFS2020\"");
        let engine: SimulatorEngine = serde_json::from_str("\"XPLANE12\"").unwrap();
        assert_eq!(engine, SimulatorEngine::Xplane12);
    }

    #[test]
    fn telemetry_frame_roundtrips_and_omits_absent_optionals() {
        let frame = TelemetryFrame {
            frame_id: "11111111-1111-1111-1111-111111111111".into(),
            pilot_id: "22222222-2222-2222-2222-222222222222".into(),
            mission_id: None,
            source_engine: SimulatorEngine::Xplane11,
            sequence_number: 42,
            observed_at: "2024-01-01T00:00:00.000Z".into(),
            received_at: None,
            position: PositionVector {
                latitude_deg: 40.44,
                longitude_deg: -79.99,
                altitude_msl_ft: 1200.0,
                altitude_agl_ft: 300.0,
            },
            flight: FlightVector {
                ground_speed_kts: 120.0,
                heading_deg: 270.0,
                vertical_speed_fpm: -500.0,
                pitch_deg: 2.0,
                roll_deg: -5.0,
            },
            systems: SystemsVector {
                fuel_remaining_lbs: 800.0,
                engine_torque_pct: 65.0,
                tot_celsius: None,
                rotor_rpm_pct: None,
                outside_air_temp_c: None,
            },
            is_delta: false,
            schema_version: crate::SCHEMA_VERSION.to_string(),
        };

        let json = serde_json::to_string(&frame).unwrap();
        assert!(!json.contains("mission_id"));
        assert!(!json.contains("tot_celsius"));

        let decoded: TelemetryFrame = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, frame);
    }
}
