import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCESS_CONTROL,
  DRAFT_MIN_RETENTION_MS,
  FailingVirsStore,
  InMemoryVirsDraftStore,
  InMemoryVirsStore,
  NARRATIVE_MAX_LENGTH,
  SAFETY_REVIEWER_ROLE,
  canRetrieveNarrative,
  retrieveVirsNarrative,
  submitVirsReport,
  toPublicProjection,
  validateVirsSubmission,
  type PersistedVirsReport,
  type SubmitVirsDependencies,
} from "./virs.js";

const NOW = new Date("2024-06-01T12:00:00.000Z");
const fixedNow = () => NOW;
const SCHEMA_VERSION = "0.1.0";

function submitDeps(
  overrides: Partial<SubmitVirsDependencies> = {},
): SubmitVirsDependencies {
  return {
    store: new InMemoryVirsStore(),
    draftStore: new InMemoryVirsDraftStore(),
    now: fixedNow,
    schemaVersion: SCHEMA_VERSION,
    reporterId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

// --- Validation (req 11.2) --------------------------------------------------

describe("validateVirsSubmission — field-specific validation (req 11.2)", () => {
  it("accepts a valid category + narrative", () => {
    const result = validateVirsSubmission({
      incident_category: "NEAR_MISS",
      narrative: "Almost clipped a tower on departure.",
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.submission.incident_category).toBe("NEAR_MISS");
      expect(result.submission.narrative).toBe("Almost clipped a tower on departure.");
    }
  });

  it("rejects a missing category with a category-specific error and retains the narrative", () => {
    const result = validateVirsSubmission({
      incident_category: "",
      narrative: "The narrative I typed.",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("incident_category");
      expect(result.errors[0].code).toBe("CATEGORY_REQUIRED");
      expect(result.retainedNarrative).toBe("The narrative I typed.");
    }
  });

  it("rejects an unknown category as a category-specific error", () => {
    const result = validateVirsSubmission({
      incident_category: "NOT_A_CATEGORY",
      narrative: "text",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("incident_category");
      expect(result.errors[0].code).toBe("CATEGORY_UNKNOWN");
    }
  });

  it("rejects an empty narrative with a narrative-specific error and retains it verbatim", () => {
    const result = validateVirsSubmission({
      incident_category: "HAZARD",
      narrative: "   ",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("narrative");
      expect(result.errors[0].code).toBe("NARRATIVE_EMPTY");
      // Retained exactly as entered, not trimmed.
      expect(result.retainedNarrative).toBe("   ");
    }
  });

  it("rejects an over-length narrative and retains the full text", () => {
    const tooLong = "x".repeat(NARRATIVE_MAX_LENGTH + 1);
    const result = validateVirsSubmission({
      incident_category: "HAZARD",
      narrative: tooLong,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("narrative");
      expect(result.errors[0].code).toBe("NARRATIVE_TOO_LONG");
      expect(result.retainedNarrative).toBe(tooLong);
      expect(result.retainedNarrative.length).toBe(NARRATIVE_MAX_LENGTH + 1);
    }
  });

  it("accepts a narrative exactly at the 10,000-char bound", () => {
    const atBound = "y".repeat(NARRATIVE_MAX_LENGTH);
    const result = validateVirsSubmission({ incident_category: "OTHER", narrative: atBound });
    expect(result.valid).toBe(true);
  });

  it("reports both field errors when category AND narrative are invalid", () => {
    const result = validateVirsSubmission({ incident_category: null, narrative: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(["incident_category", "narrative"]);
    }
  });
});

// --- Submission / persistence (req 11.1) ------------------------------------

describe("submitVirsReport — valid persistence (req 11.1)", () => {
  it("persists a valid report with defaulted access control and returns a confirmation", async () => {
    const store = new InMemoryVirsStore();
    const deps = submitDeps({ store });

    const result = await submitVirsReport(
      { incident_category: "PROCEDURE", narrative: "Checklist item skipped under time pressure." },
      deps,
    );

    expect(result.status).toBe("SAVED");
    if (result.status === "SAVED") {
      expect(result.report.incident_category).toBe("PROCEDURE");
      expect(result.report.narrative).toBe("Checklist item skipped under time pressure.");
      expect(result.report.access_control).toBe(DEFAULT_ACCESS_CONTROL);
      expect(result.report.submitted_at).toBe(NOW.toISOString());
      expect(result.report.schema_version).toBe(SCHEMA_VERSION);
      expect(result.message).toMatch(/received/i);
    }
    expect(store.size).toBe(1);
  });

  it("returns VALIDATION_ERROR and persists nothing on an invalid submission", async () => {
    const store = new InMemoryVirsStore();
    const draftStore = new InMemoryVirsDraftStore();
    const result = await submitVirsReport(
      { incident_category: "", narrative: "kept text" },
      submitDeps({ store, draftStore }),
    );

    expect(result.status).toBe("VALIDATION_ERROR");
    if (result.status === "VALIDATION_ERROR") {
      expect(result.retainedNarrative).toBe("kept text");
      expect(result.errors[0].field).toBe("incident_category");
    }
    expect(store.size).toBe(0);
    // No draft either — validation errors are not service failures.
    expect(draftStore.size).toBe(0);
  });
});

// --- Draft preservation on failure (req 11.4) -------------------------------

describe("submitVirsReport — service failure preserves a local draft (req 11.4)", () => {
  it("returns NOT_SAVED and preserves a >= 24h local draft retaining the narrative", async () => {
    const draftStore = new InMemoryVirsDraftStore();
    const deps = submitDeps({ store: new FailingVirsStore(), draftStore });

    const result = await submitVirsReport(
      { incident_category: "EQUIPMENT", narrative: "Radio failed intermittently in flight." },
      deps,
    );

    expect(result.status).toBe("NOT_SAVED");
    if (result.status === "NOT_SAVED") {
      expect(result.draft.narrative).toBe("Radio failed intermittently in flight.");
      expect(result.draft.incident_category).toBe("EQUIPMENT");
      const retentionMs =
        Date.parse(result.draft.expiresAt) - Date.parse(result.draft.createdAt);
      expect(retentionMs).toBeGreaterThanOrEqual(DRAFT_MIN_RETENTION_MS);
      expect(result.message).toMatch(/draft/i);
    }
    expect(draftStore.size).toBe(1);
    // The draft store is client-local; it retains the narrative for retry.
    expect(draftStore.all()[0].narrative).toBe("Radio failed intermittently in flight.");
  });
});

// --- Access control + public projection (req 11.3) --------------------------

const sampleReport: PersistedVirsReport = {
  id: "dddddddd-0000-0000-0000-000000000001",
  reporter_id: "11111111-1111-1111-1111-111111111111",
  mission_id: null,
  incident_category: "NEAR_MISS",
  narrative: "Sensitive narrative content.",
  access_control: DEFAULT_ACCESS_CONTROL,
  submitted_at: NOW.toISOString(),
  received_at: NOW.toISOString(),
  schema_version: SCHEMA_VERSION,
  is_redacted: false,
};

describe("narrative access control (req 11.3)", () => {
  it("grants narrative retrieval only to a safety reviewer on a non-public route", () => {
    expect(canRetrieveNarrative({ role: SAFETY_REVIEWER_ROLE })).toBe(true);
    const result = retrieveVirsNarrative(sampleReport, { role: SAFETY_REVIEWER_ROLE });
    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.narrative).toBe("Sensitive narrative content.");
    }
  });

  it("denies a non-safety-reviewer role", () => {
    expect(canRetrieveNarrative({ role: "CAPTAIN" })).toBe(false);
    const result = retrieveVirsNarrative(sampleReport, { role: "CAPTAIN" });
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.reason).toBe("NOT_SAFETY_REVIEWER");
    }
  });

  it("never exposes the narrative on a public route, even for a safety reviewer", () => {
    expect(canRetrieveNarrative({ role: SAFETY_REVIEWER_ROLE, isPublicRoute: true })).toBe(false);
    const result = retrieveVirsNarrative(sampleReport, {
      role: SAFETY_REVIEWER_ROLE,
      isPublicRoute: true,
    });
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.reason).toBe("PUBLIC_ROUTE");
    }
  });

  it("public projection never includes the narrative or reporter identity", () => {
    const projection = toPublicProjection(sampleReport);
    expect(projection.hasNarrative).toBe(true);
    expect(projection.incident_category).toBe("NEAR_MISS");
    // The narrative must not appear anywhere in the serialized projection.
    expect(JSON.stringify(projection)).not.toContain("Sensitive narrative content.");
    expect(Object.keys(projection)).not.toContain("narrative");
    expect(Object.keys(projection)).not.toContain("reporter_id");
  });
});
