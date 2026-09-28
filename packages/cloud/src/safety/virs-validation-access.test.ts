/**
 * VIRS validation edge cases + reviewer-only narrative retrieval (task 18.2).
 *
 * This is the dedicated test suite for task 18.2. It complements — and does NOT
 * duplicate — the happy-path/basic-branch coverage in `./virs.test.ts` by
 * focusing on:
 *   - validation EDGE CASES: null/undefined/whitespace inputs, the exact
 *     narrative length boundaries, whitespace-vs-raw length semantics, verbatim
 *     narrative retention, and the multi-error case (req 11.2);
 *   - reviewer-only ACCESS-CONTROL gating: only the safety-reviewer role may
 *     retrieve a narrative, never on a public route, non-reviewers are always
 *     denied, and the public projection can never leak the narrative (req 11.3);
 *   - draft PRESERVATION on a service/network failure retaining the narrative
 *     with a >= 24h retention window (req 11.4).
 *
 * Access control here is safety-sensitive: the property tests assert that across
 * ALL non-reviewer roles and ALL public-route requests the narrative is withheld.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_ACCESS_CONTROL,
  DRAFT_MIN_RETENTION_MS,
  FailingVirsStore,
  InMemoryVirsDraftStore,
  InMemoryVirsStore,
  NARRATIVE_MAX_LENGTH,
  NARRATIVE_MIN_LENGTH,
  SAFETY_REVIEWER_ROLE,
  VIRS_INCIDENT_CATEGORIES,
  canRetrieveNarrative,
  retrieveVirsNarrative,
  submitVirsReport,
  toPublicProjection,
  validateVirsSubmission,
  type PersistedVirsReport,
  type SubmitVirsDependencies,
} from "./virs.js";

const NOW = new Date("2024-06-01T12:00:00.000Z");
const SCHEMA_VERSION = "0.1.0";
const REPORTER_ID = "11111111-1111-1111-1111-111111111111";

function submitDeps(
  overrides: Partial<SubmitVirsDependencies> = {},
): SubmitVirsDependencies {
  return {
    store: new InMemoryVirsStore(),
    draftStore: new InMemoryVirsDraftStore(),
    now: () => NOW,
    schemaVersion: SCHEMA_VERSION,
    reporterId: REPORTER_ID,
    ...overrides,
  };
}

function makeReport(
  overrides: Partial<PersistedVirsReport> = {},
): PersistedVirsReport {
  return {
    id: "dddddddd-0000-0000-0000-000000000001",
    reporter_id: REPORTER_ID,
    mission_id: null,
    incident_category: "NEAR_MISS",
    narrative: "Confidential reporter narrative content.",
    access_control: DEFAULT_ACCESS_CONTROL,
    submitted_at: NOW.toISOString(),
    received_at: NOW.toISOString(),
    schema_version: SCHEMA_VERSION,
    is_redacted: false,
    ...overrides,
  };
}

// --- Validation edge cases (req 11.2) ---------------------------------------

describe("validateVirsSubmission — edge cases (req 11.2)", () => {
  it("treats an omitted (undefined) category as CATEGORY_REQUIRED", () => {
    const result = validateVirsSubmission({ narrative: "kept narrative" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("incident_category");
      expect(result.errors[0].code).toBe("CATEGORY_REQUIRED");
      expect(result.retainedNarrative).toBe("kept narrative");
    }
  });

  it("treats a null category as CATEGORY_REQUIRED", () => {
    const result = validateVirsSubmission({
      incident_category: null,
      narrative: "kept narrative",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("CATEGORY_REQUIRED");
    }
  });

  it("treats a whitespace-only category as CATEGORY_REQUIRED (not UNKNOWN)", () => {
    const result = validateVirsSubmission({
      incident_category: "   \t  ",
      narrative: "kept narrative",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("CATEGORY_REQUIRED");
    }
  });

  it("accepts a category with surrounding whitespace by normalizing (trimming) it", () => {
    const result = validateVirsSubmission({
      incident_category: "  HAZARD  ",
      narrative: "A trimmed-category submission.",
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.submission.incident_category).toBe("HAZARD");
    }
  });

  it("is case-sensitive: a lowercased known category is UNKNOWN", () => {
    const result = validateVirsSubmission({
      incident_category: "hazard",
      narrative: "text",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("CATEGORY_UNKNOWN");
    }
  });

  it("treats a null narrative as NARRATIVE_EMPTY and retains an empty string", () => {
    const result = validateVirsSubmission({
      incident_category: "OTHER",
      narrative: null,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("narrative");
      expect(result.errors[0].code).toBe("NARRATIVE_EMPTY");
      expect(result.retainedNarrative).toBe("");
    }
  });

  it("treats a narrative of only newlines/tabs as NARRATIVE_EMPTY but retains it verbatim", () => {
    const whitespace = "\n\t \r\n";
    const result = validateVirsSubmission({
      incident_category: "OTHER",
      narrative: whitespace,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("NARRATIVE_EMPTY");
      expect(result.retainedNarrative).toBe(whitespace);
    }
  });

  it("accepts a single-character (min-length) narrative", () => {
    const result = validateVirsSubmission({
      incident_category: "OTHER",
      narrative: "x".repeat(NARRATIVE_MIN_LENGTH),
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.submission.narrative.length).toBe(NARRATIVE_MIN_LENGTH);
    }
  });

  it("accepts a narrative that is short after trimming but stores it verbatim (untrimmed)", () => {
    const padded = "   real content   ";
    const result = validateVirsSubmission({
      incident_category: "PROCEDURE",
      narrative: padded,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      // The stored narrative is the raw input (never trimmed) so it is faithful.
      expect(result.submission.narrative).toBe(padded);
    }
  });

  it("length bounds are measured on the RAW (untrimmed) narrative: 10,000 core chars + surrounding whitespace is TOO_LONG", () => {
    // Core content is within bounds but the raw length exceeds the max because
    // of surrounding whitespace — the bound is checked on the raw string.
    const raw = ` ${"z".repeat(NARRATIVE_MAX_LENGTH)} `;
    expect(raw.length).toBe(NARRATIVE_MAX_LENGTH + 2);
    const result = validateVirsSubmission({ incident_category: "HAZARD", narrative: raw });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("NARRATIVE_TOO_LONG");
      expect(result.retainedNarrative).toBe(raw);
    }
  });

  it("reports BOTH field errors (one per field) when category is unknown AND narrative is too long", () => {
    const result = validateVirsSubmission({
      incident_category: "BOGUS",
      narrative: "q".repeat(NARRATIVE_MAX_LENGTH + 1),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(2);
      const byField = Object.fromEntries(result.errors.map((e) => [e.field, e.code]));
      expect(byField.incident_category).toBe("CATEGORY_UNKNOWN");
      expect(byField.narrative).toBe("NARRATIVE_TOO_LONG");
    }
  });

  it("every canonical category is accepted", () => {
    for (const category of VIRS_INCIDENT_CATEGORIES) {
      const result = validateVirsSubmission({
        incident_category: category,
        narrative: "valid narrative",
      });
      expect(result.valid).toBe(true);
    }
  });

  it("property: a known category with a 1..MAX narrative always validates and retains the exact text (req 11.2)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VIRS_INCIDENT_CATEGORIES),
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length >= 1),
        (category, narrative) => {
          const result = validateVirsSubmission({
            incident_category: category,
            narrative,
          });
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.submission.incident_category).toBe(category);
            expect(result.submission.narrative).toBe(narrative);
          }
        },
      ),
    );
  });

  it("property: an over-length narrative is always rejected AND the full text is retained verbatim (req 11.2)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VIRS_INCIDENT_CATEGORIES),
        fc.integer({ min: NARRATIVE_MAX_LENGTH + 1, max: NARRATIVE_MAX_LENGTH + 500 }),
        (category, length) => {
          const narrative = "a".repeat(length);
          const result = validateVirsSubmission({
            incident_category: category,
            narrative,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            const narrativeError = result.errors.find((e) => e.field === "narrative");
            expect(narrativeError?.code).toBe("NARRATIVE_TOO_LONG");
            // The reporter never loses their text, however long it was.
            expect(result.retainedNarrative).toBe(narrative);
          }
        },
      ),
    );
  });
});

// --- Reviewer-only narrative retrieval / access control (req 11.3) ----------

describe("reviewer-only narrative retrieval (req 11.3)", () => {
  const report = makeReport();

  it("denies retrieval to an anonymous viewer (no role)", () => {
    expect(canRetrieveNarrative({})).toBe(false);
    const result = retrieveVirsNarrative(report, {});
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.reason).toBe("NOT_SAFETY_REVIEWER");
    }
  });

  it("denies retrieval to a null/undefined role", () => {
    expect(canRetrieveNarrative({ role: null })).toBe(false);
    expect(canRetrieveNarrative({ role: undefined })).toBe(false);
    expect(retrieveVirsNarrative(report, { role: null }).granted).toBe(false);
  });

  it("is exact-match on the role: a look-alike role is denied", () => {
    for (const lookAlike of ["safety_reviewer", "SAFETY-REVIEWER", "SAFETY_REVIEWER ", "REVIEWER"]) {
      expect(canRetrieveNarrative({ role: lookAlike })).toBe(false);
      const result = retrieveVirsNarrative(report, { role: lookAlike });
      expect(result.granted).toBe(false);
      if (!result.granted) {
        expect(result.reason).toBe("NOT_SAFETY_REVIEWER");
      }
    }
  });

  it("a public route is denied FIRST, even without any role (PUBLIC_ROUTE, not NOT_SAFETY_REVIEWER)", () => {
    const result = retrieveVirsNarrative(report, { isPublicRoute: true });
    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.reason).toBe("PUBLIC_ROUTE");
    }
  });

  it("a safety reviewer on a non-public route is granted the exact narrative", () => {
    const result = retrieveVirsNarrative(report, { role: SAFETY_REVIEWER_ROLE });
    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.narrative).toBe(report.narrative);
    }
  });

  it("a denied retrieval never carries the narrative anywhere in its serialized form", () => {
    const denied = retrieveVirsNarrative(report, { role: "CAPTAIN" });
    expect(JSON.stringify(denied)).not.toContain(report.narrative);
  });

  it("property: a NON-reviewer role can NEVER retrieve the narrative (req 11.3)", () => {
    const nonReviewerRole = fc
      .oneof(
        fc.string(),
        fc.constantFrom("CAPTAIN", "DISPATCHER", "MEDIC", "ADMIN", "PILOT", ""),
      )
      .filter((role) => role !== SAFETY_REVIEWER_ROLE);

    fc.assert(
      fc.property(nonReviewerRole, fc.boolean(), (role, isPublicRoute) => {
        expect(canRetrieveNarrative({ role, isPublicRoute })).toBe(false);
        const result = retrieveVirsNarrative(report, { role, isPublicRoute });
        expect(result.granted).toBe(false);
      }),
    );
  });

  it("property: ANY public-route request is denied regardless of role (req 11.3)", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(SAFETY_REVIEWER_ROLE), fc.string(), fc.constant(null)),
        (role) => {
          expect(canRetrieveNarrative({ role, isPublicRoute: true })).toBe(false);
          const result = retrieveVirsNarrative(report, { role, isPublicRoute: true });
          expect(result.granted).toBe(false);
          if (!result.granted) {
            expect(result.reason).toBe("PUBLIC_ROUTE");
          }
        },
      ),
    );
  });
});

describe("public projection never leaks the narrative or reporter (req 11.3)", () => {
  it("property: the public projection never contains the narrative or reporter identity, whatever the report", () => {
    // Wrap the generated narrative in distinctive sentinels so that even a
    // 1-char body can never coincidentally match a metadata field (e.g. the
    // "R" in NEAR_MISS). The sentinels themselves never appear in any
    // projection field, so any occurrence would be a genuine narrative leak.
    const reportArb = fc.record({
      narrativeBody: fc.string({ maxLength: 300 }),
      reporterId: fc.uuid(),
      category: fc.constantFrom(...VIRS_INCIDENT_CATEGORIES),
      redacted: fc.boolean(),
    });

    fc.assert(
      fc.property(reportArb, ({ narrativeBody, reporterId, category, redacted }) => {
        const narrative = `<<VIRS_SECRET_START>>${narrativeBody}<<VIRS_SECRET_END>>`;
        const report = makeReport({
          narrative,
          reporter_id: reporterId,
          incident_category: category,
          is_redacted: redacted,
        });
        const projection = toPublicProjection(report);

        // Structural guarantee: the sensitive fields are simply not present.
        const keys = Object.keys(projection);
        expect(keys).not.toContain("narrative");
        expect(keys).not.toContain("reporter_id");

        // Serialized guarantee: neither the narrative (via its sentinels) nor
        // the reporter identity can be recovered from the projection.
        const serialized = JSON.stringify(projection);
        expect(serialized).not.toContain("VIRS_SECRET_START");
        expect(serialized).not.toContain("VIRS_SECRET_END");
        expect(serialized).not.toContain(reporterId);

        // But the non-sensitive metadata is faithfully carried through.
        expect(projection.incident_category).toBe(category);
        expect(projection.is_redacted).toBe(redacted);
        expect(projection.hasNarrative).toBe(narrative.length > 0);
      }),
    );
  });
});

// --- Draft preservation on service failure (req 11.4) -----------------------

describe("submitVirsReport — draft preservation on service failure (req 11.4)", () => {
  it("a validation error is NOT a service failure: nothing persisted and NO draft written", async () => {
    const store = new InMemoryVirsStore();
    const draftStore = new InMemoryVirsDraftStore();
    const result = await submitVirsReport(
      { incident_category: "", narrative: "retained on validation error" },
      submitDeps({ store, draftStore }),
    );
    expect(result.status).toBe("VALIDATION_ERROR");
    expect(store.size).toBe(0);
    expect(draftStore.size).toBe(0);
  });

  it("the preserved draft's expiry is at least 24h after its creation time (req 11.4)", async () => {
    const draftStore = new InMemoryVirsDraftStore();
    const result = await submitVirsReport(
      { incident_category: "HAZARD", narrative: "Preserve me for retry." },
      submitDeps({ store: new FailingVirsStore(), draftStore }),
    );
    expect(result.status).toBe("NOT_SAVED");
    if (result.status === "NOT_SAVED") {
      const created = Date.parse(result.draft.createdAt);
      const expires = Date.parse(result.draft.expiresAt);
      expect(expires - created).toBeGreaterThanOrEqual(DRAFT_MIN_RETENTION_MS);
      expect(created).toBe(NOW.getTime());
    }
  });

  it("property: on ANY store failure a valid submission preserves a >= 24h draft retaining the narrative and category (req 11.4)", async () => {
    const submissionArb = fc.record({
      category: fc.constantFrom(...VIRS_INCIDENT_CATEGORIES),
      narrative: fc.string({ minLength: 1, maxLength: 300 }).filter((s) => s.trim().length >= 1),
    });

    await fc.assert(
      fc.asyncProperty(submissionArb, async ({ category, narrative }) => {
        const draftStore = new InMemoryVirsDraftStore();
        const result = await submitVirsReport(
          { incident_category: category, narrative },
          submitDeps({ store: new FailingVirsStore(), draftStore }),
        );
        expect(result.status).toBe("NOT_SAVED");
        if (result.status === "NOT_SAVED") {
          expect(result.draft.narrative).toBe(narrative);
          expect(result.draft.incident_category).toBe(category);
          const retention =
            Date.parse(result.draft.expiresAt) - Date.parse(result.draft.createdAt);
          expect(retention).toBeGreaterThanOrEqual(DRAFT_MIN_RETENTION_MS);
        }
        expect(draftStore.size).toBe(1);
      }),
    );
  });
});
