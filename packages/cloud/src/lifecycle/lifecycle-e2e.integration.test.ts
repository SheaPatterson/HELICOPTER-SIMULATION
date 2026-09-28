/**
 * End-to-end integration suite for the full mission lifecycle and fault recovery
 * (task 19.2; design Section 11.2 flow 9).
 *
 * The smoke test (`mission-lifecycle.test.ts`, task 19.1) proves the composition
 * threads once on the happy path plus a single idempotent-replay case. THIS
 * suite is the fuller end-to-end coverage task 19.2 requires, mapped scenario →
 * requirement:
 *
 *   1. Full dispatch-to-AAR journey ............ req 3.7, 7.1
 *   2. Network-fault buffering + lossless,
 *      idempotent replay ....................... req 2.4
 *   3. 20-minute scene-delay deterioration ..... req 4.2
 *
 * (Scenario 4 — the RLS role matrix, req 8.3/8.5 — is enforced in Postgres via
 * SQL migrations and lives in `supabase/tests/02_rls_integration_test.sql`, run
 * by `supabase/tests/run_db_integration_tests.sh`. It is NOT modeled in TS,
 * because faking RLS in TypeScript would not exercise the real enforcement
 * layer. See that SQL file for the role×operation matrix.)
 *
 * Every subsystem is wired through its existing in-memory port, exactly as the
 * 19.1 wiring does, so each run is deterministic with no live DB, realtime, TLS
 * uplink, or Rust bridge. The bridge's SQLite offline queue is Rust/CI-only, so
 * network-fault buffering (scenario 2) is modeled at the ingestion-idempotency
 * seam in TS — consistent with the 19.1 wiring, where a duplicate ack is the
 * lossless/idempotent-replay contract (req 2.4 / 2.7).
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  ClinicalEvent,
  DispatchDetails,
  MedicalCondition,
  TelemetryFrame,
} from "@virtualhems/contracts";

import {
  ingestTelemetry,
  InMemoryTelemetryRepository,
  type AuthenticatedPilot,
  type IngestDependencies,
  type TelemetryAuthenticator,
} from "../telemetry/index.js";
import {
  InMemoryRealtimeBroadcaster,
  RealtimeFanout,
} from "../realtime/index.js";
import {
  InMemoryConditionResolver,
  InMemoryDispatchLookup,
  InMemoryMissionEventSink,
  InMemoryMissionPublisher,
} from "../dispatch/index.js";
import {
  InMemoryAarLoaders,
  InMemoryAarReportStore,
  InMemoryPilotLogbook,
} from "../aar/index.js";

import {
  runMissionLifecycle,
  type MissionLifecycleDependencies,
  type MissionLifecycleInput,
} from "./mission-lifecycle.js";
import { SimulatorFixtureSource } from "./simulator-fixture.js";

// --- Shared fixture ids -----------------------------------------------------

const PILOT_ID = "pilot-0001";
const MISSION_ID = "mission-0001";
const SESSION_ID = "session-0001";
const BASE_ID = "base-PS78";
const AIRFRAME_ID = "airframe-EC145";
const ORIGIN_ID = "hospital-KAXQ";
const DEST_ID = "hospital-KPIT";
const CONDITION_ID = "cond-trauma-1";
const PIC_ID = "crew-pic";
const NURSE_ID = "crew-nurse";
const REGION = "WESTERN_PA";

// A fixed session anchor so every derived instant is deterministic.
const SESSION_START = "2024-06-01T12:00:00.000Z";
const DISPATCH_AT = "2024-06-01T12:00:00.000Z";
const SCENE_ARRIVE_AT = "2024-06-01T12:10:00.000Z";
const TOUCHDOWN_AT = "2024-06-01T13:00:00.000Z";

const CONDITION: MedicalCondition = {
  id: CONDITION_ID,
  name: "Blunt trauma",
  category: "TRAUMA",
  baseline_gcs_min: 12,
  baseline_gcs_max: 14,
  requires_rsi: false,
  decay_rate_per_minute: 1,
  target_facility_type: "TRAUMA_1",
};

const DETAILS_PACKAGE: DispatchDetails = {
  mission_type: "SCENE_CALL",
  assigned_base_id: BASE_ID,
  assigned_airframe_id: AIRFRAME_ID,
  origin_hospital_id: ORIGIN_ID,
  destination_hospital_id: DEST_ID,
  weather_snapshot: { observed_at: DISPATCH_AT },
};

/**
 * The recorded mission events. `sceneDepartAt`/`touchdownAt` are parameterized
 * so a scenario can lengthen the on-scene interval (scenario 3). `ARRIVED_SCENE`
 * anchors scene time; `DEPARTED_SCENE` closes the interval; `TOUCHDOWN` marks
 * the landing the AAR surfaces.
 */
function clinicalEvents(sceneDepartAt: string, touchdownAt: string): ClinicalEvent[] {
  const meta: Record<string, string> = {};
  const src = "SYSTEM" as const;
  return [
    { mission_id: MISSION_ID, event_type: "DISPATCHED", occurred_at: DISPATCH_AT, source: src, metadata: meta },
    { mission_id: MISSION_ID, event_type: "ARRIVED_SCENE", occurred_at: SCENE_ARRIVE_AT, source: src, metadata: meta },
    { mission_id: MISSION_ID, event_type: "DEPARTED_SCENE", occurred_at: sceneDepartAt, source: src, metadata: meta },
    { mission_id: MISSION_ID, event_type: "TOUCHDOWN", occurred_at: touchdownAt, source: src, metadata: meta },
  ];
}

/**
 * A telemetry frame set with a grounded touchdown at the end so the AAR can
 * detect the landing from telemetry as well as the recorded TOUCHDOWN event.
 */
function aarTelemetry(): TelemetryFrame[] {
  const base = {
    pilot_id: PILOT_ID,
    mission_id: MISSION_ID,
    source_engine: "XPLANE12" as const,
    is_delta: false,
    schema_version: "0.1.0",
  };
  return [
    {
      ...base,
      frame_id: `${SESSION_ID}-1`,
      sequence_number: 1,
      observed_at: SESSION_START,
      position: { latitude_deg: 40.5, longitude_deg: -80.2, altitude_msl_ft: 1200, altitude_agl_ft: 900 },
      flight: { ground_speed_kts: 120, heading_deg: 90, vertical_speed_fpm: 0, pitch_deg: 2, roll_deg: 3 },
      systems: { fuel_remaining_lbs: 1000, engine_torque_pct: 70 },
    },
    {
      ...base,
      frame_id: `${SESSION_ID}-2`,
      sequence_number: 2,
      observed_at: TOUCHDOWN_AT,
      position: { latitude_deg: 40.44, longitude_deg: -79.99, altitude_msl_ft: 1150, altitude_agl_ft: 1 },
      flight: { ground_speed_kts: 0, heading_deg: 90, vertical_speed_fpm: 0, pitch_deg: 1, roll_deg: 1 },
      systems: { fuel_remaining_lbs: 800, engine_torque_pct: 30 },
    },
  ];
}

/** A fixed-clock authenticator resolving the fixture pilot from its credential. */
const authenticator: TelemetryAuthenticator = {
  async authenticate(credential: string | undefined): Promise<AuthenticatedPilot | null> {
    return credential === PILOT_ID ? { pilot_id: PILOT_ID } : null;
  },
};

/**
 * Build the composed lifecycle input. `deriveStateAt` is the event time the
 * clinical stage derives (possibly deteriorated) patient state at; scenario 3
 * pushes it well past the scene target.
 */
function buildInput(overrides?: {
  deriveStateAt?: string;
  sceneDepartAt?: string;
  scene_target_seconds?: number;
}): MissionLifecycleInput {
  const deriveStateAt = overrides?.deriveStateAt ?? "2024-06-01T12:45:00.000Z";
  const sceneDepartAt = overrides?.sceneDepartAt ?? "2024-06-01T12:40:00.000Z";
  const telemetry = new SimulatorFixtureSource({
    pilot_id: PILOT_ID,
    session_id: SESSION_ID,
    mission_id: MISSION_ID,
    source_engine: "XPLANE12",
    session_start: SESSION_START,
    waypoints: [
      {
        offset_seconds: 0,
        position: { latitude_deg: 40.5, longitude_deg: -80.2, altitude_msl_ft: 1200, altitude_agl_ft: 900 },
        flight: { ground_speed_kts: 120, heading_deg: 90, vertical_speed_fpm: 0, pitch_deg: 2, roll_deg: 3 },
        systems: { fuel_remaining_lbs: 1000, engine_torque_pct: 70 },
      },
      {
        offset_seconds: 2,
        position: { latitude_deg: 40.49, longitude_deg: -80.15, altitude_msl_ft: 1210, altitude_agl_ft: 910 },
        flight: { ground_speed_kts: 122, heading_deg: 91, vertical_speed_fpm: 100, pitch_deg: 3, roll_deg: 4 },
        systems: { fuel_remaining_lbs: 995, engine_torque_pct: 71 },
      },
    ],
  });

  return {
    identity: { mission_id: MISSION_ID, mission_code: "VH-001", region: REGION },
    telemetry,
    dispatch: {
      details: {
        mission_type: "SCENE_CALL",
        assigned_base_id: BASE_ID,
        assigned_airframe_id: AIRFRAME_ID,
        origin_hospital_id: ORIGIN_ID,
        destination_hospital_id: DEST_ID,
        weather_snapshot: { observed_at: DISPATCH_AT },
      },
      crew: {
        members: [
          { member_id: PIC_ID, role: "PILOT", is_pilot_in_command: true },
          { member_id: NURSE_ID, role: "FLIGHT_NURSE" },
        ],
      },
      patient: {
        simulated_patient_id: "sim-patient-1",
        age_years: 45,
        gender: "M",
        weight_lbs: 180,
        condition_id: CONDITION_ID,
        clinical_summary: "Simulated blunt trauma, hemodynamically stable.",
        interventions: "IV access, c-spine precautions.",
      },
      flightPlan: {
        route: [
          { latitude_deg: 40.5, longitude_deg: -80.2 },
          { latitude_deg: 40.44, longitude_deg: -79.99 },
        ],
        pave: { pilot_score: 1, aircraft_score: 1, environment_score: 1, external_score: 0 },
      },
      detailsPackage: DETAILS_PACKAGE,
      crewRoster: { pilot_in_command_id: PIC_ID, flight_nurse_id: NURSE_ID },
      patientPackage: {
        simulated_patient_id: "sim-patient-1",
        age_years: 45,
        gender: "M",
        weight_lbs: 180,
        condition_id: CONDITION_ID,
        clinical_summary: "Simulated blunt trauma, hemodynamically stable.",
        interventions: "IV access, c-spine precautions.",
        baseline_gcs: 14,
      },
    },
    clinical: {
      condition: CONDITION,
      events: clinicalEvents(sceneDepartAt, TOUCHDOWN_AT),
      deriveStateAt,
      policy: {
        policy_version: "policy-2024.1",
        scene_target_seconds: overrides?.scene_target_seconds ?? 1200,
      },
    },
  };
}

interface DepsBundle {
  deps: MissionLifecycleDependencies;
  broadcaster: InMemoryRealtimeBroadcaster;
  publisher: InMemoryMissionPublisher;
  events: InMemoryMissionEventSink;
  store: InMemoryAarReportStore;
  logbook: InMemoryPilotLogbook;
  repository: InMemoryTelemetryRepository;
}

function buildDeps(): DepsBundle {
  const repository = new InMemoryTelemetryRepository();
  const broadcaster = new InMemoryRealtimeBroadcaster();
  const fanout = new RealtimeFanout(broadcaster);
  const publisher = new InMemoryMissionPublisher();
  const events = new InMemoryMissionEventSink();
  const store = new InMemoryAarReportStore();
  const logbook = new InMemoryPilotLogbook();

  const lookup = new InMemoryDispatchLookup({
    baseIds: [BASE_ID],
    airframeIds: [AIRFRAME_ID],
    facilityIds: [ORIGIN_ID, DEST_ID],
  });
  const conditionResolver = new InMemoryConditionResolver([CONDITION]);

  // Fixed clocks so the fixture's observed_at falls inside the ingestion accept
  // window ([-60s, +5s] of receive) — the fixture session ends 2s after start.
  const ingestNow = (): Date => new Date(SESSION_START);
  const dispatchNow = (): Date => new Date(DISPATCH_AT);

  const aarLoaders = new InMemoryAarLoaders({
    mission: {
      mission_id: MISSION_ID,
      pilot_id: PILOT_ID,
      status: "COMPLETED",
      flight_plan: {
        direct_distance_nm: 12,
        planned_distance_nm: 12,
        reserve_at_destination_minutes: 45,
      },
      expected_frame_count: 2,
    },
    telemetry: aarTelemetry(),
    events: clinicalEvents("2024-06-01T12:40:00.000Z", TOUCHDOWN_AT),
  });

  const deps: MissionLifecycleDependencies = {
    ingest: { authenticator, repository, now: ingestNow },
    fanout,
    dispatch: {
      events,
      now: dispatchNow,
      dispatch: {
        lookup,
        conditionResolver,
        now: dispatchNow,
        reservePolicy: { required_reserve_minutes: 20 },
        pavePolicy: { go_max: 3, conditional_max: 6, max_component_score: 4 },
      },
      publisher,
      issueAuthorizationCode: (m) => `AUTH-${m.mission_code}`,
    },
    aar: {
      loaders: aarLoaders,
      clock: { now: () => new Date(TOUCHDOWN_AT) },
      policy: { policy_version: "policy-2024.1" },
      store,
      logbook,
    },
  };

  return { deps, broadcaster, publisher, events, store, logbook, repository };
}

// ===========================================================================
// Scenario 1 — full dispatch-to-AAR journey (req 3.7, 7.1)
// ===========================================================================

describe("E2E scenario 1 — full dispatch-to-AAR journey (req 3.7, 7.1)", () => {
  it("threads a GO mission through every stage and persists an immutable AAR + logbook entry", async () => {
    const { deps, publisher, store, logbook } = buildDeps();

    const result = await runMissionLifecycle(buildInput(), deps);

    // The composed path completed end-to-end without halting.
    expect(result.ok).toBe(true);
    expect(result.haltedAt).toBeUndefined();

    // --- Dispatch GO → authorized EFB package (req 3.7) --------------------
    expect(result.authorization.ok).toBe(true);
    expect(result.missionPackage?.status).toBe("DISPATCHED");
    // An authorization code was issued (req 3.7: authorized package gated on GO).
    expect(result.missionPackage?.authorization_code).toBe("AUTH-VH-001");
    // The authorized package was published exactly once to the EFB (req 3.7).
    expect(publisher.all()).toHaveLength(1);
    expect(publisher.all()[0]?.mission_id).toBe(MISSION_ID);

    // --- Touchdown → AAR generated, persisted immutably, logbook (req 7.1) --
    expect(result.aar?.ok).toBe(true);
    if (result.aar?.ok) {
      // Immutable persist: first (and only) report stored as version 1 (req 7.1/7.5).
      expect(result.aar.stored.version).toBe(1);
      expect(result.aar.stored.report.mission_id).toBe(MISSION_ID);
      // Logbook appended with a COMPLETED outcome, mission hours, and policy
      // version (req 7.1/7.5). Hours are derived, never fabricated.
      expect(result.aar.logbookEntry.mission_id).toBe(MISSION_ID);
      expect(result.aar.logbookEntry.outcome).toBe("COMPLETED");
      expect(result.aar.logbookEntry.mission_hours).not.toBeNull();
      expect(result.aar.logbookEntry.mission_hours).toBeGreaterThan(0);
      expect(result.aar.logbookEntry.policy_version).toBe("policy-2024.1");
      // The report records the effective Policy_Version it was scored under.
      expect(result.aar.stored.report.policy_version).toBe("policy-2024.1");
    }

    // Persisted immutably in the store; the pilot logbook grew by exactly one.
    expect(store.get(MISSION_ID)).toBeDefined();
    expect(logbook.entriesFor(PILOT_ID)).toHaveLength(1);
  });

  it("keeps the persisted AAR immutable — a second finalize does not overwrite version 1 (req 7.1)", async () => {
    // Two full lifecycle runs share one store: the first persists version 1; the
    // second's finalize must NOT overwrite it (immutable after-action record).
    const { deps, store, logbook } = buildDeps();

    const first = await runMissionLifecycle(buildInput(), deps);
    expect(first.ok).toBe(true);
    const firstStored = store.get(MISSION_ID);
    expect(firstStored?.version).toBe(1);

    // Re-run with the SAME store/logbook — the report already exists.
    const second = await runMissionLifecycle(buildInput(), deps);
    // The lifecycle short-circuits at AAR because the report is immutable.
    expect(second.ok).toBe(false);
    expect(second.haltedAt).toBe("AAR");

    // The stored report is unchanged (still version 1) — never overwritten.
    const afterStored = store.get(MISSION_ID);
    expect(afterStored?.version).toBe(1);
    expect(afterStored?.persisted_at).toBe(firstStored?.persisted_at);
    // No duplicate logbook entry was appended for the rejected re-finalize.
    expect(logbook.entriesFor(PILOT_ID)).toHaveLength(1);
  });

  it("halts before authorization when the crew roster has no pilot-in-command (req 3.7 gate)", async () => {
    // Req 3.7 is a GATE: a mission reaches DISPATCHED / the EFB only after every
    // stage passes. Break Stage 2 crew and assert the package is never published.
    const { deps, publisher, store } = buildDeps();
    const input = buildInput();
    input.dispatch.crew = {
      members: [
        { member_id: PIC_ID, role: "PILOT" },
        { member_id: NURSE_ID, role: "FLIGHT_NURSE" },
      ],
    };

    const result = await runMissionLifecycle(input, deps);

    expect(result.ok).toBe(false);
    expect(result.haltedAt).toBe("DISPATCH_AUTHORIZATION");
    expect(result.missionPackage).toBeUndefined();
    // Nothing was published to the EFB and no AAR was produced.
    expect(publisher.all()).toHaveLength(0);
    expect(store.get(MISSION_ID)).toBeUndefined();
  });
});

// ===========================================================================
// Scenario 2 — network-fault buffering with lossless idempotent replay (req 2.4)
// ===========================================================================

describe("E2E scenario 2 — network-fault buffering + lossless idempotent replay (req 2.4)", () => {
  /**
   * Model the bridge offline queue at the ingestion-idempotency seam: a set of
   * buffered frames, some already delivered before a fault, all replayed on
   * reconnect. This is the TS analogue of the Rust SQLite queue (CI-only), and
   * matches the 19.1 wiring where a duplicate ack IS the lossless/idempotent
   * replay contract (req 2.4 / 2.7).
   */
  function bufferedFrames(): TelemetryFrame[] {
    const base = {
      pilot_id: PILOT_ID,
      mission_id: MISSION_ID,
      source_engine: "XPLANE12" as const,
      is_delta: false,
      schema_version: "0.1.0",
    };
    return [1, 2, 3, 4, 5].map((seq) => ({
      ...base,
      frame_id: `${SESSION_ID}-${seq}`,
      sequence_number: seq,
      observed_at: new Date(Date.parse(SESSION_START) + seq * 1000).toISOString(),
      position: { latitude_deg: 40.5, longitude_deg: -80.2, altitude_msl_ft: 1200, altitude_agl_ft: 900 },
      flight: { ground_speed_kts: 120, heading_deg: 90, vertical_speed_fpm: 0, pitch_deg: 2, roll_deg: 3 },
      systems: { fuel_remaining_lbs: 1000, engine_torque_pct: 70 },
    }));
  }

  function ingestDeps(): { deps: IngestDependencies; repository: InMemoryTelemetryRepository } {
    const repository = new InMemoryTelemetryRepository();
    // Receive clock 3s past the last buffered frame so all five observed_at
    // values fall inside the [-60s, +5s] accept window.
    const now = (): Date => new Date(Date.parse(SESSION_START) + 8000);
    return { deps: { authenticator, repository, now }, repository };
  }

  it("replay after a mid-stream fault is LOSSLESS — every buffered frame is acknowledged", async () => {
    const { deps, repository } = ingestDeps();
    const frames = bufferedFrames();

    // Uplink up: frames 1..3 delivered and persisted before the fault.
    const beforeFault = frames.slice(0, 3);
    for (const frame of beforeFault) {
      const r = await ingestTelemetry(toRequest(frame), PILOT_ID, deps);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ack.disposition).toBe("accepted");
    }
    expect(repository.size()).toBe(3);

    // FAULT then RECONNECT: the bridge replays the ENTIRE buffer (1..5) in
    // ascending session-and-sequence order (req 2.4). No frame is dropped:
    // every replayed frame receives an ack.
    const acks = [];
    for (const frame of frames) {
      const r = await ingestTelemetry(toRequest(frame), PILOT_ID, deps);
      expect(r.ok).toBe(true);
      if (r.ok) acks.push(r.ack);
    }

    // Lossless: all five frames acknowledged across the replay.
    expect(acks).toHaveLength(5);
    // Idempotent: the three already-delivered frames come back as duplicates,
    // the two new ones (4, 5) as accepted — nothing re-persisted twice.
    expect(acks.filter((a) => a.disposition === "duplicate")).toHaveLength(3);
    expect(acks.filter((a) => a.disposition === "accepted")).toHaveLength(2);
    // Exactly five distinct rows after replay: no lost frames, no duplicates.
    expect(repository.size()).toBe(5);
  });

  it("a duplicate replayed frame is idempotent — no new row, ack equivalent to the original (req 2.4)", async () => {
    const { deps, repository } = ingestDeps();
    const frame = bufferedFrames()[0]!;

    const original = await ingestTelemetry(toRequest(frame), PILOT_ID, deps);
    expect(original.ok).toBe(true);
    expect(repository.size()).toBe(1);

    // Replay the SAME (pilot, session, sequence) — treated as idempotent.
    const replay = await ingestTelemetry(toRequest(frame), PILOT_ID, deps);
    expect(replay.ok).toBe(true);
    if (original.ok && replay.ok) {
      expect(replay.ack.disposition).toBe("duplicate");
      // Ack equivalent to the original persisted frame (req 2.7).
      expect(replay.ack.frame_id).toBe(original.ack.frame_id);
      expect(replay.ack.sequence_number).toBe(original.ack.sequence_number);
    }
    // No duplicate persisted record.
    expect(repository.size()).toBe(1);
  });

  it("full-buffer replay after any pre-fault prefix is lossless and idempotent (req 2.4)", async () => {
    // Property: no matter WHICH prefix (0..5 frames) was delivered before the
    // fault, replaying the WHOLE buffer on reconnect leaves the persisted set
    // equal to the buffer — every frame present exactly once (lossless +
    // idempotent). The bridge replays in ascending session-and-sequence order
    // (req 2.2/2.3), so the replay here is ascending too; already-delivered
    // frames return `duplicate` (no new row), the rest `accepted`.
    // **Validates: Requirements 2.4**
    await fc.assert(
      fc.asyncProperty(
        // How many frames were delivered before the fault (0..5).
        fc.integer({ min: 0, max: 5 }),
        async (deliveredCount) => {
          const { deps, repository } = ingestDeps();
          const frames = bufferedFrames();

          // Pre-fault delivery of the first `deliveredCount` frames.
          for (const frame of frames.slice(0, deliveredCount)) {
            const r = await ingestTelemetry(toRequest(frame), PILOT_ID, deps);
            expect(r.ok).toBe(true);
          }

          // Reconnect: replay the whole buffer in ascending order (req 2.2/2.3).
          const acks = [];
          for (const frame of frames) {
            const r = await ingestTelemetry(toRequest(frame), PILOT_ID, deps);
            expect(r.ok).toBe(true);
            if (r.ok) acks.push(r.ack);
          }

          // Lossless: every buffered frame acknowledged during replay.
          expect(acks).toHaveLength(5);
          // The already-delivered prefix comes back as duplicates; the rest as
          // accepted — nothing re-persisted, nothing dropped.
          expect(acks.filter((a) => a.disposition === "duplicate")).toHaveLength(
            deliveredCount,
          );
          // Idempotent: exactly five distinct rows regardless of the prefix.
          expect(repository.size()).toBe(5);
          const persistedSeqs = acks
            .map((a) => a.sequence_number)
            .sort((x, y) => x - y);
          // Every sequence 1..5 is represented across the acks.
          expect([...new Set(persistedSeqs)]).toEqual([1, 2, 3, 4, 5]);
        },
      ),
      { numRuns: 12 },
    );
  });
});

/** Reshape a normalized fixture frame into an ingestion request. */
function toRequest(frame: TelemetryFrame) {
  return {
    frame_id: frame.frame_id,
    session_id: SESSION_ID,
    ...(frame.mission_id !== undefined ? { mission_id: frame.mission_id } : {}),
    source_engine: frame.source_engine,
    source_sequence: frame.sequence_number,
    sequence_number: frame.sequence_number,
    observed_at: frame.observed_at,
    position: frame.position,
    flight: frame.flight,
    systems: frame.systems,
    is_delta: frame.is_delta,
    schema_version: frame.schema_version,
  };
}

// ===========================================================================
// Scenario 3 — 20-minute scene-delay deterioration (req 4.2)
// ===========================================================================

describe("E2E scenario 3 — 20-minute scene-delay deterioration (req 4.2)", () => {
  /**
   * The clinical decay math (design Section 6.4, exercised through the lifecycle):
   *   scene target        = 1200 s (20 min)
   *   over_minutes        = floor((elapsed_scene_s − 1200) / 60)
   *   gcs_points          = round(over_minutes × decay_rate(1) × points_per_unit(1))
   *   current_gcs         = clamp(baseline(14) − gcs_points, 3, 15)
   * Arrival is fixed at 12:10:00; deriving state at time T with no departure
   * keeps the scene interval open to T, so elapsed_scene = T − 12:10:00.
   */

  it("derives a deterministic GCS drop for on-scene time past the 20-minute target (req 4.2)", async () => {
    // On scene 12:10:00 → derive 12:35:00 = 25 min = 1500 s.
    // over = floor((1500 − 1200)/60) = 5 → GCS 14 − 5 = 9. Still in [3,15].
    const { deps } = buildDeps();
    const input = buildInput({
      // No departure before the derivation point: keep the scene interval open
      // so elapsed scene time is exactly (derive − arrive).
      sceneDepartAt: "2024-06-01T12:59:00.000Z",
      deriveStateAt: "2024-06-01T12:35:00.000Z",
    });

    const result = await runMissionLifecycle(input, deps);
    expect(result.ok).toBe(true);

    expect(result.deterioration?.ok).toBe(true);
    if (result.deterioration?.ok) {
      // 5 whole over-target minutes accrued exactly once each (req 4.2/4.3).
      expect(result.deterioration.penalty.over_minutes).toBe(5);
      expect(result.deterioration.penalty.gcs_points).toBe(5);
      expect(result.deterioration.policy_version).toBe("policy-2024.1");
    }

    const patient = result.patientState!;
    expect(patient.baseline_gcs).toBe(14);
    // Deterministic exact value: 14 − 5 = 9.
    expect(patient.current_gcs).toBe(9);
    expect(patient.deteriorated).toBe(true);
    expect(patient.elapsed_scene_seconds).toBe(1500);
    // Golden Hour elapsed from the dispatch anchor (12:00 → 12:35 = 2100 s).
    expect(patient.elapsed_golden_hour_seconds).toBe(2100);
  });

  it("clamps GCS to the floor of 3 for an extreme scene delay and never below (req 4.2/4.4)", async () => {
    // On scene 12:10:00 → derive 12:50:00 = 40 min = 2400 s.
    // over = floor((2400 − 1200)/60) = 20 → 14 − 20 = −6 → clamp to 3.
    const { deps } = buildDeps();
    const input = buildInput({
      sceneDepartAt: "2024-06-01T12:59:00.000Z",
      deriveStateAt: "2024-06-01T12:50:00.000Z",
    });

    const result = await runMissionLifecycle(input, deps);
    expect(result.ok).toBe(true);

    const patient = result.patientState!;
    expect(result.deterioration?.ok).toBe(true);
    if (result.deterioration?.ok) {
      expect(result.deterioration.penalty.over_minutes).toBe(20);
    }
    // Clamped at the floor — never below 3 (req 4.4).
    expect(patient.current_gcs).toBe(3);
    expect(patient.current_gcs).toBeGreaterThanOrEqual(3);
    expect(patient.deteriorated).toBe(true);
  });

  it("no deterioration while on-scene time is within the 20-minute target (req 4.2)", async () => {
    // On scene 12:10:00 → derive 12:28:00 = 18 min = 1080 s < 1200 s target.
    // over = 0 → GCS stays at baseline 14, not deteriorated.
    const { deps } = buildDeps();
    const input = buildInput({
      sceneDepartAt: "2024-06-01T12:59:00.000Z",
      deriveStateAt: "2024-06-01T12:28:00.000Z",
    });

    const result = await runMissionLifecycle(input, deps);
    expect(result.ok).toBe(true);

    const patient = result.patientState!;
    expect(result.deterioration?.ok).toBe(true);
    if (result.deterioration?.ok) {
      expect(result.deterioration.penalty.over_minutes).toBe(0);
      expect(result.deterioration.penalty.gcs_points).toBe(0);
    }
    expect(patient.current_gcs).toBe(patient.baseline_gcs);
    expect(patient.deteriorated).toBe(false);
    expect(patient.elapsed_scene_seconds).toBe(1080);
  });

  it("GCS is monotonic non-increasing and stays in [3,15] as scene delay grows (req 4.2/4.4)", async () => {
    // Property: more over-target on-scene minutes never RAISE the GCS, and the
    // derived GCS is always a valid clamped integer in [3,15].
    // **Validates: Requirements 4.2**
    await fc.assert(
      fc.asyncProperty(
        // Two derivation offsets past arrival, in whole minutes [0, 60].
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        async (minsA, minsB) => {
          const arriveMs = Date.parse(SCENE_ARRIVE_AT);
          const gcsAt = async (mins: number): Promise<number> => {
            const deriveStateAt = new Date(arriveMs + mins * 60_000).toISOString();
            const { deps } = buildDeps();
            const result = await runMissionLifecycle(
              buildInput({ sceneDepartAt: "2024-06-01T13:30:00.000Z", deriveStateAt }),
              deps,
            );
            expect(result.ok).toBe(true);
            const gcs = result.patientState!.current_gcs;
            // Always a valid clamped integer GCS (req 4.4).
            expect(Number.isInteger(gcs)).toBe(true);
            expect(gcs).toBeGreaterThanOrEqual(3);
            expect(gcs).toBeLessThanOrEqual(15);
            return gcs;
          };

          const lo = Math.min(minsA, minsB);
          const hi = Math.max(minsA, minsB);
          // Longer on-scene delay → GCS no higher (deterioration is monotone).
          expect(await gcsAt(hi)).toBeLessThanOrEqual(await gcsAt(lo));
        },
      ),
      { numRuns: 25 },
    );
  });
});
