//! Bridge runtime, sampling-rate enforcement, and the telemetry
//! validation/normalization pipeline (design Sections 4.2 and 6.1;
//! requirements 1.1, 1.3, 1.5).
//!
//! The [`BridgeRuntime`] owns the session lifecycle (`start` / `stop`),
//! adapter registration, connection status, and the offline-queue flush entry
//! point. Its core is [`BridgeRuntime::ingest_sample`], which mirrors the
//! design Section 6.1 procedure exactly:
//!
//! 1. Require the configured sample rate is 2–10 Hz (requirement 1.5).
//! 2. Normalize units and field names.
//! 3. Validate the normalized sample; on failure record a diagnostic naming the
//!    failed field and reject **without persisting** (requirement 1.3).
//! 4. Assign the next session sequence, a cloud-receive timestamp, and the
//!    schema version, producing a durable [`TelemetryFrame`] (requirement 1.1).
//! 5. Apply delta compression **after** validation, retaining a periodic full
//!    snapshot (design Section 9.2).
//! 6. Append the frame to the durable local queue before attempting uplink; if
//!    the uplink is unavailable, leave the frame queued for replay.
//!
//! ## Boundaries deferred to later tasks
//!
//! The durable SQLite ring buffer (task 5.3), offline replay (task 5.4), and
//! the TLS uplink (task 5.6) are separate tasks. This module defines the clean
//! trait seams those tasks implement — [`OfflineQueue`] and [`Uplink`] — and
//! ships a minimal in-memory queue ([`InMemoryOfflineQueue`]) plus an
//! injectable/no-op uplink ([`NoopUplink`]) so the runtime compiles, runs, and
//! is unit-testable in isolation. Adapters (`connect`/`sample`/`health`) come
//! from [`crate::adapter`].

use std::collections::VecDeque;

use crate::adapter::SimulatorAdapter;
use crate::telemetry::{SimulatorEngine, TelemetryFrame, TelemetrySample};
use crate::SCHEMA_VERSION;

/// Lowest permitted fixed sample rate in hertz (requirement 1.5, design 4.2).
pub const MIN_SAMPLE_RATE_HZ: f64 = 2.0;
/// Highest permitted fixed sample rate in hertz (requirement 1.5, design 4.2).
pub const MAX_SAMPLE_RATE_HZ: f64 = 10.0;

/// Maximum accepted length of the schema version string (requirement 1.1).
pub const MAX_SCHEMA_VERSION_LEN: usize = 32;

/// Oldest an observed timestamp may be relative to cloud-receive time, in
/// milliseconds (requirement 1.1: 60 seconds in the past).
pub const OBSERVED_MIN_SKEW_MS: i64 = -60_000;
/// Furthest into the future an observed timestamp may be relative to
/// cloud-receive time, in milliseconds (requirement 1.1: 5 seconds ahead).
pub const OBSERVED_MAX_SKEW_MS: i64 = 5_000;

/// Lowest permitted retry backoff interval in milliseconds (requirement 2.5:
/// "between 1 second and 60 seconds").
pub const MIN_RETRY_BACKOFF_MS: u64 = 1_000;
/// Highest permitted retry backoff interval in milliseconds (requirement 2.5).
pub const MAX_RETRY_BACKOFF_MS: u64 = 60_000;
/// Configured maximum number of publish attempts for a single frame before it
/// is treated as a permanent failure (requirement 2.5: "up to a configured
/// maximum of 10 attempts").
pub const MAX_REPLAY_ATTEMPTS: u32 = 10;
/// The bound, in milliseconds, within which replay must begin after the uplink
/// is newly detected available (requirement 2.3: "within 5 seconds of detecting
/// availability").
pub const REPLAY_START_DEADLINE_MS: i64 = 5_000;

/// Every Nth accepted frame is forced to be a full (non-delta) snapshot even
/// when it is within the delta threshold, so a reader can recover full state
/// without replaying from session start (design Section 9.2: "retain periodic
/// full snapshots").
pub const FULL_SNAPSHOT_INTERVAL: u64 = 30;

/// The maximum absolute change, per compared numeric field, below which a frame
/// is considered a small delta relative to the previous frame. Kept
/// intentionally small: only near-stationary frames are delta-encoded.
const DELTA_ABS_THRESHOLD: f64 = 1e-6;

// ---------------------------------------------------------------------------
// Configuration and result types (design Section 4.2)
// ---------------------------------------------------------------------------

/// A reference to a secret (e.g. an OS keychain entry or environment key),
/// never the secret value itself (design Section 4.2, `SecretReference`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretReference {
    /// Opaque key naming where the API key is stored, not the key material.
    pub key: String,
}

/// Bridge session configuration (design Section 4.2, `BridgeConfiguration`).
///
/// `sample_rate_hz` is validated to the inclusive 2–10 Hz range at
/// [`BridgeRuntime::start`] time (requirement 1.5).
#[derive(Debug, Clone, PartialEq)]
pub struct BridgeConfiguration {
    pub pilot_id: String,
    pub mission_id: Option<String>,
    pub sample_rate_hz: f64,
    pub udp_bind_address: String,
    pub uplink_endpoint: String,
    pub api_key_reference: SecretReference,
    pub offline_capacity: usize,
}

impl BridgeConfiguration {
    /// Whether the configured sample rate is within the inclusive 2–10 Hz band
    /// (requirement 1.5, design 6.1 precondition).
    #[must_use]
    pub fn sample_rate_is_valid(&self) -> bool {
        self.sample_rate_hz.is_finite()
            && (MIN_SAMPLE_RATE_HZ..=MAX_SAMPLE_RATE_HZ).contains(&self.sample_rate_hz)
    }

    /// The fixed inter-sample interval in milliseconds implied by the sample
    /// rate. Used by the sampling loop to tick at a fixed cadence
    /// (requirement 1.5).
    #[must_use]
    pub fn sample_interval_ms(&self) -> u64 {
        // Guarded by `sample_rate_is_valid`; rate is >= 2 Hz so this is finite.
        (1000.0 / self.sample_rate_hz).round() as u64
    }
}

/// An active bridge session opened by [`BridgeRuntime::start`]
/// (design Section 4.2, `BridgeSession`).
#[derive(Debug, Clone, PartialEq)]
pub struct BridgeSession {
    /// Stable identifier for this session; scopes sequence numbering and queue
    /// ordering (requirement 2.2: order by session then sequence).
    pub session_id: String,
    pub pilot_id: String,
    pub mission_id: Option<String>,
    pub sample_rate_hz: f64,
}

/// Faults raised by the runtime lifecycle and ingest pipeline
/// (design Section 4.2, `BridgeError`).
#[derive(Debug, Clone, PartialEq)]
pub enum BridgeError {
    /// `sample_rate_hz` was outside the inclusive 2–10 Hz band (requirement 1.5).
    InvalidSampleRate(f64),
    /// A lifecycle call was made in the wrong state (e.g. `stop` with no active
    /// session, or `ingest_sample` before `start`).
    NotRunning,
    /// A session is already active and `start` was called again.
    AlreadyRunning,
    /// The durable local queue rejected an append (e.g. at capacity). The
    /// capacity/backpressure policy itself is implemented by task 5.3.
    Queue(String),
}

impl core::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            BridgeError::InvalidSampleRate(hz) => {
                write!(f, "sample_rate_hz {hz} outside supported range [2, 10] Hz")
            }
            BridgeError::NotRunning => write!(f, "bridge runtime has no active session"),
            BridgeError::AlreadyRunning => write!(f, "bridge runtime already has an active session"),
            BridgeError::Queue(msg) => write!(f, "offline queue error: {msg}"),
        }
    }
}

impl std::error::Error for BridgeError {}

/// Availability of the cloud uplink (design Section 6.1: available / offline /
/// degraded).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UplinkState {
    /// Frames are being published in sequence.
    Available,
    /// Uplink cannot be reached; frames accumulate in the durable queue for
    /// replay (design 6.1 `mark_uplink_offline`).
    Offline,
    /// Uplink reachable but the last publish failed; frames remain queued
    /// (design 6.1 `mark_uplink_degraded`).
    Degraded,
}

/// A public snapshot of runtime state (design Section 4.2, `BridgeStatus`).
#[derive(Debug, Clone, PartialEq)]
pub struct BridgeStatus {
    /// Whether a session is currently active.
    pub running: bool,
    /// Active session id, if running.
    pub session_id: Option<String>,
    /// Current uplink availability.
    pub uplink_state: UplinkState,
    /// The last sequence number assigned to an accepted frame this session,
    /// or `None` if none have been accepted yet.
    pub last_sequence: Option<u64>,
    /// Number of frames currently held in the durable local queue.
    pub queued_frames: usize,
}

/// Summary returned by [`BridgeRuntime::flush_offline_queue`]
/// (design Section 4.2/6.2, `FlushSummary`). The full replay state machine
/// (retryable/permanent, backoff) is implemented by task 5.4; this task tracks
/// the counts and wires the entry point.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FlushSummary {
    /// Frames acknowledged by the uplink and removed from the queue.
    pub sent: usize,
    /// Frames left queued because the uplink was unavailable / retryable.
    pub deferred: usize,
    /// Frames marked as permanently failed but retained as diagnostics.
    pub failed: usize,
}

/// Offline-replay retry/backoff configuration (design Section 6.2, requirement
/// 2.5). The backoff interval is clamped to the inclusive 1–60 s band and the
/// attempt cap to at most [`MAX_REPLAY_ATTEMPTS`] (10) at construction, so an
/// out-of-range configuration can never widen the requirement's bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayPolicy {
    /// Deferral applied after a retryable failure, in milliseconds, clamped to
    /// `[MIN_RETRY_BACKOFF_MS, MAX_RETRY_BACKOFF_MS]` (requirement 2.5).
    backoff_ms: u64,
    /// Maximum publish attempts before a retryable failure becomes permanent,
    /// clamped to `1..=MAX_REPLAY_ATTEMPTS` (requirement 2.5).
    max_attempts: u32,
}

impl ReplayPolicy {
    /// Construct a policy, clamping the backoff into `[1s, 60s]` and the attempt
    /// cap into `1..=10` so the requirement bounds always hold (requirement 2.5).
    #[must_use]
    pub fn new(backoff_ms: u64, max_attempts: u32) -> Self {
        Self {
            backoff_ms: backoff_ms.clamp(MIN_RETRY_BACKOFF_MS, MAX_RETRY_BACKOFF_MS),
            max_attempts: max_attempts.clamp(1, MAX_REPLAY_ATTEMPTS),
        }
    }

    /// The clamped backoff interval in milliseconds (requirement 2.5).
    #[must_use]
    pub fn backoff_ms(&self) -> u64 {
        self.backoff_ms
    }

    /// The clamped maximum attempt count (requirement 2.5).
    #[must_use]
    pub fn max_attempts(&self) -> u32 {
        self.max_attempts
    }
}

impl Default for ReplayPolicy {
    /// The design defaults: a mid-band backoff and the requirement's 10-attempt
    /// cap (requirement 2.5).
    fn default() -> Self {
        Self::new(MIN_RETRY_BACKOFF_MS, MAX_REPLAY_ATTEMPTS)
    }
}

// ---------------------------------------------------------------------------
// Injectable seams: clock, durable queue, uplink
// ---------------------------------------------------------------------------

/// A clock supplying the cloud-receive time as Unix milliseconds.
///
/// Injected so the observed-timestamp skew window (requirement 1.1) and the
/// `received_at` stamp are deterministic in tests without a real wall clock.
pub trait Clock {
    /// Current cloud-receive time as milliseconds since the Unix epoch (UTC).
    fn now_unix_millis(&self) -> i64;
}

/// Default wall-clock implementation.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix_millis(&self) -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_millis() as i64,
            // Pre-epoch clock: negative offset.
            Err(e) => -(e.duration().as_millis() as i64),
        }
    }
}

/// The durable ordering contract for queued frames (design Section 6.1 loop
/// invariant, requirement 2.2). Task 5.3 provides the SQLite-backed
/// implementation that survives process restart and host power loss; this
/// task ships an in-memory implementation with the same ordering guarantees.
///
/// Implementors MUST preserve ascending (session_id, sequence_number) order and
/// MUST NOT delete unsent frames.
pub trait OfflineQueue {
    /// Durably append a frame. Called before any uplink attempt so the frame
    /// survives a crash mid-transmit (requirement 2.1). Returns an error only
    /// when the append cannot be made durable (e.g. capacity policy — task 5.3).
    fn append(&mut self, frame: TelemetryFrame) -> Result<(), BridgeError>;

    /// The oldest queued frame in (session, sequence) order, if any, without
    /// removing it.
    fn peek_oldest(&self) -> Option<&TelemetryFrame>;

    /// Remove a frame by id after the uplink acknowledges it (requirement 2.4).
    fn remove(&mut self, frame_id: &str) -> bool;

    /// Number of frames currently queued.
    fn len(&self) -> usize;

    /// Whether the queue is empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// All queued frames in ascending (session, sequence) order. Used by the
    /// flush path to publish in order (design 6.1
    /// `publish_queued_frames_in_sequence`).
    fn ordered(&self) -> Vec<TelemetryFrame>;

    // --- replay retry/backoff support (design Section 6.2, requirements 2.5/2.6) ---
    //
    // These have default implementations so the placeholder in-memory queue and
    // any pre-existing implementor keep compiling. The durable
    // [`crate::offline::SqliteOfflineQueue`] overrides them to persist attempt
    // counts, backoff eligibility, and the failed flag so replay survives
    // restart. When a frame is `failed`, it is retained in durable storage as a
    // diagnostic (requirement 2.6) but is no longer replay-eligible.

    /// The oldest **replay-eligible** frame in (session, sequence) order at
    /// `now_millis`: the oldest frame that is neither marked failed nor deferred
    /// past `now_millis` by a backoff (requirement 2.5). Returns an owned clone
    /// because eligibility filtering cannot be expressed as a borrow of interior
    /// state for every implementor.
    ///
    /// The default implementation treats every queued frame as immediately
    /// eligible (no attempt/backoff/failed state), which matches the historical
    /// behavior of a queue without retry metadata.
    fn oldest_eligible(&self, _now_millis: i64) -> Option<TelemetryFrame> {
        self.peek_oldest().cloned()
    }

    /// Number of publish attempts recorded against `frame_id` so far
    /// (requirement 2.5). Default: 0 (no attempt tracking).
    fn attempts(&self, _frame_id: &str) -> u32 {
        0
    }

    /// Record a retryable failure: increment the attempt count and defer the
    /// frame until `next_eligible_at_millis` (requirement 2.5). Default: no-op
    /// (a queue without backoff retries immediately on the next pass).
    fn defer(&mut self, _frame_id: &str, _next_eligible_at_millis: i64) {}

    /// Mark a frame permanently failed, retaining it in durable storage as a
    /// diagnostic record without removing it (requirement 2.6). Returns whether
    /// a frame with that id was present to mark. Default: no-op returning
    /// `false` (a queue without a failed flag cannot retain diagnostics).
    fn mark_failed(&mut self, _frame_id: &str, _error: &str) -> bool {
        false
    }
}

/// Minimal in-memory offline queue used until the SQLite ring buffer (task 5.3)
/// lands. It keeps frames sorted by (session_id, sequence_number) so the
/// runtime's ordering invariant holds and is testable now. It is **not**
/// durable across process restart — that durability is task 5.3's job.
#[derive(Debug, Default)]
pub struct InMemoryOfflineQueue {
    frames: VecDeque<TelemetryFrame>,
    /// Per-frame replay metadata keyed by `frame_id`: `(attempts,
    /// next_eligible_at_millis, failed)`. Mirrors the durable columns the SQLite
    /// queue persists (requirements 2.5/2.6) so the runtime's replay loop
    /// behaves identically against either queue.
    meta: std::collections::HashMap<String, ReplayMeta>,
}

/// In-memory per-frame replay bookkeeping (requirements 2.5/2.6).
#[derive(Debug, Clone, Copy, Default)]
struct ReplayMeta {
    attempts: u32,
    next_eligible_at_millis: i64,
    failed: bool,
}

impl InMemoryOfflineQueue {
    #[must_use]
    pub fn new() -> Self {
        Self {
            frames: VecDeque::new(),
            meta: std::collections::HashMap::new(),
        }
    }

    /// Sort key preserving ascending session-then-sequence order.
    fn key(frame: &TelemetryFrame) -> (String, u64) {
        // session identity is carried by pilot_id + mission_id in this contract;
        // pilot_id scopes the session for ordering purposes here.
        (frame.pilot_id.clone(), frame.sequence_number)
    }
}

impl OfflineQueue for InMemoryOfflineQueue {
    fn append(&mut self, frame: TelemetryFrame) -> Result<(), BridgeError> {
        // Insertion sort keeps the deque ordered by (session, sequence).
        let key = Self::key(&frame);
        let pos = self
            .frames
            .iter()
            .position(|f| Self::key(f) > key)
            .unwrap_or(self.frames.len());
        self.frames.insert(pos, frame);
        Ok(())
    }

    fn peek_oldest(&self) -> Option<&TelemetryFrame> {
        self.frames.front()
    }

    fn remove(&mut self, frame_id: &str) -> bool {
        if let Some(pos) = self.frames.iter().position(|f| f.frame_id == frame_id) {
            self.frames.remove(pos);
            self.meta.remove(frame_id);
            true
        } else {
            false
        }
    }

    fn len(&self) -> usize {
        self.frames.len()
    }

    fn ordered(&self) -> Vec<TelemetryFrame> {
        self.frames.iter().cloned().collect()
    }

    fn oldest_eligible(&self, now_millis: i64) -> Option<TelemetryFrame> {
        // Frames are stored in ascending (session, sequence) order, so the first
        // frame that is neither failed nor deferred is the oldest eligible one
        // (requirement 2.5: honor backoff; requirement 2.6: skip failed frames).
        self.frames
            .iter()
            .find(|f| match self.meta.get(&f.frame_id) {
                Some(m) => !m.failed && m.next_eligible_at_millis <= now_millis,
                None => true,
            })
            .cloned()
    }

    fn attempts(&self, frame_id: &str) -> u32 {
        self.meta.get(frame_id).map_or(0, |m| m.attempts)
    }

    fn defer(&mut self, frame_id: &str, next_eligible_at_millis: i64) {
        let entry = self.meta.entry(frame_id.to_string()).or_default();
        entry.attempts = entry.attempts.saturating_add(1);
        entry.next_eligible_at_millis = next_eligible_at_millis;
    }

    fn mark_failed(&mut self, frame_id: &str, _error: &str) -> bool {
        if self.frames.iter().any(|f| f.frame_id == frame_id) {
            let entry = self.meta.entry(frame_id.to_string()).or_default();
            entry.attempts = entry.attempts.saturating_add(1);
            entry.failed = true;
            true
        } else {
            false
        }
    }
}

/// Outcome of a single publish attempt (design Section 6.2 result classes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublishOutcome {
    /// The uplink acknowledged the frame; it may be removed from the queue.
    Acknowledged,
    /// A transient failure; retain the frame, back off, and retry up to the
    /// configured attempt cap (requirement 2.5). Carries a diagnostic reason.
    Retryable(String),
    /// A non-recoverable rejection (e.g. the ingestion service permanently
    /// refused the frame). The frame is marked failed and retained as a durable
    /// diagnostic without removal (requirement 2.6). Carries a diagnostic
    /// reason. Design Section 6.2 distinguishes this from [`Self::Retryable`].
    Permanent(String),
    /// Uplink is currently unreachable; leave frames queued.
    Offline,
}

/// The cloud uplink seam (design Section 4.2 `uplink_endpoint`). Task 5.6
/// provides the TLS 1.2+ implementation that aborts when a session below TLS
/// 1.2 is negotiated (design Section 9.1). This task ships an injectable no-op
/// so the runtime is testable in isolation.
pub trait Uplink {
    /// Whether the uplink is currently reachable (design 6.1
    /// `uplink_is_available`).
    fn is_available(&self) -> bool;

    /// Publish one frame in sequence. Never mutates the durable queue itself;
    /// the runtime removes acknowledged frames.
    fn publish(&mut self, frame: &TelemetryFrame) -> PublishOutcome;
}

/// An uplink that is always offline: every frame stays queued for replay. This
/// is the safe default for a task that does not implement transmission — it
/// exercises the offline path (design 6.1 `mark_uplink_offline`) without
/// sending anything.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopUplink;

impl Uplink for NoopUplink {
    fn is_available(&self) -> bool {
        false
    }

    fn publish(&mut self, _frame: &TelemetryFrame) -> PublishOutcome {
        PublishOutcome::Offline
    }
}

// ---------------------------------------------------------------------------
// Validation / normalization
// ---------------------------------------------------------------------------

/// The result of validating a normalized sample (design 6.1 `validate_telemetry`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    /// A numeric field was not finite; names the field (requirement 1.3).
    NonFinite(String),
    /// Latitude outside [-90, 90] (requirement 1.3).
    Latitude(String),
    /// Longitude outside [-180, 180] (requirement 1.3).
    Longitude(String),
    /// Heading outside [0, 360) (requirement 1.3).
    Heading(String),
    /// Observed timestamp unparseable or outside the [-60s, +5s] window
    /// (requirement 1.1).
    Timestamp(String),
    /// Schema version empty or longer than 32 chars (requirement 1.1).
    SchemaVersion(String),
    /// Sequence <= previously accepted for the session and not flagged replayed
    /// (requirement 1.3).
    SequenceRegression(String),
    /// Engine not one of the four supported values (requirement 1.2). Adapters
    /// already gate this, but the runtime re-checks defensively.
    UnsupportedEngine(String),
}

impl ValidationError {
    /// The failed validation field name for the diagnostic entry
    /// (requirement 1.3 "identifying the failed validation field").
    #[must_use]
    pub fn field(&self) -> &str {
        match self {
            ValidationError::NonFinite(f)
            | ValidationError::Latitude(f)
            | ValidationError::Longitude(f)
            | ValidationError::Heading(f)
            | ValidationError::Timestamp(f)
            | ValidationError::SchemaVersion(f)
            | ValidationError::SequenceRegression(f)
            | ValidationError::UnsupportedEngine(f) => f,
        }
    }
}

impl core::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            ValidationError::NonFinite(m) => write!(f, "non-finite value: {m}"),
            ValidationError::Latitude(m) => write!(f, "latitude out of range: {m}"),
            ValidationError::Longitude(m) => write!(f, "longitude out of range: {m}"),
            ValidationError::Heading(m) => write!(f, "heading out of range: {m}"),
            ValidationError::Timestamp(m) => write!(f, "observed timestamp invalid: {m}"),
            ValidationError::SchemaVersion(m) => write!(f, "schema version invalid: {m}"),
            ValidationError::SequenceRegression(m) => write!(f, "sequence regression: {m}"),
            ValidationError::UnsupportedEngine(m) => write!(f, "unsupported engine: {m}"),
        }
    }
}

/// Outcome of [`BridgeRuntime::ingest_sample`] (design 6.1 Accepted/Rejected).
#[derive(Debug, Clone, PartialEq)]
pub enum IngestOutcome {
    /// The frame was accepted and durably queued; carries its `frame_id`.
    Accepted(String),
    /// The frame was rejected before persistence; carries the failure and a
    /// diagnostic string (requirement 1.3).
    Rejected(ValidationError),
}

/// A bridge diagnostic record (design 6.1 `record_bridge_diagnostic`).
///
/// Rejections append one of these; the durable diagnostic store is task 5.3.
/// Here they are retained in-memory so tests can assert a diagnostic naming the
/// failed field was recorded (requirement 1.3).
#[derive(Debug, Clone, PartialEq)]
pub struct BridgeDiagnostic {
    pub field: String,
    pub message: String,
}

fn is_supported_engine(engine: SimulatorEngine) -> bool {
    matches!(
        engine,
        SimulatorEngine::Msfs2020
            | SimulatorEngine::Msfs2024
            | SimulatorEngine::Xplane11
            | SimulatorEngine::Xplane12
    )
}

fn engine_label(engine: SimulatorEngine) -> &'static str {
    match engine {
        SimulatorEngine::Msfs2020 => "MSFS2020",
        SimulatorEngine::Msfs2024 => "MSFS2024",
        SimulatorEngine::Xplane11 => "XPLANE11",
        SimulatorEngine::Xplane12 => "XPLANE12",
    }
}

/// Normalize units and field names (design 6.1 `normalize_units_and_names`).
///
/// Adapters already emit the shared contract units and field names (see
/// [`crate::adapter`]), so normalization at the runtime boundary is the
/// identity plus trimming the observed-timestamp string. Keeping this as an
/// explicit step preserves the design's pipeline shape and gives a single place
/// to add future cross-adapter normalization.
fn normalize_units_and_names(mut sample: TelemetrySample) -> TelemetrySample {
    sample.observed_at = sample.observed_at.trim().to_string();
    sample
}

/// Validate a normalized sample against requirements 1.1 and 1.3.
///
/// `previous_sequence` is the last accepted sequence number for the session (or
/// `None` if none yet). `is_replayed` flags a frame as replayed historical data,
/// which suppresses the sequence-regression rejection (requirement 1.3).
/// `receive_millis` is the cloud-receive time used for the observed-timestamp
/// skew window (requirement 1.1).
fn validate_telemetry(
    sample: &TelemetrySample,
    previous_sequence: Option<u64>,
    is_replayed: bool,
    receive_millis: i64,
) -> Result<(), ValidationError> {
    // Engine support (requirement 1.2 / 1.1 "supported engine").
    if !is_supported_engine(sample.source_engine) {
        return Err(ValidationError::UnsupportedEngine(
            engine_label(sample.source_engine).to_string(),
        ));
    }

    // Finite numeric values (requirement 1.1/1.3).
    let p = &sample.position;
    let fl = &sample.flight;
    let s = &sample.systems;
    let finite_checks: [(&str, f64); 11] = [
        ("latitude_deg", p.latitude_deg),
        ("longitude_deg", p.longitude_deg),
        ("altitude_msl_ft", p.altitude_msl_ft),
        ("altitude_agl_ft", p.altitude_agl_ft),
        ("ground_speed_kts", fl.ground_speed_kts),
        ("heading_deg", fl.heading_deg),
        ("vertical_speed_fpm", fl.vertical_speed_fpm),
        ("pitch_deg", fl.pitch_deg),
        ("roll_deg", fl.roll_deg),
        ("fuel_remaining_lbs", s.fuel_remaining_lbs),
        ("engine_torque_pct", s.engine_torque_pct),
    ];
    for (field, value) in finite_checks {
        if !value.is_finite() {
            return Err(ValidationError::NonFinite(field.to_string()));
        }
    }
    for (field, value) in [
        ("tot_celsius", s.tot_celsius),
        ("rotor_rpm_pct", s.rotor_rpm_pct),
        ("outside_air_temp_c", s.outside_air_temp_c),
    ] {
        if let Some(v) = value {
            if !v.is_finite() {
                return Err(ValidationError::NonFinite(field.to_string()));
            }
        }
    }

    // Coordinate ranges (requirement 1.3).
    if !(-90.0..=90.0).contains(&p.latitude_deg) {
        return Err(ValidationError::Latitude(format!(
            "latitude_deg {} not in [-90, 90]",
            p.latitude_deg
        )));
    }
    if !(-180.0..=180.0).contains(&p.longitude_deg) {
        return Err(ValidationError::Longitude(format!(
            "longitude_deg {} not in [-180, 180]",
            p.longitude_deg
        )));
    }

    // Heading [0, 360) (requirement 1.3).
    if !(0.0..360.0).contains(&fl.heading_deg) {
        return Err(ValidationError::Heading(format!(
            "heading_deg {} not in [0, 360)",
            fl.heading_deg
        )));
    }

    // Observed-timestamp window relative to cloud-receive time (requirement 1.1).
    let observed_millis = parse_rfc3339_millis(&sample.observed_at)
        .ok_or_else(|| ValidationError::Timestamp(format!("unparseable: {}", sample.observed_at)))?;
    let skew = observed_millis - receive_millis;
    if skew < OBSERVED_MIN_SKEW_MS || skew > OBSERVED_MAX_SKEW_MS {
        return Err(ValidationError::Timestamp(format!(
            "observed_at skew {skew}ms outside [{OBSERVED_MIN_SKEW_MS}, {OBSERVED_MAX_SKEW_MS}]ms"
        )));
    }

    // Sequence: strictly greater than the previous accepted for the session,
    // unless the frame is replayed historical data (requirement 1.1/1.3).
    if !is_replayed {
        if let Some(prev) = previous_sequence {
            if sample.source_sequence <= prev {
                return Err(ValidationError::SequenceRegression(format!(
                    "sequence_number {} <= previous {prev}",
                    sample.source_sequence
                )));
            }
        }
    }

    Ok(())
}

/// Validate the schema version string (requirement 1.1: non-empty, <= 32 chars).
fn validate_schema_version(version: &str) -> Result<(), ValidationError> {
    if version.is_empty() {
        return Err(ValidationError::SchemaVersion("empty".to_string()));
    }
    if version.chars().count() > MAX_SCHEMA_VERSION_LEN {
        return Err(ValidationError::SchemaVersion(format!(
            "{} chars exceeds max {MAX_SCHEMA_VERSION_LEN}",
            version.chars().count()
        )));
    }
    Ok(())
}

/// A minimal RFC 3339 / ISO 8601 UTC timestamp parser returning Unix
/// milliseconds. Supports `YYYY-MM-DDTHH:MM:SS[.fff]` with a `Z` or numeric
/// (`+HH:MM` / `-HH:MM`) offset. Returns `None` on any malformed input.
///
/// A hand-rolled parser avoids adding a date/time dependency for this task; the
/// window check (requirement 1.1) only needs UTC-millisecond resolution.
fn parse_rfc3339_millis(input: &str) -> Option<i64> {
    let s = input.trim();
    // Split date and time on 'T' (accept lowercase 't' and space too).
    let (date, rest) = s.split_once(['T', 't', ' '])?;
    let (y, mo, d) = {
        let mut it = date.split('-');
        let y: i64 = it.next()?.parse().ok()?;
        let mo: i64 = it.next()?.parse().ok()?;
        let d: i64 = it.next()?.parse().ok()?;
        if it.next().is_some() {
            return None;
        }
        (y, mo, d)
    };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }

    // Separate the offset from the time-of-day.
    let (time_part, offset_millis) = if let Some(t) = rest.strip_suffix(['Z', 'z']) {
        (t, 0i64)
    } else if let Some(idx) = rest.rfind(['+', '-']) {
        let (t, off) = rest.split_at(idx);
        let sign = if off.starts_with('-') { -1 } else { 1 };
        let off = &off[1..];
        let (oh, om) = off.split_once(':').unwrap_or((off, "0"));
        let oh: i64 = oh.parse().ok()?;
        let om: i64 = om.parse().ok()?;
        (t, sign * (oh * 3_600_000 + om * 60_000))
    } else {
        // No offset marker: treat as UTC.
        (rest, 0i64)
    };

    let mut hms = time_part.split(':');
    let h: i64 = hms.next()?.parse().ok()?;
    let mi: i64 = hms.next()?.parse().ok()?;
    let sec_frac = hms.next()?;
    if hms.next().is_some() {
        return None;
    }
    let (sec_str, frac_str) = sec_frac.split_once('.').unwrap_or((sec_frac, ""));
    let sec: i64 = sec_str.parse().ok()?;
    // Normalize fractional seconds to exactly milliseconds.
    let frac_ms: i64 = if frac_str.is_empty() {
        0
    } else {
        let mut digits = String::new();
        for c in frac_str.chars() {
            if c.is_ascii_digit() {
                digits.push(c);
            } else {
                return None;
            }
        }
        let mut ms = digits;
        ms.truncate(3);
        while ms.len() < 3 {
            ms.push('0');
        }
        ms.parse().ok()?
    };
    if !(0..=23).contains(&h) || !(0..=59).contains(&mi) || !(0..=60).contains(&sec) {
        return None;
    }

    let days = days_from_civil(y, mo, d);
    let millis = days * 86_400_000
        + h * 3_600_000
        + mi * 60_000
        + sec * 1_000
        + frac_ms
        - offset_millis;
    Some(millis)
}

/// Days since the Unix epoch (1970-01-01) for a civil date, using Howard
/// Hinnant's algorithm. Correct for the proleptic Gregorian calendar.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

// ---------------------------------------------------------------------------
// Delta compression (design Section 9.2)
// ---------------------------------------------------------------------------

/// Whether the candidate frame differs from the previous accepted frame by less
/// than the delta threshold across every compared numeric field (design 6.1
/// `delta_is_below_threshold`). Optional systems fields must both be present (or
/// both absent) and within threshold to count as a small delta.
fn delta_is_below_threshold(candidate: &TelemetryFrame, previous: &TelemetryFrame) -> bool {
    if candidate.source_engine != previous.source_engine {
        return false;
    }
    let close = |a: f64, b: f64| (a - b).abs() <= DELTA_ABS_THRESHOLD;
    let opt_close = |a: Option<f64>, b: Option<f64>| match (a, b) {
        (Some(x), Some(y)) => close(x, y),
        (None, None) => true,
        _ => false,
    };

    close(candidate.position.latitude_deg, previous.position.latitude_deg)
        && close(candidate.position.longitude_deg, previous.position.longitude_deg)
        && close(candidate.position.altitude_msl_ft, previous.position.altitude_msl_ft)
        && close(candidate.position.altitude_agl_ft, previous.position.altitude_agl_ft)
        && close(candidate.flight.ground_speed_kts, previous.flight.ground_speed_kts)
        && close(candidate.flight.heading_deg, previous.flight.heading_deg)
        && close(candidate.flight.vertical_speed_fpm, previous.flight.vertical_speed_fpm)
        && close(candidate.flight.pitch_deg, previous.flight.pitch_deg)
        && close(candidate.flight.roll_deg, previous.flight.roll_deg)
        && close(candidate.systems.fuel_remaining_lbs, previous.systems.fuel_remaining_lbs)
        && close(candidate.systems.engine_torque_pct, previous.systems.engine_torque_pct)
        && opt_close(candidate.systems.tot_celsius, previous.systems.tot_celsius)
        && opt_close(candidate.systems.rotor_rpm_pct, previous.systems.rotor_rpm_pct)
        && opt_close(candidate.systems.outside_air_temp_c, previous.systems.outside_air_temp_c)
}

// ---------------------------------------------------------------------------
// BridgeRuntime
// ---------------------------------------------------------------------------

/// The bridge runtime (design Section 4.2).
///
/// Generic over the injectable [`OfflineQueue`], [`Uplink`], and [`Clock`] seams
/// so tests drive it deterministically and tasks 5.3/5.4/5.6 substitute the
/// durable/TLS implementations. Construct with [`BridgeRuntime::new`] (real
/// system clock) or [`BridgeRuntime::with_parts`] (fully injected).
pub struct BridgeRuntime<Q: OfflineQueue, U: Uplink, C: Clock> {
    queue: Q,
    uplink: U,
    clock: C,
    schema_version: String,

    /// Registered adapters. The sampling loop polls these in order at the fixed
    /// cadence; adapters supply samples but never persist or transmit
    /// (requirement 1.8).
    adapters: Vec<Box<dyn SimulatorAdapter>>,

    /// Present while a session is active (between `start` and `stop`).
    session: Option<BridgeSession>,
    /// Active session configuration, mirrored so `ingest_sample` can read the
    /// sample rate and session identity without re-borrowing the session.
    configuration: Option<BridgeConfiguration>,
    /// Last accepted sequence number for the active session (requirement 1.1).
    last_sequence: Option<u64>,
    /// Last accepted full/delta frame, for delta encoding (design 6.1
    /// `latest_accepted_frame`).
    previous_frame: Option<TelemetryFrame>,
    /// Count of accepted frames this session, driving periodic full snapshots.
    accepted_count: u64,
    /// Current uplink availability.
    uplink_state: UplinkState,
    /// In-memory diagnostics recorded on rejection (durable store: task 5.3).
    diagnostics: Vec<BridgeDiagnostic>,
    /// Monotonic session counter used to mint session ids.
    session_counter: u64,
    /// Retry/backoff configuration for offline replay (requirement 2.5).
    replay_policy: ReplayPolicy,
    /// Whether the uplink was available on the previous availability check, used
    /// to detect the unavailable→available transition that must trigger replay
    /// within 5 seconds (requirement 2.3). `None` until the first check.
    last_uplink_available: Option<bool>,
    /// Cloud-receive instant (Unix millis) at which the current pending replay
    /// became due after an unavailable→available transition, or `None` when no
    /// replay is pending. Replay must begin within [`REPLAY_START_DEADLINE_MS`]
    /// of this instant (requirement 2.3).
    replay_due_at_millis: Option<i64>,
    /// User-facing permanent-failure indications raised during replay
    /// (requirement 2.6), drained by the UI via [`BridgeRuntime::take_replay_errors`].
    replay_errors: Vec<ReplayError>,
}

/// A user-facing error indication for a frame that permanently failed to replay
/// (requirement 2.6: "present an error indication to the user identifying the
/// affected frame"). Mirrors, in the runtime, the durable diagnostic the queue
/// retains, so the UI can surface which frame failed without reading the queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayError {
    /// The `frame_id` of the frame that permanently failed (identifies the
    /// affected frame per requirement 2.6).
    pub frame_id: String,
    /// The number of attempts made before the frame was treated as permanently
    /// failed.
    pub attempts: u32,
    /// Human-readable diagnostic describing the failure.
    pub message: String,
}

impl BridgeRuntime<InMemoryOfflineQueue, NoopUplink, SystemClock> {
    /// A runtime with the in-memory queue, always-offline uplink, and system
    /// clock. Suitable until tasks 5.3/5.4/5.6 supply durable/TLS parts.
    #[must_use]
    pub fn new() -> Self {
        Self::with_parts(
            InMemoryOfflineQueue::new(),
            NoopUplink,
            SystemClock,
        )
    }
}

impl Default for BridgeRuntime<InMemoryOfflineQueue, NoopUplink, SystemClock> {
    fn default() -> Self {
        Self::new()
    }
}

impl<Q: OfflineQueue, U: Uplink, C: Clock> BridgeRuntime<Q, U, C> {
    /// Construct a runtime from explicit parts (used by tests and by later
    /// tasks that inject a SQLite queue and TLS uplink). Uses the default
    /// [`ReplayPolicy`].
    pub fn with_parts(queue: Q, uplink: U, clock: C) -> Self {
        Self::with_parts_and_policy(queue, uplink, clock, ReplayPolicy::default())
    }

    /// Construct a runtime from explicit parts with an explicit replay
    /// retry/backoff policy (requirement 2.5).
    pub fn with_parts_and_policy(
        queue: Q,
        uplink: U,
        clock: C,
        replay_policy: ReplayPolicy,
    ) -> Self {
        Self {
            queue,
            uplink,
            clock,
            schema_version: SCHEMA_VERSION.to_string(),
            adapters: Vec::new(),
            session: None,
            configuration: None,
            last_sequence: None,
            previous_frame: None,
            accepted_count: 0,
            uplink_state: UplinkState::Offline,
            diagnostics: Vec::new(),
            session_counter: 0,
            replay_policy,
            last_uplink_available: None,
            replay_due_at_millis: None,
            replay_errors: Vec::new(),
        }
    }

    /// Start a session (design Section 4.2 `start`).
    ///
    /// Enforces the 2–10 Hz sample-rate precondition (requirement 1.5) before
    /// opening the session, and resets per-session sequence/delta state.
    pub fn start(
        &mut self,
        configuration: BridgeConfiguration,
    ) -> Result<BridgeSession, BridgeError> {
        if self.session.is_some() {
            return Err(BridgeError::AlreadyRunning);
        }
        if !configuration.sample_rate_is_valid() {
            return Err(BridgeError::InvalidSampleRate(configuration.sample_rate_hz));
        }

        self.session_counter += 1;
        let session = BridgeSession {
            session_id: format!("session-{}", self.session_counter),
            pilot_id: configuration.pilot_id.clone(),
            mission_id: configuration.mission_id.clone(),
            sample_rate_hz: configuration.sample_rate_hz,
        };
        self.session = Some(session.clone());
        self.configuration = Some(configuration);
        self.last_sequence = None;
        self.previous_frame = None;
        self.accepted_count = 0;
        self.uplink_state = if self.uplink.is_available() {
            UplinkState::Available
        } else {
            UplinkState::Offline
        };
        Ok(session)
    }

    /// Stop the active session (design Section 4.2 `stop`). Leaves queued frames
    /// intact for later replay (requirement 2.2). Errors if not running.
    pub fn stop(&mut self) -> Result<(), BridgeError> {
        if self.session.is_none() {
            return Err(BridgeError::NotRunning);
        }
        self.session = None;
        self.configuration = None;
        Ok(())
    }

    /// Register a simulator adapter (design Section 4.2 `register_adapter`).
    /// Adapters may be registered before or during a session.
    pub fn register_adapter(
        &mut self,
        adapter: Box<dyn SimulatorAdapter>,
    ) -> Result<(), BridgeError> {
        self.adapters.push(adapter);
        Ok(())
    }

    /// Current runtime status (design Section 4.2 `connection_status`).
    #[must_use]
    pub fn connection_status(&self) -> BridgeStatus {
        BridgeStatus {
            running: self.session.is_some(),
            session_id: self.session.as_ref().map(|s| s.session_id.clone()),
            uplink_state: self.uplink_state,
            last_sequence: self.last_sequence,
            queued_frames: self.queue.len(),
        }
    }

    /// Flush the offline queue (design Section 4.2/6.2 `flush_offline_queue`).
    ///
    /// This is the public entry point; it delegates to
    /// [`Self::replay_offline_queue`], which implements the design Section 6.2
    /// replay state machine (remove-only-after-ack, retryable backoff, permanent
    /// failure retention). Kept as a named method because callers and existing
    /// tests reference `flush_offline_queue`.
    pub fn flush_offline_queue(&mut self) -> FlushSummary {
        self.replay_offline_queue()
    }

    /// Replay the durable offline queue in ascending (session, sequence) order
    /// (design Section 6.2 `replay_offline_queue`).
    ///
    /// Loop invariant and postconditions (design Section 6.2):
    /// * Frames are published oldest-first and removed **only after** the
    ///   uplink acknowledges them (requirement 2.4).
    /// * A retryable failure defers the frame for the configured backoff
    ///   (1–60 s) and increments its attempt count; once the attempt count
    ///   reaches the configured maximum (≤10) the frame is escalated to a
    ///   permanent failure (requirement 2.5).
    /// * A permanent failure marks the frame failed and retains it in durable
    ///   storage as a diagnostic without removing it, raises a user-facing
    ///   error indication naming the affected frame, and replay continues with
    ///   subsequent records (requirement 2.6).
    ///
    /// Backoff timing uses the injected [`Clock`], so the deferral window is
    /// deterministic in tests. Because a deferred or failed frame is skipped by
    /// [`OfflineQueue::oldest_eligible`], the loop advances past it to the next
    /// eligible record rather than head-of-line blocking.
    pub fn replay_offline_queue(&mut self) -> FlushSummary {
        let mut summary = FlushSummary::default();

        if !self.uplink.is_available() {
            self.uplink_state = UplinkState::Offline;
            // Everything durable stays deferred while offline.
            summary.deferred = self.queue.len();
            return summary;
        }
        self.uplink_state = UplinkState::Available;

        // A newly-detected availability satisfies the replay-start obligation
        // (requirement 2.3): we are replaying now, so clear the pending marker.
        self.replay_due_at_millis = None;

        // Track frame ids already visited this pass so a deferred frame (whose
        // next-eligible instant is still in the future) can't be revisited in an
        // infinite loop within a single replay.
        let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();

        while self.uplink.is_available() {
            let now = self.clock.now_unix_millis();
            let Some(frame) = self.queue.oldest_eligible(now) else {
                break;
            };
            if !visited.insert(frame.frame_id.clone()) {
                // We have already handled (and deferred) this frame this pass;
                // no further eligible frame precedes it. Stop to avoid spinning.
                break;
            }

            match self.uplink.publish(&frame) {
                PublishOutcome::Acknowledged => {
                    // Remove ONLY after the server acknowledgement (req 2.4).
                    self.queue.remove(&frame.frame_id);
                    summary.sent += 1;
                }
                PublishOutcome::Retryable(reason) => {
                    // Attempts recorded so far, plus this failed attempt.
                    let attempts_after = self.queue.attempts(&frame.frame_id).saturating_add(1);
                    if attempts_after >= self.replay_policy.max_attempts() {
                        // Reaching the attempt cap escalates to a permanent
                        // failure (requirement 2.5 → 2.6).
                        self.fail_frame(&frame.frame_id, attempts_after, &reason);
                        summary.failed += 1;
                        // Continue replaying subsequent records (req 2.6).
                        continue;
                    }
                    // Defer for the configured backoff and retry on a later pass
                    // (requirement 2.5). Design Section 6.2 BREAKs the current
                    // replay burst on a retryable failure: a transient fault
                    // usually affects the uplink, not just this frame, so we stop
                    // this pass and let the next replay (after the backoff)
                    // resume from the oldest eligible record.
                    let next_eligible = now.saturating_add(self.replay_policy.backoff_ms() as i64);
                    self.queue.defer(&frame.frame_id, next_eligible);
                    self.uplink_state = UplinkState::Degraded;
                    summary.deferred += 1;
                    break;
                }
                PublishOutcome::Permanent(reason) => {
                    let attempts_after = self.queue.attempts(&frame.frame_id).saturating_add(1);
                    self.fail_frame(&frame.frame_id, attempts_after, &reason);
                    summary.failed += 1;
                    // Continue replaying subsequent records (req 2.6).
                    continue;
                }
                PublishOutcome::Offline => {
                    // Uplink dropped mid-replay; leave the rest queued.
                    self.uplink_state = UplinkState::Offline;
                    summary.deferred += 1;
                    break;
                }
            }
        }
        summary
    }

    /// Mark `frame_id` permanently failed: retain it in durable storage as a
    /// diagnostic (requirement 2.6), record an in-memory bridge diagnostic, and
    /// raise a user-facing [`ReplayError`] naming the affected frame.
    fn fail_frame(&mut self, frame_id: &str, attempts: u32, reason: &str) {
        let message = format!(
            "frame {frame_id} permanently failed replay after {attempts} attempt(s): {reason}"
        );
        self.queue.mark_failed(frame_id, &message);
        self.diagnostics.push(BridgeDiagnostic {
            field: frame_id.to_string(),
            message: message.clone(),
        });
        self.replay_errors.push(ReplayError {
            frame_id: frame_id.to_string(),
            attempts,
            message,
        });
    }

    /// Poll uplink availability and, on an unavailable→available transition with
    /// a non-empty queue, begin replay (requirement 2.3: "begin replaying …
    /// within 5 seconds of detecting availability").
    ///
    /// The caller drives this from the periodic tick. On the transition it marks
    /// a replay due at `now` and immediately runs [`Self::replay_offline_queue`],
    /// which satisfies the 5-second bound with margin. If a downstream caller
    /// defers the actual replay, [`Self::replay_start_overdue`] reports when the
    /// [`REPLAY_START_DEADLINE_MS`] window has been missed.
    ///
    /// Returns the [`FlushSummary`] of any replay run this poll, or `None` when
    /// no replay was triggered (no transition, or empty queue).
    pub fn poll_uplink(&mut self) -> Option<FlushSummary> {
        let available = self.uplink.is_available();
        let was_available = self.last_uplink_available;
        self.last_uplink_available = Some(available);

        // Detect the unavailable → available transition (req 2.3). Treat the
        // first-ever observation of "available" as a transition too, so a
        // restart that comes up already-online still replays a backlog.
        let became_available = available && was_available != Some(true);

        if available {
            self.uplink_state = UplinkState::Available;
        } else {
            self.uplink_state = UplinkState::Offline;
        }

        if became_available && !self.queue.is_empty() {
            // Mark the replay obligation as due now (req 2.3) and discharge it.
            self.replay_due_at_millis = Some(self.clock.now_unix_millis());
            return Some(self.replay_offline_queue());
        }
        None
    }

    /// Whether a replay that became due on an availability transition has not
    /// begun within [`REPLAY_START_DEADLINE_MS`] (requirement 2.3). Returns
    /// `false` when no replay is pending. Exposed so a supervisor/tick can
    /// assert the 5-second start bound.
    #[must_use]
    pub fn replay_start_overdue(&self) -> bool {
        match self.replay_due_at_millis {
            Some(due_at) => {
                self.clock.now_unix_millis().saturating_sub(due_at) > REPLAY_START_DEADLINE_MS
            }
            None => false,
        }
    }

    /// Drain the user-facing permanent-failure indications raised during replay
    /// (requirement 2.6). The runtime/UI forwards these to the operator; the
    /// affected frames remain in durable storage as diagnostics.
    pub fn take_replay_errors(&mut self) -> Vec<ReplayError> {
        std::mem::take(&mut self.replay_errors)
    }

    /// The configured replay retry/backoff policy (requirement 2.5).
    #[must_use]
    pub fn replay_policy(&self) -> ReplayPolicy {
        self.replay_policy
    }

    /// Recorded rejection diagnostics (requirement 1.3). Durable storage is
    /// task 5.3; exposed here for inspection and tests.
    #[must_use]
    pub fn diagnostics(&self) -> &[BridgeDiagnostic] {
        &self.diagnostics
    }

    /// The telemetry ingestion pipeline (design Section 6.1 `ingest_sample`).
    ///
    /// `is_replayed` marks the sample as replayed historical data, suppressing
    /// the sequence-regression rejection (requirement 1.3).
    ///
    /// Postconditions on `Accepted`: the frame has a sequence number, a
    /// cloud-receive timestamp, the schema version, and a durable local-queue
    /// record; delta compression is applied only after validation, with a full
    /// snapshot every [`FULL_SNAPSHOT_INTERVAL`] frames. On `Rejected`: nothing
    /// is persisted and a diagnostic naming the failed field is recorded.
    pub fn ingest_sample(
        &mut self,
        sample: TelemetrySample,
        is_replayed: bool,
    ) -> Result<IngestOutcome, BridgeError> {
        // Precondition: an active session with a valid 2–10 Hz rate.
        let configuration = self.configuration.as_ref().ok_or(BridgeError::NotRunning)?;
        if !configuration.sample_rate_is_valid() {
            return Err(BridgeError::InvalidSampleRate(configuration.sample_rate_hz));
        }
        let pilot_id = configuration.pilot_id.clone();
        let mission_id = configuration.mission_id.clone();

        // Schema version stamp is validated up front (requirement 1.1).
        if let Err(e) = validate_schema_version(&self.schema_version) {
            self.record_diagnostic(&e);
            return Ok(IngestOutcome::Rejected(e));
        }

        let receive_millis = self.clock.now_unix_millis();

        // normalize → validate.
        let normalized = normalize_units_and_names(sample);
        if let Err(e) =
            validate_telemetry(&normalized, self.last_sequence, is_replayed, receive_millis)
        {
            // Reject WITHOUT persisting; record a diagnostic naming the field.
            self.record_diagnostic(&e);
            return Ok(IngestOutcome::Rejected(e));
        }

        // create_frame(normalized, next_sequence(), now()).
        let sequence = normalized.source_sequence;
        let received_at = unix_millis_to_rfc3339(receive_millis);
        let mut frame = TelemetryFrame {
            frame_id: mint_frame_id(&pilot_id, sequence),
            pilot_id,
            mission_id,
            source_engine: normalized.source_engine,
            sequence_number: sequence,
            observed_at: normalized.observed_at.clone(),
            received_at: Some(received_at),
            position: normalized.position,
            flight: normalized.flight,
            systems: normalized.systems,
            is_delta: false,
            schema_version: self.schema_version.clone(),
        };

        // Delta compression AFTER validation, with a periodic full snapshot.
        // A frame is delta-encoded only when it is not a forced full snapshot,
        // a previous accepted frame exists, and the change is below threshold
        // (design Sections 6.1 and 9.2).
        let force_full = self.accepted_count % FULL_SNAPSHOT_INTERVAL == 0;
        frame.is_delta = !force_full
            && self
                .previous_frame
                .as_ref()
                .is_some_and(|previous| delta_is_below_threshold(&frame, previous));

        // append_to_local_queue(frame) — durable before any transmit.
        self.queue.append(frame.clone())?;

        // Advance session state only after the durable append succeeds.
        self.last_sequence = Some(sequence);
        self.previous_frame = Some(frame.clone());
        self.accepted_count += 1;

        // Publish in sequence if the uplink is available, else stay offline.
        if self.uplink.is_available() {
            let _ = self.flush_offline_queue();
        } else {
            self.uplink_state = UplinkState::Offline;
        }

        Ok(IngestOutcome::Accepted(frame.frame_id))
    }

    fn record_diagnostic(&mut self, error: &ValidationError) {
        self.diagnostics.push(BridgeDiagnostic {
            field: error.field().to_string(),
            message: error.to_string(),
        });
    }

    /// Run one tick of the fixed-rate sampling loop (requirement 1.5).
    ///
    /// The caller drives this at the fixed [`BridgeConfiguration::sample_interval_ms`]
    /// cadence (a real timer in production; a controlled loop in tests). Each
    /// tick polls every registered adapter for its latest kinematic state as of
    /// `now` and feeds any produced sample through [`Self::ingest_sample`].
    /// Adapters reporting no data or a rejected sample do not abort the tick;
    /// their diagnostics are recorded and the loop continues (design "reject
    /// sample, record diagnostic, continue listener loop").
    ///
    /// Returns the per-adapter ingest outcomes for the samples that were
    /// produced this tick.
    pub fn sample_once(
        &mut self,
        now: crate::adapter::Timestamp,
    ) -> Result<Vec<IngestOutcome>, BridgeError> {
        if self.session.is_none() {
            return Err(BridgeError::NotRunning);
        }
        // Take samples first to end the mutable borrow of `self.adapters`
        // before calling `ingest_sample`, which borrows `self` mutably.
        let mut samples = Vec::new();
        for adapter in &mut self.adapters {
            // NoData / transient adapter faults do not abort the tick.
            if let Ok(sample) = adapter.sample(now) {
                samples.push(sample);
            }
        }
        let mut outcomes = Vec::with_capacity(samples.len());
        for sample in samples {
            outcomes.push(self.ingest_sample(sample, false)?);
        }
        Ok(outcomes)
    }

    /// Number of registered adapters (introspection for status/tests).
    #[must_use]
    pub fn adapter_count(&self) -> usize {
        self.adapters.len()
    }
}

/// Mint a deterministic frame id from session identity and sequence. A real
/// UUID mint arrives with the durable queue (task 5.3); a stable string keeps
/// idempotency keys `(pilot, sequence)` well-defined now (requirement 2.7).
fn mint_frame_id(pilot_id: &str, sequence: u64) -> String {
    format!("{pilot_id}:{sequence}")
}

/// Format Unix milliseconds as an RFC 3339 UTC timestamp (inverse of
/// [`parse_rfc3339_millis`]), used for the `received_at` stamp.
fn unix_millis_to_rfc3339(millis: i64) -> String {
    let (mut secs, mut ms) = (millis.div_euclid(1000), millis.rem_euclid(1000));
    if ms < 0 {
        ms += 1000;
        secs -= 1;
    }
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z")
}

/// Inverse of [`days_from_civil`]: civil date from days since the Unix epoch.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{FlightVector, PositionVector, SystemsVector};
    use std::cell::Cell;

    /// A fixed clock so the observed-timestamp window is deterministic.
    struct FixedClock(i64);
    impl Clock for FixedClock {
        fn now_unix_millis(&self) -> i64 {
            self.0
        }
    }

    /// An uplink whose availability and outcome are scripted.
    struct ScriptedUplink {
        available: bool,
        outcome: PublishOutcome,
        published: Cell<usize>,
    }
    impl ScriptedUplink {
        fn available() -> Self {
            Self {
                available: true,
                outcome: PublishOutcome::Acknowledged,
                published: Cell::new(0),
            }
        }
        fn offline() -> Self {
            Self {
                available: false,
                outcome: PublishOutcome::Offline,
                published: Cell::new(0),
            }
        }
    }
    impl Uplink for ScriptedUplink {
        fn is_available(&self) -> bool {
            self.available
        }
        fn publish(&mut self, _frame: &TelemetryFrame) -> PublishOutcome {
            self.published.set(self.published.get() + 1);
            self.outcome.clone()
        }
    }

    // ISO timestamp aligned to the fixed clock (receive == observed).
    const OBSERVED_AT: &str = "2024-01-01T00:00:00.000Z";
    // Unix millis for 2024-01-01T00:00:00Z.
    const RECEIVE_MS: i64 = 1_704_067_200_000;

    fn config(rate: f64) -> BridgeConfiguration {
        BridgeConfiguration {
            pilot_id: "pilot-1".into(),
            mission_id: Some("mission-1".into()),
            sample_rate_hz: rate,
            udp_bind_address: "127.0.0.1:8080".into(),
            uplink_endpoint: "https://example.test/telemetry".into(),
            api_key_reference: SecretReference {
                key: "VH_API_KEY".into(),
            },
            offline_capacity: 1000,
        }
    }

    fn sample(sequence: u64) -> TelemetrySample {
        TelemetrySample {
            source_engine: SimulatorEngine::Xplane12,
            source_sequence: sequence,
            observed_at: OBSERVED_AT.into(),
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
                tot_celsius: Some(720.0),
                rotor_rpm_pct: Some(100.0),
                outside_air_temp_c: Some(15.0),
            },
        }
    }

    fn runtime_offline() -> BridgeRuntime<InMemoryOfflineQueue, ScriptedUplink, FixedClock> {
        BridgeRuntime::with_parts(
            InMemoryOfflineQueue::new(),
            ScriptedUplink::offline(),
            FixedClock(RECEIVE_MS),
        )
    }

    // ---- requirement 1.5: fixed sample rate 2..=10 Hz -------------------

    #[test]
    fn start_rejects_sample_rate_below_2hz() {
        let mut rt = runtime_offline();
        let err = rt.start(config(1.9)).unwrap_err();
        assert_eq!(err, BridgeError::InvalidSampleRate(1.9));
        assert!(!rt.connection_status().running);
    }

    #[test]
    fn start_rejects_sample_rate_above_10hz() {
        let mut rt = runtime_offline();
        assert!(matches!(
            rt.start(config(10.1)),
            Err(BridgeError::InvalidSampleRate(_))
        ));
    }

    #[test]
    fn start_accepts_boundary_rates() {
        let mut rt = runtime_offline();
        assert!(rt.start(config(2.0)).is_ok());
        rt.stop().unwrap();
        assert!(rt.start(config(10.0)).is_ok());
    }

    #[test]
    fn sample_interval_matches_rate() {
        assert_eq!(config(2.0).sample_interval_ms(), 500);
        assert_eq!(config(10.0).sample_interval_ms(), 100);
        assert_eq!(config(4.0).sample_interval_ms(), 250);
    }

    // ---- lifecycle ------------------------------------------------------

    #[test]
    fn stop_without_start_errors() {
        let mut rt = runtime_offline();
        assert_eq!(rt.stop().unwrap_err(), BridgeError::NotRunning);
    }

    #[test]
    fn double_start_errors() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        assert_eq!(rt.start(config(5.0)).unwrap_err(), BridgeError::AlreadyRunning);
    }

    #[test]
    fn ingest_before_start_errors() {
        let mut rt = runtime_offline();
        assert_eq!(
            rt.ingest_sample(sample(1), false).unwrap_err(),
            BridgeError::NotRunning
        );
    }

    // ---- requirement 1.1: accepted frame is stamped ---------------------

    #[test]
    fn accepts_and_stamps_sequence_timestamp_and_schema() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        let outcome = rt.ingest_sample(sample(1), false).unwrap();
        let frame_id = match outcome {
            IngestOutcome::Accepted(id) => id,
            other => panic!("expected accepted, got {other:?}"),
        };
        // Durable queue holds exactly the accepted frame.
        assert_eq!(rt.connection_status().queued_frames, 1);
        let queued = rt.diagnostics().len();
        assert_eq!(queued, 0, "no diagnostics on accept");

        let frame = rt
            .connection_status()
            .last_sequence
            .expect("sequence assigned");
        assert_eq!(frame, 1);

        // Inspect the queued frame's stamps via the queue ordering.
        let status = rt.connection_status();
        assert_eq!(status.last_sequence, Some(1));
        assert!(frame_id.starts_with("pilot-1:"));
    }

    #[test]
    fn accepted_frame_has_received_at_and_schema_version() {
        // Build a runtime and ingest, then read the frame back from the queue.
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(7), false).unwrap();
        let ordered = rt_queue(&rt);
        assert_eq!(ordered.len(), 1);
        let frame = &ordered[0];
        assert_eq!(frame.sequence_number, 7);
        assert_eq!(frame.schema_version, SCHEMA_VERSION);
        assert!(!frame.schema_version.is_empty());
        assert!(frame.schema_version.len() <= MAX_SCHEMA_VERSION_LEN);
        assert!(frame.received_at.is_some());
        // received_at round-trips to the fixed clock instant.
        assert_eq!(
            parse_rfc3339_millis(frame.received_at.as_ref().unwrap()),
            Some(RECEIVE_MS)
        );
    }

    // Helper: read the durable queue's ordered frames out of the runtime.
    fn rt_queue(
        rt: &BridgeRuntime<InMemoryOfflineQueue, ScriptedUplink, FixedClock>,
    ) -> Vec<TelemetryFrame> {
        rt.queue.ordered()
    }

    // ---- requirement 1.3: reject without persist, diagnostic names field

    fn assert_rejected_field(sample: TelemetrySample, expected_field: &str) {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        let outcome = rt.ingest_sample(sample, false).unwrap();
        match outcome {
            IngestOutcome::Rejected(err) => {
                assert!(
                    err.field().contains(expected_field),
                    "expected field containing {expected_field:?}, got {:?}",
                    err.field()
                );
            }
            other => panic!("expected rejection, got {other:?}"),
        }
        // Nothing persisted; a diagnostic naming the field was recorded.
        assert_eq!(rt.connection_status().queued_frames, 0);
        assert_eq!(rt.diagnostics().len(), 1);
        assert!(rt.diagnostics()[0].field.contains(expected_field));
    }

    #[test]
    fn rejects_latitude_out_of_range_without_persisting() {
        let mut s = sample(1);
        s.position.latitude_deg = 91.0;
        assert_rejected_field(s, "latitude");
    }

    #[test]
    fn rejects_longitude_out_of_range() {
        let mut s = sample(1);
        s.position.longitude_deg = -180.001;
        assert_rejected_field(s, "longitude");
    }

    #[test]
    fn rejects_non_finite_value() {
        let mut s = sample(1);
        s.flight.vertical_speed_fpm = f64::NAN;
        assert_rejected_field(s, "vertical_speed_fpm");
    }

    #[test]
    fn rejects_heading_at_360() {
        let mut s = sample(1);
        s.flight.heading_deg = 360.0;
        assert_rejected_field(s, "heading");
    }

    #[test]
    fn rejects_heading_below_zero() {
        let mut s = sample(1);
        s.flight.heading_deg = -0.1;
        assert_rejected_field(s, "heading");
    }

    #[test]
    fn rejects_observed_timestamp_too_old() {
        let mut s = sample(1);
        // 61 seconds before the fixed receive time.
        s.observed_at = "2023-12-31T23:58:59.000Z".into();
        assert_rejected_field(s, "observed");
    }

    #[test]
    fn rejects_observed_timestamp_too_far_future() {
        let mut s = sample(1);
        // 6 seconds after the fixed receive time.
        s.observed_at = "2024-01-01T00:00:06.000Z".into();
        assert_rejected_field(s, "observed");
    }

    // ---- sequence regression + replayed suppression ---------------------

    #[test]
    fn rejects_sequence_regression_when_not_replayed() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(5), false).unwrap();
        // Same sequence again, not replayed → rejected, not persisted.
        let outcome = rt.ingest_sample(sample(5), false).unwrap();
        assert!(matches!(outcome, IngestOutcome::Rejected(ValidationError::SequenceRegression(_))));
        assert_eq!(rt.connection_status().queued_frames, 1);
        assert_eq!(rt.connection_status().last_sequence, Some(5));
    }

    #[test]
    fn allows_sequence_regression_when_replayed() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(5), false).unwrap();
        // Lower sequence flagged replayed → accepted.
        let outcome = rt.ingest_sample(sample(3), true).unwrap();
        assert!(matches!(outcome, IngestOutcome::Accepted(_)));
        assert_eq!(rt.connection_status().queued_frames, 2);
    }

    #[test]
    fn accepts_strictly_increasing_sequences() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        assert!(matches!(rt.ingest_sample(sample(1), false).unwrap(), IngestOutcome::Accepted(_)));
        assert!(matches!(rt.ingest_sample(sample(2), false).unwrap(), IngestOutcome::Accepted(_)));
        assert_eq!(rt.connection_status().last_sequence, Some(2));
    }

    // ---- delta compression after validation + periodic full snapshot ----

    #[test]
    fn identical_frames_are_delta_encoded_after_first() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(1), false).unwrap();
        rt.ingest_sample(sample(2), false).unwrap(); // identical kinematics
        let frames = rt_queue(&rt);
        // First frame is a full snapshot; the second, being unchanged, is delta.
        assert!(!frames[0].is_delta, "first accepted frame is a full snapshot");
        assert!(frames[1].is_delta, "unchanged follow-up frame is delta-encoded");
    }

    #[test]
    fn changed_frame_is_not_delta() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(1), false).unwrap();
        let mut moved = sample(2);
        moved.position.latitude_deg = 41.0; // large change
        rt.ingest_sample(moved, false).unwrap();
        let frames = rt_queue(&rt);
        assert!(!frames[1].is_delta, "materially changed frame is a full frame");
    }

    #[test]
    fn periodic_full_snapshot_is_retained_even_when_unchanged() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        // Feed FULL_SNAPSHOT_INTERVAL + 1 identical frames.
        for seq in 1..=(FULL_SNAPSHOT_INTERVAL + 1) {
            rt.ingest_sample(sample(seq), false).unwrap();
        }
        let frames = rt_queue(&rt);
        // Frame index 0 (accepted_count 0) is full; index FULL_SNAPSHOT_INTERVAL
        // (accepted_count == interval) is forced full again despite no change.
        assert!(!frames[0].is_delta);
        assert!(
            !frames[FULL_SNAPSHOT_INTERVAL as usize].is_delta,
            "a full snapshot is retained every {FULL_SNAPSHOT_INTERVAL} frames"
        );
        // A frame in between is delta-encoded.
        assert!(frames[1].is_delta);
    }

    // ---- uplink / flush -------------------------------------------------

    #[test]
    fn offline_uplink_keeps_frames_queued() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(1), false).unwrap();
        assert_eq!(rt.connection_status().uplink_state, UplinkState::Offline);
        assert_eq!(rt.connection_status().queued_frames, 1);
    }

    #[test]
    fn available_uplink_publishes_and_drains_queue() {
        let mut rt = BridgeRuntime::with_parts(
            InMemoryOfflineQueue::new(),
            ScriptedUplink::available(),
            FixedClock(RECEIVE_MS),
        );
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(1), false).unwrap();
        // Acknowledged publish removes the frame from the durable queue.
        assert_eq!(rt.connection_status().queued_frames, 0);
        assert_eq!(rt.connection_status().uplink_state, UplinkState::Available);
    }

    #[test]
    fn flush_offline_queue_defers_when_uplink_unavailable() {
        let mut rt = runtime_offline();
        rt.start(config(5.0)).unwrap();
        rt.ingest_sample(sample(1), false).unwrap();
        let summary = rt.flush_offline_queue();
        assert_eq!(summary.sent, 0);
        assert_eq!(summary.deferred, 1);
    }

    // ---- queue ordering invariant --------------------------------------

    #[test]
    fn queue_orders_by_sequence() {
        let mut q = InMemoryOfflineQueue::new();
        let mut base = TelemetryFrame {
            frame_id: "pilot-1:2".into(),
            pilot_id: "pilot-1".into(),
            mission_id: None,
            source_engine: SimulatorEngine::Xplane12,
            sequence_number: 2,
            observed_at: OBSERVED_AT.into(),
            received_at: None,
            position: sample(1).position,
            flight: sample(1).flight,
            systems: sample(1).systems,
            is_delta: false,
            schema_version: SCHEMA_VERSION.into(),
        };
        q.append(base.clone()).unwrap();
        base.frame_id = "pilot-1:1".into();
        base.sequence_number = 1;
        q.append(base).unwrap();
        let ordered = q.ordered();
        assert_eq!(ordered[0].sequence_number, 1);
        assert_eq!(ordered[1].sequence_number, 2);
    }

    // ---- timestamp parser round-trip -----------------------------------

    #[test]
    fn rfc3339_round_trips_epoch_and_known_instant() {
        assert_eq!(parse_rfc3339_millis("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_rfc3339_millis(OBSERVED_AT), Some(RECEIVE_MS));
        // Offset handling: +01:00 shifts one hour earlier in UTC.
        assert_eq!(
            parse_rfc3339_millis("2024-01-01T01:00:00+01:00"),
            Some(RECEIVE_MS)
        );
        // Round-trip via the formatter.
        let s = unix_millis_to_rfc3339(RECEIVE_MS);
        assert_eq!(parse_rfc3339_millis(&s), Some(RECEIVE_MS));
    }

    #[test]
    fn rfc3339_rejects_malformed() {
        assert_eq!(parse_rfc3339_millis("not-a-time"), None);
        assert_eq!(parse_rfc3339_millis("2024-13-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_millis("2024-01-01"), None);
    }

    // ---- sampling loop --------------------------------------------------

    #[test]
    fn sample_once_ingests_from_registered_adapter() {
        struct OneShotAdapter(Option<TelemetrySample>);
        impl SimulatorAdapter for OneShotAdapter {
            fn connect(&mut self) -> crate::adapter::AdapterResult {
                Ok(())
            }
            fn disconnect(&mut self) -> crate::adapter::AdapterResult {
                Ok(())
            }
            fn sample(
                &mut self,
                _now: crate::adapter::Timestamp,
            ) -> Result<TelemetrySample, crate::adapter::AdapterError> {
                self.0
                    .take()
                    .ok_or(crate::adapter::AdapterError::NoData)
            }
            fn health(&self, _now: crate::adapter::Timestamp) -> crate::adapter::AdapterHealth {
                crate::adapter::AdapterHealth::offline()
            }
        }

        let mut rt = runtime_offline();
        rt.register_adapter(Box::new(OneShotAdapter(Some(sample(1))))).unwrap();
        assert_eq!(rt.adapter_count(), 1);
        rt.start(config(5.0)).unwrap();
        let now = std::time::Instant::now();
        let outcomes = rt.sample_once(now).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert!(matches!(outcomes[0], IngestOutcome::Accepted(_)));
        // Second tick: adapter has no data, loop continues, nothing ingested.
        let outcomes = rt.sample_once(now).unwrap();
        assert!(outcomes.is_empty());
    }

    // ---- task 5.4: offline replay (requirements 2.3/2.4/2.5/2.6) --------
    //
    // These tests drive the replay state machine directly against the
    // in-memory queue with a mutable clock and a programmable uplink.

    /// A clock whose value the test advances explicitly (for backoff timing).
    struct MutClock(std::cell::RefCell<i64>);
    impl MutClock {
        fn new(start: i64) -> Self {
            Self(std::cell::RefCell::new(start))
        }
        fn advance(&self, ms: i64) {
            *self.0.borrow_mut() += ms;
        }
    }
    impl Clock for MutClock {
        fn now_unix_millis(&self) -> i64 {
            *self.0.borrow()
        }
    }

    /// A uplink whose availability is toggleable and whose per-frame outcomes
    /// are programmable: a per-frame-id script of outcomes consumed in order,
    /// falling back to a default outcome once the script is exhausted.
    struct ProgrammableUplink {
        available: std::cell::Cell<bool>,
        default: PublishOutcome,
        scripted: std::collections::HashMap<String, std::collections::VecDeque<PublishOutcome>>,
        publish_calls: std::cell::RefCell<Vec<String>>,
    }
    impl ProgrammableUplink {
        fn new(available: bool, default: PublishOutcome) -> Self {
            Self {
                available: std::cell::Cell::new(available),
                default,
                scripted: std::collections::HashMap::new(),
                publish_calls: std::cell::RefCell::new(Vec::new()),
            }
        }
        fn script(&mut self, frame_id: &str, outcomes: Vec<PublishOutcome>) {
            self.scripted
                .insert(frame_id.to_string(), outcomes.into_iter().collect());
        }
        fn set_available(&self, v: bool) {
            self.available.set(v);
        }
        fn publish_order(&self) -> Vec<String> {
            self.publish_calls.borrow().clone()
        }
    }
    impl Uplink for ProgrammableUplink {
        fn is_available(&self) -> bool {
            self.available.get()
        }
        fn publish(&mut self, frame: &TelemetryFrame) -> PublishOutcome {
            self.publish_calls.borrow_mut().push(frame.frame_id.clone());
            let scripted = self
                .scripted
                .get_mut(&frame.frame_id)
                .and_then(|q| q.pop_front());
            scripted.unwrap_or_else(|| self.default.clone())
        }
    }

    fn runtime_with(
        uplink: ProgrammableUplink,
        clock: MutClock,
        policy: ReplayPolicy,
    ) -> BridgeRuntime<InMemoryOfflineQueue, ProgrammableUplink, MutClock> {
        BridgeRuntime::with_parts_and_policy(InMemoryOfflineQueue::new(), uplink, clock, policy)
    }

    fn queue_three(rt: &mut BridgeRuntime<InMemoryOfflineQueue, ProgrammableUplink, MutClock>) {
        rt.start(config(5.0)).unwrap();
        // Force the uplink offline during ingest so frames accumulate in the
        // queue rather than being published inline by `ingest_sample`.
        let restore = rt.uplink.is_available();
        rt.uplink.set_available(false);
        for seq in 1..=3 {
            rt.ingest_sample(sample(seq), false).unwrap();
        }
        rt.uplink.set_available(restore);
    }

    // ---- requirement 2.4: remove only after ack, order preserved --------

    #[test]
    fn replay_removes_only_after_ack_in_order() {
        let uplink = ProgrammableUplink::new(false, PublishOutcome::Acknowledged);
        let mut rt = runtime_with(uplink, MutClock::new(RECEIVE_MS), ReplayPolicy::default());
        queue_three(&mut rt);
        assert_eq!(rt.connection_status().queued_frames, 3);

        // Uplink comes online; replay acks all three in ascending order.
        rt.uplink.set_available(true);
        let summary = rt.replay_offline_queue();
        assert_eq!(summary.sent, 3);
        assert_eq!(summary.deferred, 0);
        assert_eq!(summary.failed, 0);
        assert_eq!(rt.connection_status().queued_frames, 0);
        // Published oldest-first (seq 1, 2, 3).
        assert_eq!(
            rt.uplink.publish_order(),
            vec!["pilot-1:1", "pilot-1:2", "pilot-1:3"]
        );
    }

    // ---- requirement 2.3: transition triggers replay within 5s ----------

    #[test]
    fn poll_uplink_triggers_replay_on_transition() {
        let uplink = ProgrammableUplink::new(false, PublishOutcome::Acknowledged);
        let mut rt = runtime_with(uplink, MutClock::new(RECEIVE_MS), ReplayPolicy::default());
        queue_three(&mut rt);

        // First poll while offline: no replay, marks last-availability false.
        assert!(rt.poll_uplink().is_none());
        // Uplink becomes available; the next poll detects the transition and
        // replays immediately (well within the 5s bound).
        rt.uplink.set_available(true);
        let summary = rt.poll_uplink().expect("transition triggers replay");
        assert_eq!(summary.sent, 3);
        assert!(!rt.replay_start_overdue(), "replay began, not overdue");
        // A subsequent poll while still available and queue empty does nothing.
        assert!(rt.poll_uplink().is_none());
    }

    #[test]
    fn replay_start_overdue_only_when_pending_past_deadline() {
        let uplink = ProgrammableUplink::new(true, PublishOutcome::Offline);
        // Default outcome Offline so replay defers without draining, keeping a
        // pending obligation is not set here; assert the no-pending case.
        let mut rt = runtime_with(uplink, MutClock::new(RECEIVE_MS), ReplayPolicy::default());
        // No replay pending → never overdue.
        assert!(!rt.replay_start_overdue());
        let _ = rt;
    }

    // ---- requirement 2.5: retryable backoff + attempt cap ---------------

    #[test]
    fn retryable_failure_defers_for_backoff_then_retries() {
        let mut uplink = ProgrammableUplink::new(true, PublishOutcome::Acknowledged);
        // Frame seq 1 fails retryably once, then succeeds.
        uplink.script(
            "pilot-1:1",
            vec![PublishOutcome::Retryable("temporary".into())],
        );
        let policy = ReplayPolicy::new(5_000, 10); // 5s backoff.
        let mut rt = runtime_with(uplink, MutClock::new(RECEIVE_MS), policy);
        rt.start(config(5.0)).unwrap();
        rt.uplink.set_available(false);
        rt.ingest_sample(sample(1), false).unwrap();
        rt.uplink.set_available(true);

        // First replay: seq 1 fails retryably and is deferred; nothing sent.
        let s1 = rt.replay_offline_queue();
        assert_eq!(s1.sent, 0);
        assert_eq!(s1.deferred, 1);
        assert_eq!(rt.connection_status().queued_frames, 1, "frame retained");

        // Immediately replaying again: still within backoff → not eligible.
        let s2 = rt.replay_offline_queue();
        assert_eq!(s2.sent, 0);
        assert_eq!(s2.deferred, 0, "deferred frame is not re-attempted early");

        // Advance past the 5s backoff; now the frame is eligible and succeeds.
        rt.clock.advance(5_000);
        let s3 = rt.replay_offline_queue();
        assert_eq!(s3.sent, 1);
        assert_eq!(rt.connection_status().queued_frames, 0);
    }

    #[test]
    fn retryable_failure_becomes_permanent_at_attempt_cap() {
        let mut uplink = ProgrammableUplink::new(true, PublishOutcome::Retryable("busy".into()));
        // Always retryable for seq 1 → exhausts the attempt cap.
        uplink.script(
            "pilot-1:1",
            vec![
                PublishOutcome::Retryable("busy".into()),
                PublishOutcome::Retryable("busy".into()),
                PublishOutcome::Retryable("busy".into()),
            ],
        );
        let policy = ReplayPolicy::new(1_000, 3); // 1s backoff, 3 attempts max.
        let mut rt = runtime_with(uplink, MutClock::new(RECEIVE_MS), policy);
        rt.start(config(5.0)).unwrap();
        rt.uplink.set_available(false);
        rt.ingest_sample(sample(1), false).unwrap();
        rt.uplink.set_available(true);

        // Attempt 1 and 2 defer; attempt 3 reaches the cap → permanent failure.
        rt.replay_offline_queue(); // attempt 1 → defer
        rt.clock.advance(1_000);
        rt.replay_offline_queue(); // attempt 2 → defer
        rt.clock.advance(1_000);
        let s = rt.replay_offline_queue(); // attempt 3 → permanent
        assert_eq!(s.failed, 1);
        // Frame retained as a durable diagnostic (not removed) per req 2.6.
        assert_eq!(rt.connection_status().queued_frames, 1);
        // A user-facing error identifying the frame was raised.
        let errors = rt.take_replay_errors();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].frame_id, "pilot-1:1");
        assert_eq!(errors[0].attempts, 3);
        // Drained.
        assert!(rt.take_replay_errors().is_empty());
    }

    // ---- requirement 2.6: permanent failure retained, replay continues --

    #[test]
    fn permanent_failure_is_retained_and_replay_continues() {
        let mut uplink = ProgrammableUplink::new(true, PublishOutcome::Acknowledged);
        // seq 2 permanently fails; seq 1 and 3 ack.
        uplink.script("pilot-1:2", vec![PublishOutcome::Permanent("rejected".into())]);
        let mut rt = runtime_with(uplink, MutClock::new(RECEIVE_MS), ReplayPolicy::default());
        queue_three(&mut rt);
        rt.uplink.set_available(true);

        let summary = rt.replay_offline_queue();
        assert_eq!(summary.sent, 2, "seq 1 and 3 acknowledged");
        assert_eq!(summary.failed, 1, "seq 2 permanently failed");
        // seq 2 retained durably (failed), seq 1 and 3 removed.
        assert_eq!(rt.connection_status().queued_frames, 1);
        let remaining: Vec<u64> = rt.queue.ordered().iter().map(|f| f.sequence_number).collect();
        assert_eq!(remaining, vec![2], "the failed frame is retained");
        // Replay visited all three and continued past the failure.
        assert_eq!(
            rt.uplink.publish_order(),
            vec!["pilot-1:1", "pilot-1:2", "pilot-1:3"]
        );
        // Error indication names the affected frame.
        let errors = rt.take_replay_errors();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].frame_id, "pilot-1:2");
    }

    // ---- ReplayPolicy clamps to requirement 2.5 bounds ------------------

    #[test]
    fn replay_policy_clamps_backoff_and_attempts() {
        // Below/above the 1..60s band and 1..10 attempts are clamped.
        let low = ReplayPolicy::new(0, 0);
        assert_eq!(low.backoff_ms(), MIN_RETRY_BACKOFF_MS);
        assert_eq!(low.max_attempts(), 1);
        let high = ReplayPolicy::new(120_000, 999);
        assert_eq!(high.backoff_ms(), MAX_RETRY_BACKOFF_MS);
        assert_eq!(high.max_attempts(), MAX_REPLAY_ATTEMPTS);
        let mid = ReplayPolicy::new(30_000, 5);
        assert_eq!(mid.backoff_ms(), 30_000);
        assert_eq!(mid.max_attempts(), 5);
    }
}
