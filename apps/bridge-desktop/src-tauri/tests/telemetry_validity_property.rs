//! Property 1: Telemetry validity (design "Correctness Properties" Property 1;
//! requirements 1.1 and 1.3).
//!
//! **Validates: Requirements 1.1, 1.3** — every telemetry frame accepted by the
//! bridge runtime uses a supported simulator engine, carries only finite
//! normalized numeric values, a non-empty schema version of at most 32
//! characters, an observed timestamp inside the `[-60s, +5s]` skew window
//! relative to cloud-receive time, and a session sequence strictly greater than
//! the previously accepted sequence (unless the frame is flagged as replayed
//! historical data). Frames that violate any of these invariants are rejected
//! before persistence and are NEVER published to the uplink or left in the
//! durable offline queue.
//!
//! This is a `proptest`-based property test driving only the public
//! [`BridgeRuntime`] API (`virtualhems_bridge`). It generates a mix of valid and
//! deliberately-invalid samples, feeds them through `ingest_sample`, and asserts
//! that the accept/reject decision matches the invariants and that no invalid
//! frame ever leaves the runtime.
//!
//! ## How persistence/publication is observed through the public API
//!
//! The runtime's queue and uplink fields are private, so the test observes what
//! was persisted indirectly: it injects an *available* uplink that acknowledges
//! every publish and records each published frame into a shared log the test
//! keeps a handle to. On accept, the runtime durably queues the frame and then
//! flushes it to the available uplink, so the recorded publish log is exactly
//! the set of frames that left the durable queue. A rejected sample is never
//! queued and therefore never published — so asserting over the publish log
//! proves "invalid frames are never published or persisted-then-drained".
//! `connection_status()` corroborates counts (`queued_frames`, `last_sequence`).
//!
//! The Rust toolchain is not run in the authoring environment; this test is
//! written to compile and pass under CI against the runtime's public contract.

use std::cell::RefCell;
use std::rc::Rc;

use proptest::prelude::*;

use virtualhems_bridge::telemetry::{FlightVector, PositionVector, SystemsVector};
use virtualhems_bridge::{
    BridgeConfiguration, BridgeRuntime, Clock, IngestOutcome, InMemoryOfflineQueue, PublishOutcome,
    SecretReference, SimulatorEngine, TelemetryFrame, TelemetrySample, Uplink, UplinkState,
    ValidationError, MAX_SAMPLE_RATE_HZ, MIN_SAMPLE_RATE_HZ,
};

// ---------------------------------------------------------------------------
// Deterministic clock and a recording, always-available uplink.
// ---------------------------------------------------------------------------

/// A fixed cloud-receive clock so the observed-timestamp skew window is
/// deterministic across generated cases.
struct FixedClock(i64);
impl Clock for FixedClock {
    fn now_unix_millis(&self) -> i64 {
        self.0
    }
}

/// Unix milliseconds for the fixed cloud-receive instant `2024-01-01T00:00:00Z`.
const RECEIVE_MS: i64 = 1_704_067_200_000;

/// Accepted frames must carry a non-empty schema version of at most 32 chars.
const MAX_SCHEMA_VERSION_LEN: usize = 32;

/// A recorded publish: the runtime only publishes frames it accepted and
/// durably queued, so this is a faithful witness of what left the runtime.
#[derive(Clone)]
struct PublishedFrame {
    frame: TelemetryFrame,
}

/// Shared log of published frames. The test holds a clone of the `Rc` before
/// the uplink is moved into the runtime, then reads the log afterward.
type PublishLog = Rc<RefCell<Vec<PublishedFrame>>>;

/// An always-available uplink that acknowledges every publish and appends the
/// frame to a shared log. Because it is available, each accepted frame is
/// flushed and acknowledged immediately, so the log equals the set of frames
/// that were durably queued and then drained.
struct RecordingUplink {
    log: PublishLog,
}
impl Uplink for RecordingUplink {
    fn is_available(&self) -> bool {
        true
    }
    fn publish(&mut self, frame: &TelemetryFrame) -> PublishOutcome {
        self.log
            .borrow_mut()
            .push(PublishedFrame { frame: frame.clone() });
        PublishOutcome::Acknowledged
    }
}

fn base_config() -> BridgeConfiguration {
    BridgeConfiguration {
        pilot_id: "pilot-prop".into(),
        mission_id: Some("mission-prop".into()),
        sample_rate_hz: 5.0,
        udp_bind_address: "127.0.0.1:8080".into(),
        uplink_endpoint: "https://example.test/telemetry".into(),
        api_key_reference: SecretReference {
            key: "VH_API_KEY".into(),
        },
        offline_capacity: 100_000,
    }
}

/// Build a runtime with a fixed clock and a recording uplink, returning the
/// runtime alongside the shared publish log.
fn new_runtime() -> (
    BridgeRuntime<InMemoryOfflineQueue, RecordingUplink, FixedClock>,
    PublishLog,
) {
    let log: PublishLog = Rc::new(RefCell::new(Vec::new()));
    let uplink = RecordingUplink { log: log.clone() };
    let rt = BridgeRuntime::with_parts(InMemoryOfflineQueue::new(), uplink, FixedClock(RECEIVE_MS));
    (rt, log)
}

// ---------------------------------------------------------------------------
// Sample generation: a mix of valid and each class of invalid sample.
// ---------------------------------------------------------------------------

/// Which invariant a generated sample is built to satisfy or violate. `Valid`
/// samples must be accepted; every other variant must be rejected.
#[derive(Debug, Clone)]
enum Shape {
    Valid,
    NonFinite,
    Latitude,
    Longitude,
    Heading,
    TimestampOld,
    TimestampFuture,
    /// Unparseable observed-timestamp string.
    TimestampBad,
}

/// The four supported engines (requirement 1.2). No unsupported engine can be
/// represented by the `SimulatorEngine` enum, so every generated engine is
/// supported by construction; the "accepted frame has a supported engine"
/// invariant is still asserted on every accepted frame. Unsupported-engine
/// rejection is exercised by the adapter/ingestion unit tests.
fn supported_engine() -> impl Strategy<Value = SimulatorEngine> {
    prop_oneof![
        Just(SimulatorEngine::Msfs2020),
        Just(SimulatorEngine::Msfs2024),
        Just(SimulatorEngine::Xplane11),
        Just(SimulatorEngine::Xplane12),
    ]
}

/// A finite, in-range base sample at the given sequence. Individual invalid
/// shapes then mutate exactly one field out of range.
fn valid_sample(engine: SimulatorEngine, sequence: u64) -> TelemetrySample {
    TelemetrySample {
        source_engine: engine,
        source_sequence: sequence,
        // Observed exactly at the fixed receive instant → zero skew, in window.
        observed_at: "2024-01-01T00:00:00.000Z".into(),
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

/// All finite numeric fields on a sample source (requirement 1.1).
fn all_finite(s: &TelemetrySample) -> bool {
    let p = &s.position;
    let f = &s.flight;
    let sys = &s.systems;
    let opt = |v: Option<f64>| v.map_or(true, f64::is_finite);
    p.latitude_deg.is_finite()
        && p.longitude_deg.is_finite()
        && p.altitude_msl_ft.is_finite()
        && p.altitude_agl_ft.is_finite()
        && f.ground_speed_kts.is_finite()
        && f.heading_deg.is_finite()
        && f.vertical_speed_fpm.is_finite()
        && f.pitch_deg.is_finite()
        && f.roll_deg.is_finite()
        && sys.fuel_remaining_lbs.is_finite()
        && sys.engine_torque_pct.is_finite()
        && opt(sys.tot_celsius)
        && opt(sys.rotor_rpm_pct)
        && opt(sys.outside_air_temp_c)
}

/// Build the sample for a shape at the given sequence. Returns the sample and
/// whether it is expected to be accepted when ingested fresh as the next frame
/// of a session (i.e. with a strictly increasing sequence).
fn build_sample(shape: &Shape, engine: SimulatorEngine, sequence: u64) -> (TelemetrySample, bool) {
    let mut s = valid_sample(engine, sequence);
    let accept = match shape {
        Shape::Valid => true,
        Shape::NonFinite => {
            s.flight.vertical_speed_fpm = f64::NAN;
            false
        }
        Shape::Latitude => {
            s.position.latitude_deg = 90.0001;
            false
        }
        Shape::Longitude => {
            s.position.longitude_deg = -180.0001;
            false
        }
        Shape::Heading => {
            // 360.0 is out of range because the band is [0, 360).
            s.flight.heading_deg = 360.0;
            false
        }
        Shape::TimestampOld => {
            // 61 seconds before receive → skew -61_000 ms < -60_000 ms.
            s.observed_at = "2023-12-31T23:58:59.000Z".into();
            false
        }
        Shape::TimestampFuture => {
            // 6 seconds after receive → skew +6_000 ms > +5_000 ms.
            s.observed_at = "2024-01-01T00:00:06.000Z".into();
            false
        }
        Shape::TimestampBad => {
            s.observed_at = "not-a-timestamp".into();
            false
        }
    };
    (s, accept)
}

fn shape_strategy() -> impl Strategy<Value = Shape> {
    prop_oneof![
        // Weight Valid higher so sessions accept multiple frames and exercise
        // the strictly-increasing-sequence invariant across accepts.
        3 => Just(Shape::Valid),
        1 => Just(Shape::NonFinite),
        1 => Just(Shape::Latitude),
        1 => Just(Shape::Longitude),
        1 => Just(Shape::Heading),
        1 => Just(Shape::TimestampOld),
        1 => Just(Shape::TimestampFuture),
        1 => Just(Shape::TimestampBad),
    ]
}

/// One generated ingest step: a shape and an engine. The caller supplies the
/// monotonic source sequence.
fn step_strategy() -> impl Strategy<Value = (Shape, SimulatorEngine)> {
    (shape_strategy(), supported_engine())
}

fn is_supported(engine: SimulatorEngine) -> bool {
    matches!(
        engine,
        SimulatorEngine::Msfs2020
            | SimulatorEngine::Msfs2024
            | SimulatorEngine::Xplane11
            | SimulatorEngine::Xplane12
    )
}

/// Assert every accepted-frame invariant on a persisted-then-published frame
/// (requirement 1.1). Returns a `TestCaseError` on the first violation.
fn assert_frame_valid(frame: &TelemetryFrame) -> Result<(), TestCaseError> {
    prop_assert!(is_supported(frame.source_engine), "unsupported engine published");
    prop_assert!(!frame.schema_version.is_empty(), "empty schema version");
    prop_assert!(
        frame.schema_version.chars().count() <= MAX_SCHEMA_VERSION_LEN,
        "schema version longer than {MAX_SCHEMA_VERSION_LEN} chars"
    );
    prop_assert!(frame.received_at.is_some(), "missing cloud-receive timestamp");
    prop_assert!(
        (-90.0..=90.0).contains(&frame.position.latitude_deg),
        "latitude out of range on published frame"
    );
    prop_assert!(
        (-180.0..=180.0).contains(&frame.position.longitude_deg),
        "longitude out of range on published frame"
    );
    prop_assert!(
        (0.0..360.0).contains(&frame.flight.heading_deg),
        "heading out of range on published frame"
    );
    let finite = frame.position.latitude_deg.is_finite()
        && frame.position.longitude_deg.is_finite()
        && frame.position.altitude_msl_ft.is_finite()
        && frame.position.altitude_agl_ft.is_finite()
        && frame.flight.ground_speed_kts.is_finite()
        && frame.flight.heading_deg.is_finite()
        && frame.flight.vertical_speed_fpm.is_finite()
        && frame.flight.pitch_deg.is_finite()
        && frame.flight.roll_deg.is_finite()
        && frame.systems.fuel_remaining_lbs.is_finite()
        && frame.systems.engine_torque_pct.is_finite();
    prop_assert!(finite, "non-finite value on published frame");
    Ok(())
}

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// Property 1: Telemetry validity.
    ///
    /// Feed a session a sequence of generated samples with strictly increasing
    /// source sequence numbers (so a rejection is always attributable to the
    /// injected invalid field, never to a sequence regression). Assert:
    ///
    /// * Every VALID sample is accepted, and every deliberately-invalid sample
    ///   is rejected with the matching `ValidationError`.
    /// * Every ACCEPTED (hence published) frame carries a supported engine,
    ///   all-finite values, a non-empty schema version <= 32 chars, a cloud
    ///   receive timestamp, and in-range coordinates/heading.
    /// * Published frames appear in strictly increasing sequence order and
    ///   number exactly the accepted samples — no invalid frame is ever
    ///   published or persisted-then-drained.
    ///
    /// **Validates: Requirements 1.1, 1.3**
    #[test]
    fn telemetry_validity_holds(steps in proptest::collection::vec(step_strategy(), 1..40)) {
        let (mut rt, log) = new_runtime();
        rt.start(base_config()).expect("start with valid 5 Hz rate");

        let mut accepted_sequences: Vec<u64> = Vec::new();
        let mut last_accepted: Option<u64> = None;

        for (i, (shape, engine)) in steps.iter().enumerate() {
            // Strictly increasing source sequence across all steps: any
            // rejection is attributable to the injected defect alone.
            let sequence = (i as u64) + 1;
            let (sample, expect_accept) = build_sample(shape, *engine, sequence);

            let outcome = rt
                .ingest_sample(sample.clone(), false)
                .expect("running session with a valid rate never errors on ingest");

            match outcome {
                IngestOutcome::Accepted(frame_id) => {
                    prop_assert!(
                        expect_accept,
                        "shape {:?} accepted but invariant expected rejection",
                        shape
                    );
                    // Source-side invariants that must hold for an accept.
                    prop_assert!(is_supported(sample.source_engine));
                    prop_assert!(all_finite(&sample), "accepted a non-finite sample");
                    if let Some(prev) = last_accepted {
                        prop_assert!(
                            sequence > prev,
                            "accepted sequence {sequence} not > previous {prev}"
                        );
                    }
                    last_accepted = Some(sequence);
                    accepted_sequences.push(sequence);
                    prop_assert!(frame_id.starts_with("pilot-prop:"));
                }
                IngestOutcome::Rejected(err) => {
                    prop_assert!(
                        !expect_accept,
                        "shape {:?} rejected but invariant expected acceptance (err: {:?})",
                        shape,
                        err
                    );
                    // The rejection reason matches the injected defect.
                    match shape {
                        Shape::NonFinite => prop_assert!(matches!(err, ValidationError::NonFinite(_))),
                        Shape::Latitude => prop_assert!(matches!(err, ValidationError::Latitude(_))),
                        Shape::Longitude => prop_assert!(matches!(err, ValidationError::Longitude(_))),
                        Shape::Heading => prop_assert!(matches!(err, ValidationError::Heading(_))),
                        Shape::TimestampOld | Shape::TimestampFuture | Shape::TimestampBad => {
                            prop_assert!(matches!(err, ValidationError::Timestamp(_)))
                        }
                        Shape::Valid => prop_assert!(false, "unexpected rejection of a valid sample"),
                    }
                }
            }
        }

        // --- Nothing invalid was persisted or published ------------------

        let status = rt.connection_status();
        // An available uplink drains each accepted frame on ingest, so the
        // durable queue is empty and every accepted frame was published.
        prop_assert_eq!(status.queued_frames, 0);
        prop_assert_eq!(status.uplink_state, UplinkState::Available);
        prop_assert_eq!(status.last_sequence, accepted_sequences.last().copied());

        let published = log.borrow();
        // Exactly the accepted frames were published — no more, no fewer.
        prop_assert_eq!(published.len(), accepted_sequences.len());

        // Each published frame satisfies every validity invariant and the
        // published stream is strictly increasing in sequence.
        let mut prev_seq: Option<u64> = None;
        for (idx, pf) in published.iter().enumerate() {
            assert_frame_valid(&pf.frame)?;
            prop_assert_eq!(pf.frame.sequence_number, accepted_sequences[idx]);
            if let Some(p) = prev_seq {
                prop_assert!(pf.frame.sequence_number > p, "published sequence not strictly increasing");
            }
            prev_seq = Some(pf.frame.sequence_number);
        }
    }

    /// A replayed frame with a regressing sequence is accepted (the sequence
    /// invariant is suppressed for replayed historical data, requirement 1.3),
    /// but it must still satisfy every other validity invariant. An invalid
    /// replayed frame is still rejected and never published.
    #[test]
    fn replayed_frames_bypass_sequence_but_not_validity(
        (bad_shape, engine) in (prop_oneof![
            Just(Shape::NonFinite),
            Just(Shape::Latitude),
            Just(Shape::Longitude),
            Just(Shape::Heading),
            Just(Shape::TimestampOld),
        ], supported_engine())
    ) {
        let (mut rt, log) = new_runtime();
        rt.start(base_config()).expect("start");

        // Accept a fresh frame at sequence 10.
        let (fresh, _) = build_sample(&Shape::Valid, engine, 10);
        prop_assert!(matches!(
            rt.ingest_sample(fresh, false).unwrap(),
            IngestOutcome::Accepted(_)
        ));

        // A replayed VALID frame at a lower sequence (5) is accepted despite the
        // regression, because it is flagged replayed.
        let (replay_ok, _) = build_sample(&Shape::Valid, engine, 5);
        prop_assert!(matches!(
            rt.ingest_sample(replay_ok, true).unwrap(),
            IngestOutcome::Accepted(_)
        ));
        let published_after_two = log.borrow().len();
        prop_assert_eq!(published_after_two, 2);

        // A replayed INVALID frame at a lower sequence (3) is still rejected —
        // replay suppresses only the sequence check, not the other invariants —
        // and is never published.
        let (replay_bad, _) = build_sample(&bad_shape, engine, 3);
        let outcome = rt.ingest_sample(replay_bad, true).unwrap();
        prop_assert!(matches!(outcome, IngestOutcome::Rejected(_)));
        prop_assert_eq!(log.borrow().len(), published_after_two);

        // Every published frame is still valid.
        for pf in log.borrow().iter() {
            assert_frame_valid(&pf.frame)?;
        }
    }

    /// The runtime refuses to open a session outside the fixed 2–10 Hz band
    /// (requirement 1.5 precondition to the ingest pipeline); rates inside the
    /// band start successfully. This guards the precondition under which the
    /// telemetry-validity invariants are established.
    #[test]
    fn sample_rate_precondition(rate in 0.0f64..20.0) {
        let mut cfg = base_config();
        cfg.sample_rate_hz = rate;
        let (mut rt, _log) = new_runtime();
        let in_band = (MIN_SAMPLE_RATE_HZ..=MAX_SAMPLE_RATE_HZ).contains(&rate);
        prop_assert_eq!(rt.start(cfg).is_ok(), in_band);
    }
}
