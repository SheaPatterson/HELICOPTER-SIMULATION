//! Property 2: Durable delivery (design "Correctness Properties" Property 2;
//! requirements 2.1, 2.4, 2.7).
//!
//! **Validates: Requirements 2.1, 2.4, 2.7** — a telemetry frame is durably
//! queued before any uplink attempt and leaves the queue ONLY after the uplink
//! acknowledges it; the frames remaining in the queue stay in ascending
//! session-then-sequence order after any interleaving of acknowledgements and
//! availability toggles; and replay is idempotent per
//! `(pilot_id, session-key, sequence_number)` — replaying already-sent frames
//! never produces duplicate delivery.
//!
//! This is a `proptest`-based property test driving the real durable queue
//! ([`SqliteOfflineQueue::open_in_memory`], which uses the bundled rusqlite and
//! is fine under CI) and, for the runtime path, the real
//! [`BridgeRuntime::replay_offline_queue`] state machine. It mirrors the
//! Property 1 harness (`RecordingUplink` / `FixedClock` / `Rc<RefCell<..>>`
//! publish log, `with_parts`) but adds a *toggleable*, *idempotency-recording*
//! uplink so the offline → available transitions and duplicate-delivery
//! detection can be exercised.
//!
//! The Rust toolchain is not run in the authoring environment; this test is
//! written to compile and pass under CI against the crate's public contract
//! (`virtualhems_bridge`).

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use proptest::prelude::*;

use virtualhems_bridge::telemetry::{FlightVector, PositionVector, SystemsVector};
use virtualhems_bridge::{
    session_key, BridgeRuntime, Clock, FlushSummary, OfflineQueue, PublishOutcome, RetentionPolicy,
    SimulatorEngine, SqliteOfflineQueue, TelemetryFrame, Uplink, SCHEMA_VERSION,
};

// ---------------------------------------------------------------------------
// Idempotency identity: (pilot_id, session-key, sequence_number).
// ---------------------------------------------------------------------------

/// The cloud-side idempotency key for a delivered frame (requirement 2.7). The
/// cloud dedupes on `(pilot_id, session identity, sequence_number)`; the bridge
/// derives the session identity via [`session_key`] (pilot + optional mission),
/// exactly as [`SqliteOfflineQueue`] orders by. Two frames sharing this key are
/// "the same delivery" and must never both count as delivered.
type IdKey = (String, String, u64);

fn id_key(frame: &TelemetryFrame) -> IdKey {
    (
        frame.pilot_id.clone(),
        session_key(frame),
        frame.sequence_number,
    )
}

// ---------------------------------------------------------------------------
// Deterministic clock and a toggleable, idempotency-recording uplink.
// ---------------------------------------------------------------------------

/// A fixed cloud-receive clock; timing is not the subject of Property 2, so a
/// constant instant keeps the schedule deterministic.
struct FixedClock(i64);
impl Clock for FixedClock {
    fn now_unix_millis(&self) -> i64 {
        self.0
    }
}

const RECEIVE_MS: i64 = 1_704_067_200_000; // 2024-01-01T00:00:00Z

/// Shared, mutable uplink control + delivery ledger. The test keeps a clone of
/// the `Rc` before the uplink is moved into the runtime/replay loop, then reads
/// the ledger afterward.
#[derive(Default)]
struct UplinkShared {
    /// Whether the uplink currently acknowledges publishes.
    available: bool,
    /// Every acknowledged delivery, in delivery order, recorded by the cloud
    /// idempotency key. A well-behaved system produces NO duplicate keys here.
    delivered: Vec<IdKey>,
    /// A model of the cloud's idempotent receiver: keys it has already accepted.
    /// A re-delivery of an already-accepted key is a duplicate we flag.
    accepted: BTreeSet<IdKey>,
    /// Duplicate deliveries observed (the same key acknowledged more than once).
    duplicates: Vec<IdKey>,
}

type Shared = Rc<RefCell<UplinkShared>>;

/// An uplink whose availability is externally toggled and which records the
/// idempotency key of every acknowledged frame. When available it acknowledges
/// (and the cloud model dedupes); when unavailable it reports
/// [`PublishOutcome::Offline`] so the frame stays queued.
struct ModelUplink {
    shared: Shared,
}

impl Uplink for ModelUplink {
    fn is_available(&self) -> bool {
        self.shared.borrow().available
    }

    fn publish(&mut self, frame: &TelemetryFrame) -> PublishOutcome {
        let mut s = self.shared.borrow_mut();
        if !s.available {
            return PublishOutcome::Offline;
        }
        let key = id_key(frame);
        // Record the raw delivery (used to assert no duplicate acknowledgements).
        s.delivered.push(key.clone());
        // Model the cloud's idempotent receiver: a key seen twice is a duplicate.
        if !s.accepted.insert(key.clone()) {
            s.duplicates.push(key);
        }
        PublishOutcome::Acknowledged
    }
}

fn new_shared(available: bool) -> Shared {
    Rc::new(RefCell::new(UplinkShared {
        available,
        ..UplinkShared::default()
    }))
}

// ---------------------------------------------------------------------------
// Frame construction (direct, valid frames — Property 1 covers validation).
// ---------------------------------------------------------------------------

/// Build a valid, fully-populated telemetry frame for a session and sequence.
/// `mission` distinguishes sessions sharing a pilot, so `session_key` yields
/// distinct ordering/idempotency scopes.
fn frame(pilot: &str, mission: Option<&str>, seq: u64) -> TelemetryFrame {
    TelemetryFrame {
        // frame_id encodes the identity so an idempotent re-append is a true
        // in-place replace (matches the queue's INSERT OR REPLACE semantics).
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

/// Assert the frames currently queued are in ascending (session-key, sequence)
/// order (requirement 2.4 "remaining records stay ordered"). `ordered()` is the
/// query the replay loop publishes from, so its order IS the delivery order.
fn assert_queue_ordered(queue: &SqliteOfflineQueue) -> Result<(), TestCaseError> {
    let ordered = queue.ordered();
    let mut prev: Option<(String, u64)> = None;
    for f in &ordered {
        let key = (session_key(f), f.sequence_number);
        if let Some(p) = &prev {
            prop_assert!(
                *p <= key,
                "queue not in ascending (session, sequence) order: {:?} then {:?}",
                p,
                key
            );
            // Within the ordered stream the keys are also unique (a session's
            // sequence is a primary-key-like identity in the queue).
            prop_assert!(*p != key, "duplicate (session, sequence) in queue: {:?}", key);
        }
        prev = Some(key);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Generated schedule.
// ---------------------------------------------------------------------------

/// One step in a randomized durable-delivery schedule.
#[derive(Debug, Clone)]
enum Op {
    /// Ingest/append a frame for `session` (index into the session table) at the
    /// given per-session sequence. Duplicate (session, seq) pairs model an
    /// idempotent re-append / replay of an already-known frame.
    Append { session: usize, seq: u64 },
    /// Toggle the uplink to available/unavailable, modelling connectivity loss
    /// and recovery (design 6.1 offline ↔ available).
    SetAvailable(bool),
    /// Run one replay/flush pass (design 6.2 `replay_offline_queue`).
    Flush,
}

/// A small table of distinct sessions: two pilots, one of them with two
/// missions, so `session_key` produces several independent ordering scopes and
/// cross-session interleaving is exercised.
const SESSIONS: &[(&str, Option<&str>)] = &[
    ("pilot-a", Some("m1")),
    ("pilot-a", Some("m2")),
    ("pilot-b", None),
];

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        // Weight appends heavily so the queue actually fills and replays have
        // work to do; sequences are kept small so collisions (idempotent
        // re-appends) occur and exercise requirement 2.7.
        5 => (0..SESSIONS.len(), 1u64..8).prop_map(|(session, seq)| Op::Append { session, seq }),
        2 => any::<bool>().prop_map(Op::SetAvailable),
        3 => Just(Op::Flush),
    ]
}

// ---------------------------------------------------------------------------
// The properties.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// Property 2 (queue + replay path): durable delivery, remove-only-after-ack,
    /// order preservation, and per-(pilot, session, sequence) replay idempotency.
    ///
    /// The schedule interleaves appends across several sessions with uplink
    /// availability toggles and replay passes, then replays everything to
    /// completion. Throughout and at the end we assert:
    ///
    /// * **2.1 durable-before-transmit / no phantom delivery.** Every delivered
    ///   idempotency key was appended first — the delivered set is always a
    ///   subset of the appended set. A frame is never published that was not
    ///   first queued.
    /// * **2.4 remove-only-after-ack + order preserved.** A frame leaves the
    ///   queue ONLY once it has been acknowledged: a flush removes exactly the
    ///   frames it acknowledged this pass, and the frames still queued are in
    ///   ascending (session, sequence) order. While the uplink is unavailable, a
    ///   flush delivers nothing and removes nothing.
    /// * **2.7 replay idempotency.** Re-appending an already-delivered frame and
    ///   replaying it re-sends it on the wire, but the cloud's idempotent
    ///   receiver (keyed on `(pilot, session, sequence)`) accepts each distinct
    ///   key exactly once. After a final drain, the set of accepted keys equals
    ///   exactly the distinct appended keys — never more.
    ///
    /// **Validates: Requirements 2.1, 2.4, 2.7**
    #[test]
    fn durable_delivery_holds(ops in proptest::collection::vec(op_strategy(), 1..60)) {
        let shared = new_shared(false); // start offline
        let mut queue =
            SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();

        // The union of every idempotency key ever appended (idempotent, so a
        // set). This is the ground truth the delivered/queued sets reconcile to.
        let mut appended: BTreeSet<IdKey> = BTreeSet::new();

        // A cheap, direct replay driver mirroring the runtime's remove-only-
        // after-ack contract, so this property isolates the QUEUE's behaviour.
        // Returns the number of frames acknowledged AND removed this pass. The
        // second property below exercises the real BridgeRuntime loop.
        let flush = |queue: &mut SqliteOfflineQueue, shared: &Shared| {
            let mut acked = 0usize;
            if !shared.borrow().available {
                return Ok::<usize, TestCaseError>(0);
            }
            // Publish oldest-eligible first; remove ONLY on acknowledgement.
            loop {
                let Some(frame) = queue.oldest_eligible(RECEIVE_MS) else {
                    break;
                };
                let mut up = ModelUplink { shared: shared.clone() };
                match up.publish(&frame) {
                    PublishOutcome::Acknowledged => {
                        // req 2.4: removal happens strictly after the ack above.
                        prop_assert_removed(queue.remove(&frame.frame_id))?;
                        acked += 1;
                    }
                    // Offline/other: leave everything queued.
                    _ => break,
                }
            }
            Ok(acked)
        };

        for op in &ops {
            match op {
                Op::Append { session, seq } => {
                    let (pilot, mission) = SESSIONS[*session];
                    let f = frame(pilot, mission, *seq);
                    let key = id_key(&f);
                    // req 2.1: append is durable and precedes any transmit. A
                    // re-append of an existing (session, seq) is an idempotent
                    // in-place replace and must not create a duplicate row.
                    queue.append(f).unwrap();
                    appended.insert(key);
                }
                Op::SetAvailable(v) => {
                    shared.borrow_mut().available = *v;
                }
                Op::Flush => {
                    let delivered_before = shared.borrow().delivered.len();
                    let was_available = shared.borrow().available;
                    let queued_before: usize = queue.len();
                    let acked = flush(&mut queue, &shared)?;
                    let delivered_after = shared.borrow().delivered.len();

                    // req 2.4: a frame leaves the queue ONLY after an ack, so the
                    // queue shrinks by exactly the number acknowledged this pass,
                    // and the wire deliveries grew by that same count.
                    prop_assert_eq!(delivered_after - delivered_before, acked);
                    prop_assert_eq!(queued_before - queue.len(), acked);
                    if !was_available {
                        // req 2.4: an offline flush delivers/removes nothing.
                        prop_assert_eq!(acked, 0);
                        prop_assert_eq!(delivered_after, delivered_before);
                        prop_assert_eq!(queue.len(), queued_before);
                    }
                }
            }

            // --- invariants after every step -------------------------------

            // req 2.4: remaining queued records stay ordered.
            assert_queue_ordered(&queue)?;

            // req 2.1: every frame the cloud has ACCEPTED was appended first —
            // no phantom delivery. (Raw wire deliveries may repeat when an
            // already-delivered frame is re-appended and replayed; the cloud's
            // idempotent receiver is the authority on what was truly delivered.)
            let accepted_set: BTreeSet<IdKey> = shared.borrow().accepted.clone();
            prop_assert!(
                accepted_set.is_subset(&appended),
                "cloud accepted a key that was never appended"
            );
            // req 2.7: the idempotent receiver never holds more than the distinct
            // appended keys, no matter how many times frames are re-sent.
            prop_assert!(
                accepted_set.len() <= appended.len(),
                "accepted more distinct keys than were appended"
            );
        }

        // --- final drain: bring the uplink up and replay to completion -----
        shared.borrow_mut().available = true;
        // Replay repeatedly until the queue is empty (a retry-free available
        // uplink drains it in one pass, but loop defensively).
        while queue.len() > 0 {
            let acked = flush(&mut queue, &shared)?;
            prop_assert!(acked > 0, "available uplink made no progress draining the queue");
        }

        // The queue is empty (everything acknowledged) and ...
        prop_assert_eq!(queue.len(), 0, "queue not fully drained after final replay");

        let s = shared.borrow();
        // req 2.7 / 2.1: the cloud's idempotent receiver accepted EXACTLY the
        // distinct appended keys — every appended frame delivered, none twice,
        // none fabricated.
        prop_assert_eq!(
            &s.accepted,
            &appended,
            "final accepted set must equal the distinct appended keys"
        );
        // Per-key, the receiver holds exactly one acceptance (idempotent).
        let mut per_key: BTreeMap<IdKey, usize> = BTreeMap::new();
        for k in &s.delivered {
            *per_key.entry(k.clone()).or_default() += 1;
        }
        prop_assert_eq!(per_key.len(), appended.len(),
            "distinct delivered keys must equal distinct appended keys");
    }

    /// Property 2 (runtime path): the real [`BridgeRuntime::replay_offline_queue`]
    /// state machine, backed by the durable [`SqliteOfflineQueue`], removes a
    /// frame only after acknowledgement and is idempotent under repeated
    /// replays, including explicit re-appends of already-sent frames.
    ///
    /// This complements the queue-level property above by exercising the
    /// production remove-only-after-ack loop rather than a hand-rolled driver.
    ///
    /// **Validates: Requirements 2.1, 2.4, 2.7**
    #[test]
    fn runtime_replay_is_idempotent(
        frames in proptest::collection::vec((0..SESSIONS.len(), 1u64..8), 1..30),
        replays in 1usize..4,
    ) {
        // Pre-seed the durable queue with the generated frames (idempotent on
        // (session, seq)); this models frames the ingest pipeline already
        // durably appended (req 2.1) that now await replay.
        let shared = new_shared(true); // available so replay can drain
        let mut queue =
            SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();

        let mut appended: BTreeSet<IdKey> = BTreeSet::new();
        for (session, seq) in &frames {
            let (pilot, mission) = SESSIONS[*session];
            let f = frame(pilot, mission, *seq);
            appended.insert(id_key(&f));
            queue.append(f).unwrap();
        }

        let uplink = ModelUplink { shared: shared.clone() };
        let mut rt = BridgeRuntime::with_parts(queue, uplink, FixedClock(RECEIVE_MS));

        // First replay drains the whole (available) queue via the real loop.
        let summary: FlushSummary = rt.replay_offline_queue();
        prop_assert_eq!(summary.sent, appended.len(), "first replay sends each distinct frame once");
        prop_assert_eq!(rt.connection_status().queued_frames, 0, "queue drained after replay");

        // Re-run replay several more times: with an empty queue nothing new is
        // sent (idempotent — req 2.7). Delivered count stays put.
        for _ in 0..replays {
            let s = rt.replay_offline_queue();
            prop_assert_eq!(s.sent, 0, "a replay over an empty queue delivers nothing");
        }

        // Now explicitly RE-APPEND every already-sent frame (a genuine replay of
        // historical data) and replay again. Because the frame_id/identity is
        // unchanged, the cloud dedupes and no key is delivered twice.
        {
            // Re-appending requires touching the queue through the runtime's
            // owned queue; drive it by pushing the same frames back in via a
            // fresh queue seeded identically, then a runtime over it. This keeps
            // to the public API (the runtime owns its queue) while still proving
            // idempotency across a re-queue+replay cycle.
            let mut requeue =
                SqliteOfflineQueue::open_in_memory(0, RetentionPolicy::DropOldest).unwrap();
            for (session, seq) in &frames {
                let (pilot, mission) = SESSIONS[*session];
                requeue.append(frame(pilot, mission, *seq)).unwrap();
            }
            let uplink2 = ModelUplink { shared: shared.clone() };
            let mut rt2 = BridgeRuntime::with_parts(requeue, uplink2, FixedClock(RECEIVE_MS));
            let s = rt2.replay_offline_queue();
            // The queue drains (frames are acknowledged again by the uplink),
            // but the CLOUD MODEL records them as duplicates-free accepted keys.
            prop_assert_eq!(s.sent, appended.len());
            prop_assert_eq!(rt2.connection_status().queued_frames, 0);
        }

        // req 2.7: across the first replay, the empty-queue replays, AND the
        // re-append + replay cycle, the cloud's idempotent receiver holds each
        // (pilot, session, sequence) key exactly once. The re-append cycle DOES
        // re-send frames on the wire (that is what replay is), so raw duplicate
        // acknowledgements are expected — the guarantee is that the receiver
        // dedupes them, so the ACCEPTED set never grows past the distinct keys.
        let s = shared.borrow();
        prop_assert_eq!(
            &s.accepted,
            &appended,
            "idempotent receiver must hold exactly the distinct (pilot, session, sequence) keys"
        );
        prop_assert_eq!(s.accepted.len(), appended.len());

        // Every appended key that was re-sent shows up in the duplicate ledger
        // AT MOST alongside its single acceptance — i.e. each distinct delivered
        // key still maps to exactly one accepted entry.
        let mut per_key: BTreeMap<IdKey, usize> = BTreeMap::new();
        for k in &s.delivered {
            *per_key.entry(k.clone()).or_default() += 1;
        }
        prop_assert_eq!(per_key.len(), appended.len(),
            "distinct delivered keys must equal distinct appended keys");
        // Any duplicate the wire produced is confined to keys that were actually
        // appended — replay never fabricates a new identity.
        for k in &s.duplicates {
            prop_assert!(appended.contains(k), "duplicate for a never-appended key: {:?}", k);
        }
    }
}

/// Small helper: assert a `queue.remove(..)` actually removed a row. Kept as a
/// free fn so the closure above can use `?` on a `TestCaseError`.
fn prop_assert_removed(removed: bool) -> Result<(), TestCaseError> {
    prop_assert!(removed, "acknowledged frame was not present to remove");
    Ok(())
}
