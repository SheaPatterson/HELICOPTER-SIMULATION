import { describe, expect, it } from "vitest";
import type { MedicalCondition } from "@virtualhems/contracts";
import {
  advanceDispatch,
  calculateFlightPlan,
  calculatePaveRisk,
  deriveDispatchBaselineGcs,
  validateFlightPlan,
  validatePatientInfo,
  MAX_GCS,
  MIN_GCS,
  type AdvanceDispatchDependencies,
  type DispatchErrorCode,
  type FlightPlanInput,
  type PatientInfoInput,
  type PavePolicy,
  type ReservePolicy,
} from "./state-machine.js";
import { InMemoryDispatchLookup } from "./in-memory-lookup.js";
import { InMemoryConditionResolver } from "./in-memory-condition-resolver.js";

// --- Fixtures ----------------------------------------------------------------

const CONDITION_ID = "d0000000-0000-0000-0000-000000000001";
const PATIENT_ID = "p0000000-0000-0000-0000-000000000001";

const NOW = new Date("2024-01-01T12:00:00.000Z");

/** A condition whose baseline GCS range is 10..14 (midpoint 12). */
function traumaCondition(
  overrides: Partial<MedicalCondition> = {},
): MedicalCondition {
  return {
    id: CONDITION_ID,
    name: "Blunt trauma",
    category: "TRAUMA",
    baseline_gcs_min: 10,
    baseline_gcs_max: 14,
    requires_rsi: false,
    decay_rate_per_minute: 0.5,
    target_facility_type: "TRAUMA_I",
    ...overrides,
  };
}

function resolverWith(...conditions: MedicalCondition[]): InMemoryConditionResolver {
  return new InMemoryConditionResolver(conditions);
}

function validPatient(overrides: Partial<PatientInfoInput> = {}): PatientInfoInput {
  return {
    simulated_patient_id: PATIENT_ID,
    age_years: 42,
    gender: "M",
    weight_lbs: 180,
    condition_id: CONDITION_ID,
    clinical_summary: "MVC, chest pain",
    interventions: "IV, O2",
    ...overrides,
  };
}

const RESERVE_POLICY: ReservePolicy = { required_reserve_minutes: 20 };
const PAVE_POLICY: PavePolicy = {
  go_max: 3,
  conditional_max: 6,
  max_component_score: 4,
};

/** A short valid route (~ under 20 nm) that comfortably meets reserve. */
function validRoute(): FlightPlanInput["route"] {
  return [
    { latitude_deg: 40.44, longitude_deg: -80.0 },
    { latitude_deg: 40.5, longitude_deg: -80.05 },
  ];
}

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

function deps(
  overrides: Partial<AdvanceDispatchDependencies> = {},
): AdvanceDispatchDependencies {
  return {
    lookup: overrides.lookup ?? new InMemoryDispatchLookup(),
    now: overrides.now ?? (() => NOW),
    conditionResolver:
      overrides.conditionResolver ?? resolverWith(traumaCondition()),
    reservePolicy: overrides.reservePolicy ?? RESERVE_POLICY,
    pavePolicy: overrides.pavePolicy ?? PAVE_POLICY,
  };
}

function codes(errors: { code: DispatchErrorCode }[]): DispatchErrorCode[] {
  return errors.map((e) => e.code);
}

// --- Stage 3 Patient Info (req 3.4) -----------------------------------------

describe("validatePatientInfo (Stage 3) — req 3.4", () => {
  it("accepts a complete patient with a resolvable condition", () => {
    const errors = validatePatientInfo(
      validPatient(),
      resolverWith(traumaCondition()),
    );
    expect(errors).toEqual([]);
  });

  it("reports every missing/incomplete field simultaneously", () => {
    const errors = validatePatientInfo(
      {
        simulated_patient_id: undefined,
        age_years: undefined,
        gender: undefined,
        weight_lbs: undefined,
        condition_id: undefined,
        clinical_summary: undefined,
        interventions: undefined,
      },
      resolverWith(traumaCondition()),
    );
    expect(codes(errors)).toEqual(
      expect.arrayContaining([
        "PATIENT_ID_MISSING",
        "PATIENT_AGE_INVALID",
        "PATIENT_GENDER_MISSING",
        "PATIENT_WEIGHT_INVALID",
        "PATIENT_CONDITION_MISSING",
        "PATIENT_CLINICAL_SUMMARY_MISSING",
        "PATIENT_INTERVENTIONS_MISSING",
      ]),
    );
  });

  it("rejects a condition that does not resolve to an existing record", () => {
    const errors = validatePatientInfo(
      validPatient({ condition_id: "d0000000-0000-0000-0000-0000000000ff" }),
      resolverWith(traumaCondition()),
    );
    expect(codes(errors)).toContain("PATIENT_CONDITION_NOT_FOUND");
  });

  it("rejects a resolvable condition with an inverted GCS range", () => {
    const errors = validatePatientInfo(
      validPatient(),
      resolverWith(
        traumaCondition({ baseline_gcs_min: 14, baseline_gcs_max: 10 }),
      ),
    );
    expect(codes(errors)).toContain("PATIENT_CONDITION_GCS_RANGE_INVALID");
  });

  it("rejects a supplied baseline GCS outside the 3..15 scale", () => {
    const errors = validatePatientInfo(
      validPatient({ baseline_gcs: 20 }),
      resolverWith(traumaCondition()),
    );
    expect(codes(errors)).toContain("PATIENT_BASELINE_GCS_OUT_OF_RANGE");
  });

  it("accepts a negative age as invalid but a zero age as valid", () => {
    expect(
      codes(
        validatePatientInfo(
          validPatient({ age_years: -1 }),
          resolverWith(traumaCondition()),
        ),
      ),
    ).toContain("PATIENT_AGE_INVALID");
    expect(
      validatePatientInfo(
        validPatient({ age_years: 0 }),
        resolverWith(traumaCondition()),
      ),
    ).toEqual([]);
  });
});

describe("deriveDispatchBaselineGcs — req 3.4", () => {
  it("uses the condition-range midpoint when no baseline is supplied", () => {
    expect(deriveDispatchBaselineGcs(traumaCondition())).toBe(12); // (10+14)/2
  });

  it("uses a supplied in-range baseline verbatim", () => {
    expect(deriveDispatchBaselineGcs(traumaCondition(), 11)).toBe(11);
  });

  it("falls back to the midpoint when the supplied baseline is out of range", () => {
    expect(deriveDispatchBaselineGcs(traumaCondition(), 3)).toBe(12);
  });

  it("always yields an integer within 3..15", () => {
    const gcs = deriveDispatchBaselineGcs(
      traumaCondition({ baseline_gcs_min: 1, baseline_gcs_max: 20 }),
    );
    expect(Number.isInteger(gcs)).toBe(true);
    expect(gcs).toBeGreaterThanOrEqual(MIN_GCS);
    expect(gcs).toBeLessThanOrEqual(MAX_GCS);
  });
});

// --- Stage 4 Flight Plan (req 3.5) ------------------------------------------

describe("calculatePaveRisk — req 3.5", () => {
  it("maps a low total to GO", () => {
    const risk = calculatePaveRisk(
      { pilot_score: 1, aircraft_score: 1, environment_score: 1, external_score: 0 },
      PAVE_POLICY,
    );
    expect(risk.total_score).toBe(3);
    expect(risk.disposition).toBe("GO");
  });

  it("maps a mid total to CONDITIONAL", () => {
    const risk = calculatePaveRisk(
      { pilot_score: 2, aircraft_score: 2, environment_score: 1, external_score: 0 },
      PAVE_POLICY,
    );
    expect(risk.total_score).toBe(5);
    expect(risk.disposition).toBe("CONDITIONAL");
  });

  it("maps a high total to NO_GO", () => {
    const risk = calculatePaveRisk(
      { pilot_score: 4, aircraft_score: 4, environment_score: 4, external_score: 0 },
      PAVE_POLICY,
    );
    expect(risk.disposition).toBe("NO_GO");
  });
});

describe("calculateFlightPlan — req 3.5", () => {
  it("computes direct and planned distances and a positive reserve", () => {
    const plan = calculateFlightPlan(validFlightPlanInput(), RESERVE_POLICY);
    expect(plan.direct_distance_nm).toBeGreaterThan(0);
    expect(plan.planned_distance_nm).toBeGreaterThanOrEqual(
      plan.direct_distance_nm - 1e-6,
    );
    expect(plan.reserve_requirement_minutes).toBe(20);
    expect(plan.reserve_at_destination_minutes).toBeGreaterThan(20);
  });
});

describe("validateFlightPlan — req 3.5", () => {
  it("accepts a valid plan that meets reserve and is GO/CONDITIONAL", () => {
    expect(
      validateFlightPlan(validFlightPlanInput(), RESERVE_POLICY, PAVE_POLICY),
    ).toEqual([]);
  });

  it("rejects a route with fewer than two waypoints", () => {
    const errors = validateFlightPlan(
      validFlightPlanInput({ route: [{ latitude_deg: 40, longitude_deg: -80 }] }),
      RESERVE_POLICY,
      PAVE_POLICY,
    );
    expect(codes(errors)).toContain("FLIGHT_PLAN_ROUTE_INVALID");
  });

  it("rejects missing PAVE scores", () => {
    const input = validFlightPlanInput();
    delete (input as { pave?: unknown }).pave;
    expect(
      codes(validateFlightPlan(input, RESERVE_POLICY, PAVE_POLICY)),
    ).toContain("PAVE_SCORES_MISSING");
  });

  it("rejects a plan whose reserve margin is below the policy requirement", () => {
    // A very long route with modest usable fuel drives reserve negative.
    const errors = validateFlightPlan(
      validFlightPlanInput({
        route: [
          { latitude_deg: 40.0, longitude_deg: -80.0 },
          { latitude_deg: 25.0, longitude_deg: -80.0 },
        ],
        usable_fuel_lbs: 400,
      }),
      RESERVE_POLICY,
      PAVE_POLICY,
    );
    expect(codes(errors)).toContain("RESERVE_MARGIN_INSUFFICIENT");
  });

  it("rejects a NO_GO disposition", () => {
    const errors = validateFlightPlan(
      validFlightPlanInput({
        pave: {
          pilot_score: 4,
          aircraft_score: 4,
          environment_score: 4,
          external_score: 4,
        },
      }),
      RESERVE_POLICY,
      PAVE_POLICY,
    );
    expect(codes(errors)).toContain("DISPATCH_DISPOSITION_NO_GO");
  });
});

// --- advanceDispatch integration (Stage 3/4) --------------------------------

describe("advanceDispatch — Stage 3/4 gating", () => {
  it("opens FLIGHT_PLAN and derives the baseline GCS on a valid PATIENT_INFO submission", () => {
    const result = advanceDispatch(
      { currentStage: "PATIENT_INFO" },
      "PATIENT_INFO",
      validPatient(),
      deps(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.openedStage).toBe("FLIGHT_PLAN");
      expect(result.patient?.baseline_gcs).toBe(12);
    }
  });

  it("keeps FLIGHT_PLAN closed and retains input on a failed PATIENT_INFO submission (req 3.4)", () => {
    const input = validPatient({ condition_id: undefined });
    const result = advanceDispatch(
      { currentStage: "PATIENT_INFO" },
      "PATIENT_INFO",
      input,
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContain("PATIENT_CONDITION_MISSING");
      expect(result.retainedInput).toBe(input);
    }
  });

  it("marks the mission ready to authorize WITHOUT authorizing on a valid FLIGHT_PLAN submission (task 8.3 seam)", () => {
    const result = advanceDispatch(
      { currentStage: "FLIGHT_PLAN" },
      "FLIGHT_PLAN",
      validFlightPlanInput(),
      deps(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readyToAuthorize).toBe(true);
      expect(result.openedStage).toBeUndefined();
      expect(result.risk?.disposition).toBe("GO");
      expect(result.flightPlan?.reserve_at_destination_minutes).toBeGreaterThan(
        20,
      );
    }
  });

  it("keeps the mission unauthorized and retains input on a failed FLIGHT_PLAN submission (req 3.5)", () => {
    const input = validFlightPlanInput({
      pave: {
        pilot_score: 4,
        aircraft_score: 4,
        environment_score: 4,
        external_score: 4,
      },
    });
    const result = advanceDispatch(
      { currentStage: "FLIGHT_PLAN" },
      "FLIGHT_PLAN",
      input,
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContain("DISPATCH_DISPOSITION_NO_GO");
      expect(result.retainedInput).toBe(input);
    }
  });
});
