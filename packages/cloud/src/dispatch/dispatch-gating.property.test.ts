/**
 * Property 3: Dispatch gating (design Section 6.3; requirements 3.6, 3.7, 3.9).
 *
 * The universal gating invariants asserted here, over randomized dispatch input:
 *
 *   - **Gating (req 3.6 / 3.7):** a mission reaches DISPATCHED status AND is
 *     published to the EFB IF AND ONLY IF every required check passes — valid
 *     Stage 1 Details, Stage 2 Crew, Stage 3 Patient Info, plus the Stage 4
 *     flight plan whose route, PAVE component scores, reserve policy,
 *     reserve-margin check, and PAVE disposition (not NO_GO) are all valid. When
 *     any check fails, `authorizeMission` fails: no authorization code is
 *     issued, no DISPATCHED status is set, and nothing is published.
 *   - **Auditability (req 3.9):** every ACCEPTED transition appends exactly one
 *     mission event recording source, target, and timestamp; a REJECTED
 *     transition appends none. This is asserted both for the final authorization
 *     (`authorizeMission` → one AUTHORIZED event) and for each per-stage advance
 *     (`advanceMissionStage` → one STAGE_ADVANCED event on accept, zero on
 *     reject).
 *
 * The oracle is derived from the SAME rules the implementation honors — the
 * pure `validateFlightPlan` / `validateDetails` / `validateCrew` /
 * `validatePatientInfo` core — so the test never re-encodes the thresholds; it
 * asserts the authorization outcome and its audit/publish side effects agree
 * with what the pure validators say. All external effects go through the
 * in-memory seams (lookup, condition resolver, event sink, publisher) plus an
 * injected deterministic clock and code issuer.
 *
 * This is a TEST for existing behavior — it changes no dispatch implementation.
 *
 * Validates: Requirements 3.6, 3.7, 3.9
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  CrewRoster,
  DispatchDetails,
  GeoPoint,
  MedicalCondition,
  PatientInput,
} from "@virtualhems/contracts";
import {
  advanceDispatch,
  advanceMissionStage,
  authorizeMission,
  validateCrew,
  validateDetails,
  validateFlightPlan,
  validatePatientInfo,
  InMemoryConditionResolver,
  InMemoryDispatchLookup,
  InMemoryMissionEventSink,
  InMemoryMissionPublisher,
  type AdvanceDispatchDependencies,
  type AuthorizationMissionData,
  type AuthorizeMissionDependencies,
  type CrewInput,
  type DetailsInput,
  type DispatchStage,
  type FlightPlanInput,
  type MissionIdentity,
  type PatientInfoInput,
  type PavePolicy,
  type ReservePolicy,
} from "./index.js";

// --- Deterministic fixtures / injected seams --------------------------------

const MISSION_ID = "01000000-0000-0000-0000-000000000001";
const MISSION_CODE = "HEMS-001";
const AUTH_CODE = "AUTH-CODE-123";

const BASE_ID = "b0000000-0000-0000-0000-000000000001";
const AIRFRAME_ID = "a0000000-0000-0000-0000-000000000001";
const ORIGIN_ID = "f0000000-0000-0000-0000-000000000001";
const DEST_ID = "f0000000-0000-0000-0000-000000000002";
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

function lookup(): InMemoryDispatchLookup {
  return new InMemoryDispatchLookup({
    baseIds: [BASE_ID],
    airframeIds: [AIRFRAME_ID],
    facilityIds: [ORIGIN_ID, DEST_ID],
  });
}

function dispatchDeps(): AdvanceDispatchDependencies {
  return {
    lookup: lookup(),
    now: () => NOW,
    conditionResolver: new InMemoryConditionResolver([traumaCondition()]),
    reservePolicy: RESERVE_POLICY,
    pavePolicy: PAVE_POLICY,
  };
}

function authDeps(
  events: InMemoryMissionEventSink,
  publisher: InMemoryMissionPublisher,
): AuthorizeMissionDependencies {
  return {
    events,
    publisher,
    now: () => NOW,
    dispatch: dispatchDeps(),
    issueAuthorizationCode: () => AUTH_CODE,
  };
}

function identity(): MissionIdentity {
  return { mission_id: MISSION_ID, mission_code: MISSION_CODE };
}

// The already-validated Stage 1–3 artifacts the authorized package is assembled
// from. These are held fixed; the randomized surface for the authorization gate
// is the Stage 4 flight-plan submission, which is where the reserve/PAVE gates
// (req 3.6/3.7) live.
const DETAILS: DispatchDetails = {
  mission_type: "SCENE_CALL",
  assigned_base_id: BASE_ID,
  assigned_airframe_id: AIRFRAME_ID,
  origin_hospital_id: ORIGIN_ID,
  destination_hospital_id: DEST_ID,
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

// --- Generators --------------------------------------------------------------

/** A finite coordinate near the base region so distances stay physical. */
const geoPointArb: fc.Arbitrary<GeoPoint> = fc.record({
  latitude_deg: fc.double({ min: 40, max: 45, noNaN: true, noDefaultInfinity: true }),
  longitude_deg: fc.double({ min: -85, max: -80, noNaN: true, noDefaultInfinity: true }),
});

/**
 * A route arbitrary that spans both valid and invalid shapes: sometimes too
 * short (invalid), sometimes a healthy 2–4 waypoint route.
 */
const routeArb: fc.Arbitrary<GeoPoint[] | undefined> = fc.oneof(
  // Valid-length routes.
  fc.array(geoPointArb, { minLength: 2, maxLength: 4 }),
  // Degenerate / invalid-length routes (0 or 1 waypoints).
  fc.array(geoPointArb, { minLength: 0, maxLength: 1 }),
);

/**
 * A PAVE component score arbitrary spanning valid (0..max) and invalid
 * (negative / above max) values so the disposition + range gates both exercise.
 */
const paveScoreArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 0, max: 4 }), // in-range
  fc.integer({ min: 5, max: 12 }), // above max -> PAVE_SCORE_INVALID
  fc.integer({ min: -4, max: -1 }), // negative -> PAVE_SCORE_INVALID
);

const paveArb = fc.record({
  pilot_score: paveScoreArb,
  aircraft_score: paveScoreArb,
  environment_score: paveScoreArb,
  external_score: paveScoreArb,
});

/**
 * A full Stage 4 flight-plan submission arbitrary. Fuel/usable-fuel vary so the
 * reserve-margin gate lands on both sides; low usable fuel forces an
 * insufficient reserve.
 */
const flightPlanInputArb: fc.Arbitrary<FlightPlanInput> = fc.record({
  route: routeArb,
  pave: paveArb,
  usable_fuel_lbs: fc.oneof(
    fc.constant<number | undefined>(undefined), // healthy default reserve
    fc.double({ min: 10, max: 300, noNaN: true, noDefaultInfinity: true }), // may starve reserve
    fc.double({ min: 800, max: 2000, noNaN: true, noDefaultInfinity: true }),
  ),
}) as fc.Arbitrary<FlightPlanInput>;

// --- Property 3a: authorization gate is exactly the pure validator (3.6/3.7) --

describe("Property 3: dispatch gating — authorization iff all checks pass (req 3.6, 3.7)", () => {
  it("authorizes (code + DISPATCHED + publish) iff the Stage 4 gate passes; otherwise no state leaks", () => {
    fc.assert(
      fc.property(flightPlanInputArb, (flightPlanInput) => {
        const events = new InMemoryMissionEventSink();
        const publisher = new InMemoryMissionPublisher();

        // Oracle derived from the SAME rules the implementation honors: the
        // mission may only be authorized when the pure Stage 4 validator reports
        // no failed check (route valid, PAVE scores in range, reserve policy
        // valid, reserve margin sufficient, disposition not NO_GO). Stages 1–3
        // are held valid via the fixed missionData, so the Stage 4 gate is the
        // deciding gate here.
        const gateErrors = validateFlightPlan(
          flightPlanInput,
          RESERVE_POLICY,
          PAVE_POLICY,
        );
        const shouldAuthorize = gateErrors.length === 0;

        const result = authorizeMission(
          identity(),
          "FLIGHT_PLAN",
          flightPlanInput,
          missionData(),
          authDeps(events, publisher),
        );

        // Outcome agrees with the pure gate — IFF.
        expect(result.ok).toBe(shouldAuthorize);

        if (shouldAuthorize) {
          if (!result.ok) throw new Error("expected authorization to succeed");
          // req 3.7: a code is issued, status is DISPATCHED, and the package is
          // published to the EFB exactly once.
          expect(result.authorizationCode).toBe(AUTH_CODE);
          expect(result.mission.status).toBe("DISPATCHED");
          expect(result.mission.authorization_code).toBe(AUTH_CODE);
          const published = publisher.all();
          expect(published).toHaveLength(1);
          expect(published[0]!.status).toBe("DISPATCHED");
          expect(published[0]!.mission_id).toBe(MISSION_ID);
          // A passing disposition is never NO_GO.
          expect(published[0]!.risk.disposition).not.toBe("NO_GO");

          // req 3.9: exactly one AUTHORIZED audit event with source/target/ts.
          const authorized = events
            .all()
            .filter((e) => e.event_type === "AUTHORIZED");
          expect(authorized).toHaveLength(1);
          expect(authorized[0]).toMatchObject({
            mission_id: MISSION_ID,
            source_state: "FLIGHT_PLAN",
            target_state: "DISPATCHED",
            occurred_at: NOW.toISOString(),
          });
        } else {
          if (result.ok) throw new Error("expected authorization to fail");
          // req 3.6: the failed check is identified.
          expect(result.dispatchErrors.length).toBeGreaterThan(0);
          // The exact set of failed checks matches the pure validator.
          expect(new Set(result.dispatchErrors.map((e) => e.code))).toEqual(
            new Set(gateErrors.map((e) => e.code)),
          );
          // No code, no DISPATCHED, no publish, no audit event on rejection.
          expect(publisher.all()).toEqual([]);
          expect(events.all()).toEqual([]);
        }
      }),
    );
  });

  it("never publishes and never appends an AUTHORIZED event when the disposition is NO_GO or the reserve is short", () => {
    // A focused generator that biases toward failing gates to stress the
    // negative side of the IFF: high PAVE scores (NO_GO) or starved fuel.
    const failingArb = fc.record({
      route: fc.array(geoPointArb, { minLength: 2, maxLength: 3 }),
      pave: fc.record({
        pilot_score: fc.integer({ min: 3, max: 4 }),
        aircraft_score: fc.integer({ min: 3, max: 4 }),
        environment_score: fc.integer({ min: 3, max: 4 }),
        external_score: fc.integer({ min: 3, max: 4 }),
      }),
      usable_fuel_lbs: fc.double({
        min: 10,
        max: 120,
        noNaN: true,
        noDefaultInfinity: true,
      }),
    }) as fc.Arbitrary<FlightPlanInput>;

    fc.assert(
      fc.property(failingArb, (flightPlanInput) => {
        const gateErrors = validateFlightPlan(
          flightPlanInput,
          RESERVE_POLICY,
          PAVE_POLICY,
        );
        fc.pre(gateErrors.length > 0); // only inspect genuinely failing inputs

        const events = new InMemoryMissionEventSink();
        const publisher = new InMemoryMissionPublisher();
        const result = authorizeMission(
          identity(),
          "FLIGHT_PLAN",
          flightPlanInput,
          missionData(),
          authDeps(events, publisher),
        );

        expect(result.ok).toBe(false);
        expect(publisher.all()).toEqual([]);
        expect(events.all()).toEqual([]);
      }),
    );
  });
});

// --- Property 3b: per-stage advance auditability (req 3.9) -------------------

/**
 * Build a stage submission that is either valid or invalid for the given stage,
 * paired with the pure oracle for whether the dispatch core accepts it. Stages
 * are exercised at their own `currentStage` so the stage-advance restriction
 * (req 3.8) never masks the stage-specific validation under test.
 */
type StageCase = {
  stage: DispatchStage;
  input: DetailsInput | CrewInput | PatientInfoInput | FlightPlanInput;
  expectedAccept: boolean;
};

const stageCaseArb: fc.Arbitrary<StageCase> = fc.oneof(
  // DETAILS: toggle mission_type validity.
  fc.boolean().map((valid): StageCase => {
    const input: DetailsInput = {
      mission_type: valid ? "SCENE_CALL" : "NOT_A_TYPE",
      assigned_base_id: BASE_ID,
      assigned_airframe_id: AIRFRAME_ID,
      origin_hospital_id: ORIGIN_ID,
      destination_hospital_id: DEST_ID,
      weather_snapshot: { observed_at: NOW.toISOString() },
    };
    const accept =
      validateDetails(input, lookup(), NOW).length === 0;
    return { stage: "DETAILS", input, expectedAccept: accept };
  }),
  // CREW: toggle roster validity (valid 2-member roster vs empty).
  fc.boolean().map((valid): StageCase => {
    const input: CrewInput = valid
      ? {
          members: [
            { member_id: PIC_ID, role: "PIC", is_pilot_in_command: true },
            {
              member_id: "c0000000-0000-0000-0000-000000000002",
              role: "FLIGHT_NURSE",
            },
          ],
        }
      : { members: [] };
    const accept = validateCrew(input).length === 0;
    return { stage: "CREW", input, expectedAccept: accept };
  }),
  // PATIENT_INFO: toggle presence of required fields.
  fc.boolean().map((valid): StageCase => {
    const input: PatientInfoInput = valid
      ? {
          simulated_patient_id: PATIENT_ID,
          age_years: 42,
          gender: "M",
          weight_lbs: 180,
          condition_id: CONDITION_ID,
          clinical_summary: "MVC",
          interventions: "IV",
        }
      : { simulated_patient_id: PATIENT_ID };
    const accept =
      validatePatientInfo(
        input,
        new InMemoryConditionResolver([traumaCondition()]),
      ).length === 0;
    return { stage: "PATIENT_INFO", input, expectedAccept: accept };
  }),
  // FLIGHT_PLAN: reuse the randomized flight-plan generator.
  flightPlanInputArb.map((input): StageCase => {
    const accept =
      validateFlightPlan(input, RESERVE_POLICY, PAVE_POLICY).length === 0;
    return { stage: "FLIGHT_PLAN", input, expectedAccept: accept };
  }),
);

describe("Property 3: dispatch gating — one audit event per accepted transition (req 3.9)", () => {
  it("advanceMissionStage appends exactly one STAGE_ADVANCED event on accept, and none on reject", () => {
    fc.assert(
      fc.property(stageCaseArb, ({ stage, input, expectedAccept }) => {
        const events = new InMemoryMissionEventSink();

        const result = advanceMissionStage(
          { mission_id: MISSION_ID, currentStage: stage },
          stage,
          input,
          dispatchDeps(),
          { events, now: () => NOW },
        );

        // The wrapper's verdict matches the pure core's verdict.
        expect(result.ok).toBe(expectedAccept);

        const appended = events.all();
        if (expectedAccept) {
          // req 3.9: exactly one auditable event recording source/target/ts.
          expect(appended).toHaveLength(1);
          expect(appended[0]!.event_type).toBe("STAGE_ADVANCED");
          expect(appended[0]!.source_state).toBe(stage);
          // The target is the newly opened stage, or the readiness marker for
          // the final stage — always a defined, recorded transition target.
          expect(appended[0]!.target_state).toBeDefined();
          expect(appended[0]!.occurred_at).toBe(NOW.toISOString());
        } else {
          // A rejected transition appends NO event.
          expect(appended).toEqual([]);
        }
      }),
    );
  });

  it("agrees with advanceDispatch: the audit side effect follows the core verdict exactly", () => {
    // Cross-check that advanceMissionStage's audit behavior is driven purely by
    // advanceDispatch's accept/reject, over the same randomized cases.
    fc.assert(
      fc.property(stageCaseArb, ({ stage, input }) => {
        const coreResult = advanceDispatch(
          { currentStage: stage },
          stage,
          input,
          dispatchDeps(),
        );

        const events = new InMemoryMissionEventSink();
        advanceMissionStage(
          { mission_id: MISSION_ID, currentStage: stage },
          stage,
          input,
          dispatchDeps(),
          { events, now: () => NOW },
        );

        expect(events.all()).toHaveLength(coreResult.ok ? 1 : 0);
      }),
    );
  });
});
