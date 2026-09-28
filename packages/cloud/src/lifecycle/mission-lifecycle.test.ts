/**
 * Smoke test for the full mission-lifecycle wiring (task 19.1).
 *
 * This is the composition proof, not the exhaustive end-to-end suite (that is
 * task 19.2). It runs the composed happy path once and asserts each stage's
 * output feeds the next in order:
 *
 *   simulator fixture → ingestion (accepted) → realtime fanout
 *     → dispatch GO → authorized EFB package published
 *     → Golden Hour initiated → clinical state derived
 *     → mission update fanned out → AAR persisted + logbook entry appended
 *
 * Every subsystem is wired through its existing in-memory port, so the run is
 * deterministic with no live DB / realtime / bridge.
 */

import { describe, expect, it } from "vitest";
import type {
  ClinicalEvent,
  DispatchDetails,
  MedicalCondition,
  TelemetryFrame,
} from "@virtualhems/contracts";

import {
  InMemoryTelemetryRepository,
  type AuthenticatedPilot,
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

// Session anchored to a fixed instant so the run is fully deterministic.
const SESSION_START = "2024-06-01T12:00:00.000Z";
const DISPATCH_AT = "2024-06-01T12:00:00.000Z";
const SCENE_ARRIVE_AT = "2024-06-01T12:10:00.000Z";
const SCENE_DEPART_AT = "2024-06-01T12:40:00.000Z";
const TOUCHDOWN_AT = "2024-06-01T13:00:00.000Z";
const DERIVE_STATE_AT = "2024-06-01T12:45:00.000Z";

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

function clinicalEvents(): ClinicalEvent[] {
  const meta: Record<string, string> = {};
  const src = "SYSTEM" as const;
  return [
    { mission_id: MISSION_ID, event_type: "DISPATCHED", occurred_at: DISPATCH_AT, source: src, metadata: meta },
    { mission_id: MISSION_ID, event_type: "ARRIVED_SCENE", occurred_at: SCENE_ARRIVE_AT, source: src, metadata: meta },
    { mission_id: MISSION_ID, event_type: "DEPARTED_SCENE", occurred_at: SCENE_DEPART_AT, source: src, metadata: meta },
    { mission_id: MISSION_ID, event_type: "TOUCHDOWN", occurred_at: TOUCHDOWN_AT, source: src, metadata: meta },
  ];
}

/**
 * A telemetry frame with a grounded touchdown at the end so the AAR can detect
 * the landing from telemetry as well as the recorded TOUCHDOWN event.
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

function buildInput(): MissionLifecycleInput {
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
      events: clinicalEvents(),
      deriveStateAt: DERIVE_STATE_AT,
      policy: { policy_version: "policy-2024.1", scene_target_seconds: 1200 },
    },
  };
}

function buildDeps(): {
  deps: MissionLifecycleDependencies;
  broadcaster: InMemoryRealtimeBroadcaster;
  publisher: InMemoryMissionPublisher;
  events: InMemoryMissionEventSink;
  store: InMemoryAarReportStore;
  logbook: InMemoryPilotLogbook;
  repository: InMemoryTelemetryRepository;
} {
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

  // Fixed clock so the fixture's observed_at falls inside the ingestion accept
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
    events: clinicalEvents(),
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

describe("runMissionLifecycle — end-to-end happy path (task 19.1)", () => {
  it("threads a mission through every stage in order", async () => {
    const input = buildInput();
    const { deps, broadcaster, publisher, store, logbook, repository } = buildDeps();

    const result = await runMissionLifecycle(input, deps);

    // The composed path completed without halting.
    expect(result.ok).toBe(true);
    expect(result.haltedAt).toBeUndefined();

    // Stage 1: simulator fixture → ingestion → realtime fanout.
    // Both fixture frames were accepted and persisted (req 1.1); no duplicate.
    expect(result.telemetry).toHaveLength(2);
    expect(result.telemetry.every((t) => t.ack.disposition === "accepted")).toBe(true);
    expect(repository.size()).toBe(2);
    // Each accepted frame was fanned out to the region's realtime clients.
    expect(result.telemetry.every((t) => (t.fanout?.channels.length ?? 0) > 0)).toBe(true);

    // Stage 2: four-stage dispatch GO → authorized EFB package (req 3.7 / 6.1).
    expect(result.authorization.ok).toBe(true);
    expect(result.missionPackage?.status).toBe("DISPATCHED");
    expect(result.missionPackage?.authorization_code).toBe("AUTH-VH-001");
    // The authorized package was published to the EFB.
    expect(publisher.all()).toHaveLength(1);
    expect(publisher.all()[0]?.mission_id).toBe(MISSION_ID);

    // Stage 3: Golden Hour initiated off the DISPATCHED anchor (req 4.1).
    expect(result.goldenHour.ok).toBe(true);
    if (result.goldenHour.ok) {
      expect(result.goldenHour.initiation.timer.anchoredAt).toBe(DISPATCH_AT);
      expect(result.goldenHour.initiation.timer.durationSeconds).toBe(3600);
    }

    // Stage 4: deterministic deterioration from the scene delay (req 4.2).
    // Scene target 1200s (20 min); on-scene 35 min (arrive 12:10 → derive
    // 12:45) → 15 over-target minutes → GCS drops below baseline 14.
    expect(result.deterioration?.ok).toBe(true);
    expect(result.patientState).toBeDefined();
    expect(result.patientState!.deteriorated).toBe(true);
    expect(result.patientState!.current_gcs).toBeLessThan(result.patientState!.baseline_gcs);
    expect(result.patientState!.current_gcs).toBeGreaterThanOrEqual(3);

    // Stage 5: the mission/patient update was fanned out to the EFB.
    expect(result.missionUpdate?.channels.length).toBeGreaterThan(0);

    // Stage 6: touchdown → AAR finalized → immutable persist + logbook (req 7.1).
    expect(result.aar?.ok).toBe(true);
    if (result.aar?.ok) {
      expect(result.aar.stored.report.mission_id).toBe(MISSION_ID);
      expect(result.aar.stored.version).toBe(1);
      expect(result.aar.logbookEntry.mission_id).toBe(MISSION_ID);
      expect(result.aar.logbookEntry.outcome).toBe("COMPLETED");
    }
    // The report is persisted immutably and the pilot logbook grew by one.
    expect(store.get(MISSION_ID)).toBeDefined();
    expect(logbook.entriesFor(PILOT_ID)).toHaveLength(1);

    // Cross-stage wiring: the audit trail recorded the dispatch transitions +
    // the authorization (STAGE_ADVANCED × 3 opening CREW/PATIENT_INFO/ready,
    // plus AUTHORIZED).
    const eventTypes = deps.dispatch.events instanceof InMemoryMissionEventSink
      ? deps.dispatch.events.all().map((e) => e.event_type)
      : [];
    void broadcaster; // fanout results already asserted above
    expect(eventTypes).toContain("AUTHORIZED");
  });

  it("idempotent replay of the same frames is acknowledged, not re-broadcast (req 2.4)", async () => {
    const { deps, repository } = buildDeps();

    // Run the telemetry stage twice over the same session via two lifecycle runs
    // sharing one repository: the second run's frames collide on the idempotency
    // key and return duplicate acks without persisting duplicates.
    const first = await runMissionLifecycle(buildInput(), deps);
    expect(first.ok).toBe(true);
    expect(repository.size()).toBe(2);

    const second = await runMissionLifecycle(buildInput(), deps);
    // Second run's frames are idempotent duplicates (req 2.4): no new rows.
    expect(second.telemetry.every((t) => t.ack.disposition === "duplicate")).toBe(true);
    expect(repository.size()).toBe(2);
    // A duplicate ack is not re-broadcast.
    expect(second.telemetry.every((t) => t.fanout === undefined)).toBe(true);
  });
});
