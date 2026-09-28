/**
 * Mission authorization, gating enforcement, and audit events (design Section
 * 6.3; requirements 3.6, 3.7, 3.9, 3.10).
 *
 * This module is the authorization/audit layer that WRAPS the pure dispatch core
 * ({@link advanceDispatch} in `./state-machine.ts`). The core deliberately stops
 * short of authorizing: a successful FLIGHT_PLAN submission returns
 * `readyToAuthorize: true` with the computed {@link PAVERisk} / {@link FlightPlan}
 * but does NOT set DISPATCHED or issue an authorization code. This module owns
 * exactly those concerns:
 *
 *   - {@link advanceMissionStage} wraps a single stage transition and appends
 *     exactly one auditable mission event per accepted stage/lifecycle
 *     transition — recording the source state, the target state, and the
 *     transition timestamp (req 3.9). A failed stage validation is surfaced
 *     unchanged and appends NO event (the mission did not transition).
 *
 *   - {@link authorizeMission} performs the final gate. It only authorizes when
 *     the dispatch core reports the mission has passed all four stages
 *     (`readyToAuthorize`); otherwise it returns an error identifying the failed
 *     check and keeps the mission in its pre-dispatch state (req 3.6). On
 *     success it issues an authorization code, sets {@link MissionStatus}
 *     DISPATCHED, publishes the mission package to the EFB (req 3.7), and appends
 *     the transition mission event (req 3.9).
 *
 *   - The training-override rule (req 3.10): an override for a failed check
 *     requires a NON-EMPTY (non-whitespace) rationale, recorded as a mission
 *     event BEFORE authorization. An absent/empty/whitespace-only rationale
 *     rejects the override and prevents authorization; no override event is
 *     recorded and no authorization occurs.
 *
 * Every external effect is behind an injectable seam so this module compiles and
 * is unit-tested in isolation, and so later tasks can back the seams:
 *
 *   - {@link MissionEventSinkPort} — the append-only mission event history
 *     (design `mission_events`). The platform-wide audit log (task 16.1) can
 *     back this sink without changing this module.
 *   - {@link MissionPublisherPort} — EFB publication. The real EFB client is
 *     task 13; here it is a seam. (The realtime fanout from task 7.2 exists as
 *     `RealtimeFanout` and can drive an adapter, but this module prefers a clean
 *     injectable port.)
 *   - {@link AuthorizationCodeIssuer} — issues the authorization code.
 *   - An injectable clock (`now`) for the event timestamp.
 */

import type {
  CrewRoster,
  FlightPlan,
  MissionDispatch,
  MissionStatus,
  PatientInput,
  PAVERisk,
  Timestamp,
  Uuid,
} from "@virtualhems/contracts";

import {
  advanceDispatch,
  type AdvanceDispatchDependencies,
  type DispatchError,
  type DispatchMissionContext,
  type DispatchStage,
  type DispatchStageInput,
  type FlightPlanInput,
} from "./state-machine.js";

// --- Mission event model (design `mission_events`) --------------------------

/**
 * The kinds of auditable mission event this module appends.
 *
 *   - `STAGE_ADVANCED` — an accepted dispatch stage transition (req 3.9).
 *   - `TRAINING_OVERRIDE` — a recorded training override with its rationale,
 *     appended BEFORE authorization (req 3.10).
 *   - `AUTHORIZED` — the mission was authorized and set DISPATCHED (req 3.7 /
 *     the DISPATCHED lifecycle transition of req 3.9).
 */
export const MISSION_EVENT_TYPES = [
  "STAGE_ADVANCED",
  "TRAINING_OVERRIDE",
  "AUTHORIZED",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

/**
 * A single append-only mission event (design `mission_events`: "append-only
 * lifecycle, checklist, communication, and authorization events").
 *
 * Every event records the transition it captures: `source_state` → `target_state`
 * and the `occurred_at` timestamp (req 3.9). A stage transition names the source
 * and target {@link DispatchStage}; a lifecycle authorization names the target
 * {@link MissionStatus}; a training override names the failed check it overrides
 * and carries the required non-empty `rationale` (req 3.10).
 */
export interface MissionEvent {
  mission_id: Uuid;
  event_type: MissionEventType;
  /** The state the mission transitioned FROM (stage name or status). */
  source_state?: string;
  /** The state the mission transitioned TO (stage name or status). */
  target_state?: string;
  /** ISO-8601 transition timestamp (req 3.9). */
  occurred_at: Timestamp;
  /**
   * The non-empty override rationale for a `TRAINING_OVERRIDE` event (req 3.10).
   * Absent on other event types.
   */
  rationale?: string;
  /**
   * The failed check a `TRAINING_OVERRIDE` overrides (req 3.10). Absent on other
   * event types.
   */
  overridden_check?: string;
}

/**
 * Append-only sink for {@link MissionEvent}s (design `mission_events`). Modeled
 * as an injectable port so this module stays independent of the persistence
 * layer and so the platform-wide audit log (task 16.1) can back it.
 */
export interface MissionEventSinkPort {
  /** Append one mission event to the append-only history. */
  append(event: MissionEvent): void;
}

/**
 * Publishes an authorized mission package to the EFB (req 3.7). The real EFB
 * client is task 13; this port is the seam that layer implements.
 */
export interface MissionPublisherPort {
  /** Publish the fully assembled, authorized mission package to the EFB. */
  publish(mission: MissionDispatch): void;
}

/**
 * Issues an authorization code for a mission ready to be dispatched (req 3.7).
 * Injectable so the code scheme is policy-driven and deterministic in tests.
 */
export type AuthorizationCodeIssuer = (
  mission: DispatchMissionContext & { mission_id: Uuid; mission_code: string },
) => string;

// --- Training override model (req 3.10) -------------------------------------

/**
 * A dispatcher's explicit training override of a failed check (req 3.10). The
 * `rationale` must be a NON-EMPTY, non-whitespace-only text entry; otherwise the
 * override is rejected and authorization is prevented.
 */
export interface TrainingOverride {
  /** The failed check being overridden (e.g. a {@link DispatchError} code). */
  overridden_check: string;
  /** Free-text justification. Must be non-empty and not whitespace-only. */
  rationale?: string;
}

// --- Result model -----------------------------------------------------------

/** Machine-readable failure codes specific to the authorization layer. */
export type AuthorizationErrorCode =
  /** The dispatch core reported the mission is not yet ready to authorize. */
  | "NOT_READY_TO_AUTHORIZE"
  /** A training override was supplied without a non-empty rationale (req 3.10). */
  | "OVERRIDE_RATIONALE_REQUIRED";

/** A single authorization-layer failure. */
export interface AuthorizationError {
  code: AuthorizationErrorCode;
  message: string;
  detail?: string;
}

/** Successful authorization outcome (req 3.7). */
export interface AuthorizationSuccess {
  ok: true;
  /** The fully assembled, authorized, DISPATCHED mission package. */
  mission: MissionDispatch;
  /** The issued authorization code. */
  authorizationCode: string;
  /** The mission events appended during authorization, in append order. */
  events: MissionEvent[];
}

/**
 * Failed authorization outcome. `dispatchErrors` carries the dispatch-core
 * checks that failed (req 3.6, identifying the failed check); `authorizationErrors`
 * carries authorization-layer failures (e.g. a missing override rationale, req
 * 3.10). The mission is retained in its pre-dispatch state — no code is issued,
 * status is not set DISPATCHED, and nothing is published (req 3.6 / 3.10).
 */
export interface AuthorizationFailure {
  ok: false;
  dispatchErrors: DispatchError[];
  authorizationErrors: AuthorizationError[];
}

export type AuthorizationResult = AuthorizationSuccess | AuthorizationFailure;

// --- Stage-transition wrapper (req 3.9) -------------------------------------

/** Injectable dependencies shared by the authorization layer. */
export interface MissionServiceDependencies {
  /** The append-only mission event sink (design `mission_events`). */
  events: MissionEventSinkPort;
  /** Returns "now" for event timestamps. Injectable for deterministic tests. */
  now?: () => Date;
}

/**
 * Advance a mission one dispatch stage AND append exactly one auditable mission
 * event on an ACCEPTED transition (req 3.9).
 *
 * This wraps {@link advanceDispatch}: the pure core decides whether the
 * transition is valid; this layer owns the audit side effect. On success it
 * appends a single `STAGE_ADVANCED` event recording the source stage, the target
 * (newly opened) stage, and the timestamp, then returns the core's result
 * unchanged. On failure it appends NO event (the mission did not transition) and
 * returns the failure unchanged so the caller can re-render the stage with the
 * retained input.
 *
 * A successful FLIGHT_PLAN submission opens no further stage (`openedStage` is
 * undefined, `readyToAuthorize` is true); the recorded target is the mission's
 * readiness marker `READY_TO_AUTHORIZE`, and authorization itself is
 * {@link authorizeMission}.
 */
export function advanceMissionStage(
  mission: DispatchMissionContext & { mission_id: Uuid },
  requestedStage: DispatchStage,
  input: DispatchStageInput,
  dispatchDeps: AdvanceDispatchDependencies,
  serviceDeps: MissionServiceDependencies,
): ReturnType<typeof advanceDispatch> {
  const result = advanceDispatch(mission, requestedStage, input, dispatchDeps);

  if (result.ok) {
    const now = (serviceDeps.now ?? (() => new Date()))();
    const target = result.openedStage ?? "READY_TO_AUTHORIZE";
    serviceDeps.events.append({
      mission_id: mission.mission_id,
      event_type: "STAGE_ADVANCED",
      source_state: requestedStage,
      target_state: target,
      occurred_at: now.toISOString(),
    });
  }

  return result;
}

// --- Authorization (req 3.6, 3.7, 3.9, 3.10) --------------------------------

/** Identity fields for the mission being authorized. */
export interface MissionIdentity {
  mission_id: Uuid;
  mission_code: string;
}

/**
 * The already-validated Stage 1–3 artifacts that, together with the Stage 4
 * flight-plan submission, assemble the authorized {@link MissionDispatch}
 * package (design Section 4.4). These come from the earlier accepted stage
 * transitions (Details, Crew, Patient Info).
 */
export interface AuthorizationMissionData {
  details: MissionDispatch["details"];
  crew: CrewRoster;
  patient: PatientInput;
}

/** Injectable dependencies for {@link authorizeMission}. */
export interface AuthorizeMissionDependencies extends MissionServiceDependencies {
  /** The dispatch-core dependencies used to validate the Stage 4 submission. */
  dispatch: AdvanceDispatchDependencies;
  /** Publishes the authorized package to the EFB (req 3.7). */
  publisher: MissionPublisherPort;
  /** Issues the authorization code (req 3.7). */
  issueAuthorizationCode: AuthorizationCodeIssuer;
}

/**
 * Authorize a mission (req 3.6, 3.7, 3.9, 3.10).
 *
 * Order of operations:
 *
 *   1. Re-run the Stage 4 (FLIGHT_PLAN) gate through the dispatch core. If it
 *      does not report `readyToAuthorize`, the mission has a failed check: no
 *      code is issued, status is not set DISPATCHED, nothing is published, and
 *      the failed checks are returned. The mission is retained pre-dispatch
 *      (req 3.6).
 *   2. Enforce the training-override rule (req 3.10): every supplied override
 *      must carry a non-empty (non-whitespace) rationale. Any override missing a
 *      valid rationale rejects the override and prevents authorization — before
 *      any override event is appended and before any code is issued.
 *   3. Append one `TRAINING_OVERRIDE` mission event per valid override, recording
 *      the overridden check and its non-empty rationale, BEFORE authorizing
 *      (req 3.10).
 *   4. Issue an authorization code, set status DISPATCHED, publish to the EFB
 *      (req 3.7), and append the `AUTHORIZED` lifecycle mission event recording
 *      the transition to DISPATCHED and its timestamp (req 3.9).
 */
export function authorizeMission(
  mission: MissionIdentity,
  currentStage: DispatchStage,
  flightPlanInput: FlightPlanInput,
  missionData: AuthorizationMissionData,
  deps: AuthorizeMissionDependencies,
  overrides: TrainingOverride[] = [],
): AuthorizationResult {
  // 1. Gating enforcement (req 3.6): only proceed when all Stage 1–4 checks
  //    pass. The dispatch core owns the check; we honor its verdict.
  const advance = advanceDispatch(
    { currentStage },
    "FLIGHT_PLAN",
    flightPlanInput,
    deps.dispatch,
  );

  if (!advance.ok) {
    // A failed check keeps the mission pre-dispatch: no event, no code, no
    // publish (req 3.6). Return the identified failed checks unchanged.
    return {
      ok: false,
      dispatchErrors: advance.errors,
      authorizationErrors: [],
    };
  }

  if (advance.readyToAuthorize !== true) {
    // Defensive: a FLIGHT_PLAN success is always readyToAuthorize, but never
    // authorize without an explicit readiness signal.
    return {
      ok: false,
      dispatchErrors: [],
      authorizationErrors: [
        {
          code: "NOT_READY_TO_AUTHORIZE",
          message:
            "dispatch core did not report the mission ready to authorize",
        },
      ],
    };
  }

  // 2. Training-override rationale enforcement (req 3.10). Reject the override
  //    (and prevent authorization) when a rationale is absent or empty/whitespace.
  const overrideErrors: AuthorizationError[] = [];
  for (const override of overrides) {
    if (!isNonEmptyRationale(override.rationale)) {
      overrideErrors.push({
        code: "OVERRIDE_RATIONALE_REQUIRED",
        message:
          "a training override requires a non-empty rationale recorded before authorization",
        detail: override.overridden_check,
      });
    }
  }
  if (overrideErrors.length > 0) {
    // No override event is recorded and no authorization occurs (req 3.10).
    return { ok: false, dispatchErrors: [], authorizationErrors: overrideErrors };
  }

  const now = (deps.now ?? (() => new Date()))();
  const timestamp = now.toISOString();
  const appended: MissionEvent[] = [];

  // 3. Record each override with its non-empty rationale BEFORE authorizing
  //    (req 3.10).
  for (const override of overrides) {
    const event: MissionEvent = {
      mission_id: mission.mission_id,
      event_type: "TRAINING_OVERRIDE",
      overridden_check: override.overridden_check,
      // Trimmed so the recorded entry is the meaningful non-empty text.
      rationale: (override.rationale as string).trim(),
      occurred_at: timestamp,
    };
    deps.events.append(event);
    appended.push(event);
  }

  // 4. Authorize (req 3.7): issue code, set DISPATCHED, publish, and append the
  //    lifecycle audit event (req 3.9).
  const risk = advance.risk as PAVERisk;
  const flightPlan = advance.flightPlan as FlightPlan;

  const authorizationCode = deps.issueAuthorizationCode({
    currentStage,
    mission_id: mission.mission_id,
    mission_code: mission.mission_code,
  });

  const dispatchedStatus: MissionStatus = "DISPATCHED";
  const authorizedMission: MissionDispatch = {
    mission_id: mission.mission_id,
    mission_code: mission.mission_code,
    details: missionData.details,
    crew: missionData.crew,
    patient: missionData.patient,
    risk,
    flight_plan: flightPlan,
    status: dispatchedStatus,
    authorization_code: authorizationCode,
  };

  deps.publisher.publish(authorizedMission);

  const authorizedEvent: MissionEvent = {
    mission_id: mission.mission_id,
    event_type: "AUTHORIZED",
    source_state: currentStage,
    target_state: dispatchedStatus,
    occurred_at: timestamp,
  };
  deps.events.append(authorizedEvent);
  appended.push(authorizedEvent);

  return {
    ok: true,
    mission: authorizedMission,
    authorizationCode,
    events: appended,
  };
}

// --- Helpers ----------------------------------------------------------------

/**
 * A rationale is a "non-empty text entry" (req 3.10) only when it is a string
 * with at least one non-whitespace character. `undefined`/`null`, the empty
 * string, and whitespace-only strings all fail.
 */
export function isNonEmptyRationale(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// --- In-memory reference implementations (tests / local wiring) -------------

/** An in-memory append-only {@link MissionEventSinkPort}. */
export class InMemoryMissionEventSink implements MissionEventSinkPort {
  private readonly events: MissionEvent[] = [];

  append(event: MissionEvent): void {
    this.events.push(event);
  }

  /** All appended events in append order (a defensive copy). */
  all(): MissionEvent[] {
    return [...this.events];
  }
}

/** An in-memory {@link MissionPublisherPort} that records published packages. */
export class InMemoryMissionPublisher implements MissionPublisherPort {
  private readonly published: MissionDispatch[] = [];

  publish(mission: MissionDispatch): void {
    this.published.push(mission);
  }

  /** All published mission packages in publish order (a defensive copy). */
  all(): MissionDispatch[] {
    return [...this.published];
  }
}
