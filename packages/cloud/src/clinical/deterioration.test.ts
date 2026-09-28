import { describe, expect, it } from "vitest";
import type { ClinicalEvent, PatientState } from "@virtualhems/contracts";
import {
  DEFAULT_SCENE_TARGET_SECONDS,
  MAX_SCENE_TARGET_SECONDS,
  MIN_SCENE_TARGET_SECONDS,
  VITAL_EFFECT_FLAG,
  calculateDecayPenalty,
  calculateSceneSeconds,
  resolvePolicy,
  secondsBetween,
  updatePatientState,
  type ClinicalPolicy,
  type UpdatePatientStateInput,
} from "./deterioration.js";

// --- Fixtures ----------------------------------------------------------------

const MISSION_ID = "11111111-0000-0000-0000-000000000001";
const DISPATCH_TIME = "2024-01-01T12:00:00.000Z";

/** eventTime = DISPATCH_TIME + `seconds`. */
function at(seconds: number): string {
  return new Date(Date.parse(DISPATCH_TIME) + seconds * 1000).toISOString();
}

function initialPatient(overrides: Partial<PatientState> = {}): PatientState {
  return {
    mission_id: MISSION_ID,
    baseline_gcs: 12,
    current_gcs: 12,
    elapsed_golden_hour_seconds: 0,
    elapsed_scene_seconds: 0,
    physiological_flags: [],
    deteriorated: false,
    updated_at: DISPATCH_TIME,
    ...overrides,
  };
}

function sceneEvent(
  event_type: ClinicalEvent["event_type"],
  seconds: number,
): Pick<ClinicalEvent, "event_type" | "occurred_at"> {
  return { event_type, occurred_at: at(seconds) };
}

function input(
  overrides: Partial<UpdatePatientStateInput> = {},
): UpdatePatientStateInput {
  return {
    patient: initialPatient(),
    eventTime: at(0),
    dispatchTime: DISPATCH_TIME,
    events: [],
    condition: { decay_rate_per_minute: 1 },
    policy: { policy_version: "policy-v1" } satisfies ClinicalPolicy,
    ...overrides,
  };
}

// --- resolvePolicy: scene-target clamp (req 4.3) -----------------------------

describe("resolvePolicy scene-target clamp (req 4.3)", () => {
  it("defaults an omitted scene target to 1200 seconds", () => {
    expect(resolvePolicy({ policy_version: "p" }).scene_target_seconds).toBe(
      DEFAULT_SCENE_TARGET_SECONDS,
    );
  });

  it("clamps below-range and above-range targets into [300, 3600]", () => {
    expect(
      resolvePolicy({ policy_version: "p", scene_target_seconds: 100 })
        .scene_target_seconds,
    ).toBe(MIN_SCENE_TARGET_SECONDS);
    expect(
      resolvePolicy({ policy_version: "p", scene_target_seconds: 9000 })
        .scene_target_seconds,
    ).toBe(MAX_SCENE_TARGET_SECONDS);
  });

  it("keeps an in-range target unchanged", () => {
    expect(
      resolvePolicy({ policy_version: "p", scene_target_seconds: 900 })
        .scene_target_seconds,
    ).toBe(900);
  });
});

// --- secondsBetween / scene time (req 4.2) -----------------------------------

describe("elapsed time is whole seconds and deterministic (req 4.2)", () => {
  it("truncates sub-second differences to whole seconds", () => {
    expect(
      secondsBetween(DISPATCH_TIME, "2024-01-01T12:00:05.900Z"),
    ).toBe(5);
  });

  it("sums arrival->departure scene intervals in whole seconds", () => {
    const events = [
      sceneEvent("ARRIVED_SCENE", 100),
      sceneEvent("DEPARTED_SCENE", 400),
    ];
    expect(calculateSceneSeconds(events, at(600))).toBe(300);
  });

  it("counts an open scene interval up to the derivation point", () => {
    const events = [sceneEvent("ARRIVED_SCENE", 100)];
    expect(calculateSceneSeconds(events, at(700))).toBe(600);
  });

  it("is deterministic regardless of event array order", () => {
    const ordered = [
      sceneEvent("ARRIVED_SCENE", 100),
      sceneEvent("DEPARTED_SCENE", 400),
    ];
    const shuffled = [...ordered].reverse();
    expect(calculateSceneSeconds(shuffled, at(600))).toBe(
      calculateSceneSeconds(ordered, at(600)),
    );
  });

  it("ignores scene events after the derivation point", () => {
    const events = [
      sceneEvent("ARRIVED_SCENE", 100),
      sceneEvent("DEPARTED_SCENE", 5000),
    ];
    // Derivation at 400s: only 300s of scene time has accrued so far.
    expect(calculateSceneSeconds(events, at(400))).toBe(300);
  });
});

// --- Penalty once per whole minute beyond target (req 4.3) -------------------

describe("calculateDecayPenalty accrues once per whole minute (req 4.3)", () => {
  const policy = resolvePolicy({ policy_version: "p" });

  it("is zero at or below the target (no excess)", () => {
    expect(calculateDecayPenalty(0, 1, policy).gcs_points).toBe(0);
    expect(calculateDecayPenalty(0, 1, policy).over_minutes).toBe(0);
  });

  it("floors partial minutes: 119s excess is one whole minute", () => {
    const p = calculateDecayPenalty(119, 1, policy);
    expect(p.over_minutes).toBe(1);
    expect(p.gcs_points).toBe(1);
  });

  it("scales with whole minutes and decay rate", () => {
    // 3 whole minutes of excess, decay rate 2 -> 6 GCS points.
    expect(calculateDecayPenalty(180, 2, policy).gcs_points).toBe(6);
  });
});

// --- update_patient_state happy path (req 4.2, 4.4, 4.7) ---------------------

describe("updatePatientState derives state (design Section 6.4)", () => {
  it("holds baseline before the scene target is exceeded (req 4.3)", () => {
    const events = [sceneEvent("ARRIVED_SCENE", 0)];
    // 1200s on scene == target, not beyond -> no penalty.
    const result = updatePatientState(
      input({ events, eventTime: at(1200) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patient.current_gcs).toBe(12);
      expect(result.patient.deteriorated).toBe(false);
      expect(result.patient.elapsed_scene_seconds).toBe(1200);
      expect(result.patient.elapsed_golden_hour_seconds).toBe(1200);
      expect(result.policy_version).toBe("policy-v1");
    }
  });

  it("subtracts one GCS point per whole over-target minute (req 4.3)", () => {
    const events = [sceneEvent("ARRIVED_SCENE", 0)];
    // 1200 + 180 = 1380s scene, 3 minutes over, decay 1 -> baseline 12 - 3 = 9.
    const result = updatePatientState(
      input({ events, eventTime: at(1380) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patient.current_gcs).toBe(9);
      expect(result.patient.deteriorated).toBe(true);
      expect(result.penalty.over_minutes).toBe(3);
    }
  });

  it("records the Policy_Version used (req 4.7)", () => {
    const result = updatePatientState(
      input({ policy: { policy_version: "policy-2025-Q1" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policy_version).toBe("policy-2025-Q1");
  });

  it("is deterministic: identical inputs produce identical output", () => {
    const events = [sceneEvent("ARRIVED_SCENE", 0)];
    const a = updatePatientState(input({ events, eventTime: at(1500) }));
    const b = updatePatientState(input({ events, eventTime: at(1500) }));
    expect(a).toEqual(b);
  });

  it("does not mutate the input patient state", () => {
    const patient = initialPatient();
    const snapshot = { ...patient, physiological_flags: [...patient.physiological_flags] };
    const events = [sceneEvent("ARRIVED_SCENE", 0)];
    updatePatientState(input({ patient, events, eventTime: at(1500) }));
    expect(patient).toEqual(snapshot);
  });
});

// --- GCS clamp to [3,15] (req 4.4) -------------------------------------------

describe("updatePatientState clamps current GCS to [3,15] (req 4.4)", () => {
  it("clamps a large penalty to a floor of 3, never below", () => {
    const events = [sceneEvent("ARRIVED_SCENE", 0)];
    // 30 minutes over target at decay 5 -> 150 points; baseline 12 -> clamp 3.
    const result = updatePatientState(
      input({ events, eventTime: at(1200 + 30 * 60), condition: { decay_rate_per_minute: 5 } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patient.current_gcs).toBe(3);
  });
});

// --- deteriorated flag (req 4.5) ---------------------------------------------

describe("updatePatientState sets the deteriorated flag (req 4.5)", () => {
  it("is false when GCS is unchanged and no vital effect", () => {
    const result = updatePatientState(input({ eventTime: at(600) }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patient.deteriorated).toBe(false);
      expect(result.patient.physiological_flags).toEqual([]);
    }
  });

  it("is true when a vital-sign effect is present even if GCS held", () => {
    const events = [sceneEvent("ARRIVED_SCENE", 0)];
    // 10 over-target minutes -> vital effect threshold met; decay 0 keeps GCS.
    const result = updatePatientState(
      input({
        events,
        eventTime: at(1200 + 10 * 60),
        condition: { decay_rate_per_minute: 0 },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patient.current_gcs).toBe(12); // unchanged
      expect(result.patient.deteriorated).toBe(true); // via vital effect
      expect(result.patient.physiological_flags).toContain(VITAL_EFFECT_FLAG);
    }
  });
});

// --- Out-of-order rejection + monotonic preservation (req 4.6) ---------------

describe("updatePatientState rejects out-of-order events (req 4.6)", () => {
  it("rejects an event before updated_at and preserves prior state unchanged", () => {
    const prior = initialPatient({
      updated_at: at(1000),
      current_gcs: 10,
      elapsed_golden_hour_seconds: 1000,
      elapsed_scene_seconds: 800,
      deteriorated: true,
    });
    const result = updatePatientState(
      input({ patient: prior, eventTime: at(500) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("OUT_OF_ORDER_EVENT");
      expect(result.errors[0]?.detail).toContain(at(500));
      // Prior monotonic state preserved unchanged.
      expect(result.patient).toEqual(prior);
    }
  });

  it("accepts an event exactly at updated_at (not before)", () => {
    const prior = initialPatient({ updated_at: at(1000) });
    const result = updatePatientState(
      input({ patient: prior, eventTime: at(1000) }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an out-of-range baseline GCS", () => {
    const result = updatePatientState(
      input({ patient: initialPatient({ baseline_gcs: 2 }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain(
        "BASELINE_GCS_OUT_OF_RANGE",
      );
    }
  });
});
