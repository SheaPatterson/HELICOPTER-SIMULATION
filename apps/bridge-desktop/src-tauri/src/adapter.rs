//! Simulator adapter contract (design Section 4.1).
//!
//! An adapter reads state from exactly one simulator engine and normalizes it
//! into the shared [`TelemetrySample`] contract. Adapters are deliberately
//! narrow: they must not persist data, call cloud services, or leak
//! simulator-specific field names past their own boundary. Persistence and
//! cloud transmission belong to the bridge runtime and the cloud ingestion
//! service (requirement 1.8, design Section 4.2).
//!
//! This module defines the trait plus the shared result/error/health types.
//! Each engine gets its own submodule so the X-Plane adapter (task 4.1) and the
//! MSFS adapter (task 4.2) share one contract:
//! - [`xplane`] — X-Plane 11/12 FlyWithLua UDP listener bound to `127.0.0.1:8080`.
//! - `msfs` — MSFS 2020/2024 SimConnect adapter (added by task 4.2).

use crate::telemetry::TelemetrySample;

pub mod msfs;
pub mod xplane;

/// The number of consecutive seconds without a source sample after which an
/// adapter marks its session source as disconnected (requirement 1.6).
pub const SOURCE_TIMEOUT_SECS: u64 = 5;

/// Result of a lifecycle operation (`connect` / `disconnect`) on an adapter
/// (design Section 4.1, `AdapterResult`).
pub type AdapterResult = Result<(), AdapterError>;

/// A fault surfaced by an adapter.
///
/// Adapters classify faults so the bridge runtime can decide whether to reject
/// a single sample and keep listening (`InvalidSample`, `NoData`) or treat the
/// adapter as unusable (`Io`, `NotConnected`). Every variant carries a
/// human-readable diagnostic; none carries simulator-specific field names in a
/// structured form that would leak past the adapter boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterError {
    /// The adapter was asked to sample before a successful `connect`.
    NotConnected,
    /// The underlying transport (UDP socket, SimConnect handle) failed.
    Io(String),
    /// A sample was received but failed validation or unit mapping. The listener
    /// loop should reject the sample, record the diagnostic, and continue
    /// (design "Malformed UDP/SimConnect sample" edge case).
    InvalidSample(String),
    /// No new source data was available for this `sample` call. When the source
    /// has been silent past [`SOURCE_TIMEOUT_SECS`], the accompanying
    /// [`AdapterHealth`] reports `Disconnected` (requirement 1.6).
    NoData,
}

impl core::fmt::Display for AdapterError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            AdapterError::NotConnected => write!(f, "adapter is not connected"),
            AdapterError::Io(msg) => write!(f, "adapter transport error: {msg}"),
            AdapterError::InvalidSample(msg) => write!(f, "invalid simulator sample: {msg}"),
            AdapterError::NoData => write!(f, "no simulator data available"),
        }
    }
}

impl std::error::Error for AdapterError {}

/// Connection state of an adapter's source (design Section 4.1, `AdapterHealth`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceState {
    /// `connect` has not been called (or `disconnect` has been called).
    Offline,
    /// Connected and receiving data within the timeout window.
    Connected,
    /// Connected transport but no data for at least [`SOURCE_TIMEOUT_SECS`]
    /// (requirement 1.6).
    Disconnected,
}

/// Health snapshot reported by an adapter (design Section 4.1, `AdapterHealth`).
///
/// `last_sample_age_secs` is the whole seconds elapsed since the last accepted
/// source sample, or `None` if no sample has ever been received. `diagnostic`
/// carries the most recent source-loss or fault message; the bridge runtime
/// records it (requirement 1.6, design "record a diagnostic").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterHealth {
    pub source_state: SourceState,
    pub last_sample_age_secs: Option<u64>,
    pub diagnostic: Option<String>,
}

impl AdapterHealth {
    /// Health for an adapter that has not been connected yet.
    #[must_use]
    pub fn offline() -> Self {
        Self {
            source_state: SourceState::Offline,
            last_sample_age_secs: None,
            diagnostic: None,
        }
    }

    /// Whether the source is currently considered connected and live.
    #[must_use]
    pub fn is_connected(&self) -> bool {
        self.source_state == SourceState::Connected
    }
}

/// A monotonic instant supplied by the bridge runtime.
///
/// `sample` and `health` take the current time as a parameter so the timeout
/// logic (requirement 1.6) is deterministic and unit-testable without sleeping
/// on a real clock.
pub type Timestamp = std::time::Instant;

/// The simulator adapter contract (design Section 4.1).
///
/// Implementors read one engine's state and normalize it into the shared
/// contract. They MUST NOT persist data or perform network uplink themselves
/// (requirement 1.8).
pub trait SimulatorAdapter {
    /// Establish the source connection (bind the UDP socket, open the
    /// SimConnect handle). Idempotent: connecting an already-connected adapter
    /// succeeds without rebinding.
    fn connect(&mut self) -> AdapterResult;

    /// Tear down the source connection and return to `Offline`. Idempotent.
    fn disconnect(&mut self) -> AdapterResult;

    /// Read and normalize the latest source state as of `now`.
    ///
    /// Returns [`AdapterError::NoData`] when nothing new has arrived,
    /// [`AdapterError::InvalidSample`] when a received sample fails validation,
    /// and [`AdapterError::NotConnected`] when called before `connect`.
    fn sample(&mut self, now: Timestamp) -> Result<TelemetrySample, AdapterError>;

    /// Current health as of `now`, including source-loss detection
    /// (requirement 1.6).
    fn health(&self, now: Timestamp) -> AdapterHealth;
}
