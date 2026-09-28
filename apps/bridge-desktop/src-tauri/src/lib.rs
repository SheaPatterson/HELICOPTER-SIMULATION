//! Virtual HEMS desktop bridge library.
//!
//! Task 1.1 established the crate boundary and the proptest test tooling; task
//! 1.2 mirrored the telemetry contract ([`telemetry`]); task 4.1 added the
//! simulator adapter contract ([`adapter`]) and the X-Plane FlyWithLua UDP
//! adapter ([`adapter::xplane`]). Task 5.3 added the durable SQLite offline ring
//! buffer ([`offline::SqliteOfflineQueue`]) that implements the runtime's
//! [`runtime::OfflineQueue`] trait. Task 5.7 added the pure TLS-abort decision
//! contract ([`uplink::tls_transmission_permitted`]) that the task-5.6 TLS
//! client will build on to abort transmission (sending no telemetry) unless a
//! session negotiates TLS 1.2 or higher (requirements 8.8/8.8a). Task 5.6 added
//! that client ([`uplink::client::TlsUplink`]): a rustls-backed
//! ([`uplink::client::RustlsTransport`]) [`runtime::Uplink`] that enforces the
//! TLS 1.2+ floor, aborts (sending no telemetry) on a failed or sub-1.2
//! handshake, and resolves its API key from a [`runtime::SecretReference`] at
//! runtime so no secret is bundled in the desktop package (requirement 8.12).
//! Offline replay (design Section 6.2) lands in later bridge tasks. The
//! telemetry contract keeps adapters and cloud ingestion on one shared
//! definition.

pub mod adapter;
pub mod offline;
pub mod runtime;
pub mod telemetry;
pub mod uplink;

pub use adapter::{
    AdapterError, AdapterHealth, AdapterResult, SimulatorAdapter, SourceState, SOURCE_TIMEOUT_SECS,
};
pub use adapter::msfs::MsfsAdapter;
pub use adapter::xplane::XPlaneAdapter;
pub use offline::{
    session_key, CapacityAlert, MissionEvent, QueueDiagnostic, RetentionPolicy, SqliteOfflineQueue,
};
pub use runtime::{
    BridgeConfiguration, BridgeError, BridgeRuntime, BridgeSession, BridgeStatus, Clock,
    FlushSummary, InMemoryOfflineQueue, IngestOutcome, NoopUplink, OfflineQueue, PublishOutcome,
    ReplayError, ReplayPolicy, SecretReference, SystemClock, Uplink, UplinkState, ValidationError,
    MAX_REPLAY_ATTEMPTS, MAX_RETRY_BACKOFF_MS, MAX_SAMPLE_RATE_HZ, MIN_RETRY_BACKOFF_MS,
    MIN_SAMPLE_RATE_HZ, REPLAY_START_DEADLINE_MS,
};
pub use telemetry::{
    FlightVector, GeoPoint, PositionVector, SimulatorEngine, SystemsVector, TelemetryFrame,
    TelemetrySample,
};
pub use uplink::{tls_transmission_permitted, TlsAbortReason, TlsNegotiation, TlsVersion};
pub use uplink::client::{
    EnvSecretResolver, RustlsTransport, SecretResolver, TlsTransport, TlsUplink,
};

/// Contract schema version the bridge is built against.
///
/// Mirrors the `SCHEMA_VERSION` constant in `@virtualhems/contracts` so that the
/// Rust bridge and the TypeScript cloud/web share one versioned definition.
pub const SCHEMA_VERSION: &str = "0.1.0";

/// Returns the contract schema version.
#[must_use]
pub fn schema_version() -> &'static str {
    SCHEMA_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn schema_version_is_non_empty_and_bounded() {
        let v = schema_version();
        assert!(!v.is_empty());
        assert!(v.len() <= 32);
    }

    proptest! {
        // Smoke test proving the proptest runner is wired into the crate.
        #[test]
        fn addition_is_commutative(a in any::<i32>(), b in any::<i32>()) {
            prop_assert_eq!(a.wrapping_add(b), b.wrapping_add(a));
        }
    }
}
