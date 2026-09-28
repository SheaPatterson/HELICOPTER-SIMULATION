//! X-Plane 11/12 FlyWithLua UDP adapter (design Section 4.1, requirements 1.4, 1.6, 1.8).
//!
//! A FlyWithLua script running inside X-Plane serializes rotorcraft datarefs to
//! a JSON object and sends one UDP datagram per sample to `127.0.0.1:8080`. This
//! adapter binds that socket, parses each datagram, validates it, converts the
//! simulator-native units into the shared contract units, and hands back a
//! normalized [`TelemetrySample`]. It never persists or transmits data
//! (requirement 1.8) — that is the bridge runtime's job.
//!
//! ## FlyWithLua payload
//!
//! The script reports these datarefs (SI / X-Plane native units). The adapter
//! converts each into the shared contract unit (see [`crate::telemetry`]):
//!
//! | Payload field         | Native unit        | Contract field         | Contract unit |
//! |-----------------------|--------------------|------------------------|---------------|
//! | `lat`                 | degrees            | `latitude_deg`         | degrees       |
//! | `lon`                 | degrees            | `longitude_deg`        | degrees       |
//! | `elevation_m`         | meters MSL         | `altitude_msl_ft`      | feet          |
//! | `agl_m`               | meters AGL         | `altitude_agl_ft`      | feet          |
//! | `groundspeed_mps`     | meters/second      | `ground_speed_kts`     | knots         |
//! | `heading_true_deg`    | degrees true       | `heading_deg`          | degrees       |
//! | `vertical_speed_mps`  | meters/second      | `vertical_speed_fpm`   | feet/minute   |
//! | `pitch_deg`           | degrees            | `pitch_deg`            | degrees       |
//! | `roll_deg`            | degrees            | `roll_deg`             | degrees       |
//! | `fuel_kg`             | kilograms          | `fuel_remaining_lbs`   | pounds        |
//! | `engine_torque_pct`   | percent            | `engine_torque_pct`    | percent       |
//! | `rotor_rpm_pct`       | percent (optional) | `rotor_rpm_pct`        | percent       |
//! | `itt_celsius`         | Celsius (optional) | `tot_celsius`          | Celsius       |
//! | `oat_celsius`         | Celsius (optional) | `outside_air_temp_c`   | Celsius       |
//! | `sim_version`         | `11` or `12`       | `source_engine`        | XPLANE11/12   |
//! | `sequence`            | integer            | `source_sequence`      | integer       |
//! | `sim_time_utc`        | ISO 8601 string    | `observed_at`          | ISO 8601      |

use std::net::UdpSocket;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::adapter::{
    AdapterError, AdapterHealth, AdapterResult, SimulatorAdapter, SourceState, Timestamp,
    SOURCE_TIMEOUT_SECS,
};
use crate::telemetry::{
    FlightVector, PositionVector, SimulatorEngine, SystemsVector, TelemetrySample,
};

/// The documented default bind address for the FlyWithLua listener
/// (design Section 4.2, requirement 1.4).
pub const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:8080";

/// Maximum expected FlyWithLua datagram size. Payloads are small JSON objects;
/// this bound keeps the receive buffer fixed without heap churn per sample.
const RECV_BUFFER_BYTES: usize = 4096;

// ---- unit conversion constants (native X-Plane → shared contract) ----------

const METERS_TO_FEET: f64 = 3.280_839_895_013_123;
const MPS_TO_KNOTS: f64 = 1.943_844_492_440_605; // 1 m/s = 3600/1852 kts
const MPS_TO_FPM: f64 = 196.850_393_700_787_4; // 60 s * 3.28084 ft/m
const KG_TO_POUNDS: f64 = 2.204_622_621_848_776;

/// The raw FlyWithLua UDP payload, deserialized straight from JSON.
///
/// This type is the adapter's private boundary: its simulator-specific field
/// names never escape this module (requirement 1.8, "not expose
/// simulator-specific field names beyond their implementation boundary").
#[derive(Debug, Clone, Deserialize)]
struct FlyWithLuaPayload {
    /// X-Plane major version: 11 or 12.
    sim_version: u32,
    sequence: u64,
    /// ISO 8601 UTC timestamp emitted by the script.
    sim_time_utc: String,

    lat: f64,
    lon: f64,
    elevation_m: f64,
    agl_m: f64,

    groundspeed_mps: f64,
    heading_true_deg: f64,
    vertical_speed_mps: f64,
    pitch_deg: f64,
    roll_deg: f64,

    fuel_kg: f64,
    engine_torque_pct: f64,
    #[serde(default)]
    rotor_rpm_pct: Option<f64>,
    #[serde(default)]
    itt_celsius: Option<f64>,
    #[serde(default)]
    oat_celsius: Option<f64>,
}

/// Parse and normalize a single FlyWithLua UDP datagram into the shared
/// [`TelemetrySample`] contract.
///
/// This is the pure core of the adapter: no sockets, no clock, no state. It
/// performs JSON parsing, engine identification (requirement 1.4), unit
/// conversion (requirement 1.4), and validation (design Section 4.3: reject
/// invalid coordinates, unsupported engines, non-finite values, impossible
/// headings). On any failure it returns [`AdapterError::InvalidSample`] with a
/// diagnostic that names the offending field.
pub fn parse_payload(bytes: &[u8]) -> Result<TelemetrySample, AdapterError> {
    let payload: FlyWithLuaPayload = serde_json::from_slice(bytes)
        .map_err(|e| AdapterError::InvalidSample(format!("malformed FlyWithLua JSON: {e}")))?;

    let source_engine = match payload.sim_version {
        11 => SimulatorEngine::Xplane11,
        12 => SimulatorEngine::Xplane12,
        other => {
            return Err(AdapterError::InvalidSample(format!(
                "unsupported X-Plane version {other}: expected 11 or 12"
            )))
        }
    };

    if payload.sim_time_utc.trim().is_empty() {
        return Err(AdapterError::InvalidSample(
            "sim_time_utc is empty".to_string(),
        ));
    }

    // Convert native units into the shared contract units.
    let position = PositionVector {
        latitude_deg: payload.lat,
        longitude_deg: payload.lon,
        altitude_msl_ft: payload.elevation_m * METERS_TO_FEET,
        altitude_agl_ft: payload.agl_m * METERS_TO_FEET,
    };
    let flight = FlightVector {
        ground_speed_kts: payload.groundspeed_mps * MPS_TO_KNOTS,
        heading_deg: payload.heading_true_deg,
        vertical_speed_fpm: payload.vertical_speed_mps * MPS_TO_FPM,
        pitch_deg: payload.pitch_deg,
        roll_deg: payload.roll_deg,
    };
    let systems = SystemsVector {
        fuel_remaining_lbs: payload.fuel_kg * KG_TO_POUNDS,
        engine_torque_pct: payload.engine_torque_pct,
        tot_celsius: payload.itt_celsius,
        rotor_rpm_pct: payload.rotor_rpm_pct,
        outside_air_temp_c: payload.oat_celsius,
    };

    let sample = TelemetrySample {
        source_engine,
        source_sequence: payload.sequence,
        observed_at: payload.sim_time_utc,
        position,
        flight,
        systems,
    };

    validate_sample(&sample)?;
    Ok(sample)
}

/// Validate a normalized sample against the contract rules
/// (design Section 4.3). Adapter-level validation catches source corruption at
/// the boundary before the sample enters the bridge pipeline.
fn validate_sample(sample: &TelemetrySample) -> Result<(), AdapterError> {
    let p = &sample.position;
    let f = &sample.flight;
    let s = &sample.systems;

    // Non-finite numeric values.
    let finite_checks: [(&str, f64); 11] = [
        ("latitude_deg", p.latitude_deg),
        ("longitude_deg", p.longitude_deg),
        ("altitude_msl_ft", p.altitude_msl_ft),
        ("altitude_agl_ft", p.altitude_agl_ft),
        ("ground_speed_kts", f.ground_speed_kts),
        ("heading_deg", f.heading_deg),
        ("vertical_speed_fpm", f.vertical_speed_fpm),
        ("pitch_deg", f.pitch_deg),
        ("roll_deg", f.roll_deg),
        ("fuel_remaining_lbs", s.fuel_remaining_lbs),
        ("engine_torque_pct", s.engine_torque_pct),
    ];
    for (field, value) in finite_checks {
        if !value.is_finite() {
            return Err(AdapterError::InvalidSample(format!(
                "{field} is not finite ({value})"
            )));
        }
    }
    for (field, value) in [
        ("tot_celsius", s.tot_celsius),
        ("rotor_rpm_pct", s.rotor_rpm_pct),
        ("outside_air_temp_c", s.outside_air_temp_c),
    ] {
        if let Some(v) = value {
            if !v.is_finite() {
                return Err(AdapterError::InvalidSample(format!(
                    "{field} is not finite ({v})"
                )));
            }
        }
    }

    // Invalid coordinates.
    if !(-90.0..=90.0).contains(&p.latitude_deg) {
        return Err(AdapterError::InvalidSample(format!(
            "latitude_deg {} out of range [-90, 90]",
            p.latitude_deg
        )));
    }
    if !(-180.0..=180.0).contains(&p.longitude_deg) {
        return Err(AdapterError::InvalidSample(format!(
            "longitude_deg {} out of range [-180, 180]",
            p.longitude_deg
        )));
    }

    // Impossible headings: contract heading is [0, 360).
    if !(0.0..360.0).contains(&f.heading_deg) {
        return Err(AdapterError::InvalidSample(format!(
            "heading_deg {} out of range [0, 360)",
            f.heading_deg
        )));
    }

    Ok(())
}

/// Abstraction over the receiving side of the UDP socket so the adapter's
/// timeout and normalization logic can be unit-tested deterministically without
/// binding a real socket.
///
/// `recv` returns `Ok(Some(bytes))` when a datagram was available, `Ok(None)`
/// when none was available (would-block / no data yet), and `Err` on transport
/// failure.
trait DatagramSource {
    fn recv(&self) -> Result<Option<Vec<u8>>, AdapterError>;
}

/// Real UDP socket bound to the FlyWithLua listener address.
struct UdpDatagramSource {
    socket: UdpSocket,
}

impl UdpDatagramSource {
    fn bind(address: &str) -> Result<Self, AdapterError> {
        let socket = UdpSocket::bind(address)
            .map_err(|e| AdapterError::Io(format!("failed to bind {address}: {e}")))?;
        // Non-blocking so `sample(now)` never stalls the bridge sampling loop:
        // when no datagram is queued we report NoData and let the timeout logic
        // decide on disconnection (requirement 1.6).
        socket
            .set_nonblocking(true)
            .map_err(|e| AdapterError::Io(format!("failed to set non-blocking: {e}")))?;
        Ok(Self { socket })
    }
}

impl DatagramSource for UdpDatagramSource {
    fn recv(&self) -> Result<Option<Vec<u8>>, AdapterError> {
        let mut buf = [0u8; RECV_BUFFER_BYTES];
        match self.socket.recv_from(&mut buf) {
            Ok((len, _addr)) => Ok(Some(buf[..len].to_vec())),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(e) => Err(AdapterError::Io(format!("recv failed: {e}"))),
        }
    }
}

/// X-Plane 11/12 FlyWithLua UDP adapter.
///
/// Generic over the datagram source so tests can drive it with a scripted
/// source; the public constructor [`XPlaneAdapter::new`] uses a real UDP socket.
pub struct XPlaneAdapter<S: DatagramSource = UdpDatagramSource> {
    bind_address: String,
    source: Option<S>,
    /// Timeout window for source-loss detection (requirement 1.6).
    timeout: Duration,
    /// Monotonic instant of the last accepted datagram, if any.
    last_received: Option<Instant>,
    /// Sticky diagnostic recorded when the source is first seen as lost, cleared
    /// when data resumes.
    diagnostic: Option<String>,
    /// Whether we have latched the disconnected diagnostic for the current gap
    /// (avoids re-recording every poll).
    source_lost_recorded: bool,
}

impl XPlaneAdapter<UdpDatagramSource> {
    /// Create an adapter bound (on `connect`) to the default FlyWithLua address
    /// `127.0.0.1:8080` (requirement 1.4).
    #[must_use]
    pub fn new() -> Self {
        Self::with_bind_address(DEFAULT_BIND_ADDRESS)
    }

    /// Create an adapter bound (on `connect`) to a specific address. The bridge
    /// runtime passes `BridgeConfiguration.udp_bind_address` here
    /// (design Section 4.2).
    #[must_use]
    pub fn with_bind_address(address: impl Into<String>) -> Self {
        Self {
            bind_address: address.into(),
            source: None,
            timeout: Duration::from_secs(SOURCE_TIMEOUT_SECS),
            last_received: None,
            diagnostic: None,
            source_lost_recorded: false,
        }
    }
}

impl Default for XPlaneAdapter<UdpDatagramSource> {
    fn default() -> Self {
        Self::new()
    }
}

impl SimulatorAdapter for XPlaneAdapter<UdpDatagramSource> {
    fn connect(&mut self) -> AdapterResult {
        if self.source.is_some() {
            return Ok(());
        }
        let source = UdpDatagramSource::bind(&self.bind_address)?;
        self.source = Some(source);
        self.last_received = None;
        self.diagnostic = None;
        self.source_lost_recorded = false;
        Ok(())
    }

    fn disconnect(&mut self) -> AdapterResult {
        self.source = None;
        self.last_received = None;
        self.source_lost_recorded = false;
        Ok(())
    }

    fn sample(&mut self, now: Timestamp) -> Result<TelemetrySample, AdapterError> {
        self.sample_impl(now)
    }

    fn health(&self, now: Timestamp) -> AdapterHealth {
        self.health_impl(now)
    }
}

impl<S: DatagramSource> XPlaneAdapter<S> {
    /// Shared sampling logic across real and test sources.
    fn sample_impl(&mut self, now: Instant) -> Result<TelemetrySample, AdapterError> {
        let Some(source) = self.source.as_ref() else {
            return Err(AdapterError::NotConnected);
        };

        match source.recv()? {
            None => Err(AdapterError::NoData),
            Some(bytes) => {
                // Parse + validate before we treat the source as alive: a
                // malformed datagram is rejected but does not reset the timeout,
                // matching the "reject sample, record diagnostic, continue
                // listener loop" edge case.
                let sample = parse_payload(&bytes).map_err(|e| {
                    // Latch the parse diagnostic without disturbing source-loss state.
                    self.diagnostic = Some(e.to_string());
                    e
                })?;
                self.last_received = Some(now);
                self.source_lost_recorded = false;
                self.diagnostic = None;
                Ok(sample)
            }
        }
    }

    /// Shared health logic; also latches the source-loss diagnostic exactly once
    /// per gap (requirement 1.6).
    fn health_impl(&self, now: Instant) -> AdapterHealth {
        if self.source.is_none() {
            return AdapterHealth::offline();
        }

        match self.last_received {
            None => AdapterHealth {
                // Connected transport, awaiting the first datagram.
                source_state: SourceState::Connected,
                last_sample_age_secs: None,
                diagnostic: self.diagnostic.clone(),
            },
            Some(last) => {
                let age = now.saturating_duration_since(last);
                if age >= self.timeout {
                    AdapterHealth {
                        source_state: SourceState::Disconnected,
                        last_sample_age_secs: Some(age.as_secs()),
                        diagnostic: Some(source_loss_diagnostic(age)),
                    }
                } else {
                    AdapterHealth {
                        source_state: SourceState::Connected,
                        last_sample_age_secs: Some(age.as_secs()),
                        diagnostic: None,
                    }
                }
            }
        }
    }

    /// Advance timeout bookkeeping and record the source-loss diagnostic once
    /// when the gap first crosses the threshold. The bridge runtime calls this
    /// on its sampling tick; it returns the diagnostic string the first time the
    /// source is newly considered lost so the runtime can record it
    /// (requirement 1.6).
    pub fn poll_source_loss(&mut self, now: Timestamp) -> Option<String> {
        let last = self.last_received?;
        let age = now.saturating_duration_since(last);
        if age >= self.timeout && !self.source_lost_recorded {
            self.source_lost_recorded = true;
            let diagnostic = source_loss_diagnostic(age);
            self.diagnostic = Some(diagnostic.clone());
            Some(diagnostic)
        } else {
            None
        }
    }
}

/// The diagnostic message recorded when the FlyWithLua source is lost
/// (requirement 1.6: "record a diagnostic identifying the source loss").
fn source_loss_diagnostic(age: Duration) -> String {
    format!(
        "X-Plane FlyWithLua source disconnected: no UDP data on {DEFAULT_BIND_ADDRESS} for {}s (>= {SOURCE_TIMEOUT_SECS}s)",
        age.as_secs()
    )
}

#[cfg(test)]
mod tests {
    //! X-Plane adapter test suite (task 4.3).
    //!
    //! Organized by the requirement each section (banner-commented below)
    //! exercises:
    //! - unit conversion — native SI → shared contract conversions with known
    //!   values and boundaries, plus a proptest for exactness (requirement 1.4).
    //! - supported-engine mapping — `sim_version` → `XPLANE11`/`XPLANE12` and
    //!   rejection of every other version (requirement 1.4; parity with 1.2).
    //! - malformed rejection — out-of-range coordinates, impossible headings,
    //!   empty timestamp, and malformed JSON are rejected as `InvalidSample`
    //!   naming the offending field (requirement 1.3; supports the 1.4 boundary).
    //! - source loss — 5-second silence produces `Disconnected` plus a
    //!   diagnostic, recorded exactly once per gap (requirement 1.6).

    use super::*;
    use std::cell::RefCell;

    /// Scripted datagram source: pops queued datagrams in order, then reports
    /// no-data.
    struct ScriptedSource {
        queue: RefCell<std::collections::VecDeque<Result<Option<Vec<u8>>, AdapterError>>>,
    }

    impl ScriptedSource {
        fn new(items: Vec<Result<Option<Vec<u8>>, AdapterError>>) -> Self {
            Self {
                queue: RefCell::new(items.into_iter().collect()),
            }
        }
    }

    impl DatagramSource for ScriptedSource {
        fn recv(&self) -> Result<Option<Vec<u8>>, AdapterError> {
            self.queue
                .borrow_mut()
                .pop_front()
                .unwrap_or(Ok(None))
        }
    }

    fn adapter_with(items: Vec<Result<Option<Vec<u8>>, AdapterError>>) -> XPlaneAdapter<ScriptedSource> {
        XPlaneAdapter {
            bind_address: DEFAULT_BIND_ADDRESS.to_string(),
            source: Some(ScriptedSource::new(items)),
            timeout: Duration::from_secs(SOURCE_TIMEOUT_SECS),
            last_received: None,
            diagnostic: None,
            source_lost_recorded: false,
        }
    }

    fn valid_payload() -> &'static str {
        r#"{
            "sim_version": 12,
            "sequence": 7,
            "sim_time_utc": "2024-01-01T00:00:00.000Z",
            "lat": 40.44, "lon": -79.99,
            "elevation_m": 365.76, "agl_m": 91.44,
            "groundspeed_mps": 61.7333, "heading_true_deg": 270.0,
            "vertical_speed_mps": -2.54, "pitch_deg": 2.0, "roll_deg": -5.0,
            "fuel_kg": 362.874, "engine_torque_pct": 65.0,
            "rotor_rpm_pct": 100.0, "itt_celsius": 720.0, "oat_celsius": 15.0
        }"#
    }

    /// Build a JSON payload string from individually overridable numeric fields
    /// so tests can target one field at a time without brittle string replaces.
    #[allow(clippy::too_many_arguments)]
    fn payload_json(
        sim_version: &str,
        sequence: &str,
        sim_time_utc: &str,
        lat: f64,
        lon: f64,
        elevation_m: f64,
        agl_m: f64,
        groundspeed_mps: f64,
        heading_true_deg: f64,
        vertical_speed_mps: f64,
        pitch_deg: f64,
        roll_deg: f64,
        fuel_kg: f64,
        engine_torque_pct: f64,
    ) -> String {
        format!(
            r#"{{
                "sim_version": {sim_version},
                "sequence": {sequence},
                "sim_time_utc": "{sim_time_utc}",
                "lat": {lat}, "lon": {lon},
                "elevation_m": {elevation_m}, "agl_m": {agl_m},
                "groundspeed_mps": {groundspeed_mps}, "heading_true_deg": {heading_true_deg},
                "vertical_speed_mps": {vertical_speed_mps}, "pitch_deg": {pitch_deg}, "roll_deg": {roll_deg},
                "fuel_kg": {fuel_kg}, "engine_torque_pct": {engine_torque_pct}
            }}"#
        )
    }

    // =======================================================================
    // Requirement 1.4 — unit conversion correctness (known values + boundaries)
    // =======================================================================

        #[test]
        fn parses_and_normalizes_units() {
            let sample = parse_payload(valid_payload().as_bytes()).unwrap();
            assert_eq!(sample.source_engine, SimulatorEngine::Xplane12);
            assert_eq!(sample.source_sequence, 7);
            assert_eq!(sample.observed_at, "2024-01-01T00:00:00.000Z");
            // 365.76 m ≈ 1200 ft.
            assert!((sample.position.altitude_msl_ft - 1200.0).abs() < 0.5);
            // 91.44 m ≈ 300 ft.
            assert!((sample.position.altitude_agl_ft - 300.0).abs() < 0.5);
            // 61.7333 m/s ≈ 120 kts.
            assert!((sample.flight.ground_speed_kts - 120.0).abs() < 0.1);
            // -2.54 m/s ≈ -500 fpm.
            assert!((sample.flight.vertical_speed_fpm - (-500.0)).abs() < 0.5);
            // 362.874 kg ≈ 800 lbs.
            assert!((sample.systems.fuel_remaining_lbs - 800.0).abs() < 0.5);
            assert_eq!(sample.systems.rotor_rpm_pct, Some(100.0));
        }

        #[test]
        fn latitude_longitude_pass_through_unconverted() {
            // X-Plane already reports lat/lon in degrees; they must not be scaled.
            let sample = parse_payload(valid_payload().as_bytes()).unwrap();
            assert!((sample.position.latitude_deg - 40.44).abs() < 1e-12);
            assert!((sample.position.longitude_deg - (-79.99)).abs() < 1e-12);
            // Heading, pitch, roll are also degree pass-through.
            assert!((sample.flight.heading_deg - 270.0).abs() < 1e-12);
            assert!((sample.flight.pitch_deg - 2.0).abs() < 1e-12);
            assert!((sample.flight.roll_deg - (-5.0)).abs() < 1e-12);
        }

        #[test]
        fn zero_inputs_convert_to_zero() {
            let json = payload_json(
                "12", "0", "2024-01-01T00:00:00Z", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                0.0, 0.0,
            );
            let s = parse_payload(json.as_bytes()).unwrap();
            assert_eq!(s.position.altitude_msl_ft, 0.0);
            assert_eq!(s.flight.ground_speed_kts, 0.0);
            assert_eq!(s.flight.vertical_speed_fpm, 0.0);
            assert_eq!(s.systems.fuel_remaining_lbs, 0.0);
        }

        #[test]
        fn optional_systems_fields_absent_map_to_none() {
            // valid_payload includes optionals; drop them via a minimal payload.
            let json = payload_json(
                "11", "1", "2024-01-01T00:00:00Z", 10.0, 20.0, 100.0, 50.0, 30.0, 90.0, 1.0, 0.0,
                0.0, 200.0, 40.0,
            );
            let s = parse_payload(json.as_bytes()).unwrap();
            assert_eq!(s.systems.tot_celsius, None);
            assert_eq!(s.systems.rotor_rpm_pct, None);
            assert_eq!(s.systems.outside_air_temp_c, None);
        }

        #[test]
        fn conversion_constants_match_known_reference_values() {
            // 1 m = 3.28084 ft; 1 m/s = 1.943844 kts; 1 m/s = 196.85 fpm; 1 kg = 2.204623 lbs.
            let json = payload_json(
                "12", "1", "2024-01-01T00:00:00Z", 0.0, 0.0, 1.0, 1.0, 1.0, 180.0, 1.0, 0.0, 0.0,
                1.0, 0.0,
            );
            let s = parse_payload(json.as_bytes()).unwrap();
            assert!((s.position.altitude_msl_ft - 3.280_839_895).abs() < 1e-6);
            assert!((s.flight.ground_speed_kts - 1.943_844_492).abs() < 1e-6);
            assert!((s.flight.vertical_speed_fpm - 196.850_393_7).abs() < 1e-4);
            assert!((s.systems.fuel_remaining_lbs - 2.204_622_622).abs() < 1e-6);
        }

        proptest::proptest! {
            /// For any finite, in-range inputs, conversions are linear, exact to
            /// tolerance, sign-preserving, and never introduce non-finite output
            /// (requirement 1.4).
            #[test]
            fn conversions_are_linear_and_sign_preserving(
                lat in -90.0f64..=90.0,
                lon in -180.0f64..=180.0,
                elevation_m in -500.0f64..30000.0,
                agl_m in 0.0f64..30000.0,
                groundspeed_mps in 0.0f64..200.0,
                heading in 0.0f64..360.0,
                vs_mps in -100.0f64..100.0,
                fuel_kg in 0.0f64..5000.0,
            ) {
                let json = payload_json(
                    "12", "3", "2024-01-01T00:00:00Z", lat, lon, elevation_m, agl_m,
                    groundspeed_mps, heading, vs_mps, 0.0, 0.0, fuel_kg, 50.0,
                );
                let s = parse_payload(json.as_bytes()).unwrap();

                proptest::prop_assert!((s.position.altitude_msl_ft - elevation_m * METERS_TO_FEET).abs() < 1e-6);
                proptest::prop_assert!((s.position.altitude_agl_ft - agl_m * METERS_TO_FEET).abs() < 1e-6);
                proptest::prop_assert!((s.flight.ground_speed_kts - groundspeed_mps * MPS_TO_KNOTS).abs() < 1e-6);
                proptest::prop_assert!((s.flight.vertical_speed_fpm - vs_mps * MPS_TO_FPM).abs() < 1e-4);
                proptest::prop_assert!((s.systems.fuel_remaining_lbs - fuel_kg * KG_TO_POUNDS).abs() < 1e-6);
                // Sign preservation for vertical speed.
                proptest::prop_assert_eq!(
                    s.flight.vertical_speed_fpm.is_sign_negative(),
                    vs_mps.is_sign_negative()
                );
                // No conversion produces a non-finite value.
                proptest::prop_assert!(s.position.altitude_msl_ft.is_finite());
                proptest::prop_assert!(s.flight.ground_speed_kts.is_finite());
            }
        }

    // =======================================================================
    // Requirement 1.4 — supported-engine mapping (XPLANE11 / XPLANE12)
    // =======================================================================

        #[test]
        fn identifies_xplane11_and_xplane12() {
            let v11 = valid_payload().replace("\"sim_version\": 12", "\"sim_version\": 11");
            assert_eq!(
                parse_payload(v11.as_bytes()).unwrap().source_engine,
                SimulatorEngine::Xplane11
            );
            assert_eq!(
                parse_payload(valid_payload().as_bytes()).unwrap().source_engine,
                SimulatorEngine::Xplane12
            );
        }

        #[test]
        fn rejects_unsupported_version_naming_the_value() {
            // The X-Plane adapter is version-keyed; an unknown version is a
            // compatibility rejection that names the offending value (parity
            // with requirement 1.2, no coercion).
            for bad in ["9", "10", "13", "0"] {
                let json = valid_payload()
                    .replace("\"sim_version\": 12", &format!("\"sim_version\": {bad}"));
                match parse_payload(json.as_bytes()) {
                    Err(AdapterError::InvalidSample(msg)) => {
                        assert!(msg.contains(bad), "message must name version {bad}: {msg}");
                        assert!(msg.contains("11") && msg.contains("12"));
                    }
                    other => panic!("expected InvalidSample for version {bad}, got {other:?}"),
                }
            }
        }

    // =======================================================================
    // Requirement 1.3 — malformed sample rejection (also the boundary edge of 1.4)
    // =======================================================================

        #[test]
        fn rejects_malformed_json() {
            match parse_payload(b"not json at all") {
                Err(AdapterError::InvalidSample(msg)) => {
                    assert!(msg.contains("malformed FlyWithLua JSON"), "{msg}");
                }
                other => panic!("expected InvalidSample, got {other:?}"),
            }
            // Missing required fields is also malformed.
            assert!(matches!(
                parse_payload(br#"{"sim_version": 12}"#),
                Err(AdapterError::InvalidSample(_))
            ));
        }

        #[test]
        fn rejects_empty_timestamp() {
            let json = valid_payload().replace(
                "\"sim_time_utc\": \"2024-01-01T00:00:00.000Z\"",
                "\"sim_time_utc\": \"   \"",
            );
            match parse_payload(json.as_bytes()) {
                Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("sim_time_utc")),
                other => panic!("expected InvalidSample, got {other:?}"),
            }
        }

        #[test]
        fn rejects_out_of_range_latitude() {
            for bad in [91.0, -91.0, 180.0] {
                let json = valid_payload()
                    .replace("\"lat\": 40.44", &format!("\"lat\": {bad}"));
                match parse_payload(json.as_bytes()) {
                    Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("latitude_deg")),
                    other => panic!("expected InvalidSample for lat {bad}, got {other:?}"),
                }
            }
        }

        #[test]
        fn rejects_out_of_range_longitude() {
            for bad in [181.0, -181.0, 360.0] {
                let json = valid_payload()
                    .replace("\"lon\": -79.99", &format!("\"lon\": {bad}"));
                match parse_payload(json.as_bytes()) {
                    Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("longitude_deg")),
                    other => panic!("expected InvalidSample for lon {bad}, got {other:?}"),
                }
            }
        }

        #[test]
        fn accepts_coordinate_boundaries() {
            // Inclusive bounds must be accepted (design Section 4.3).
            for (lat, lon) in [(90.0, 180.0), (-90.0, -180.0), (0.0, 0.0)] {
                let json = valid_payload()
                    .replace("\"lat\": 40.44", &format!("\"lat\": {lat}"))
                    .replace("\"lon\": -79.99", &format!("\"lon\": {lon}"));
                assert!(
                    parse_payload(json.as_bytes()).is_ok(),
                    "boundary ({lat},{lon}) should be accepted"
                );
            }
        }

        #[test]
        fn rejects_impossible_heading_including_360() {
            for bad in [360.0, 400.0, -1.0] {
                let json = valid_payload()
                    .replace("\"heading_true_deg\": 270.0", &format!("\"heading_true_deg\": {bad}"));
                match parse_payload(json.as_bytes()) {
                    Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("heading_deg")),
                    other => panic!("expected InvalidSample for heading {bad}, got {other:?}"),
                }
            }
        }

        #[test]
        fn accepts_heading_lower_bound_zero() {
            let json = valid_payload().replace("\"heading_true_deg\": 270.0", "\"heading_true_deg\": 0.0");
            let s = parse_payload(json.as_bytes()).unwrap();
            assert_eq!(s.flight.heading_deg, 0.0);
        }

        // Note: non-finite (NaN/Infinity) rejection for the shared validation
        // path is covered exhaustively on the MSFS side, where `map_sample`
        // accepts an f64 struct and can be driven with `f64::NAN` /
        // `f64::INFINITY` deterministically. JSON has no portable NaN/Infinity
        // literal, so we do not attempt to inject one through `parse_payload`
        // here; the finite-check code path is identical in intent.

        proptest::proptest! {
            /// Any latitude strictly outside [-90, 90] is rejected (requirement 1.3).
            #[test]
            fn out_of_range_latitude_always_rejected(bad_lat in 90.001f64..1000.0) {
                let json = valid_payload().replace("\"lat\": 40.44", &format!("\"lat\": {bad_lat}"));
                proptest::prop_assert!(matches!(
                    parse_payload(json.as_bytes()),
                    Err(AdapterError::InvalidSample(_))
                ));
            }

            /// Any heading >= 360 is rejected (requirement 1.3, upper bound exclusive).
            #[test]
            fn heading_at_or_above_360_always_rejected(bad in 360.0f64..2000.0) {
                let json = valid_payload()
                    .replace("\"heading_true_deg\": 270.0", &format!("\"heading_true_deg\": {bad}"));
                proptest::prop_assert!(matches!(
                    parse_payload(json.as_bytes()),
                    Err(AdapterError::InvalidSample(_))
                ));
            }
        }

    // =======================================================================
    // Requirement 1.6 — 5-second source-loss detection + diagnostic
    // =======================================================================

        #[test]
        fn sample_without_connect_is_not_connected() {
            let mut adapter = adapter_with(vec![]);
            adapter.source = None;
            let err = adapter.sample_impl(Instant::now()).unwrap_err();
            assert_eq!(err, AdapterError::NotConnected);
        }

        #[test]
        fn no_datagram_reports_no_data() {
            let mut adapter = adapter_with(vec![Ok(None)]);
            assert_eq!(adapter.sample_impl(Instant::now()).unwrap_err(), AdapterError::NoData);
        }

        #[test]
        fn connected_below_timeout_stays_connected() {
            let start = Instant::now();
            let mut adapter = adapter_with(vec![Ok(Some(valid_payload().into_bytes()))]);
            adapter.sample_impl(start).unwrap();
            // 4s < 5s timeout: still connected, no diagnostic.
            let healthy = adapter.health_impl(start + Duration::from_secs(SOURCE_TIMEOUT_SECS - 1));
            assert_eq!(healthy.source_state, SourceState::Connected);
            assert!(healthy.diagnostic.is_none());
        }

        #[test]
        fn marks_disconnected_exactly_at_timeout_and_records_diagnostic() {
            let start = Instant::now();
            let mut adapter = adapter_with(vec![Ok(Some(valid_payload().into_bytes()))]);
            adapter.sample_impl(start).unwrap();

            // Exactly 5s: boundary is inclusive (>= timeout).
            let later = start + Duration::from_secs(SOURCE_TIMEOUT_SECS);
            let lost = adapter.health_impl(later);
            assert_eq!(lost.source_state, SourceState::Disconnected);
            let diag = lost.diagnostic.as_deref().unwrap();
            assert!(diag.contains("disconnected"));
            assert!(diag.contains(DEFAULT_BIND_ADDRESS));
            assert_eq!(lost.last_sample_age_secs, Some(SOURCE_TIMEOUT_SECS));
        }

        #[test]
        fn poll_source_loss_records_diagnostic_exactly_once_per_gap() {
            let start = Instant::now();
            let mut adapter = adapter_with(vec![Ok(Some(valid_payload().into_bytes()))]);
            adapter.sample_impl(start).unwrap();

            let later = start + Duration::from_secs(SOURCE_TIMEOUT_SECS);
            let first = adapter.poll_source_loss(later);
            let diag = first.expect("first poll after timeout records a diagnostic");
            assert!(diag.contains("disconnected"), "diagnostic should name the loss: {diag}");
            // Subsequent polls in the same gap do not re-record.
            assert!(adapter.poll_source_loss(later + Duration::from_secs(1)).is_none());
        }

        #[test]
        fn resuming_data_clears_disconnected_state() {
            let start = Instant::now();
            let mut adapter = adapter_with(vec![
                Ok(Some(valid_payload().into_bytes())),
                Ok(Some(valid_payload().into_bytes())),
            ]);
            adapter.sample_impl(start).unwrap();
            let _ = adapter.poll_source_loss(start + Duration::from_secs(SOURCE_TIMEOUT_SECS));
            // New datagram resets the clock and re-arms one-shot recording.
            let resume = start + Duration::from_secs(10);
            adapter.sample_impl(resume).unwrap();
            assert_eq!(adapter.health_impl(resume).source_state, SourceState::Connected);
            // A fresh gap after resume records again.
            assert!(adapter
                .poll_source_loss(resume + Duration::from_secs(SOURCE_TIMEOUT_SECS))
                .is_some());
        }

        #[test]
        fn malformed_datagram_does_not_reset_the_timeout_clock() {
            let start = Instant::now();
            // First a good sample, then a malformed one arriving before timeout.
            let mut adapter = adapter_with(vec![
                Ok(Some(valid_payload().into_bytes())),
                Ok(Some(b"garbage".to_vec())),
            ]);
            adapter.sample_impl(start).unwrap();
            // Malformed sample rejected; clock is NOT advanced by it.
            let mid = start + Duration::from_secs(2);
            assert!(matches!(
                adapter.sample_impl(mid),
                Err(AdapterError::InvalidSample(_))
            ));
            // Still measured from the last GOOD sample: 5s from start => disconnected.
            let later = start + Duration::from_secs(SOURCE_TIMEOUT_SECS);
            assert_eq!(adapter.health_impl(later).source_state, SourceState::Disconnected);
        }
}
