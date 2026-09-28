import { describe, expect, it } from "vitest";
import type { MedicalCondition } from "@virtualhems/contracts";
import {
  GCS_MAX,
  GCS_MIN,
  resolveCondition,
  validateCondition,
  type ConditionErrorCode,
  type UnresolvedCondition,
} from "./condition.js";

// --- Fixtures ----------------------------------------------------------------

const CONDITION_ID = "d0000000-0000-0000-0000-000000000001";

/** A fully valid, complete medical condition record (req 4.8). */
function validCondition(
  overrides: Partial<MedicalCondition> = {},
): MedicalCondition {
  return {
    id: CONDITION_ID,
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

function codes(errors: { code: ConditionErrorCode }[]): ConditionErrorCode[] {
  return errors.map((e) => e.code);
}

// --- Valid records -----------------------------------------------------------

describe("validateCondition (req 4.8)", () => {
  it("accepts a fully valid, complete condition with no errors", () => {
    expect(validateCondition(validCondition())).toEqual([]);
  });

  it("accepts a single-point GCS range (min === max)", () => {
    const errors = validateCondition(
      validCondition({ baseline_gcs_min: 10, baseline_gcs_max: 10 }),
    );
    expect(errors).toEqual([]);
  });

  it("accepts the extreme in-bounds range [3, 15]", () => {
    const errors = validateCondition(
      validCondition({ baseline_gcs_min: GCS_MIN, baseline_gcs_max: GCS_MAX }),
    );
    expect(errors).toEqual([]);
  });

  it("accepts a zero decay rate", () => {
    expect(
      validateCondition(validCondition({ decay_rate_per_minute: 0 })),
    ).toEqual([]);
  });

  it("accepts every one of the 8 defined categories", () => {
    const categories: MedicalCondition["category"][] = [
      "TRAUMA",
      "CARDIAC",
      "STROKE",
      "NEURO",
      "OB",
      "PEDIATRIC",
      "ENVIRONMENTAL",
      "OTHER",
    ];
    for (const category of categories) {
      expect(validateCondition(validCondition({ category }))).toEqual([]);
    }
  });
});

// --- Incomplete / invalid records (req 4.9) ----------------------------------

describe("validateCondition rejects incomplete records (req 4.9)", () => {
  it("rejects a missing category", () => {
    const { category: _omit, ...rest } = validCondition();
    const errors = validateCondition(rest as UnresolvedCondition);
    expect(codes(errors)).toContain("CATEGORY_MISSING");
  });

  it("rejects a category outside the 8 defined categories", () => {
    const errors = validateCondition(
      validCondition({ category: "BURN" as MedicalCondition["category"] }),
    );
    expect(codes(errors)).toContain("CATEGORY_INVALID");
  });

  it("rejects a missing GCS range bound", () => {
    const { baseline_gcs_max: _omit, ...rest } = validCondition();
    const errors = validateCondition(rest as UnresolvedCondition);
    expect(codes(errors)).toContain("GCS_RANGE_MISSING");
  });

  it("rejects a GCS range below the lower bound", () => {
    const errors = validateCondition(
      validCondition({ baseline_gcs_min: 2, baseline_gcs_max: 10 }),
    );
    expect(codes(errors)).toContain("GCS_RANGE_OUT_OF_BOUNDS");
  });

  it("rejects a GCS range above the upper bound", () => {
    const errors = validateCondition(
      validCondition({ baseline_gcs_min: 10, baseline_gcs_max: 16 }),
    );
    expect(codes(errors)).toContain("GCS_RANGE_OUT_OF_BOUNDS");
  });

  it("rejects an inverted GCS range (min > max)", () => {
    const errors = validateCondition(
      validCondition({ baseline_gcs_min: 12, baseline_gcs_max: 8 }),
    );
    expect(codes(errors)).toContain("GCS_RANGE_INVERTED");
  });

  it("rejects a non-integer GCS bound", () => {
    const errors = validateCondition(
      validCondition({ baseline_gcs_min: 8.5, baseline_gcs_max: 12 }),
    );
    expect(codes(errors)).toContain("GCS_RANGE_NOT_INTEGER");
  });

  it("rejects a missing decay rate", () => {
    const { decay_rate_per_minute: _omit, ...rest } = validCondition();
    const errors = validateCondition(rest as UnresolvedCondition);
    expect(codes(errors)).toContain("DECAY_RATE_MISSING");
  });

  it("rejects a negative decay rate", () => {
    const errors = validateCondition(
      validCondition({ decay_rate_per_minute: -0.1 }),
    );
    expect(codes(errors)).toContain("DECAY_RATE_INVALID");
  });

  it("rejects a missing required facility capability", () => {
    const { target_facility_type: _omit, ...rest } = validCondition();
    const errors = validateCondition(rest as UnresolvedCondition);
    expect(codes(errors)).toContain("FACILITY_CAPABILITY_MISSING");
  });

  it("rejects a blank required facility capability", () => {
    const errors = validateCondition(
      validCondition({ target_facility_type: "   " }),
    );
    expect(codes(errors)).toContain("FACILITY_CAPABILITY_MISSING");
  });

  it("reports EVERY failed condition, not just the first", () => {
    const errors = validateCondition({
      id: CONDITION_ID,
      name: "Broken record",
      // category, GCS range, decay, capability all missing/invalid
      baseline_gcs_min: 20,
      baseline_gcs_max: 1,
    } as UnresolvedCondition);
    const found = codes(errors);
    expect(found).toContain("CATEGORY_MISSING");
    expect(found).toContain("DECAY_RATE_MISSING");
    expect(found).toContain("FACILITY_CAPABILITY_MISSING");
    // out-of-bounds AND inverted are both reported for 20..1
    expect(found).toContain("GCS_RANGE_OUT_OF_BOUNDS");
    expect(found).toContain("GCS_RANGE_INVERTED");
  });
});

// --- resolveCondition --------------------------------------------------------

describe("resolveCondition (req 4.9)", () => {
  it("resolves a valid condition to ok:true with the condition", () => {
    const result = resolveCondition(validCondition());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.condition.id).toBe(CONDITION_ID);
    }
  });

  it("rejects an incomplete condition and identifies the record by id and name", () => {
    const result = resolveCondition({
      id: CONDITION_ID,
      name: "Incomplete Sepsis",
      category: "OTHER",
      // no GCS range, decay, or capability
    } as UnresolvedCondition);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conditionId).toBe(CONDITION_ID);
      expect(result.conditionName).toBe("Incomplete Sepsis");
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("omits id/name in the rejection when the incomplete record lacks them", () => {
    const result = resolveCondition({ category: "OTHER" } as UnresolvedCondition);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conditionId).toBeUndefined();
      expect(result.conditionName).toBeUndefined();
    }
  });
});
