//! MSFS SimConnect simulator adapter (design Section 4.1; requirements 1.2, 1.4, 1.8).
//!
//! This adapter implements the shared [`SimulatorAdapter`] contract for
//! Microsoft Flight Simulator (2020 and 2024). It reads rotorcraft state over
//! SimConnect, converts the simulator-native units into the shared telemetry
//! contract ([`crate::telemetry`]), and identifies the source engine as
//! `MSFS2020` or `MSFS2024`. It never persists or transmits data (requirement
//! 1.8) — that is the bridge runtime's job.
//!
//! ## Coordination note
//!
//! The shared `SimulatorAdapter` trait plus the `AdapterError` / `AdapterHealth`
//! / `SourceState` / `Timestamp` types and `SOURCE_TIMEOUT_SECS` live in the
//! shared adapter contract module `crate::adapter` (`src/adapter.rs`, authored
//! by task 4.1, which declares `pub mod msfs;` and `pub mod xplane;`). This file
//! implements ONLY the MSFS adapter against that contract and does not redefine
//! the trait or touch `telemetry.rs` or the X-Plane adapter.
//!
//! ## Testability / cross-platform build
//!
//! A real SimConnect binding needs the Windows SDK and only links on Windows. To
//! keep the crate compiling and unit-testable on every CI target, the SimConnect
//! read is modeled through the [`SimConnectSource`] trait, which yields a plain
//! [`SimConnectRotorcraftState`] intermediate struct holding the raw simulator
//! variables in SimConnect's native units. The native binding is provided only
//! under `#[cfg(all(windows, feature = "simconnect"))]`; on all other targets
//! (and in tests) a source is injected. Mapping, engine identification, and
//! rejection are therefore pure and fully covered without the native SDK.

use crate::adapter::{
    AdapterError, AdapterHealth, AdapterResult, SimulatorAdapter, SourceState, Timestamp,
    SOURCE_TIMEOUT_SECS,
};
use crate::telemetry::{
    FlightVector, PositionVector, SimulatorEngine, SystemsVector, TelemetrySample,
};

use std::time::Duration;

/// Raw rotorcraft state as read from SimConnect, in SimConnect's native units.
///
/// This is the adapter's private boundary intermediate: its simulator-specific
/// field names never escape this module (requirement 1.8). The native binding
/// fills it in (or tests inject it); [`map_sample`] converts each field into the
/// shared contract unit:
///
/// | Field                    | SimConnect unit           | Contract unit       |
/// |--------------------------|---------------------------|---------------------|
/// | `plane_latitude_rad`     | radians                   | decimal degrees     |
/// | `plane_longitude_rad`    | radians                   | decimal degrees     |
/// | `plane_altitude_ft`      | feet                      | feet (MSL)          |
/// | `plane_alt_above_ground_ft` | feet                   | feet (AGL)          |
/// | `ground_velocity_kts`    | knots                     | knots               |
/// | `plane_heading_true_rad` | radians                   | degrees true        |
/// | `vertical_speed_fps`     | feet/second               | feet/minute         |
/// | `plane_pitch_rad`        | radians (+ nose down)     | degrees (+ nose up) |
/// | `plane_bank_rad`         | radians (+ right roll)    | degrees             |
/// | `fuel_total_weight_lbs`  | pounds                    | pounds              |
/// | `eng_torque_pct`         | percent                   | percent             |
/// | `turb_eng_itt_rankine`   | rankine (optional)        | Celsius             |
/// | `rotor_rpm_pct`          | percent (optional)        | percent             |
/// | `ambient_temp_c`         | Celsius (optional)        | Celsius             |
#[derive(Debug, Clone, PartialEq)]
pub struct SimConnectRotorcraftState {
    /// Source sequence counter provided by the SimConnect data-request loop.
    pub source_sequence: u64,
    /// ISO 8601 UTC timestamp string emitted for this read.
    pub sim_time_utc: String,

    // Position (radians / feet).
    pub plane_latitude_rad: f64,
    pub plane_longitude_rad: f64,
    pub plane_altitude_ft: f64,
    pub plane_alt_above_ground_ft: f64,

    // Flight kinematics.
    pub ground_velocity_kts: f64,
    pub plane_heading_true_rad: f64,
    pub vertical_speed_fps: f64,
    pub plane_pitch_rad: f64,
    pub plane_bank_rad: f64,

    // Systems.
    pub fuel_total_weight_lbs: f64,
    pub eng_torque_pct: f64,
    pub turb_eng_itt_rankine: Option<f64>,
    pub rotor_rpm_pct: Option<f64>,
    pub ambient_temp_c: Option<f64>,
}

// ---- unit conversion constants (native SimConnect → shared contract) --------

/// SimConnect vertical speed is feet/second; the contract is feet/minute.
const FPS_TO_FPM: f64 = 60.0;

/// The engine/version reported by a SimConnect session, before validation.
///
/// SimConnect itself does not hand back a clean "MSFS2020 vs MSFS2024" token, so
/// the source resolves it (e.g. from the connected app name/version) and reports
/// it here. `Supported` carries a known-good engine; `Unsupported` carries the
/// raw reported string verbatim so the adapter can name it in a compatibility
/// error without coercion (requirement 1.2). `Undetermined` means the source
/// could not identify the version at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReportedEngine {
    /// A recognized MSFS engine (MSFS2020 or MSFS2024).
    Supported(SimulatorEngine),
    /// A recognized-but-not-MSFS or otherwise unsupported engine/version. Holds
    /// the exact reported value for the compatibility message.
    Unsupported(String),
    /// The engine/version could not be determined from the session.
    Undetermined,
}

/// Abstraction over the SimConnect read so the adapter is testable and compiles
/// on non-Windows targets.
///
/// The native implementation lives behind `#[cfg(all(windows, feature =
/// "simconnect"))]`; tests and non-Windows builds inject their own source.
pub trait SimConnectSource {
    /// Open the SimConnect session.
    fn open(&mut self) -> Result<(), String>;
    /// Close the SimConnect session.
    fn close(&mut self) -> Result<(), String>;
    /// Read the current rotorcraft state in native SimConnect units. Returns
    /// `Ok(None)` when no fresh data is available yet (mirrors the X-Plane
    /// adapter's no-data semantics).
    fn read_state(&mut self) -> Result<Option<SimConnectRotorcraftState>, String>;
    /// The engine/version this session represents, as reported by SimConnect.
    fn reported_engine(&self) -> ReportedEngine;
}

/// MSFS SimConnect adapter over an injectable [`SimConnectSource`].
///
/// Generic over the source so tests drive it with a scripted source. It reads
/// rotorcraft state, normalizes units into the shared contract, and tags the
/// source engine as `MSFS2020` or `MSFS2024`. It never persists or transmits
/// (requirement 1.8).
pub struct MsfsAdapter<S: SimConnectSource> {
    source: Option<S>,
    timeout: Duration,
    /// Monotonic instant of the last accepted read, if any.
    last_received: Option<Timestamp>,
    /// Latched diagnostic (compatibility rejection, read error, or source loss).
    diagnostic: Option<String>,
    /// Whether the source-loss diagnostic has been latched for the current gap.
    source_lost_recorded: bool,
}

impl<S: SimConnectSource> MsfsAdapter<S> {
    /// Create an adapter over the given (not-yet-opened) SimConnect source.
    #[must_use]
    pub fn new(source: S) -> Self {
        Self {
            source: Some(source),
            timeout: Duration::from_secs(SOURCE_TIMEOUT_SECS),
            last_received: None,
            diagnostic: None,
            source_lost_recorded: false,
        }
    }

    /// Resolve and validate the engine the source reports.
    ///
    /// Only `MSFS2020` and `MSFS2024` are supported. Any other reported
    /// engine/version — including a non-MSFS engine, an unknown string, or an
    /// undeterminable session — is rejected with an actionable
    /// [`AdapterError::InvalidSample`] that names the unsupported value, and no
    /// fields are coerced (requirement 1.2).
    fn resolve_engine(&self) -> Result<SimulatorEngine, AdapterError> {
        match self.source.as_ref().map(SimConnectSource::reported_engine) {
            Some(ReportedEngine::Supported(
                engine @ (SimulatorEngine::Msfs2020 | SimulatorEngine::Msfs2024),
            )) => Ok(engine),
            // A supported-enum value that is not MSFS (defensive: an X-Plane
            // engine handed to the MSFS adapter) is still a compatibility error.
            Some(ReportedEngine::Supported(other)) => {
                Err(compatibility_error(engine_label(other)))
            }
            Some(ReportedEngine::Unsupported(reported)) => Err(compatibility_error(&reported)),
            Some(ReportedEngine::Undetermined) | None => Err(AdapterError::InvalidSample(
                "MSFS adapter could not determine the simulator engine/version; expected \
                 MSFS2020 or MSFS2024. Verify the SimConnect connection and simulator version."
                    .to_string(),
            )),
        }
    }
}

/// Map raw SimConnect rotorcraft state to a normalized [`TelemetrySample`].
///
/// All unit conversions to the shared contract happen here (requirement 1.4).
/// Any non-finite raw value is rejected as [`AdapterError::InvalidSample`] rather
/// than silently coerced, and invalid coordinates / impossible headings are
/// rejected at the boundary (design Section 4.3).
pub fn map_sample(
    engine: SimulatorEngine,
    raw: &SimConnectRotorcraftState,
) -> Result<TelemetrySample, AdapterError> {
    // Reject non-finite required numeric inputs instead of coercing them.
    let required = [
        ("plane_latitude", raw.plane_latitude_rad),
        ("plane_longitude", raw.plane_longitude_rad),
        ("plane_altitude", raw.plane_altitude_ft),
        ("plane_alt_above_ground", raw.plane_alt_above_ground_ft),
        ("ground_velocity", raw.ground_velocity_kts),
        ("plane_heading_true", raw.plane_heading_true_rad),
        ("vertical_speed", raw.vertical_speed_fps),
        ("plane_pitch", raw.plane_pitch_rad),
        ("plane_bank", raw.plane_bank_rad),
        ("fuel_total_weight", raw.fuel_total_weight_lbs),
        ("eng_torque_pct", raw.eng_torque_pct),
    ];
    for (field, value) in required {
        if !value.is_finite() {
            return Err(AdapterError::InvalidSample(format!(
                "SimConnect variable `{field}` was non-finite ({value})"
            )));
        }
    }

    if raw.sim_time_utc.trim().is_empty() {
        return Err(AdapterError::InvalidSample(
            "SimConnect read had an empty sim_time_utc timestamp".to_string(),
        ));
    }

    let position = PositionVector {
        latitude_deg: raw.plane_latitude_rad.to_degrees(),
        longitude_deg: raw.plane_longitude_rad.to_degrees(),
        altitude_msl_ft: raw.plane_altitude_ft,
        altitude_agl_ft: raw.plane_alt_above_ground_ft,
    };

    let flight = FlightVector {
        ground_speed_kts: raw.ground_velocity_kts,
        heading_deg: normalize_heading_deg(raw.plane_heading_true_rad.to_degrees()),
        vertical_speed_fpm: raw.vertical_speed_fps * FPS_TO_FPM,
        // SimConnect pitch is positive nose-down; the contract is positive
        // nose-up. Bank is positive right-roll in both.
        pitch_deg: -raw.plane_pitch_rad.to_degrees(),
        roll_deg: raw.plane_bank_rad.to_degrees(),
    };

    // Optional systems values: convert only when present; reject non-finite.
    let tot_celsius = convert_optional("turb_eng_itt", raw.turb_eng_itt_rankine, rankine_to_celsius)?;
    let rotor_rpm_pct = convert_optional("rotor_rpm_pct", raw.rotor_rpm_pct, |v| v)?;
    let outside_air_temp_c = convert_optional("ambient_temp", raw.ambient_temp_c, |v| v)?;

    let systems = SystemsVector {
        fuel_remaining_lbs: raw.fuel_total_weight_lbs,
        engine_torque_pct: raw.eng_torque_pct,
        tot_celsius,
        rotor_rpm_pct,
        outside_air_temp_c,
    };

    let sample = TelemetrySample {
        source_engine: engine,
        source_sequence: raw.source_sequence,
        observed_at: raw.sim_time_utc.clone(),
        position,
        flight,
        systems,
    };

    validate_ranges(&sample)?;
    Ok(sample)
}

/// Convert an optional native value, rejecting a present-but-non-finite reading.
fn convert_optional(
    field: &str,
    value: Option<f64>,
    convert: impl Fn(f64) -> f64,
) -> Result<Option<f64>, AdapterError> {
    match value {
        Some(v) if v.is_finite() => Ok(Some(convert(v))),
        Some(v) => Err(AdapterError::InvalidSample(format!(
            "SimConnect variable `{field}` was non-finite ({v})"
        ))),
        None => Ok(None),
    }
}

/// Validate the normalized sample against the contract ranges (design Section
/// 4.3): valid coordinates and a heading in `[0, 360)`.
fn validate_ranges(sample: &TelemetrySample) -> Result<(), AdapterError> {
    let p = &sample.position;
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
    if !(0.0..360.0).contains(&sample.flight.heading_deg) {
        return Err(AdapterError::InvalidSample(format!(
            "heading_deg {} out of range [0, 360)",
            sample.flight.heading_deg
        )));
    }
    Ok(())
}

impl<S: SimConnectSource> SimulatorAdapter for MsfsAdapter<S> {
    fn connect(&mut self) -> AdapterResult {
        // Validate engine compatibility before opening a session so an
        // unsupported version is rejected without side effects (requirement 1.2).
        self.resolve_engine().map_err(|e| {
            self.diagnostic = Some(e.to_string());
            e
        })?;
        let source = self
            .source
            .as_mut()
            .ok_or_else(|| AdapterError::Io("MSFS adapter has no SimConnect source".to_string()))?;
        source
            .open()
            .map_err(|e| AdapterError::Io(format!("SimConnect open failed: {e}")))?;
        self.last_received = None;
        self.diagnostic = None;
        self.source_lost_recorded = false;
        Ok(())
    }

    fn disconnect(&mut self) -> AdapterResult {
        if let Some(source) = self.source.as_mut() {
            source
                .close()
                .map_err(|e| AdapterError::Io(format!("SimConnect close failed: {e}")))?;
        }
        self.last_received = None;
        self.source_lost_recorded = false;
        Ok(())
    }

    fn sample(&mut self, now: Timestamp) -> Result<TelemetrySample, AdapterError> {
        // Re-check engine on every sample: reject an unsupported engine/version
        // with a named compatibility error and never coerce unknown fields.
        let engine = self.resolve_engine().map_err(|e| {
            self.diagnostic = Some(e.to_string());
            e
        })?;

        let source = self.source.as_mut().ok_or(AdapterError::NotConnected)?;
        match source.read_state() {
            Ok(None) => Err(AdapterError::NoData),
            Ok(Some(raw)) => {
                let sample = map_sample(engine, &raw).map_err(|e| {
                    self.diagnostic = Some(e.to_string());
                    e
                })?;
                self.last_received = Some(now);
                self.source_lost_recorded = false;
                self.diagnostic = None;
                Ok(sample)
            }
            Err(e) => {
                let diag = format!("SimConnect read failed: {e}");
                self.diagnostic = Some(diag.clone());
                Err(AdapterError::Io(diag))
            }
        }
    }

    fn health(&self, now: Timestamp) -> AdapterHealth {
        if self.source.is_none() {
            return AdapterHealth::offline();
        }
        match self.last_received {
            None => AdapterHealth {
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
                        diagnostic: self.diagnostic.clone(),
                    }
                }
            }
        }
    }
}

impl<S: SimConnectSource> MsfsAdapter<S> {
    /// Advance timeout bookkeeping and record the source-loss diagnostic once
    /// when the gap first crosses the threshold (requirement 1.6 parity with the
    /// X-Plane adapter). Returns the diagnostic the first time the source is
    /// newly considered lost so the runtime can record it.
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

/// Build the actionable compatibility error that names the unsupported engine
/// value without coercing it (requirement 1.2).
fn compatibility_error(reported: &str) -> AdapterError {
    AdapterError::InvalidSample(format!(
        "unsupported simulator engine/version `{reported}`: the MSFS adapter requires MSFS2020 or \
         MSFS2024. Use the adapter that matches `{reported}`, or connect a supported MSFS version."
    ))
}

/// Convert degrees Rankine to degrees Celsius.
#[inline]
fn rankine_to_celsius(rankine: f64) -> f64 {
    // Rankine -> Fahrenheit -> Celsius.
    (rankine - 491.67) * 5.0 / 9.0
}

/// Normalize a heading in degrees into the contract range `[0, 360)`.
#[inline]
fn normalize_heading_deg(deg: f64) -> f64 {
    let wrapped = deg % 360.0;
    if wrapped < 0.0 {
        wrapped + 360.0
    } else {
        wrapped
    }
}

/// Stable screaming-case label for an engine used in compatibility messages.
#[inline]
fn engine_label(engine: SimulatorEngine) -> &'static str {
    match engine {
        SimulatorEngine::Msfs2020 => "MSFS2020",
        SimulatorEngine::Msfs2024 => "MSFS2024",
        SimulatorEngine::Xplane11 => "XPLANE11",
        SimulatorEngine::Xplane12 => "XPLANE12",
    }
}

/// The diagnostic recorded when the SimConnect source is lost (parity with the
/// X-Plane adapter's source-loss handling; requirement 1.6).
fn source_loss_diagnostic(age: Duration) -> String {
    format!(
        "MSFS SimConnect source disconnected: no data for {}s (>= {SOURCE_TIMEOUT_SECS}s)",
        age.as_secs()
    )
}

// ---------------------------------------------------------------------------
// Native SimConnect binding (Windows only). Compiled out on other targets so
// the crate builds cross-platform; the real FFI binding is layered in when the
// `simconnect` feature and the Windows SDK are available. It fills a
// `SimConnectRotorcraftState` and implements `SimConnectSource`.
// ---------------------------------------------------------------------------
#[cfg(all(windows, feature = "simconnect"))]
mod native {
    // Intentionally a binding point: a real implementation wires the SimConnect
    // FFI here. Gated so non-Windows CI never links the Windows-only SDK.
}

#[cfg(test)]
mod tests {
    //! MSFS adapter test suite (task 4.3).
    //!
    //! Organized by the requirement each section (banner-commented below)
    //! exercises:
    //! - unit conversion — SimConnect native units → shared contract, with
    //!   known values, boundaries, the pitch sign flip, optional-field handling,
    //!   and a proptest for exactness (requirement 1.4).
    //! - supported-engine mapping — reported engine → `MSFS2020`/`MSFS2024`
    //!   (requirement 1.4).
    //! - malformed rejection — unsupported engine named without coercion
    //!   (requirement 1.2), non-finite required/optional values, out-of-range
    //!   coordinates, and impossible headings (supports 1.3/1.4 boundary side).
    //! - source loss — 5-second silence produces `Disconnected` plus a
    //!   diagnostic, recorded exactly once per gap (requirement 1.6).

    use super::*;
    use std::time::Instant;

    /// Test source returning a canned raw state and reported engine.
    struct FakeSource {
        engine: ReportedEngine,
        state: Option<SimConnectRotorcraftState>,
        opened: bool,
    }

    fn sample_state() -> SimConnectRotorcraftState {
        SimConnectRotorcraftState {
            source_sequence: 7,
            sim_time_utc: "2024-01-01T00:00:00.000Z".into(),
            // 40.44 deg N, -79.99 deg W expressed in radians.
            plane_latitude_rad: 40.44_f64.to_radians(),
            plane_longitude_rad: (-79.99_f64).to_radians(),
            plane_altitude_ft: 1200.0,
            plane_alt_above_ground_ft: 300.0,
            ground_velocity_kts: 120.0,
            plane_heading_true_rad: 270.0_f64.to_radians(),
            vertical_speed_fps: -8.5, // -510 fpm
            plane_pitch_rad: 2.0_f64.to_radians(), // nose-down 2 deg -> contract -2
            plane_bank_rad: (-5.0_f64).to_radians(),
            fuel_total_weight_lbs: 800.0,
            eng_torque_pct: 65.0,
            turb_eng_itt_rankine: Some(1000.0),
            rotor_rpm_pct: Some(100.0),
            ambient_temp_c: Some(15.0),
        }
    }

    impl SimConnectSource for FakeSource {
        fn open(&mut self) -> Result<(), String> {
            self.opened = true;
            Ok(())
        }
        fn close(&mut self) -> Result<(), String> {
            self.opened = false;
            Ok(())
        }
        fn read_state(&mut self) -> Result<Option<SimConnectRotorcraftState>, String> {
            Ok(self.state.clone())
        }
        fn reported_engine(&self) -> ReportedEngine {
            self.engine.clone()
        }
    }

    fn adapter_with(engine: ReportedEngine, state: Option<SimConnectRotorcraftState>) -> MsfsAdapter<FakeSource> {
        MsfsAdapter::new(FakeSource {
            engine,
            state,
            opened: false,
        })
    }

    // =======================================================================
    // Requirement 1.4 — unit conversion correctness (known values + boundaries)
    // =======================================================================

        #[test]
        fn maps_simconnect_units_into_shared_contract() {
            let mut adapter = adapter_with(
                ReportedEngine::Supported(SimulatorEngine::Msfs2024),
                Some(sample_state()),
            );
            adapter.connect().expect("connect");
            let sample = adapter.sample(Instant::now()).expect("sample");

            assert_eq!(sample.source_engine, SimulatorEngine::Msfs2024);
            assert_eq!(sample.source_sequence, 7);
            assert_eq!(sample.observed_at, "2024-01-01T00:00:00.000Z");

            // Radians -> degrees.
            assert!((sample.position.latitude_deg - 40.44).abs() < 1e-9);
            assert!((sample.position.longitude_deg - (-79.99)).abs() < 1e-9);
            // Feet pass through unconverted.
            assert_eq!(sample.position.altitude_msl_ft, 1200.0);
            assert_eq!(sample.position.altitude_agl_ft, 300.0);

            // Heading rad->deg (270), fps->fpm (-8.5 * 60 = -510).
            assert!((sample.flight.heading_deg - 270.0).abs() < 1e-9);
            assert!((sample.flight.vertical_speed_fpm - (-510.0)).abs() < 1e-9);
            // Pitch sign flips (nose-down positive -> nose-up positive).
            assert!((sample.flight.pitch_deg - (-2.0)).abs() < 1e-9);
            // Roll keeps its sign (right-roll positive in both).
            assert!((sample.flight.roll_deg - (-5.0)).abs() < 1e-9);
            // Ground speed (knots) and fuel (lbs) pass through unconverted.
            assert_eq!(sample.flight.ground_speed_kts, 120.0);
            assert_eq!(sample.systems.fuel_remaining_lbs, 800.0);

            // Rankine -> Celsius: (1000 - 491.67) * 5/9 ~= 282.4.
            let tot = sample.systems.tot_celsius.expect("tot present");
            assert!((tot - 282.405_555_5).abs() < 1e-3);
            assert_eq!(sample.systems.rotor_rpm_pct, Some(100.0));
            assert_eq!(sample.systems.outside_air_temp_c, Some(15.0));
        }

        #[test]
        fn pitch_sign_is_flipped_from_nose_down_to_nose_up() {
            let mut raw = sample_state();
            // Nose-down 10 deg in SimConnect must become nose-up -10 in contract.
            raw.plane_pitch_rad = 10.0_f64.to_radians();
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert!((s.flight.pitch_deg - (-10.0)).abs() < 1e-9);

            // And a nose-up SimConnect value (negative) becomes positive contract.
            raw.plane_pitch_rad = (-7.5_f64).to_radians();
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert!((s.flight.pitch_deg - 7.5).abs() < 1e-9);
        }

        #[test]
        fn rankine_to_celsius_known_values() {
            // 491.67 R == 0 C (water freeze); 671.641 R == 100 C.
            let mut raw = sample_state();
            raw.turb_eng_itt_rankine = Some(491.67);
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert!((s.systems.tot_celsius.unwrap() - 0.0).abs() < 1e-6);

            raw.turb_eng_itt_rankine = Some(671.641);
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert!((s.systems.tot_celsius.unwrap() - 100.0).abs() < 1e-3);
        }

        #[test]
        fn fps_to_fpm_known_and_sign() {
            let mut raw = sample_state();
            raw.vertical_speed_fps = 10.0; // 600 fpm climb
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert_eq!(s.flight.vertical_speed_fpm, 600.0);

            raw.vertical_speed_fps = -10.0; // 600 fpm descent
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert_eq!(s.flight.vertical_speed_fpm, -600.0);
        }

        #[test]
        fn absent_optionals_map_to_none() {
            let mut raw = sample_state();
            raw.turb_eng_itt_rankine = None;
            raw.rotor_rpm_pct = None;
            raw.ambient_temp_c = None;
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert_eq!(s.systems.tot_celsius, None);
            assert_eq!(s.systems.rotor_rpm_pct, None);
            assert_eq!(s.systems.outside_air_temp_c, None);
        }

        #[test]
        fn heading_wraps_into_contract_range() {
            // A raw heading just under a full turn must normalize into [0,360).
            let mut raw = sample_state();
            raw.plane_heading_true_rad = 359.9_f64.to_radians();
            let s = map_sample(SimulatorEngine::Msfs2020, &raw).unwrap();
            assert!((s.flight.heading_deg - 359.9).abs() < 1e-6);
        }

        #[test]
        fn normalizes_negative_and_over_range_headings() {
            assert!((normalize_heading_deg(-90.0) - 270.0).abs() < 1e-9);
            assert!((normalize_heading_deg(450.0) - 90.0).abs() < 1e-9);
            assert!(normalize_heading_deg(0.0).abs() < 1e-9);
            // Exactly 360 wraps to 0 (contract upper bound is exclusive).
            assert!(normalize_heading_deg(360.0).abs() < 1e-9);
        }

        proptest::proptest! {
            /// For any finite, in-range inputs, conversions are exact to
            /// tolerance, pitch sign flips, vertical-speed sign is preserved,
            /// and the normalized heading always lands in [0, 360)
            /// (requirement 1.4).
            #[test]
            fn conversions_exact_and_heading_in_range(
                lat_deg in -89.0f64..=89.0,
                lon_deg in -179.0f64..=179.0,
                heading_deg in 0.0f64..360.0,
                vs_fps in -100.0f64..100.0,
                pitch_deg in -80.0f64..80.0,
                itt_r in 300.0f64..2000.0,
            ) {
                let raw = SimConnectRotorcraftState {
                    source_sequence: 1,
                    sim_time_utc: "2024-01-01T00:00:00Z".into(),
                    plane_latitude_rad: lat_deg.to_radians(),
                    plane_longitude_rad: lon_deg.to_radians(),
                    plane_altitude_ft: 1000.0,
                    plane_alt_above_ground_ft: 200.0,
                    ground_velocity_kts: 100.0,
                    plane_heading_true_rad: heading_deg.to_radians(),
                    vertical_speed_fps: vs_fps,
                    plane_pitch_rad: pitch_deg.to_radians(),
                    plane_bank_rad: 0.0,
                    fuel_total_weight_lbs: 500.0,
                    eng_torque_pct: 50.0,
                    turb_eng_itt_rankine: Some(itt_r),
                    rotor_rpm_pct: None,
                    ambient_temp_c: None,
                };
                let s = map_sample(SimulatorEngine::Msfs2024, &raw).unwrap();

                proptest::prop_assert!((s.position.latitude_deg - lat_deg).abs() < 1e-9);
                proptest::prop_assert!((s.position.longitude_deg - lon_deg).abs() < 1e-9);
                // Heading always normalized into the contract range.
                proptest::prop_assert!(s.flight.heading_deg >= 0.0 && s.flight.heading_deg < 360.0);
                proptest::prop_assert!((s.flight.heading_deg - heading_deg).abs() < 1e-6);
                // fps -> fpm exact and sign-preserving.
                proptest::prop_assert!((s.flight.vertical_speed_fpm - vs_fps * FPS_TO_FPM).abs() < 1e-6);
                proptest::prop_assert_eq!(
                    s.flight.vertical_speed_fpm.is_sign_negative(),
                    vs_fps.is_sign_negative()
                );
                // Pitch sign flips.
                proptest::prop_assert!((s.flight.pitch_deg - (-pitch_deg)).abs() < 1e-9);
                // Rankine -> Celsius matches the reference formula.
                proptest::prop_assert!(
                    (s.systems.tot_celsius.unwrap() - (itt_r - 491.67) * 5.0 / 9.0).abs() < 1e-6
                );
            }
        }

    // =======================================================================
    // Requirement 1.4 — supported-engine mapping (MSFS2020 / MSFS2024)
    // =======================================================================

        #[test]
        fn identifies_both_supported_msfs_engines() {
            for engine in [SimulatorEngine::Msfs2020, SimulatorEngine::Msfs2024] {
                let mut adapter =
                    adapter_with(ReportedEngine::Supported(engine), Some(sample_state()));
                adapter.connect().expect("connect");
                let sample = adapter.sample(Instant::now()).expect("sample");
                assert_eq!(sample.source_engine, engine);
            }
        }

        #[test]
        fn map_sample_tags_the_engine_it_is_given() {
            for engine in [SimulatorEngine::Msfs2020, SimulatorEngine::Msfs2024] {
                let s = map_sample(engine, &sample_state()).unwrap();
                assert_eq!(s.source_engine, engine);
            }
        }

    // =======================================================================
    // Requirement 1.2 / 1.3 — malformed sample & unsupported-engine rejection
    // =======================================================================

        #[test]
        fn rejects_unsupported_engine_naming_the_value_without_coercion() {
            // A raw unsupported version string is named verbatim and not coerced.
            let mut adapter = adapter_with(
                ReportedEngine::Unsupported("MSFS2019".to_string()),
                Some(sample_state()),
            );
            let err = adapter.connect().expect_err("should reject unsupported version");
            match err {
                AdapterError::InvalidSample(msg) => {
                    assert!(msg.contains("MSFS2019"), "message must name the value: {msg}");
                    assert!(msg.contains("MSFS2020") && msg.contains("MSFS2024"));
                }
                other => panic!("expected InvalidSample, got {other:?}"),
            }
        }

        #[test]
        fn unsupported_engine_rejected_at_connect_without_opening_source() {
            // Requirement 1.2: rejection is side-effect free — the source is
            // never opened when the engine is unsupported.
            let mut adapter = adapter_with(
                ReportedEngine::Unsupported("FSX".to_string()),
                Some(sample_state()),
            );
            assert!(adapter.connect().is_err());
            // FakeSource.opened must still be false.
            assert!(!adapter.source.as_ref().unwrap().opened);
        }

        #[test]
        fn rejects_arbitrary_unsupported_strings_verbatim() {
            for reported in ["FSX", "Prepar3D v5", "DCS World", "unknown-sim"] {
                let mut adapter = adapter_with(
                    ReportedEngine::Unsupported(reported.to_string()),
                    Some(sample_state()),
                );
                match adapter.connect() {
                    Err(AdapterError::InvalidSample(msg)) => {
                        assert!(msg.contains(reported), "must name `{reported}` verbatim: {msg}");
                    }
                    other => panic!("expected InvalidSample for {reported}, got {other:?}"),
                }
            }
        }

        #[test]
        fn rejects_non_msfs_supported_engine_handed_to_msfs_adapter() {
            for engine in [SimulatorEngine::Xplane11, SimulatorEngine::Xplane12] {
                let mut adapter =
                    adapter_with(ReportedEngine::Supported(engine), Some(sample_state()));
                let err = adapter
                    .sample(Instant::now())
                    .expect_err("non-MSFS engine rejected");
                match err {
                    AdapterError::InvalidSample(msg) => {
                        assert!(msg.contains("XPLANE"), "must name the engine: {msg}");
                    }
                    other => panic!("expected InvalidSample, got {other:?}"),
                }
            }
        }

        #[test]
        fn rejects_undeterminable_engine() {
            let mut adapter = adapter_with(ReportedEngine::Undetermined, Some(sample_state()));
            let err = adapter
                .sample(Instant::now())
                .expect_err("undetermined engine rejected");
            assert!(matches!(err, AdapterError::InvalidSample(_)));
        }

        #[test]
        fn rejects_non_finite_required_value_instead_of_coercing() {
            for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
                let mut raw = sample_state();
                raw.plane_altitude_ft = bad;
                match map_sample(SimulatorEngine::Msfs2020, &raw) {
                    Err(AdapterError::InvalidSample(msg)) => {
                        assert!(msg.contains("plane_altitude"), "must name field: {msg}");
                    }
                    other => panic!("expected InvalidSample for {bad}, got {other:?}"),
                }
            }
        }

        #[test]
        fn rejects_non_finite_optional_value_naming_the_field() {
            let mut raw = sample_state();
            raw.turb_eng_itt_rankine = Some(f64::NAN);
            match map_sample(SimulatorEngine::Msfs2020, &raw) {
                Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("turb_eng_itt")),
                other => panic!("expected InvalidSample, got {other:?}"),
            }
        }

        #[test]
        fn rejects_empty_timestamp() {
            let mut raw = sample_state();
            raw.sim_time_utc = "   ".to_string();
            match map_sample(SimulatorEngine::Msfs2020, &raw) {
                Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("sim_time_utc")),
                other => panic!("expected InvalidSample, got {other:?}"),
            }
        }

        #[test]
        fn rejects_out_of_range_latitude() {
            let mut raw = sample_state();
            raw.plane_latitude_rad = 91.0_f64.to_radians();
            match map_sample(SimulatorEngine::Msfs2020, &raw) {
                Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("latitude_deg")),
                other => panic!("expected InvalidSample, got {other:?}"),
            }
        }

        #[test]
        fn rejects_out_of_range_longitude() {
            let mut raw = sample_state();
            raw.plane_longitude_rad = 181.0_f64.to_radians();
            match map_sample(SimulatorEngine::Msfs2020, &raw) {
                Err(AdapterError::InvalidSample(msg)) => assert!(msg.contains("longitude_deg")),
                other => panic!("expected InvalidSample, got {other:?}"),
            }
        }

        #[test]
        fn accepts_coordinates_just_inside_boundaries() {
            // The MSFS adapter receives radians and converts to degrees, so a
            // degree->radian->degree round-trip of an exact pole (90.0) can
            // overshoot the inclusive bound by a float ULP. Assert values just
            // inside the limit, which are unambiguously valid, and cover the
            // exact-inclusive-bound acceptance in the X-Plane suite where lat/lon
            // pass through without a round-trip.
            let boundaries: [(f64, f64); 2] = [(89.9999, 179.9999), (-89.9999, -179.9999)];
            for (lat, lon) in boundaries {
                let mut raw = sample_state();
                raw.plane_latitude_rad = lat.to_radians();
                raw.plane_longitude_rad = lon.to_radians();
                raw.plane_heading_true_rad = 90.0_f64.to_radians();
                assert!(
                    map_sample(SimulatorEngine::Msfs2020, &raw).is_ok(),
                    "just-inside boundary ({lat},{lon}) should be accepted"
                );
            }
        }

        proptest::proptest! {
            /// Any latitude magnitude strictly beyond 90 degrees is rejected
            /// once converted from radians (requirement 1.3 boundary).
            #[test]
            fn out_of_range_latitude_always_rejected(bad_deg in 90.001f64..180.0) {
                let mut raw = sample_state();
                raw.plane_latitude_rad = bad_deg.to_radians();
                proptest::prop_assert!(matches!(
                    map_sample(SimulatorEngine::Msfs2020, &raw),
                    Err(AdapterError::InvalidSample(_))
                ));
            }
        }

    // =======================================================================
    // Requirement 1.6 — 5-second source-loss detection + diagnostic
    // =======================================================================

        #[test]
        fn no_fresh_data_reports_no_data() {
            let mut adapter =
                adapter_with(ReportedEngine::Supported(SimulatorEngine::Msfs2020), None);
            adapter.connect().expect("connect");
            assert_eq!(
                adapter.sample(Instant::now()).unwrap_err(),
                AdapterError::NoData
            );
        }

        #[test]
        fn connected_below_timeout_stays_connected() {
            let start = Instant::now();
            let mut adapter = adapter_with(
                ReportedEngine::Supported(SimulatorEngine::Msfs2020),
                Some(sample_state()),
            );
            adapter.connect().expect("connect");
            adapter.sample(start).expect("first sample");
            let healthy = adapter.health(start + Duration::from_secs(SOURCE_TIMEOUT_SECS - 1));
            assert_eq!(healthy.source_state, SourceState::Connected);
        }

        #[test]
        fn marks_disconnected_at_timeout_with_diagnostic() {
            let start = Instant::now();
            let mut adapter = adapter_with(
                ReportedEngine::Supported(SimulatorEngine::Msfs2020),
                Some(sample_state()),
            );
            adapter.connect().expect("connect");
            adapter.sample(start).expect("first sample");

            let later = start + Duration::from_secs(SOURCE_TIMEOUT_SECS);
            let lost = adapter.health(later);
            assert_eq!(lost.source_state, SourceState::Disconnected);
            let diag = lost.diagnostic.as_deref().unwrap();
            assert!(diag.contains("disconnected"), "diagnostic should name the loss: {diag}");
            assert_eq!(lost.last_sample_age_secs, Some(SOURCE_TIMEOUT_SECS));
        }

        #[test]
        fn poll_source_loss_records_diagnostic_exactly_once_per_gap() {
            let start = Instant::now();
            let mut adapter = adapter_with(
                ReportedEngine::Supported(SimulatorEngine::Msfs2020),
                Some(sample_state()),
            );
            adapter.connect().expect("connect");
            adapter.sample(start).expect("first sample");

            let later = start + Duration::from_secs(SOURCE_TIMEOUT_SECS);
            let first = adapter.poll_source_loss(later);
            let diag = first.expect("first poll after timeout records a diagnostic");
            assert!(diag.contains("disconnected"), "{diag}");
            assert!(adapter
                .poll_source_loss(later + Duration::from_secs(1))
                .is_none());
        }

        #[test]
        fn resuming_data_rearms_source_loss_recording() {
            let start = Instant::now();
            let mut adapter = adapter_with(
                ReportedEngine::Supported(SimulatorEngine::Msfs2020),
                Some(sample_state()),
            );
            adapter.connect().expect("connect");
            adapter.sample(start).expect("first sample");
            let _ = adapter.poll_source_loss(start + Duration::from_secs(SOURCE_TIMEOUT_SECS));

            // A fresh accepted sample resets the clock and re-arms recording.
            let resume = start + Duration::from_secs(10);
            adapter.sample(resume).expect("resumed sample");
            assert_eq!(adapter.health(resume).source_state, SourceState::Connected);
            assert!(adapter
                .poll_source_loss(resume + Duration::from_secs(SOURCE_TIMEOUT_SECS))
                .is_some());
        }
}
