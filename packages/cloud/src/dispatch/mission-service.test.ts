import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  CrewRoster,
  DispatchDetails,
  MedicalCondition,
  PatientInput,
} from "@virtualhems/contracts";
import {
  advanceDispatch,
  type AdvanceDispatchDependencies,
  type FlightPlanInput,
  type PavePolicy,
  type ReservePolicy,
} from "./state-machine.js";
import { InMemoryDispatchLookup } from "./in-memory-lookup.js";
import { InMemoryConditionResolver } from "./in-memory-condition-resolver.js";
import {
  advanceMissionStage,
  authorizeMission,
  isNonEmptyRationale,
  InMemoryMissionEventSink,
  InMemoryMissionPublisher,
  type AuthorizationMissionData,
  type AuthorizeMissionDependencies,
  type MissionIdentity,
  type TrainingOverride,
} from "./mission-service.js";

// --- Fixtures ----------------------------------------------------------------

const MISSION_ID = "01000000-0000-0000-0000-000000000001";
const MISSION_CODE = "HEMS-001";
const CONDITION_ID = "d0000000-0000-0000-0000-000000000001";
const PATIENT_ID = "p0000000-0000-0000-0000-000000000001";
const PIC_ID = "c0000000-0000-0000-0000-000000000001";

const NOW = new Date("2024-01-01T12:00:00.000Z");

const RESERVE_POLICY: ReservePolicy = { required_reserve_minutes: 20 };
const PAVE_POLICY: PavePolicy = {
  go_max: 3,
  conditional_max: 6,
  max_component_score: 4,
};

function traumaCondition(): MedicalCondition {
  return {
    id: CONDITION_ID,
    name: "Blunt trauma",
    category: "TRAUMA",
    baseline_gcs_min: 10,
    baseline_gcs_max: 14,
    requires_rsi: false,
    decay_rate_per_minute: 0.5,
    target_facility_type: "TRAUMA_I",
  };
}

/** A short valid route that comfortably meets the reserve margin. */
function validRoute(): FlightPlanInput["route"] {
  return [
    { latitude_deg: 40.44, longitude_deg: -80.0 },
    { latitude_deg: 40.5, longitude_deg: -80.05 },
  ];
}

/** A fully valid Stage 4 flight-plan submission (GO disposition, ample reserve). */
function validFlightPlanInput(
  overrides: Partial<FlightPlanInput> = {},
): FlightPlanInput {
  return {
    route: validRoute(),
    pave: {
      pilot_score: 1,
      aircraft_score: 1,
      environment_score: 0,
      external_score: 0,
    },
    ...overrides,
  };
}

/** A flight-plan submission that fails a check (NO_GO PAVE disposition). */
function noGoFlightPlanInput(): FlightPlanInput {
  return validFlightPlanInput({
    pave: {
      pilot_score: 4,
      aircraft_score: 4,
      environment_score: 4,
      external_score: 4,
    },
  });
}

function dispatchDeps(
  overrides: Partial<AdvanceDispatchDependencies> = {},
): AdvanceDispatchDependencies {
  return {
    lookup: overrides.lookup ?? new InMemoryDispatchLookup(),
    now: overrides.now ?? (() => NOW),
    conditionResolver:
      overrides.conditionResolver ??
      new InMemoryConditionResolver([traumaCondition()]),
    reservePolicy: overrides.reservePolicy ?? RESERVE_POLICY,
    pavePolicy: overrides.pavePolicy ?? PAVE_POLICY,
  };
}

const DETAILS: DispatchDetails = {
  mission_type: "SCENE_CALL",
  assigned_base_id: "b0000000-0000-0000-0000-000000000001",
  assigned_airframe_id: "a0000000-0000-0000-0000-000000000001",
  origin_hospital_id: "f0000000-0000-0000-0000-000000000001",
  destination_hospital_id: "f0000000-0000-0000-0000-000000000002",
  weather_snapshot: { observed_at: NOW.toISOString() },
};

const CREW: CrewRoster = { pilot_in_command_id: PIC_ID };

const PATIENT: PatientInput = {
  simulated_patient_id: PATIENT_ID,
  age_years: 42,
  gender: "M",
  weight_lbs: 180,
  condition_id: CONDITION_ID,
  clinical_summary: "MVC, chest pain",
  interventions: "IV, O2",
  baseline_gcs: 12,
};

function missionData(): AuthorizationMissionData {
  return { details: DETAILS, crew: CREW, patient: PATIENT };
}

function identity(): MissionIdentity {
  return { mission_id: MISSION_ID, mission_code: MISSION_CODE };
}

function authDeps(
  events: InMemoryMissionEventSink,
  publisher: InMemoryMissionPublisher,
  overrides: Partial<AuthorizeMissionDependencies> = {},
): AuthorizeMissionDependencies {
  return {
    events,
    publisher,
    now: () => NOW,
    dispatch: dispatchDeps(),
    issueAuthorizationCode: () => "AUTH-CODE-123",
    ...overrides,
  };
}

// ============================================================================
// req 3.6 — gating enforcement: a failed check prevents DISPATCHED / EFB
// ============================================================================

describe("authorizeMission gating enforcement — req 3.6", () => {
  it("prevents DISPATCHED, prevents EFB publish, and identifies the failed check", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    const result = authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      noGoFlightPlanInput(),
      missionData(),
      authDeps(events, publisher),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The failed check is identified (req 3.6).
    expect(result.dispatchErrors.map((e) => e.code)).toContain(
      "DISPATCH_DISPOSITION_NO_GO",
    );
    // No authorization code, no DISPATCHED status, no EFB publication.
    expect(publisher.all()).toEqual([]);
    // The mission is retained pre-dispatch: no mission events appended.
    expect(events.all()).toEqual([]);
  });

  it("returns the failed check for an insufficient reserve margin", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    // A long route with little fuel fails the reserve-margin gate.
    const result = authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      validFlightPlanInput({
        route: [
          { latitude_deg: 40.44, longitude_deg: -80.0 },
          { latitude_deg: 44.0, longitude_deg: -85.0 },
        ],
        usable_fuel_lbs: 200,
      }),
      missionData(),
      authDeps(events, publisher),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dispatchErrors.map((e) => e.code)).toContain(
      "RESERVE_MARGIN_INSUFFICIENT",
    );
    expect(publisher.all()).toEqual([]);
  });
});

// ============================================================================
// req 3.7 — authorization: issue code, set DISPATCHED, publish to EFB
// ============================================================================

describe("authorizeMission success — req 3.7", () => {
  it("issues a code, sets DISPATCHED, and publishes the mission package", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    const result = authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      missionData(),
      authDeps(events, publisher),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.authorizationCode).toBe("AUTH-CODE-123");
    expect(result.mission.status).toBe("DISPATCHED");
    expect(result.mission.authorization_code).toBe("AUTH-CODE-123");
    // The mission package is published to the EFB.
    const published = publisher.all();
    expect(published).toHaveLength(1);
    expect(published[0]!.status).toBe("DISPATCHED");
    expect(published[0]!.mission_id).toBe(MISSION_ID);
    expect(published[0]!.risk.disposition).toBe("GO");
    expect(published[0]!.flight_plan.route).toHaveLength(2);
  });
});

// ============================================================================
// req 3.9 — one auditable mission event per transition (source/target/timestamp)
// ============================================================================

describe("mission events — req 3.9", () => {
  it("authorization appends exactly one AUTHORIZED event with source, target, and timestamp", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      missionData(),
      authDeps(events, publisher),
    );

    const authorized = events.all().filter((e) => e.event_type === "AUTHORIZED");
    expect(authorized).toHaveLength(1);
    expect(authorized[0]).toMatchObject({
      mission_id: MISSION_ID,
      source_state: "FLIGHT_PLAN",
      target_state: "DISPATCHED",
      occurred_at: NOW.toISOString(),
    });
  });

  it("advanceMissionStage appends one STAGE_ADVANCED event on an accepted transition", () => {
    const events = new InMemoryMissionEventSink();

    const result = advanceMissionStage(
      { mission_id: MISSION_ID, currentStage: "PATIENT_INFO" },
      "PATIENT_INFO",
      {
        simulated_patient_id: PATIENT_ID,
        age_years: 42,
        gender: "M",
        weight_lbs: 180,
        condition_id: CONDITION_ID,
        clinical_summary: "MVC",
        interventions: "IV",
      },
      dispatchDeps(),
      { events, now: () => NOW },
    );

    expect(result.ok).toBe(true);
    const all = events.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      event_type: "STAGE_ADVANCED",
      source_state: "PATIENT_INFO",
      target_state: "FLIGHT_PLAN",
      occurred_at: NOW.toISOString(),
    });
  });

  it("advanceMissionStage appends NO event on a failed transition", () => {
    const events = new InMemoryMissionEventSink();

    const result = advanceMissionStage(
      { mission_id: MISSION_ID, currentStage: "CREW" },
      "CREW",
      { members: [] }, // too small, no PIC
      dispatchDeps(),
      { events, now: () => NOW },
    );

    expect(result.ok).toBe(false);
    expect(events.all()).toEqual([]);
  });

  it("records the readiness marker as the target when the final stage is accepted", () => {
    const events = new InMemoryMissionEventSink();

    advanceMissionStage(
      { mission_id: MISSION_ID, currentStage: "FLIGHT_PLAN" },
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      dispatchDeps(),
      { events, now: () => NOW },
    );

    expect(events.all()[0]).toMatchObject({
      event_type: "STAGE_ADVANCED",
      source_state: "FLIGHT_PLAN",
      target_state: "READY_TO_AUTHORIZE",
    });
  });
});

// ============================================================================
// req 3.10 — training-override rationale enforcement
// ============================================================================

describe("training-override rationale enforcement — req 3.10", () => {
  const override = (rationale?: string): TrainingOverride => ({
    overridden_check: "DISPATCH_DISPOSITION_NO_GO",
    rationale,
  });

  it("records a training override with a non-empty rationale as a mission event and permits authorization", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    const result = authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      missionData(),
      authDeps(events, publisher),
      [override("Training scenario: intentionally elevated risk")],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const all = events.all();
    const overrideIdx = all.findIndex((e) => e.event_type === "TRAINING_OVERRIDE");
    const authIdx = all.findIndex((e) => e.event_type === "AUTHORIZED");
    // The override is recorded with its non-empty rationale.
    expect(overrideIdx).toBeGreaterThanOrEqual(0);
    expect(all[overrideIdx]).toMatchObject({
      event_type: "TRAINING_OVERRIDE",
      overridden_check: "DISPATCH_DISPOSITION_NO_GO",
      rationale: "Training scenario: intentionally elevated risk",
    });
    // The override event is recorded BEFORE the authorization event.
    expect(overrideIdx).toBeLessThan(authIdx);
    expect(publisher.all()).toHaveLength(1);
  });

  it("rejects a training override with an absent rationale and prevents authorization", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    const result = authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      missionData(),
      authDeps(events, publisher),
      [override(undefined)],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.authorizationErrors.map((e) => e.code)).toContain(
      "OVERRIDE_RATIONALE_REQUIRED",
    );
    // No override event recorded, no authorization, no publish.
    expect(events.all()).toEqual([]);
    expect(publisher.all()).toEqual([]);
  });

  it("rejects a training override with an empty-string rationale and prevents authorization", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    const result = authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      missionData(),
      authDeps(events, publisher),
      [override("")],
    );

    expect(result.ok).toBe(false);
    expect(events.all()).toEqual([]);
    expect(publisher.all()).toEqual([]);
  });

  it("rejects a training override with a whitespace-only rationale and prevents authorization", () => {
    const events = new InMemoryMissionEventSink();
    const publisher = new InMemoryMissionPublisher();

    const result = authorizeMission(
      identity(),
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      missionData(),
      authDeps(events, publisher),
      [override("   \t\n  ")],
    );

    expect(result.ok).toBe(false);
    expect(events.all()).toEqual([]);
    expect(publisher.all()).toEqual([]);
  });

  // Property: for ANY rationale string, the override is accepted iff the string
  // has at least one non-whitespace character; whitespace-only/empty is rejected
  // and prevents authorization, and no state leaks on rejection (req 3.10).
  it("accepts iff rationale is non-empty text; rejection prevents authorization (property)", () => {
    fc.assert(
      fc.property(fc.string(), (rationale) => {
        const events = new InMemoryMissionEventSink();
        const publisher = new InMemoryMissionPublisher();

        const result = authorizeMission(
          identity(),
          "FLIGHT_PLAN",
          validFlightPlanInput(),
          missionData(),
          authDeps(events, publisher),
          [override(rationale)],
        );

        const shouldAccept = rationale.trim().length > 0;
        expect(result.ok).toBe(shouldAccept);
        expect(isNonEmptyRationale(rationale)).toBe(shouldAccept);

        if (shouldAccept) {
          const overrideEvents = events
            .all()
            .filter((e) => e.event_type === "TRAINING_OVERRIDE");
          expect(overrideEvents).toHaveLength(1);
          // The recorded rationale is the trimmed, non-empty text.
          expect(overrideEvents[0]!.rationale).toBe(rationale.trim());
          expect(publisher.all()).toHaveLength(1);
        } else {
          // Rejection prevents authorization: nothing recorded, nothing published.
          expect(events.all()).toEqual([]);
          expect(publisher.all()).toEqual([]);
        }
      }),
    );
  });
});

// ============================================================================
// Regression: the dispatch core still stops short of authorizing (seam intact)
// ============================================================================

describe("dispatch core seam", () => {
  it("advanceDispatch reports readyToAuthorize without setting DISPATCHED", () => {
    const result = advanceDispatch(
      { currentStage: "FLIGHT_PLAN" },
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      dispatchDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.readyToAuthorize).toBe(true);
    // The core does not carry a status/authorization code.
    expect(result).not.toHaveProperty("status");
  });
});
