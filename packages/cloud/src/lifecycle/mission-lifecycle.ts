/**
 * Full mission-lifecycle wiring (task 19.1; design Section 11.2 flow 9).
 *
 * This module is the INTEGRATION-WIRING for the helicopter simulation. It does
 * NOT re-implement any subsystem — every subsystem (telemetry ingestion,
 * realtime fanout, four-stage dispatch + authorization, clinical Golden Hour +
 * deterioration, AAR + logbook) is already implemented, tested, and green. Here
 * we COMPOSE them into a single cohesive end-to-end path, threading one mission
 * through:
 *
 *   simulator fixture → (bridge) → normalized telemetry
 *     → ingestion → realtime map/EFB fanout
 *     → four-stage dispatch → authorized EFB package
 *     → scene events → clinical deterioration
 *     → touchdown → AAR finalize → logbook / archive update
 *
 * Every subsystem boundary that is async/live in production (DB, realtime,
 * TLS uplink, the Rust bridge) is wired through the existing in-memory /
 * injectable ports the modules already provide, so the composed path is
 * deterministic and testable end-to-end. The Rust bridge is CI-only (no cargo
 * here), so the "simulator fixture → bridge → normalized telemetry" hop is
 * modeled by {@link SimulatorFixtureSource} emitting the normalized telemetry
 * contract the bridge would output (see `./simulator-fixture.ts`).
 *
 * Requirements exercised end-to-end: 1.1 (telemetry validity/acceptance),
 * 2.4 (durable delivery — modeled here as idempotent ingestion acks), 3.7
 * (dispatch GO → authorized EFB package), 4.2 (deterministic clinical
 * deterioration), 6.1 (authorized mission package published to the EFB), and
 * 7.1 (touchdown → AAR generated + persisted + logbook updated).
 */

import type {
  ClinicalEvent,
  CrewRoster,
  DispatchDetails,
  MedicalCondition,
  MissionDispatch,
  PatientInput,
  PatientState,
  Uuid,
} from "@virtualhems/contracts";

// Telemetry ingestion (task 7.1).
import {
  ingestTelemetry,
  type IngestDependencies,
  type TelemetryAck,
} from "../telemetry/index.js";

// Realtime map/EFB fanout (task 7.2).
import {
  RealtimeFanout,
  type AcceptedFrameView,
  type FanoutResult,
  type MissionUpdateInput,
} from "../realtime/index.js";

// Four-stage dispatch + authorization (tasks 8.1–8.3).
import {
  advanceMissionStage,
  authorizeMission,
  type AdvanceDispatchDependencies,
  type AuthorizationResult,
  type AuthorizeMissionDependencies,
  type CrewInput,
  type DetailsInput,
  type DispatchStage,
  type FlightPlanInput,
  type PatientInfoInput,
  type TrainingOverride,
} from "../dispatch/index.js";

// Clinical Golden Hour + deterioration (tasks 9.1–9.2).
import {
  initiateGoldenHour,
  updatePatientState,
  type ClinicalPolicy,
  type DeteriorationResult,
  type GoldenHourResult,
} from "../clinical/index.js";

// AAR finalize + logbook/archive (tasks 14.1–14.2).
import {
  finalizeAar,
  type FinalizeAarDependencies,
  type FinalizeAarResult,
} from "../aar/index.js";

import { SimulatorFixtureSource } from "./simulator-fixture.js";

// --- Composed inputs --------------------------------------------------------

/**
 * The identity + region of the mission being flown through the lifecycle. The
 * region scopes the realtime fanout channels (req 6.3).
 */
export interface LifecycleMissionIdentity {
  mission_id: Uuid;
  mission_code: string;
  region: string;
}

/**
 * The four staged dispatch submissions, plus the already-validated Stage 1–3
 * artifacts the authorization step needs to assemble the authorized package.
 * These mirror the real dispatch-planner submissions (design Section 6.3); the
 * lifecycle threads them through the same {@link advanceMissionStage} /
 * {@link authorizeMission} the web dispatcher uses.
 */
export interface LifecycleDispatchInputs {
  details: DetailsInput;
  crew: CrewInput;
  patient: PatientInfoInput;
  flightPlan: FlightPlanInput;
  /** Assembled Stage 1 details for the authorized package. */
  detailsPackage: DispatchDetails;
  /** Assembled crew roster for the authorized package. */
  crewRoster: CrewRoster;
  /** Assembled patient input for the authorized package. */
  patientPackage: PatientInput;
  /** Optional recorded training overrides (req 3.10). */
  overrides?: TrainingOverride[];
}

/**
 * The clinical context threaded into the Golden Hour + deterioration stages.
 * The condition supplies the decay rate and baseline; the events supply scene
 * timing; the policy supplies the tunables + Policy_Version (req 4.2/4.3/4.7).
 */
export interface LifecycleClinicalContext {
  condition: MedicalCondition;
  /** The recorded clinical events (DISPATCHED → ARRIVED/DEPARTED_SCENE → …). */
  events: ClinicalEvent[];
  /** The event time to derive deteriorated patient state at (ISO-8601). */
  deriveStateAt: string;
  policy: ClinicalPolicy;
}

/** The composed lifecycle inputs. */
export interface MissionLifecycleInput {
  identity: LifecycleMissionIdentity;
  /** The simulator-fixture telemetry source (bridge output stand-in). */
  telemetry: SimulatorFixtureSource;
  dispatch: LifecycleDispatchInputs;
  clinical: LifecycleClinicalContext;
}

/**
 * The injectable subsystem dependencies. Every one is an existing port from the
 * subsystem module — the lifecycle owns none of the persistence/transport, it
 * only threads the ports together.
 */
export interface MissionLifecycleDependencies {
  ingest: IngestDependencies;
  fanout: RealtimeFanout;
  dispatch: AuthorizeMissionDependencies;
  aar: FinalizeAarDependencies;
}

// --- Composed result --------------------------------------------------------

/** The recorded outcome of one telemetry frame flowing through the path. */
export interface TelemetryStageOutcome {
  ack: TelemetryAck;
  /**
   * The realtime fanout for an ACCEPTED frame (req 6.3). `undefined` for an
   * idempotent `duplicate` replay, which is acknowledged but NOT re-broadcast
   * (req 2.4) — matching the ingestion-bridge contract.
   */
  fanout?: FanoutResult;
}

/** The full lifecycle outcome — each stage's output, in flow order. */
export interface MissionLifecycleResult {
  ok: boolean;
  /** Stage 1: ingestion + realtime fanout per accepted frame. */
  telemetry: TelemetryStageOutcome[];
  /** Stage 2: the authorized EFB mission package (present iff dispatch GO). */
  authorization: AuthorizationResult;
  /** The authorized package, hoisted for convenience (req 3.7 / 6.1). */
  missionPackage?: MissionDispatch;
  /** Stage 3: Golden Hour initiation. */
  goldenHour: GoldenHourResult;
  /** Stage 4: deterministic clinical deterioration at the derivation time. */
  deterioration?: DeteriorationResult;
  /** The derived (possibly deteriorated) patient state. */
  patientState?: PatientState;
  /** Stage 5: the realtime mission/patient update published to the EFB. */
  missionUpdate?: FanoutResult;
  /** Stage 6: AAR finalize → immutable persist + logbook/archive update. */
  aar?: FinalizeAarResult;
  /** Where the path stopped, when it did not complete. */
  haltedAt?:
    | "TELEMETRY"
    | "DISPATCH_AUTHORIZATION"
    | "GOLDEN_HOUR"
    | "DETERIORATION"
    | "AAR";
}

// --- Composition ------------------------------------------------------------

/**
 * Build the {@link AcceptedFrameView} the realtime fanout consumes from a
 * normalized fixture frame and its accepted ingestion ack. This is the one
 * minimal adapter the lifecycle owns: ingestion returns a persistence-key ack
 * (no position/flight body) while the fanout wants the operational body + the
 * region, so we carry the frame's normalized vectors across the seam. It
 * reshapes neither subsystem.
 */
function toAssetStateView(
  frame: import("@virtualhems/contracts").TelemetryFrame,
  ack: TelemetryAck,
  region: string,
): AcceptedFrameView {
  const view: AcceptedFrameView = {
    pilot_id: ack.pilot_id,
    region,
    position: frame.position,
    flight: frame.flight,
    systems: frame.systems,
    observed_at: ack.source_observed_at,
    received_at: ack.received_at,
    sequence_number: ack.sequence_number,
  };
  if (frame.mission_id !== undefined) {
    view.mission_id = frame.mission_id;
  }
  return view;
}

/**
 * The four ordered dispatch stages the lifecycle advances through before
 * authorizing (design Section 6.3).
 */
const DISPATCH_FLOW: ReadonlyArray<{
  stage: DispatchStage;
  pick: (d: LifecycleDispatchInputs) =>
    | DetailsInput
    | CrewInput
    | PatientInfoInput
    | FlightPlanInput;
}> = [
  { stage: "DETAILS", pick: (d) => d.details },
  { stage: "CREW", pick: (d) => d.crew },
  { stage: "PATIENT_INFO", pick: (d) => d.patient },
];

/**
 * Run one mission through the composed end-to-end lifecycle (task 19.1).
 *
 * The path is threaded stage-by-stage; each stage's output feeds the next. It
 * short-circuits with `ok: false` and a `haltedAt` marker at the first stage
 * that does not succeed, so a caller sees exactly how far a mission got — the
 * happy path runs every stage in order.
 *
 * Async because ingestion and the realtime fanout are async ports; the dispatch
 * and clinical cores are synchronous and pure and are awaited only for ordering
 * clarity.
 */
export async function runMissionLifecycle(
  input: MissionLifecycleInput,
  deps: MissionLifecycleDependencies,
): Promise<MissionLifecycleResult> {
  const { identity, telemetry, dispatch, clinical } = input;
  const region = identity.region;

  // --- Stage 1: simulator fixture → ingestion → realtime map/EFB fanout -----
  // Each normalized frame is authenticated + validated + persisted by the
  // ingestion core (req 1.1); an accepted frame is fanned out to the region's
  // realtime map / EFB clients (req 6.3). A duplicate ack (idempotent replay,
  // req 2.4) is NOT re-broadcast, matching the ingestion-bridge contract.
  const telemetryOutcomes: TelemetryStageOutcome[] = [];
  for (const { session_id, frame } of telemetry.frames()) {
    const result = await ingestTelemetry(
      {
        frame_id: frame.frame_id,
        session_id,
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
      },
      // The fixture stands in for an authenticated bridge session; the concrete
      // authenticator resolves the principal.
      frame.pilot_id,
      deps.ingest,
    );

    if (!result.ok) {
      // A rejected frame halts the telemetry stage (a real bridge would keep
      // the frame queued; here a rejection is a hard stop for determinism).
      return {
        ok: false,
        telemetry: telemetryOutcomes,
        authorization: { ok: false, dispatchErrors: [], authorizationErrors: [] },
        goldenHour: { ok: false, errors: [] },
        haltedAt: "TELEMETRY",
      };
    }

    if (result.ack.disposition === "accepted") {
      const fanout = await deps.fanout.broadcastAssetState(
        toAssetStateView(frame, result.ack, region),
      );
      telemetryOutcomes.push({ ack: result.ack, fanout });
    } else {
      // Idempotent replay (req 2.4): acknowledged, not re-broadcast.
      telemetryOutcomes.push({ ack: result.ack });
    }
  }

  // --- Stage 2: four-stage dispatch → authorized EFB package ----------------
  // Advance DETAILS → CREW → PATIENT_INFO (each appends an auditable event,
  // req 3.9), then authorize the FLIGHT_PLAN. Authorization is the gate: only a
  // valid GO issues a code, sets DISPATCHED, and publishes the package to the
  // EFB (req 3.7 / 6.1).
  let currentStage: DispatchStage = "DETAILS";
  const stageServiceDeps = {
    events: deps.dispatch.events,
    ...(deps.dispatch.now !== undefined ? { now: deps.dispatch.now } : {}),
  };
  const advanceDeps: AdvanceDispatchDependencies = deps.dispatch.dispatch;

  for (const step of DISPATCH_FLOW) {
    const advance = advanceMissionStage(
      { currentStage, mission_id: identity.mission_id },
      step.stage,
      step.pick(dispatch),
      advanceDeps,
      stageServiceDeps,
    );
    if (!advance.ok) {
      return {
        ok: false,
        telemetry: telemetryOutcomes,
        authorization: {
          ok: false,
          dispatchErrors: advance.errors,
          authorizationErrors: [],
        },
        goldenHour: { ok: false, errors: [] },
        haltedAt: "DISPATCH_AUTHORIZATION",
      };
    }
    currentStage = advance.openedStage ?? currentStage;
  }

  const authorization = authorizeMission(
    { mission_id: identity.mission_id, mission_code: identity.mission_code },
    currentStage,
    dispatch.flightPlan,
    {
      details: dispatch.detailsPackage,
      crew: dispatch.crewRoster,
      patient: dispatch.patientPackage,
    },
    deps.dispatch,
    dispatch.overrides ?? [],
  );

  if (!authorization.ok) {
    return {
      ok: false,
      telemetry: telemetryOutcomes,
      authorization,
      goldenHour: { ok: false, errors: [] },
      haltedAt: "DISPATCH_AUTHORIZATION",
    };
  }
  const missionPackage = authorization.mission;

  // --- Stage 3: Golden Hour initiation (req 4.1) ----------------------------
  // The authorized dispatch anchors a scene-call Golden Hour timer and seeds the
  // initial patient state.
  const dispatchEvent = clinical.events.find((e) => e.event_type === "DISPATCHED");
  const goldenHour = initiateGoldenHour({
    mission_id: identity.mission_id,
    mission_type: missionPackage.details.mission_type,
    ...(dispatchEvent !== undefined ? { dispatchEvent } : {}),
    condition: clinical.condition,
  });

  if (!goldenHour.ok) {
    return {
      ok: false,
      telemetry: telemetryOutcomes,
      authorization,
      missionPackage,
      goldenHour,
      haltedAt: "GOLDEN_HOUR",
    };
  }

  // --- Stage 4: scene events → deterministic clinical deterioration ---------
  // Advance the seeded patient state to the derivation time using the recorded
  // scene events + the dispatch anchor (req 4.2).
  const deterioration = updatePatientState({
    patient: goldenHour.initiation.patient,
    eventTime: clinical.deriveStateAt,
    dispatchTime: goldenHour.initiation.timer.anchoredAt,
    events: clinical.events,
    condition: clinical.condition,
    policy: clinical.policy,
  });

  if (!deterioration.ok) {
    return {
      ok: false,
      telemetry: telemetryOutcomes,
      authorization,
      missionPackage,
      goldenHour,
      deterioration,
      haltedAt: "DETERIORATION",
    };
  }
  const patientState = deterioration.patient;

  // --- Stage 5: publish the mission/patient update to the EFB (req 6.3) -----
  const missionUpdateInput: MissionUpdateInput = {
    mission_id: identity.mission_id,
    region,
    status: missionPackage.status,
    patient_state: patientState,
    updated_at: clinical.deriveStateAt,
  };
  const missionUpdate = await deps.fanout.broadcastMissionUpdate(missionUpdateInput);

  // --- Stage 6: touchdown → AAR finalize → logbook / archive update ---------
  // finalizeAar runs generateAar (touchdown detection + metric derivation,
  // req 7.1/7.2), scores against the effective policy, persists the report
  // immutably, and appends the pilot-logbook entry (req 7.5). The touchdown
  // itself is a recorded TOUCHDOWN clinical event the AAR loaders surface.
  const aar = finalizeAar(identity.mission_id, deps.aar);
  if (!aar.ok) {
    return {
      ok: false,
      telemetry: telemetryOutcomes,
      authorization,
      missionPackage,
      goldenHour,
      deterioration,
      patientState,
      missionUpdate,
      aar,
      haltedAt: "AAR",
    };
  }

  return {
    ok: true,
    telemetry: telemetryOutcomes,
    authorization,
    missionPackage,
    goldenHour,
    deterioration,
    patientState,
    missionUpdate,
    aar,
  };
}
