//! Durable SQLite offline ring buffer (design Sections 6.1/6.2, requirements
//! 2.1, 2.2, 2.8).
//!
//! [`SqliteOfflineQueue`] is the durable implementation of the
//! [`crate::runtime::OfflineQueue`] trait shipped as a placeholder by task 5.1
//! ([`crate::runtime::InMemoryOfflineQueue`]). It drops straight into
//! [`crate::runtime::BridgeRuntime`] because it implements the same trait, so
//! the runtime gains crash- and power-loss-durable persistence with no changes
//! to the ingest pipeline.
//!
//! ## What this module guarantees
//!
//! * **Durable append before transmit (requirement 2.1).** Every append is
//!   committed with `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = FULL`,
//!   so the record is flushed to durable storage (WAL + fsync) before
//!   [`SqliteOfflineQueue::append`] returns. The runtime calls `append` before
//!   any uplink attempt (see [`crate::runtime::BridgeRuntime::ingest_sample`]),
//!   so a frame survives a crash or host power loss mid-transmit.
//!
//! * **Ascending session-then-sequence order across restart (requirement 2.2).**
//!   Frames and mission events are persisted with an explicit `session_id`
//!   column and read back `ORDER BY session_id ASC, sequence_number ASC`. The
//!   ordering is a property of the query, not of in-memory state, so it holds
//!   identically after a process restart when the queue is reopened against the
//!   same database file.
//!
//! * **Capacity/backpressure without silent discard (requirement 2.8).** At the
//!   configured capacity the queue applies a [`RetentionPolicy`]
//!   ([`RetentionPolicy::DropOldest`] ring-buffer eviction or
//!   [`RetentionPolicy::RejectNewest`] backpressure). Either branch records a
//!   durable [`diagnostics`](SqliteOfflineQueue::diagnostics) row describing the
//!   retention action and raises a [`CapacityAlert`] the runtime/UI surfaces to
//!   the user. Records are never dropped without a durable diagnostic and an
//!   alert.
//!
//! ## Session identity
//!
//! The [`crate::runtime::OfflineQueue`] trait persists [`TelemetryFrame`]s,
//! which carry `pilot_id` and optional `mission_id` but no standalone
//! `session_id` field (see [`crate::telemetry`]). Requirement 2.2 orders "by
//! session identifier then sequence number". This module derives a stable
//! session key from the frame's `(pilot_id, mission_id)` — the same identity the
//! placeholder [`crate::runtime::InMemoryOfflineQueue`] scopes ordering by — and
//! stores it in the `session_id` column. When the runtime later threads an
//! explicit `BridgeSession::session_id` onto frames, only [`session_key`] needs
//! to change; the schema already keys on `session_id`.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension};

use crate::runtime::{BridgeError, OfflineQueue};
use crate::telemetry::TelemetryFrame;

/// The retention/backpressure policy applied when the queue is full
/// (requirement 2.8, design Section 6.7 "Queue capacity reached").
///
/// Both policies are non-silent: they record a durable diagnostic and raise a
/// [`CapacityAlert`]. They differ only in which record is sacrificed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionPolicy {
    /// Ring-buffer behavior: at capacity, evict the oldest record in
    /// (session, sequence) order to make room for the newest, then append.
    /// Favors the freshest telemetry (the live picture) over the stalest.
    DropOldest,
    /// Backpressure behavior: at capacity, reject the incoming record and keep
    /// the existing buffer intact. Favors the earliest recorded data and the
    /// integrity of an unbroken initial sequence.
    RejectNewest,
}

impl Default for RetentionPolicy {
    /// Ring-buffer drop-oldest is the design default (design Section 6.7:
    /// "retain oldest or highest-priority records"; the live operational picture
    /// prioritizes the freshest frames).
    fn default() -> Self {
        RetentionPolicy::DropOldest
    }
}

impl RetentionPolicy {
    fn as_str(self) -> &'static str {
        match self {
            RetentionPolicy::DropOldest => "DROP_OLDEST",
            RetentionPolicy::RejectNewest => "REJECT_NEWEST",
        }
    }
}

/// A user-facing alert raised when the capacity policy acts (requirement 2.8:
/// "present an alert to the user indicating that the capacity limit has been
/// reached"). The runtime forwards these to the Tauri/UI layer; they are also
/// mirrored durably in the diagnostics table so the record survives restart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapacityAlert {
    /// The policy that was applied.
    pub policy: RetentionPolicy,
    /// Configured maximum capacity that was reached.
    pub capacity: usize,
    /// `frame_id` of the record that was dropped (DropOldest) or rejected
    /// (RejectNewest).
    pub affected_frame_id: String,
    /// Human-readable message suitable for surfacing to the user.
    pub message: String,
}

/// A durable diagnostic entry (requirement 2.8 "record the retention action as
/// a durable diagnostic entry"; design 6.1 `record_bridge_diagnostic`). Stored
/// in its own table so it survives restart independently of the queued records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueDiagnostic {
    /// Monotonic row id assigned by SQLite.
    pub id: i64,
    /// Diagnostic category, e.g. `"capacity"`.
    pub kind: String,
    /// Human-readable detail describing the action taken.
    pub message: String,
    /// Cloud-receive-style wall clock is not available here; this is the Unix
    /// millisecond stamp recorded at write time via SQLite, or 0 if unavailable.
    pub recorded_at_millis: i64,
}

/// A persisted mission event (requirement 2.2: retain unsent "frames and
/// mission events"). Mission events share the ring buffer with frames and the
/// same (session, sequence) ordering so replay is a single ordered stream.
///
/// The full mission-event schema is owned by the cloud `mission_events` table
/// (design Section 5.1); this is the minimal durable envelope the bridge needs
/// to buffer an unsent event offline and replay it in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissionEvent {
    /// Stable idempotency identifier for the event.
    pub event_id: String,
    /// Session this event belongs to (same key space as frames).
    pub session_id: String,
    /// Ordering position within the session.
    pub sequence_number: u64,
    /// Source→target transition or event kind (design 6.3 mission events).
    pub kind: String,
    /// Opaque serialized payload (e.g. JSON) the cloud interprets.
    pub payload: String,
    /// ISO 8601 UTC event time.
    pub occurred_at: String,
}

/// Derive the session key used for ordering from a frame's identity
/// (requirement 2.2). See the module docs: `(pilot_id, mission_id)` is the
/// session scope until an explicit session id is threaded onto frames.
#[must_use]
pub fn session_key(frame: &TelemetryFrame) -> String {
    match &frame.mission_id {
        Some(mission) => format!("{}::{}", frame.pilot_id, mission),
        None => frame.pilot_id.clone(),
    }
}

/// The durable SQLite ring buffer.
///
/// Construct with [`SqliteOfflineQueue::open`] (a file path, for real durability)
/// or [`SqliteOfflineQueue::open_in_memory`] (tests). Configure capacity and
/// policy via [`SqliteOfflineQueue::with_capacity`].
pub struct SqliteOfflineQueue {
    conn: Connection,
    capacity: usize,
    policy: RetentionPolicy,
    /// Pending capacity alerts drained by the runtime and forwarded to the UI.
    pending_alerts: Vec<CapacityAlert>,
    /// Owned copy of the current oldest queued frame in (session, sequence)
    /// order. SQLite rows are not borrowable, but the [`OfflineQueue`] trait's
    /// `peek_oldest` returns a borrow, so we cache the oldest frame here and
    /// refresh it after every mutation. This lets the design 6.2 replay loop
    /// (task 5.4) call `peek_oldest` against the durable queue exactly as it
    /// does the in-memory one.
    cached_oldest: Option<TelemetryFrame>,
}

impl SqliteOfflineQueue {
    /// Open (creating if absent) a durable queue backed by the file at `path`.
    ///
    /// Applies the durability PRAGMAs (`journal_mode = WAL`,
    /// `synchronous = FULL`) and creates the schema. `capacity` is the maximum
    /// number of queued frames before the retention policy applies; `0` is
    /// treated as unbounded.
    pub fn open<P: AsRef<Path>>(
        path: P,
        capacity: usize,
        policy: RetentionPolicy,
    ) -> Result<Self, BridgeError> {
        let conn = Connection::open(path).map_err(Self::map_err)?;
        Self::from_connection(conn, capacity, policy)
    }

    /// Open an in-memory queue. Not durable across process restart — intended
    /// for unit tests of the ordering/capacity logic. Production callers use
    /// [`SqliteOfflineQueue::open`].
    pub fn open_in_memory(capacity: usize, policy: RetentionPolicy) -> Result<Self, BridgeError> {
        let conn = Connection::open_in_memory().map_err(Self::map_err)?;
        Self::from_connection(conn, capacity, policy)
    }

    /// Convenience: open a durable file queue with the default
    /// [`RetentionPolicy::DropOldest`] ring-buffer policy.
    pub fn with_capacity<P: AsRef<Path>>(path: P, capacity: usize) -> Result<Self, BridgeError> {
        Self::open(path, capacity, RetentionPolicy::default())
    }

    fn from_connection(
        conn: Connection,
        capacity: usize,
        policy: RetentionPolicy,
    ) -> Result<Self, BridgeError> {
        // Durability configuration (requirement 2.1: survive process restart AND
        // host power loss). WAL keeps writers from blocking readers and commits
        // atomically; synchronous=FULL fsyncs the WAL (and, at checkpoint, the
        // database) so a committed append is on stable storage before we return.
        //
        // NOTE: WAL is a persistent database property; setting it here also
        // covers a database created by a previous run. synchronous=FULL (not the
        // WAL-relaxed NORMAL) is the strict choice: it protects against host
        // power loss, which requirement 2.1 names explicitly, at the cost of an
        // extra fsync per commit — acceptable at 2–10 Hz.
        //
        // These run via `execute_batch` (not inside a transaction): SQLite
        // forbids changing `journal_mode` within an active transaction, and
        // `execute_batch` steps each statement individually, correctly consuming
        // the row `PRAGMA journal_mode=WAL` returns.
        conn.execute_batch(PRAGMA_SQL).map_err(Self::map_err)?;
        conn.execute_batch(SCHEMA_SQL).map_err(Self::map_err)?;
        // Bring a database created by an earlier schema (task 5.3, before replay
        // metadata existed) up to date. `CREATE TABLE IF NOT EXISTS` does not add
        // columns to an existing table, so add the replay columns idempotently;
        // an "duplicate column name" error means the column already exists and is
        // ignored (requirements 2.5/2.6).
        Self::ensure_replay_columns(&conn)?;

        let mut queue = Self {
            conn,
            capacity,
            policy,
            pending_alerts: Vec::new(),
            cached_oldest: None,
        };
        // Prime the oldest-frame cache from any frames already durable on disk
        // (e.g. after a restart), so `peek_oldest` is correct immediately.
        queue.refresh_oldest_cache()?;
        Ok(queue)
    }

    /// Reload the cached oldest frame from SQLite in (session, sequence) order.
    /// Called after every mutation so [`Self::peek_oldest`] returns a live
    /// borrow that matches the durable state.
    fn refresh_oldest_cache(&mut self) -> Result<(), BridgeError> {
        // The peek reflects the oldest UNSENT (non-failed) frame; failed frames
        // are retained durably (requirement 2.6) but are not next to replay.
        let payload: Option<String> = self
            .conn
            .query_row(
                "SELECT payload FROM offline_frame \
                 WHERE failed = 0 \
                 ORDER BY session_id ASC, sequence_number ASC, rowid ASC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Self::map_err)?;
        self.cached_oldest = match payload {
            Some(p) => Some(
                serde_json::from_str(&p)
                    .map_err(|e| BridgeError::Queue(format!("frame deserialize failed: {e}")))?,
            ),
            None => None,
        };
        Ok(())
    }

    /// Map any SQLite error onto the runtime's [`BridgeError::Queue`] variant so
    /// callers see a single queue-error type (design Section 4.2 `BridgeError`).
    fn map_err(err: rusqlite::Error) -> BridgeError {
        BridgeError::Queue(err.to_string())
    }

    /// Idempotently add the replay-metadata columns to `offline_frame` for
    /// databases created before they existed (requirements 2.5/2.6). SQLite has
    /// no `ADD COLUMN IF NOT EXISTS`, so each `ALTER TABLE` is attempted and a
    /// "duplicate column name" error (the column already exists) is treated as
    /// success. Any other error propagates.
    fn ensure_replay_columns(conn: &Connection) -> Result<(), BridgeError> {
        const ALTERS: [&str; 4] = [
            "ALTER TABLE offline_frame ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE offline_frame ADD COLUMN next_eligible_at_ms INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE offline_frame ADD COLUMN failed INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE offline_frame ADD COLUMN fail_reason TEXT",
        ];
        for stmt in ALTERS {
            match conn.execute(stmt, []) {
                Ok(_) => {}
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("duplicate column name") {
                        // Column already present from the current schema — fine.
                        continue;
                    }
                    return Err(Self::map_err(e));
                }
            }
        }
        Ok(())
    }

    /// Number of queued frames (excludes mission events and diagnostics).
    fn count_frames(&self) -> Result<usize, BridgeError> {
        let n: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM offline_frame", [], |row| row.get(0))
            .map_err(Self::map_err)?;
        Ok(n as usize)
    }

    /// Insert a frame row. Serializes the full frame as JSON in the `payload`
    /// column and mirrors the ordering keys into indexed columns.
    fn insert_frame(&self, frame: &TelemetryFrame) -> Result<(), BridgeError> {
        let payload = serde_json::to_string(frame)
            .map_err(|e| BridgeError::Queue(format!("frame serialize failed: {e}")))?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO offline_frame \
                 (frame_id, session_id, sequence_number, payload) \
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    frame.frame_id,
                    session_key(frame),
                    frame.sequence_number as i64,
                    payload
                ],
            )
            .map_err(Self::map_err)?;
        Ok(())
    }

    /// The oldest replay-eligible frame at `now_millis`: unsent (present),
    /// not marked failed, and past its backoff deadline, in ascending
    /// (session, sequence) order (requirements 2.5/2.6).
    fn read_oldest_eligible(&self, now_millis: i64) -> Result<Option<TelemetryFrame>, BridgeError> {
        let payload: Option<String> = self
            .conn
            .query_row(
                "SELECT payload FROM offline_frame \
                 WHERE failed = 0 AND next_eligible_at_ms <= ?1 \
                 ORDER BY session_id ASC, sequence_number ASC, rowid ASC LIMIT 1",
                rusqlite::params![now_millis],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Self::map_err)?;
        match payload {
            Some(p) => Ok(Some(
                serde_json::from_str(&p)
                    .map_err(|e| BridgeError::Queue(format!("frame deserialize failed: {e}")))?,
            )),
            None => Ok(None),
        }
    }

    /// The oldest frame's `frame_id` in (session, sequence) order, if any.
    fn oldest_frame_id(&self) -> Result<Option<String>, BridgeError> {
        self.conn
            .query_row(
                "SELECT frame_id FROM offline_frame \
                 ORDER BY session_id ASC, sequence_number ASC, rowid ASC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Self::map_err)
    }

    /// Record a durable diagnostic row (requirement 2.8).
    fn record_diagnostic(&self, kind: &str, message: &str) -> Result<(), BridgeError> {
        self.conn
            .execute(
                "INSERT INTO offline_diagnostic (kind, message, recorded_at_millis) \
                 VALUES (?1, ?2, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))",
                rusqlite::params![kind, message],
            )
            .map_err(Self::map_err)?;
        Ok(())
    }

    /// Apply the retention policy at capacity, recording a durable diagnostic
    /// and queueing a user alert (requirement 2.8). Returns `Ok(true)` when the
    /// caller should proceed to append the incoming `frame`, `Ok(false)` when
    /// the incoming frame was rejected by policy.
    fn apply_capacity_policy(&mut self, frame: &TelemetryFrame) -> Result<bool, BridgeError> {
        match self.policy {
            RetentionPolicy::DropOldest => {
                let evicted = self.oldest_frame_id()?;
                if let Some(evicted_id) = evicted {
                    self.conn
                        .execute(
                            "DELETE FROM offline_frame WHERE frame_id = ?1",
                            rusqlite::params![evicted_id],
                        )
                        .map_err(Self::map_err)?;
                    let message = format!(
                        "offline queue at capacity {}: dropped oldest frame {} \
                         to admit newest per DROP_OLDEST policy",
                        self.capacity, evicted_id
                    );
                    self.record_diagnostic("capacity", &message)?;
                    self.pending_alerts.push(CapacityAlert {
                        policy: self.policy,
                        capacity: self.capacity,
                        affected_frame_id: evicted_id,
                        message,
                    });
                }
                Ok(true)
            }
            RetentionPolicy::RejectNewest => {
                let message = format!(
                    "offline queue at capacity {}: rejected incoming frame {} \
                     per REJECT_NEWEST policy",
                    self.capacity, frame.frame_id
                );
                self.record_diagnostic("capacity", &message)?;
                self.pending_alerts.push(CapacityAlert {
                    policy: self.policy,
                    capacity: self.capacity,
                    affected_frame_id: frame.frame_id.clone(),
                    message,
                });
                Ok(false)
            }
        }
    }

    /// Durably append a mission event (requirement 2.2 — events, not only
    /// frames). Mission events share the (session, sequence) ordering with
    /// frames. Capacity policy applies to frames; events are small and always
    /// retained so mission history is never lost.
    pub fn append_event(&self, event: &MissionEvent) -> Result<(), BridgeError> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO offline_event \
                 (event_id, session_id, sequence_number, kind, payload, occurred_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    event.event_id,
                    event.session_id,
                    event.sequence_number as i64,
                    event.kind,
                    event.payload,
                    event.occurred_at
                ],
            )
            .map_err(Self::map_err)?;
        Ok(())
    }

    /// All buffered mission events in ascending (session, sequence) order.
    pub fn ordered_events(&self) -> Result<Vec<MissionEvent>, BridgeError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT event_id, session_id, sequence_number, kind, payload, occurred_at \
                 FROM offline_event \
                 ORDER BY session_id ASC, sequence_number ASC, rowid ASC",
            )
            .map_err(Self::map_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(MissionEvent {
                    event_id: row.get(0)?,
                    session_id: row.get(1)?,
                    sequence_number: row.get::<_, i64>(2)? as u64,
                    kind: row.get(3)?,
                    payload: row.get(4)?,
                    occurred_at: row.get(5)?,
                })
            })
            .map_err(Self::map_err)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(Self::map_err)?);
        }
        Ok(out)
    }

    /// Remove a mission event after acknowledgement.
    pub fn remove_event(&self, event_id: &str) -> Result<bool, BridgeError> {
        let n = self
            .conn
            .execute(
                "DELETE FROM offline_event WHERE event_id = ?1",
                rusqlite::params![event_id],
            )
            .map_err(Self::map_err)?;
        Ok(n > 0)
    }

    /// Drain the pending user-facing capacity alerts (requirement 2.8). The
    /// runtime calls this after appends to forward alerts to the UI. Alerts are
    /// also mirrored durably in [`Self::diagnostics`].
    pub fn take_alerts(&mut self) -> Vec<CapacityAlert> {
        std::mem::take(&mut self.pending_alerts)
    }

    /// All durable diagnostic rows in insertion order (requirement 2.8). Read
    /// back from SQLite so the entries survive restart.
    pub fn diagnostics(&self) -> Result<Vec<QueueDiagnostic>, BridgeError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, kind, message, recorded_at_millis \
                 FROM offline_diagnostic ORDER BY id ASC",
            )
            .map_err(Self::map_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(QueueDiagnostic {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    message: row.get(2)?,
                    recorded_at_millis: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                })
            })
            .map_err(Self::map_err)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(Self::map_err)?);
        }
        Ok(out)
    }

    /// The `frame_id`s of frames marked permanently failed, retained as durable
    /// diagnostics (requirement 2.6), in ascending (session, sequence) order.
    pub fn failed_frame_ids(&self) -> Result<Vec<String>, BridgeError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT frame_id FROM offline_frame WHERE failed = 1 \
                 ORDER BY session_id ASC, sequence_number ASC, rowid ASC",
            )
            .map_err(Self::map_err)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(Self::map_err)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(Self::map_err)?);
        }
        Ok(out)
    }

    /// The failure reason recorded for a frame, if it was marked failed
    /// (requirement 2.6).
    pub fn fail_reason(&self, frame_id: &str) -> Result<Option<String>, BridgeError> {
        self.conn
            .query_row(
                "SELECT fail_reason FROM offline_frame WHERE frame_id = ?1 AND failed = 1",
                rusqlite::params![frame_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(Self::map_err)
            .map(Option::flatten)
    }

    /// Read all queued frames in ascending (session, sequence) order. Shared by
    /// [`OfflineQueue::ordered`] and internal helpers.
    fn read_ordered(&self) -> Result<Vec<TelemetryFrame>, BridgeError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT payload FROM offline_frame \
                 ORDER BY session_id ASC, sequence_number ASC, rowid ASC",
            )
            .map_err(Self::map_err)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(Self::map_err)?;
        let mut out = Vec::new();
        for r in rows {
            let payload = r.map_err(Self::map_err)?;
            let frame: TelemetryFrame = serde_json::from_str(&payload)
                .map_err(|e| BridgeError::Queue(format!("frame deserialize failed: {e}")))?;
            out.push(frame);
        }
        Ok(out)
    }
}

/// Schema keyed for ascending (session, sequence) ordering (requirement 2.2).
///
/// * `offline_frame` — unsent telemetry frames; `payload` holds the full
///   serialized [`TelemetryFrame`]; `(session_id, sequence_number)` is indexed
///   for ordered reads and replay.
/// * `offline_event` — unsent mission events (requirement 2.2).
/// * `offline_diagnostic` — durable diagnostics, including capacity retention
///   actions (requirement 2.8).
/// Durability PRAGMAs (requirement 2.1). Applied outside any transaction; see
/// [`SqliteOfflineQueue::from_connection`].
const PRAGMA_SQL: &str = "\
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
";

const SCHEMA_SQL: &str = "\
CREATE TABLE IF NOT EXISTS offline_frame (
    frame_id             TEXT PRIMARY KEY,
    session_id           TEXT NOT NULL,
    sequence_number      INTEGER NOT NULL,
    payload              TEXT NOT NULL,
    attempts             INTEGER NOT NULL DEFAULT 0,
    next_eligible_at_ms  INTEGER NOT NULL DEFAULT 0,
    failed               INTEGER NOT NULL DEFAULT 0,
    fail_reason          TEXT
);
CREATE INDEX IF NOT EXISTS idx_offline_frame_order
    ON offline_frame (session_id ASC, sequence_number ASC);
-- Replay eligibility ordering (requirements 2.5/2.6): unsent, non-failed,
-- backoff-elapsed frames in ascending (session, sequence) order.
CREATE INDEX IF NOT EXISTS idx_offline_frame_eligible
    ON offline_frame (failed ASC, next_eligible_at_ms ASC, session_id ASC, sequence_number ASC);

CREATE TABLE IF NOT EXISTS offline_event (
    event_id        TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    kind            TEXT NOT NULL,
    payload         TEXT NOT NULL,
    occurred_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offline_event_order
    ON offline_event (session_id ASC, sequence_number ASC);

CREATE TABLE IF NOT EXISTS offline_diagnostic (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    kind               TEXT NOT NULL,
    message            TEXT NOT NULL,
    recorded_at_millis INTEGER
);
";

impl OfflineQueue for SqliteOfflineQueue {
    fn append(&mut self, frame: TelemetryFrame) -> Result<(), BridgeError> {
        // Capacity check BEFORE the durable insert (requirement 2.8). A capacity
        // of 0 means unbounded.
        if self.capacity > 0 {
            let count = self.count_frames()?;
            // If the frame_id already exists (idempotent re-append), INSERT OR
            // REPLACE will not grow the table, so only apply the policy when a
            // genuinely new row would exceed capacity.
            let exists: bool = self
                .conn
                .query_row(
                    "SELECT 1 FROM offline_frame WHERE frame_id = ?1",
                    rusqlite::params![frame.frame_id],
                    |_| Ok(true),
                )
                .optional()
                .map_err(Self::map_err)?
                .unwrap_or(false);

            if !exists && count >= self.capacity {
                let proceed = self.apply_capacity_policy(&frame)?;
                if !proceed {
                    // REJECT_NEWEST: the incoming frame is dropped, but a durable
                    // diagnostic and a user alert were recorded — never silent.
                    return Ok(());
                }
            }
        }

        self.insert_frame(&frame)?;
        // Keep the peek cache consistent with durable state.
        self.refresh_oldest_cache()?;
        Ok(())
    }

    fn peek_oldest(&self) -> Option<&TelemetryFrame> {
        // Backed by the cache refreshed on every mutation, so this borrow always
        // matches the durable (session, sequence) ordering.
        self.cached_oldest.as_ref()
    }

    fn remove(&mut self, frame_id: &str) -> bool {
        let removed = self
            .conn
            .execute(
                "DELETE FROM offline_frame WHERE frame_id = ?1",
                rusqlite::params![frame_id],
            )
            .map(|n| n > 0)
            .unwrap_or(false);
        if removed {
            // Best-effort cache refresh; on error, fall back to an empty cache so
            // we never return a stale/removed frame from `peek_oldest`.
            if self.refresh_oldest_cache().is_err() {
                self.cached_oldest = None;
            }
        }
        removed
    }

    fn len(&self) -> usize {
        self.count_frames().unwrap_or(0)
    }

    fn ordered(&self) -> Vec<TelemetryFrame> {
        self.read_ordered().unwrap_or_default()
    }

    fn oldest_eligible(&self, now_millis: i64) -> Option<TelemetryFrame> {
        // Oldest unsent, non-failed frame whose backoff has elapsed, in
        // ascending (session, sequence) order (requirements 2.5/2.6). The
        // eligibility index backs this read.
        self.read_oldest_eligible(now_millis).unwrap_or(None)
    }

    fn attempts(&self, frame_id: &str) -> u32 {
        self.conn
            .query_row(
                "SELECT attempts FROM offline_frame WHERE frame_id = ?1",
                rusqlite::params![frame_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .ok()
            .flatten()
            .map(|a| a.max(0) as u32)
            .unwrap_or(0)
    }

    fn defer(&mut self, frame_id: &str, next_eligible_at_millis: i64) {
        // Increment the attempt count and set the next-eligible instant
        // (requirement 2.5). Best-effort: a failed write leaves the frame at its
        // prior eligibility, which at worst retries sooner — never drops it.
        let _ = self.conn.execute(
            "UPDATE offline_frame \
             SET attempts = attempts + 1, next_eligible_at_ms = ?2 \
             WHERE frame_id = ?1",
            rusqlite::params![frame_id, next_eligible_at_millis],
        );
        if self.refresh_oldest_cache().is_err() {
            self.cached_oldest = None;
        }
    }

    fn mark_failed(&mut self, frame_id: &str, error: &str) -> bool {
        // Retain the frame as a durable diagnostic WITHOUT removing it
        // (requirement 2.6): set the failed flag and record the reason. Also
        // append a durable diagnostic row so the failure survives independently
        // of the frame row.
        let updated = self
            .conn
            .execute(
                "UPDATE offline_frame \
                 SET failed = 1, attempts = attempts + 1, fail_reason = ?2 \
                 WHERE frame_id = ?1",
                rusqlite::params![frame_id, error],
            )
            .map(|n| n > 0)
            .unwrap_or(false);
        if updated {
            let _ = self.record_diagnostic(
                "replay_permanent_failure",
                &format!("frame {frame_id} marked failed: {error}"),
            );
            // A failed frame is no longer replay-eligible; refresh the peek cache
            // so `peek_oldest` still points at an eligible unsent frame.
            if self.refresh_oldest_cache().is_err() {
                self.cached_oldest = None;
            }
        }
        updated
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{
        FlightVector, PositionVector, SimulatorEngine, SystemsVector, TelemetryFrame,
    };
    use crate::SCHEMA_VERSION;

    fn frame(pilot: &str, mission: Option<&str>, seq: u64) -> TelemetryFrame {
        TelemetryFrame {
            frame_id: format!("{pilot}:{}:{seq}", mission.unwrap_or("-")),
            pilot_id: pilot.to_string(),
            mission_id: mission.map(str::to_string),
            source_engine: SimulatorEngine::Xplane12,
            sequence_number: seq,
            observed_at: "2024-01-01T00:00:00.000Z".into(),
            received_at: Some("2024-01-01T00:00:00.000Z".into()),
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
            schema_version: SCHEMA_VERSION.into(),
        }
    }

    // ---- requirement 2.1: durable append, round-trip ------------------------

    #[test]
    fn append_persists_and_round_trips_frame() {
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        assert!(q.is_empty());
        let f = frame("pilot-1", Some("m1"), 1);
        q.append(f.clone()).unwrap();
        assert_eq!(q.len(), 1);
        let ordered = q.ordered();
        assert_eq!(ordered.len(), 1);
        assert_eq!(ordered[0], f);
    }

    #[test]
    fn durability_survives_reopen_of_same_file() {
        // A file-backed queue reopened against the same path must still hold the
        // appended frames in order (requirement 2.1: survive process restart).
        let dir = std::env::temp_dir();
        let path = dir.join(format!("vh-offline-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);

        {
            let mut q =
                SqliteOfflineQueue::open(&path, 0, RetentionPolicy::DropOldest).unwrap();
            q.append(frame("pilot-1", Some("m1"), 2)).unwrap();
            q.append(frame("pilot-1", Some("m1"), 1)).unwrap();
        } // queue dropped: simulates process exit.

        let q = SqliteOfflineQueue::open(&path, 0, RetentionPolicy::DropOldest).unwrap();
        let ordered = q.ordered();
        assert_eq!(ordered.len(), 2);
        // Ascending sequence order preserved across "restart".
        assert_eq!(ordered[0].sequence_number, 1);
        assert_eq!(ordered[1].sequence_number, 2);

        drop(q);
        let _ = std::fs::remove_file(&path);
    }

    // ---- requirement 2.2: ascending session-then-sequence order -------------

    #[test]
    fn orders_by_session_then_sequence() {
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        // Interleave sessions and sequences; expect ordering by session, then seq.
        q.append(frame("pilot-b", None, 2)).unwrap();
        q.append(frame("pilot-a", None, 5)).unwrap();
        q.append(frame("pilot-b", None, 1)).unwrap();
        q.append(frame("pilot-a", None, 1)).unwrap();

        let ordered = q.ordered();
        let keys: Vec<(String, u64)> = ordered
            .iter()
            .map(|f| (session_key(f), f.sequence_number))
            .collect();
        assert_eq!(
            keys,
            vec![
                ("pilot-a".to_string(), 1),
                ("pilot-a".to_string(), 5),
                ("pilot-b".to_string(), 1),
                ("pilot-b".to_string(), 2),
            ]
        );
    }

    #[test]
    fn remove_preserves_order_of_remaining() {
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        q.append(frame("p", None, 2)).unwrap();
        q.append(frame("p", None, 3)).unwrap();
        assert!(q.remove("p:-:2"));
        let seqs: Vec<u64> = q.ordered().iter().map(|f| f.sequence_number).collect();
        assert_eq!(seqs, vec![1, 3]);
        // Removing a missing id is a no-op returning false.
        assert!(!q.remove("does-not-exist"));
    }

    // ---- requirement 2.2: mission events buffered and ordered ---------------

    #[test]
    fn mission_events_persist_and_order() {
        let q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        q.append_event(&MissionEvent {
            event_id: "e2".into(),
            session_id: "s1".into(),
            sequence_number: 2,
            kind: "DISPATCHED->ENROUTE".into(),
            payload: "{}".into(),
            occurred_at: "2024-01-01T00:00:02.000Z".into(),
        })
        .unwrap();
        q.append_event(&MissionEvent {
            event_id: "e1".into(),
            session_id: "s1".into(),
            sequence_number: 1,
            kind: "PLANNED->DISPATCHED".into(),
            payload: "{}".into(),
            occurred_at: "2024-01-01T00:00:01.000Z".into(),
        })
        .unwrap();

        let events = q.ordered_events().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].sequence_number, 1);
        assert_eq!(events[1].sequence_number, 2);
        assert!(q.remove_event("e1").unwrap());
        assert_eq!(q.ordered_events().unwrap().len(), 1);
    }

    // ---- requirement 2.8: capacity policy, durable diagnostic, alert --------

    #[test]
    fn drop_oldest_evicts_and_records_diagnostic_and_alert() {
        let mut q = SqliteOfflineQueue::open_in_memory(2, RetentionPolicy::DropOldest).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        q.append(frame("p", None, 2)).unwrap();
        // Third append is at capacity: evict oldest (seq 1), admit seq 3.
        q.append(frame("p", None, 3)).unwrap();

        let seqs: Vec<u64> = q.ordered().iter().map(|f| f.sequence_number).collect();
        assert_eq!(seqs, vec![2, 3], "oldest evicted, newest admitted");
        assert_eq!(q.len(), 2, "capacity respected");

        // A durable diagnostic was recorded (survives restart).
        let diags = q.diagnostics().unwrap();
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].kind, "capacity");
        assert!(diags[0].message.contains("dropped oldest"));

        // A user alert was raised (not silent).
        let alerts = q.take_alerts();
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].policy, RetentionPolicy::DropOldest);
        assert_eq!(alerts[0].capacity, 2);
        // Alerts drained.
        assert!(q.take_alerts().is_empty());
    }

    #[test]
    fn reject_newest_keeps_buffer_and_records_diagnostic_and_alert() {
        let mut q = SqliteOfflineQueue::open_in_memory(2, RetentionPolicy::RejectNewest).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        q.append(frame("p", None, 2)).unwrap();
        // Third append at capacity: reject newest, keep 1 and 2.
        q.append(frame("p", None, 3)).unwrap();

        let seqs: Vec<u64> = q.ordered().iter().map(|f| f.sequence_number).collect();
        assert_eq!(seqs, vec![1, 2], "existing buffer retained, newest rejected");
        assert_eq!(q.len(), 2);

        let diags = q.diagnostics().unwrap();
        assert_eq!(diags.len(), 1);
        assert!(diags[0].message.contains("rejected incoming"));

        let alerts = q.take_alerts();
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].policy, RetentionPolicy::RejectNewest);
    }

    #[test]
    fn capacity_zero_is_unbounded() {
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        for seq in 1..=50 {
            q.append(frame("p", None, seq)).unwrap();
        }
        assert_eq!(q.len(), 50);
        assert!(q.diagnostics().unwrap().is_empty(), "no capacity action");
    }

    #[test]
    fn idempotent_reappend_does_not_trigger_capacity() {
        // Re-appending the same frame_id at capacity is an in-place replace and
        // must not evict/reject (idempotency, design 6.2).
        let mut q = SqliteOfflineQueue::open_in_memory(2, RetentionPolicy::DropOldest).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        q.append(frame("p", None, 2)).unwrap();
        q.append(frame("p", None, 2)).unwrap(); // same frame_id as seq 2
        assert_eq!(q.len(), 2);
        assert!(q.diagnostics().unwrap().is_empty());
    }

    // ---- peek_oldest reflects durable (session, sequence) order -------------

    #[test]
    fn peek_oldest_tracks_ordering_across_mutations() {
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        assert!(q.peek_oldest().is_none());
        q.append(frame("p", None, 3)).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        q.append(frame("p", None, 2)).unwrap();
        // Oldest is the lowest sequence in the session.
        assert_eq!(q.peek_oldest().unwrap().sequence_number, 1);
        // Removing the oldest advances the peek to the next in order.
        assert!(q.remove("p:-:1"));
        assert_eq!(q.peek_oldest().unwrap().sequence_number, 2);
        assert!(q.remove("p:-:2"));
        assert!(q.remove("p:-:3"));
        assert!(q.peek_oldest().is_none());
    }

    #[test]
    fn peek_oldest_is_primed_from_disk_on_reopen() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("vh-offline-peek-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let mut q = SqliteOfflineQueue::open(&path, 0, RetentionPolicy::DropOldest).unwrap();
            q.append(frame("p", None, 2)).unwrap();
            q.append(frame("p", None, 1)).unwrap();
        }
        // Reopened queue must expose the oldest frame without any prior append.
        let q = SqliteOfflineQueue::open(&path, 0, RetentionPolicy::DropOldest).unwrap();
        assert_eq!(q.peek_oldest().unwrap().sequence_number, 1);
        drop(q);
        let _ = std::fs::remove_file(&path);
    }

    // ---- requirement 2.8: no silent discard — every sacrificed frame is -----
    // ---- reconciled by exactly one durable diagnostic AND one alert ---------

    #[test]
    fn drop_oldest_reconciles_every_eviction_with_a_diagnostic_and_alert() {
        // Push well past capacity and prove the counts reconcile: with capacity
        // C and N appended frames, exactly (N - C) frames are evicted, and each
        // eviction produced exactly one durable diagnostic and one alert. No
        // frame leaves the buffer without being accounted for (requirement 2.8:
        // "rather than silently discarding records").
        let capacity = 3usize;
        let appended = 10u64;
        let mut q =
            SqliteOfflineQueue::open_in_memory(capacity, RetentionPolicy::DropOldest).unwrap();
        for seq in 1..=appended {
            q.append(frame("p", None, seq)).unwrap();
        }

        let expected_evictions = appended as usize - capacity; // 7
        assert_eq!(q.len(), capacity, "buffer never exceeds capacity");

        // One durable diagnostic per eviction, all categorized as capacity.
        let diags = q.diagnostics().unwrap();
        assert_eq!(
            diags.len(),
            expected_evictions,
            "one durable diagnostic per evicted frame"
        );
        assert!(diags.iter().all(|d| d.kind == "capacity"));
        assert!(diags.iter().all(|d| d.message.contains("dropped oldest")));

        // One alert per eviction, each naming the specific evicted frame_id.
        let alerts = q.take_alerts();
        assert_eq!(
            alerts.len(),
            expected_evictions,
            "one user alert per evicted frame"
        );
        // The evicted frames are the oldest sequences 1..=7; their frame_ids
        // must be exactly the affected_frame_ids reported by the alerts. This is
        // the reconciliation: dropped ∪ retained == everything appended.
        let evicted_ids: std::collections::BTreeSet<String> =
            alerts.iter().map(|a| a.affected_frame_id.clone()).collect();
        let expected_evicted_ids: std::collections::BTreeSet<String> =
            (1..=expected_evictions as u64)
                .map(|seq| frame("p", None, seq).frame_id)
                .collect();
        assert_eq!(
            evicted_ids, expected_evicted_ids,
            "every evicted frame is accounted for by an alert, none silently lost"
        );
        // What remains in the buffer is exactly the newest `capacity` frames,
        // and it is disjoint from the evicted set — nothing double-counted, and
        // (evicted ∪ retained) covers all appended frames.
        let retained_ids: std::collections::BTreeSet<String> =
            q.ordered().iter().map(|f| f.frame_id.clone()).collect();
        assert!(retained_ids.is_disjoint(&evicted_ids));
        assert_eq!(retained_ids.len(), capacity);
        let mut all_accounted = evicted_ids.clone();
        all_accounted.extend(retained_ids);
        assert_eq!(
            all_accounted.len(),
            appended as usize,
            "evicted + retained accounts for every appended frame"
        );
        assert!(q.take_alerts().is_empty(), "alerts drained after read");
    }

    #[test]
    fn reject_newest_reconciles_every_rejection_with_a_diagnostic_and_alert() {
        // Symmetric to DropOldest: the buffer keeps its original C frames, and
        // every one of the (N - C) newer frames that is refused produces exactly
        // one durable diagnostic and one alert naming the rejected frame — never
        // a silent drop (requirement 2.8).
        let capacity = 3usize;
        let appended = 10u64;
        let mut q =
            SqliteOfflineQueue::open_in_memory(capacity, RetentionPolicy::RejectNewest).unwrap();
        for seq in 1..=appended {
            q.append(frame("p", None, seq)).unwrap();
        }

        let expected_rejections = appended as usize - capacity; // 7
        assert_eq!(q.len(), capacity, "buffer never exceeds capacity");
        // The first `capacity` frames are retained intact under backpressure.
        let retained_seqs: Vec<u64> =
            q.ordered().iter().map(|f| f.sequence_number).collect();
        assert_eq!(retained_seqs, vec![1, 2, 3]);

        let diags = q.diagnostics().unwrap();
        assert_eq!(diags.len(), expected_rejections);
        assert!(diags.iter().all(|d| d.kind == "capacity"));
        assert!(diags.iter().all(|d| d.message.contains("rejected incoming")));

        let alerts = q.take_alerts();
        assert_eq!(alerts.len(), expected_rejections);
        assert!(alerts
            .iter()
            .all(|a| a.policy == RetentionPolicy::RejectNewest && a.capacity == capacity));
        // The rejected frames are exactly the newest sequences 4..=10.
        let rejected_ids: std::collections::BTreeSet<String> =
            alerts.iter().map(|a| a.affected_frame_id.clone()).collect();
        let expected_rejected_ids: std::collections::BTreeSet<String> = (capacity as u64 + 1
            ..=appended)
            .map(|seq| frame("p", None, seq).frame_id)
            .collect();
        assert_eq!(
            rejected_ids, expected_rejected_ids,
            "every rejected frame is accounted for by an alert, none silently lost"
        );
    }

    #[test]
    fn capacity_diagnostics_are_durable_across_reopen() {
        // Requirement 2.8 requires the retention action to be a *durable*
        // diagnostic. Prove the diagnostic rows survive a process restart by
        // reopening the same file and reading them back. (Alerts are transient
        // UI signals drained via take_alerts; the durable record is the
        // diagnostic row.)
        let dir = std::env::temp_dir();
        let path = dir.join(format!("vh-offline-cap-diag-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let mut q =
                SqliteOfflineQueue::open(&path, 2, RetentionPolicy::DropOldest).unwrap();
            q.append(frame("p", None, 1)).unwrap();
            q.append(frame("p", None, 2)).unwrap();
            q.append(frame("p", None, 3)).unwrap(); // forces one eviction
            assert_eq!(q.diagnostics().unwrap().len(), 1);
        } // dropped: simulates process exit.

        let q = SqliteOfflineQueue::open(&path, 2, RetentionPolicy::DropOldest).unwrap();
        let diags = q.diagnostics().unwrap();
        assert_eq!(diags.len(), 1, "capacity diagnostic survives restart");
        assert_eq!(diags[0].kind, "capacity");
        assert!(diags[0].message.contains("dropped oldest"));
        drop(q);
        let _ = std::fs::remove_file(&path);
    }

    // ---- OfflineQueue trait drop-in ----------------------------------------

    #[test]
    fn implements_offline_queue_trait() {
        fn assert_impl<Q: OfflineQueue>(_q: &Q) {}
        let q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        assert_impl(&q);
    }

    // ---- task 5.4: replay metadata (requirements 2.5/2.6) ------------------

    #[test]
    fn defer_records_attempt_and_backoff_eligibility() {
        // A deferred frame is not eligible until its backoff instant passes
        // (requirement 2.5). Attempt count is tracked durably.
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        let id = "p:-:1";
        assert_eq!(q.attempts(id), 0);

        // Defer until t=1000; at t=0 and t=999 the frame is not eligible.
        q.defer(id, 1_000);
        assert_eq!(q.attempts(id), 1);
        assert!(q.oldest_eligible(0).is_none());
        assert!(q.oldest_eligible(999).is_none());
        // At/after the backoff instant it becomes eligible again.
        assert_eq!(q.oldest_eligible(1_000).unwrap().sequence_number, 1);
    }

    #[test]
    fn mark_failed_retains_frame_and_excludes_from_eligible() {
        // A permanently failed frame is retained in durable storage as a
        // diagnostic (requirement 2.6) but is no longer replay-eligible.
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        q.append(frame("p", None, 2)).unwrap();
        assert!(q.mark_failed("p:-:1", "server rejected"));

        // Frame is still present in durable storage.
        assert_eq!(q.len(), 2);
        assert_eq!(q.failed_frame_ids().unwrap(), vec!["p:-:1".to_string()]);
        assert_eq!(q.fail_reason("p:-:1").unwrap().as_deref(), Some("server rejected"));
        // A durable diagnostic row was recorded.
        let diags = q.diagnostics().unwrap();
        assert!(diags.iter().any(|d| d.kind == "replay_permanent_failure"));

        // The failed frame is skipped by eligibility; the next frame is oldest.
        assert_eq!(q.oldest_eligible(0).unwrap().sequence_number, 2);
        // peek_oldest also skips the failed frame.
        assert_eq!(q.peek_oldest().unwrap().sequence_number, 2);
        // Marking a missing frame returns false.
        assert!(!q.mark_failed("nope", "x"));
    }

    #[test]
    fn oldest_eligible_orders_by_session_then_sequence_skipping_deferred() {
        let mut q = SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
        q.append(frame("p", None, 1)).unwrap();
        q.append(frame("p", None, 2)).unwrap();
        q.append(frame("p", None, 3)).unwrap();
        // Defer seq 1 into the future: seq 2 becomes the oldest eligible.
        q.defer("p:-:1", 10_000);
        assert_eq!(q.oldest_eligible(0).unwrap().sequence_number, 2);
        // Mark seq 2 failed: seq 3 becomes oldest eligible.
        assert!(q.mark_failed("p:-:2", "perm"));
        assert_eq!(q.oldest_eligible(0).unwrap().sequence_number, 3);
    }

    #[test]
    fn replay_metadata_survives_reopen() {
        // Attempt count, backoff, and failed flag are durable across restart
        // (requirements 2.5/2.6).
        let dir = std::env::temp_dir();
        let path = dir.join(format!("vh-offline-replay-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let mut q = SqliteOfflineQueue::open(&path, 0, RetentionPolicy::DropOldest).unwrap();
            q.append(frame("p", None, 1)).unwrap();
            q.append(frame("p", None, 2)).unwrap();
            q.defer("p:-:1", 50_000);
            q.mark_failed("p:-:2", "gone");
        }
        let q = SqliteOfflineQueue::open(&path, 0, RetentionPolicy::DropOldest).unwrap();
        assert_eq!(q.attempts("p:-:1"), 1);
        assert!(q.oldest_eligible(0).is_none(), "seq1 deferred, seq2 failed");
        assert_eq!(q.oldest_eligible(50_000).unwrap().sequence_number, 1);
        assert_eq!(q.failed_frame_ids().unwrap(), vec!["p:-:2".to_string()]);
        drop(q);
        let _ = std::fs::remove_file(&path);
    }
}
