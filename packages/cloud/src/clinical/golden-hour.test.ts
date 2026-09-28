import { describe, expect, it } from "vitest";
import type { ClinicalEvent, MedicalCondition } from "@virtualhems/contracts";
import {
  GOLDEN_HOUR_DURATION_SECONDS,
  deriveBaselineGcs,
  initiateGoldenHour,
  type GoldenHourDispatchInput,
} from "./golden-hour.js";

// --- Fixtures ----------------------------------------------------------------

const MISSION_ID = "11111111-0000-0000-0000-000000000001";
const DISPATCH_TIME = "2024-01-01T12:00:00.000Z";

function validCondition(
  overrides: Partial<MedicalCondition> = {},
): MedicalCondition {
  return {
    id: "d0000000-0000-0000-0000-000000000001",
    name: "Severe TBI",
    category: "TRAUMA",
    baseline_gcs_min: 8,
    baseline_gcs_max: 12,
    requires_rsi: true,
    decay_rate_per_minute: 0.5,
    target_facility_type: "TRAUMA_LEVEL_I",
    ...overrides,
  };
}

function dispatchEvent(
  overrides: Partial<Pick<ClinicalEvent, "event_type" | "occurred_at">> = {},
): Pick<ClinicalEvent, "event_type" | "occurred_at"> {
  return { event_type: "DISPATCHED", occurred_at: DISPATCH_TIME, ...overrides };
}

function sceneCallInput(
  overrides: Partial<GoldenHourDispatchInput> = {},
): GoldenHourDispatchInput {
  return {
    mission_id: MISSION_ID,
    mission_type: "SCENE_CALL",
    dispatchEvent: dispatchEvent(),
    condition: validCondition(),
    ...overrides,
  };
}

// --- Timer initiation (req 4.1) ---------------------------------------------

describe("initiateGoldenHour on a scene call (req 4.1)", () => {
  it("initiates a 3600-second timer anchored to the dispatch event time", () => {
    const result = initiateGoldenHour(sceneCallInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.initiation.timer.durationSeconds).toBe(3600);
      expect(GOLDEN_HOUR_DURATION_SECONDS).toBe(3600);
      expect(result.initiation.timer.anchoredAt).toBe(DISPATCH_TIME);
      expect(result.initiation.timer.mission_id).toBe(MISSION_ID);
    }
  });

  it("derives an initial patient-state seam at baseline with zero elapsed", () => {
    const result = initiateGoldenHour(sceneCallInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const p = result.initiation.patient;
      expect(p.mission_id).toBe(MISSION_ID);
      expect(p.baseline_gcs).toBe(12);
      expect(p.current_gcs).toBe(p.baseline_gcs);
      expect(p.elapsed_golden_hour_seconds).toBe(0);
      expect(p.elapsed_scene_seconds).toBe(0);
      expect(p.physiological_flags).toEqual([]);
      expect(p.deteriorated).toBe(false);
      expect(p.updated_at).toBe(DISPATCH_TIME);
    }
  });

  it("is deterministic: identical inputs produce identical output", () => {
    const a = initiateGoldenHour(sceneCallInput());
    const b = initiateGoldenHour(sceneCallInput());
    expect(a).toEqual(b);
  });

  it("derives the baseline GCS from the condition's upper bound", () => {
    expect(deriveBaselineGcs(validCondition({ baseline_gcs_max: 9 }))).toBe(9);
  });
});

// --- Non-scene-call missions (req 4.1 scoping) -------------------------------

describe("initiateGoldenHour scoping (req 4.1)", () => {
  it("does not initiate a timer for an inter-facility transfer", () => {
    const result = initiateGoldenHour(
      sceneCallInput({ mission_type: "INTER_FACILITY_TRANSFER" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("NOT_A_SCENE_CALL");
    }
  });

  it("does not initiate a timer when mission type is absent", () => {
    const result = initiateGoldenHour(
      sceneCallInput({ mission_type: undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("NOT_A_SCENE_CALL");
    }
  });
});

// --- Rejections for a scene call missing its anchor --------------------------

describe("initiateGoldenHour rejects an unanchored scene call (req 4.1)", () => {
  it("rejects a missing dispatch event", () => {
    const result = initiateGoldenHour(
      sceneCallInput({ dispatchEvent: undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain(
        "DISPATCH_EVENT_MISSING",
      );
    }
  });

  it("rejects a non-DISPATCHED anchoring event", () => {
    const result = initiateGoldenHour(
      sceneCallInput({ dispatchEvent: dispatchEvent({ event_type: "ARRIVED_SCENE" }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain(
        "DISPATCH_EVENT_MISSING",
      );
    }
  });

  it("rejects an invalid dispatch timestamp", () => {
    const result = initiateGoldenHour(
      sceneCallInput({ dispatchEvent: dispatchEvent({ occurred_at: "not-a-time" }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain(
        "DISPATCH_EVENT_INVALID_TIME",
      );
    }
  });

  it("rejects a missing mission id", () => {
    const result = initiateGoldenHour(
      sceneCallInput({ mission_id: undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("MISSION_ID_MISSING");
    }
  });
});
