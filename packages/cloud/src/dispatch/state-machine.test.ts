import { describe, expect, it } from "vitest";
import {
  advanceDispatch,
  checkStageAdvancePermitted,
  toCrewRoster,
  validateCrew,
  validateDetails,
  DISPATCH_STAGES,
  MAX_WEATHER_AGE_MS,
  MIN_CREW_MEMBERS,
  MAX_CREW_MEMBERS,
  type AdvanceDispatchDependencies,
  type CrewInput,
  type DetailsInput,
  type DispatchErrorCode,
} from "./state-machine.js";
import { InMemoryDispatchLookup } from "./in-memory-lookup.js";

// --- Fixtures ----------------------------------------------------------------

const BASE_ID = "b0000000-0000-0000-0000-000000000001";
const AIRFRAME_ID = "a0000000-0000-0000-0000-000000000001";
const ORIGIN_ID = "f0000000-0000-0000-0000-000000000001";
const DEST_ID = "f0000000-0000-0000-0000-000000000002";

const NOW = new Date("2024-01-01T12:00:00.000Z");

function lookupWithAll(): InMemoryDispatchLookup {
  return new InMemoryDispatchLookup({
    baseIds: [BASE_ID],
    airframeIds: [AIRFRAME_ID],
    facilityIds: [ORIGIN_ID, DEST_ID],
  });
}

function deps(
  overrides: Partial<AdvanceDispatchDependencies> = {},
): AdvanceDispatchDependencies {
  return {
    lookup: overrides.lookup ?? lookupWithAll(),
    now: overrides.now ?? (() => NOW),
  };
}

/** A fully valid Stage 1 Details submission with a fresh weather snapshot. */
function validDetails(overrides: Partial<DetailsInput> = {}): DetailsInput {
  return {
    mission_type: "SCENE_CALL",
    assigned_base_id: BASE_ID,
    assigned_airframe_id: AIRFRAME_ID,
    origin_hospital_id: ORIGIN_ID,
    destination_hospital_id: DEST_ID,
    weather_snapshot: { observed_at: NOW.toISOString() },
    ...overrides,
  };
}

/** A valid 2-member Stage 2 crew: one PIC, one nurse, no duplicates. */
function validCrew(overrides: Partial<CrewInput> = {}): CrewInput {
  return {
    members: [
      {
        member_id: "c0000000-0000-0000-0000-000000000001",
        role: "PILOT",
        is_pilot_in_command: true,
      },
      {
        member_id: "c0000000-0000-0000-0000-000000000002",
        role: "FLIGHT_NURSE",
      },
    ],
    ...overrides,
  };
}

function codes(errors: { code: DispatchErrorCode }[]): DispatchErrorCode[] {
  return errors.map((e) => e.code);
}

// --- Stage 1 Details (req 3.1, 3.2) -----------------------------------------

describe("validateDetails (Stage 1) — req 3.1/3.2", () => {
  it("accepts a fully valid Details submission", () => {
    expect(validateDetails(validDetails(), lookupWithAll(), NOW)).toEqual([]);
  });

  it("rejects an undefined mission type", () => {
    const errors = validateDetails(
      validDetails({ mission_type: undefined }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("MISSION_TYPE_INVALID");
  });

  it("rejects a mission type that is not a defined type", () => {
    const errors = validateDetails(
      validDetails({ mission_type: "NOT_A_TYPE" }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("MISSION_TYPE_INVALID");
  });

  it("flags a missing base and a non-existent airframe distinctly", () => {
    const errors = validateDetails(
      validDetails({
        assigned_base_id: undefined,
        assigned_airframe_id: "a0000000-0000-0000-0000-0000000000ff",
      }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("BASE_MISSING");
    expect(codes(errors)).toContain("AIRFRAME_NOT_FOUND");
  });

  it("flags a non-existent origin and destination", () => {
    const errors = validateDetails(
      validDetails({
        origin_hospital_id: "f0000000-0000-0000-0000-0000000000fe",
        destination_hospital_id: "f0000000-0000-0000-0000-0000000000fd",
      }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("ORIGIN_NOT_FOUND");
    expect(codes(errors)).toContain("DESTINATION_NOT_FOUND");
  });

  it("rejects identical origin and destination", () => {
    const errors = validateDetails(
      validDetails({ destination_hospital_id: ORIGIN_ID }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("ORIGIN_DESTINATION_IDENTICAL");
  });

  it("rejects a missing weather snapshot", () => {
    const errors = validateDetails(
      validDetails({ weather_snapshot: undefined }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("WEATHER_SNAPSHOT_MISSING");
  });

  it("accepts a weather snapshot exactly 60 minutes old", () => {
    const observed_at = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const errors = validateDetails(
      validDetails({ weather_snapshot: { observed_at } }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).not.toContain("WEATHER_SNAPSHOT_STALE");
  });

  it("rejects a weather snapshot older than 60 minutes", () => {
    const observed_at = new Date(
      NOW.getTime() - (60 * 60 * 1000 + 1),
    ).toISOString();
    const errors = validateDetails(
      validDetails({ weather_snapshot: { observed_at } }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("WEATHER_SNAPSHOT_STALE");
  });

  it("returns EVERY failed field, not just the first (req 3.2)", () => {
    const errors = validateDetails(
      {
        mission_type: "BOGUS",
        assigned_base_id: undefined,
        assigned_airframe_id: undefined,
        origin_hospital_id: undefined,
        destination_hospital_id: undefined,
        weather_snapshot: undefined,
      },
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toEqual(
      expect.arrayContaining([
        "MISSION_TYPE_INVALID",
        "BASE_MISSING",
        "AIRFRAME_MISSING",
        "ORIGIN_MISSING",
        "DESTINATION_MISSING",
        "WEATHER_SNAPSHOT_MISSING",
      ]),
    );
  });
});

// --- Stage 2 Crew (req 3.3, 3.3a) -------------------------------------------

describe("validateCrew (Stage 2) — req 3.3/3.3a", () => {
  it("accepts a valid 2-member roster with exactly one PIC and defined roles", () => {
    expect(validateCrew(validCrew())).toEqual([]);
  });

  it("rejects a roster with no PIC", () => {
    const crew = validCrew();
    crew.members![0]!.is_pilot_in_command = false;
    expect(codes(validateCrew(crew))).toContain("PIC_MISSING");
  });

  it("rejects a roster with multiple PICs", () => {
    const crew = validCrew();
    crew.members![1]!.is_pilot_in_command = true;
    expect(codes(validateCrew(crew))).toContain("PIC_MULTIPLE");
  });

  it("rejects a roster smaller than 2 members", () => {
    const crew: CrewInput = {
      members: [
        {
          member_id: "c0000000-0000-0000-0000-000000000001",
          role: "PILOT",
          is_pilot_in_command: true,
        },
      ],
    };
    expect(codes(validateCrew(crew))).toContain("CREW_ROSTER_TOO_SMALL");
  });

  it("rejects a roster larger than 6 members", () => {
    const members = Array.from({ length: 7 }, (_, i) => ({
      member_id: `c0000000-0000-0000-0000-00000000000${i}`,
      role: "TECH",
      is_pilot_in_command: i === 0,
    }));
    expect(codes(validateCrew({ members }))).toContain("CREW_ROSTER_TOO_LARGE");
  });

  it("rejects a duplicate member and reports it once", () => {
    const crew: CrewInput = {
      members: [
        {
          member_id: "c0000000-0000-0000-0000-000000000001",
          role: "PILOT",
          is_pilot_in_command: true,
        },
        {
          member_id: "c0000000-0000-0000-0000-000000000002",
          role: "FLIGHT_NURSE",
        },
        {
          member_id: "c0000000-0000-0000-0000-000000000002",
          role: "FLIGHT_PARAMEDIC",
        },
      ],
    };
    const dupes = validateCrew(crew).filter(
      (e) => e.code === "CREW_DUPLICATE_MEMBER",
    );
    expect(dupes).toHaveLength(1);
  });

  it("rejects a member with no defined role", () => {
    const crew = validCrew();
    crew.members![1]!.role = "";
    expect(codes(validateCrew(crew))).toContain("CREW_MEMBER_MISSING_ROLE");
  });

  it("returns EVERY failed crew condition simultaneously (req 3.3a)", () => {
    const crew: CrewInput = {
      members: [
        // Two PICs, second has no role, and both share an id (duplicate).
        {
          member_id: "c0000000-0000-0000-0000-000000000001",
          role: "PILOT",
          is_pilot_in_command: true,
        },
        {
          member_id: "c0000000-0000-0000-0000-000000000001",
          role: "",
          is_pilot_in_command: true,
        },
      ],
    };
    const found = codes(validateCrew(crew));
    expect(found).toEqual(
      expect.arrayContaining([
        "PIC_MULTIPLE",
        "CREW_MEMBER_MISSING_ROLE",
        "CREW_DUPLICATE_MEMBER",
      ]),
    );
  });
});

describe("toCrewRoster", () => {
  it("projects a valid crew list onto a CrewRoster", () => {
    const roster = toCrewRoster({
      members: [
        {
          member_id: "c0000000-0000-0000-0000-000000000001",
          role: "PILOT",
          is_pilot_in_command: true,
        },
        {
          member_id: "c0000000-0000-0000-0000-000000000002",
          role: "FLIGHT_NURSE",
        },
        {
          member_id: "c0000000-0000-0000-0000-000000000003",
          role: "FLIGHT_PARAMEDIC",
        },
      ],
    });
    expect(roster).toEqual({
      pilot_in_command_id: "c0000000-0000-0000-0000-000000000001",
      flight_nurse_id: "c0000000-0000-0000-0000-000000000002",
      flight_paramedic_id: "c0000000-0000-0000-0000-000000000003",
    });
  });
});

// --- Stage-advance restriction (req 3.8) ------------------------------------

describe("checkStageAdvancePermitted — req 3.8", () => {
  it("permits advancing to the current stage", () => {
    expect(checkStageAdvancePermitted("CREW", "CREW")).toBeNull();
  });

  it("permits returning to a previously completed stage", () => {
    expect(checkStageAdvancePermitted("PATIENT_INFO", "DETAILS")).toBeNull();
  });

  it("rejects advancing beyond the current incomplete stage and names it", () => {
    const err = checkStageAdvancePermitted("DETAILS", "PATIENT_INFO");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("STAGE_ADVANCE_NOT_PERMITTED");
    expect(err!.detail).toBe("DETAILS");
  });
});

// --- advanceDispatch integration --------------------------------------------

describe("advanceDispatch — Stage 1/Stage 2 gating", () => {
  it("opens CREW on a valid DETAILS submission", () => {
    const result = advanceDispatch(
      { currentStage: "DETAILS" },
      "DETAILS",
      validDetails(),
      deps(),
    );
    expect(result).toEqual({ ok: true, openedStage: "CREW" });
  });

  it("keeps the next stage closed and retains input on a failed DETAILS submission (req 3.2)", () => {
    const input = validDetails({ destination_hospital_id: ORIGIN_ID });
    const result = advanceDispatch(
      { currentStage: "DETAILS" },
      "DETAILS",
      input,
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContain("ORIGIN_DESTINATION_IDENTICAL");
      expect(result.retainedInput).toBe(input);
    }
  });

  it("opens PATIENT_INFO on a valid CREW submission", () => {
    const result = advanceDispatch(
      { currentStage: "CREW" },
      "CREW",
      validCrew(),
      deps(),
    );
    expect(result).toEqual({ ok: true, openedStage: "PATIENT_INFO" });
  });

  it("keeps Stage 3 closed and retains input on a failed CREW submission (req 3.3a)", () => {
    const input = validCrew();
    input.members![0]!.is_pilot_in_command = false;
    const result = advanceDispatch(
      { currentStage: "CREW" },
      "CREW",
      input,
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContain("PIC_MISSING");
      expect(result.retainedInput).toBe(input);
    }
  });

  it("rejects a skip-ahead request before running stage validation (req 3.8)", () => {
    const result = advanceDispatch(
      { currentStage: "DETAILS" },
      "PATIENT_INFO",
      validDetails(),
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(["STAGE_ADVANCE_NOT_PERMITTED"]);
    }
  });
});

// ============================================================================
// Task 8.5 — Stage validation and override rules
//
// Focused tests for the completeness/boundary/restriction behaviors of the
// dispatch state machine that exist NOW:
//   - req 3.2  : Stage 1 per-field error reporting (EVERY failed field, named,
//                with the submission retained)
//   - req 3.3a : Stage 2 per-condition error reporting (EVERY failed condition,
//                including simultaneous failures; roster-size boundaries)
//   - req 3.8  : stage-advance restriction (permit current/earlier, reject
//                skip-ahead and name the incomplete stage)
//
// req 3.10 (training-override rationale enforcement) is implemented by task 8.3
// (mission authorization / audit events), which has NOT landed in this package
// yet — no override / authorization / rationale function exists in
// packages/cloud/src/dispatch (the state-machine module documents it as a
// future seam). Per the task's coordination guidance, the 3.10 behavior is
// captured below as `it.todo` placeholders describing exactly what to assert
// once 8.3 lands, rather than as failing or false-passing tests.
// ============================================================================

// --- req 3.2: Stage 1 per-field error reporting -----------------------------

describe("Stage 1 per-field error reporting — req 3.2", () => {
  it("reports EVERY failed field for a submission with several simultaneous failures", () => {
    // Invalid mission type, missing base, non-existent airframe, missing
    // origin, non-existent destination, and a stale weather snapshot all at
    // once — validation must surface all of them together, not short-circuit.
    const staleObservedAt = new Date(
      NOW.getTime() - (MAX_WEATHER_AGE_MS + 60_000),
    ).toISOString();
    const errors = validateDetails(
      {
        mission_type: "NOT_A_TYPE",
        assigned_base_id: undefined,
        assigned_airframe_id: "a0000000-0000-0000-0000-0000000000ff",
        origin_hospital_id: undefined,
        destination_hospital_id: "f0000000-0000-0000-0000-0000000000fe",
        weather_snapshot: { observed_at: staleObservedAt },
      },
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toEqual(
      expect.arrayContaining([
        "MISSION_TYPE_INVALID",
        "BASE_MISSING",
        "AIRFRAME_NOT_FOUND",
        "ORIGIN_MISSING",
        "DESTINATION_NOT_FOUND",
        "WEATHER_SNAPSHOT_STALE",
      ]),
    );
  });

  it("names the offending field on every Stage 1 error", () => {
    const errors = validateDetails(
      {
        mission_type: undefined,
        assigned_base_id: undefined,
        assigned_airframe_id: undefined,
        origin_hospital_id: undefined,
        destination_hospital_id: undefined,
        weather_snapshot: undefined,
      },
      lookupWithAll(),
      NOW,
    );
    // Requirement 3.2 requires "identifying each failed field": every reported
    // error must carry a non-empty field name.
    expect(errors.length).toBeGreaterThan(0);
    for (const err of errors) {
      expect(err.field).toBeTruthy();
    }
    const fields = errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "mission_type",
        "assigned_base_id",
        "assigned_airframe_id",
        "origin_hospital_id",
        "destination_hospital_id",
        "weather_snapshot",
      ]),
    );
  });

  it("retains the exact submitted input on a failed Stage 1 advance (req 3.2)", () => {
    const input = validDetails({
      mission_type: "NOT_A_TYPE",
      destination_hospital_id: "f0000000-0000-0000-0000-0000000000fe",
    });
    const result = advanceDispatch(
      { currentStage: "DETAILS" },
      "DETAILS",
      input,
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Same reference and same values: the UI can re-render the stage intact.
      expect(result.retainedInput).toBe(input);
      expect(result.retainedInput).toEqual(input);
    }
  });

  it("flags an invalid (unparseable) weather timestamp distinctly from a missing one", () => {
    const invalid = validateDetails(
      validDetails({ weather_snapshot: { observed_at: "not-a-timestamp" } }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(invalid)).toContain("WEATHER_SNAPSHOT_INVALID");

    const missing = validateDetails(
      validDetails({ weather_snapshot: { observed_at: undefined } }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(missing)).toContain("WEATHER_SNAPSHOT_INVALID");
  });

  it("treats a weather snapshot one millisecond under 60 minutes as fresh (boundary)", () => {
    const observed_at = new Date(
      NOW.getTime() - (MAX_WEATHER_AGE_MS - 1),
    ).toISOString();
    const errors = validateDetails(
      validDetails({ weather_snapshot: { observed_at } }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).not.toContain("WEATHER_SNAPSHOT_STALE");
  });

  it("treats a weather snapshot exactly one millisecond over 60 minutes as stale (boundary)", () => {
    const observed_at = new Date(
      NOW.getTime() - (MAX_WEATHER_AGE_MS + 1),
    ).toISOString();
    const errors = validateDetails(
      validDetails({ weather_snapshot: { observed_at } }),
      lookupWithAll(),
      NOW,
    );
    expect(codes(errors)).toContain("WEATHER_SNAPSHOT_STALE");
  });
});

// --- req 3.3a: Stage 2 per-condition error reporting ------------------------

describe("Stage 2 per-condition error reporting — req 3.3a", () => {
  it("reports EVERY failed crew condition present in one submission", () => {
    // A roster that fails as many distinct conditions as can co-exist:
    //   - too large (7 > 6)
    //   - multiple PICs
    //   - a duplicate member id
    //   - a member with no defined role
    const members = [
      { member_id: "c0000000-0000-0000-0000-000000000001", role: "PILOT", is_pilot_in_command: true },
      { member_id: "c0000000-0000-0000-0000-000000000002", role: "PILOT", is_pilot_in_command: true },
      { member_id: "c0000000-0000-0000-0000-000000000002", role: "FLIGHT_NURSE" },
      { member_id: "c0000000-0000-0000-0000-000000000003", role: "" },
      { member_id: "c0000000-0000-0000-0000-000000000004", role: "TECH" },
      { member_id: "c0000000-0000-0000-0000-000000000005", role: "TECH" },
      { member_id: "c0000000-0000-0000-0000-000000000006", role: "TECH" },
    ];
    const found = codes(validateCrew({ members }));
    expect(found).toEqual(
      expect.arrayContaining([
        "CREW_ROSTER_TOO_LARGE",
        "PIC_MULTIPLE",
        "CREW_DUPLICATE_MEMBER",
        "CREW_MEMBER_MISSING_ROLE",
      ]),
    );
  });

  it("reports the no-PIC and too-small conditions together for a single under-crewed member", () => {
    const found = codes(
      validateCrew({
        members: [
          { member_id: "c0000000-0000-0000-0000-000000000001", role: "FLIGHT_NURSE" },
        ],
      }),
    );
    expect(found).toEqual(
      expect.arrayContaining(["CREW_ROSTER_TOO_SMALL", "PIC_MISSING"]),
    );
  });

  it("flags a member missing an identifier as un-deduplicable", () => {
    const found = codes(
      validateCrew({
        members: [
          { member_id: "c0000000-0000-0000-0000-000000000001", role: "PILOT", is_pilot_in_command: true },
          { role: "FLIGHT_NURSE" },
        ],
      }),
    );
    expect(found).toContain("CREW_DUPLICATE_MEMBER");
  });

  it("accepts a roster of exactly 2 members (lower boundary)", () => {
    const members = [
      { member_id: "c0000000-0000-0000-0000-000000000001", role: "PILOT", is_pilot_in_command: true },
      { member_id: "c0000000-0000-0000-0000-000000000002", role: "FLIGHT_NURSE" },
    ];
    expect(codes(validateCrew({ members }))).not.toContain("CREW_ROSTER_TOO_SMALL");
    expect(members).toHaveLength(MIN_CREW_MEMBERS);
    expect(validateCrew({ members })).toEqual([]);
  });

  it("accepts a roster of exactly 6 members (upper boundary)", () => {
    const members = Array.from({ length: MAX_CREW_MEMBERS }, (_, i) => ({
      member_id: `c0000000-0000-0000-0000-00000000000${i + 1}`,
      role: "TECH",
      is_pilot_in_command: i === 0,
    }));
    expect(members).toHaveLength(MAX_CREW_MEMBERS);
    expect(codes(validateCrew({ members }))).not.toContain("CREW_ROSTER_TOO_LARGE");
    expect(validateCrew({ members })).toEqual([]);
  });

  it("rejects a roster of exactly 7 members (just over the upper boundary)", () => {
    const members = Array.from({ length: MAX_CREW_MEMBERS + 1 }, (_, i) => ({
      member_id: `c0000000-0000-0000-0000-00000000000${i + 1}`,
      role: "TECH",
      is_pilot_in_command: i === 0,
    }));
    expect(codes(validateCrew({ members }))).toContain("CREW_ROSTER_TOO_LARGE");
  });

  it("names the offending member index on a missing-role error", () => {
    const errors = validateCrew({
      members: [
        { member_id: "c0000000-0000-0000-0000-000000000001", role: "PILOT", is_pilot_in_command: true },
        { member_id: "c0000000-0000-0000-0000-000000000002", role: "" },
      ],
    });
    const roleError = errors.find((e) => e.code === "CREW_MEMBER_MISSING_ROLE");
    expect(roleError).toBeDefined();
    expect(roleError!.field).toBe("members[1].role");
  });

  it("retains the exact submitted crew input on a failed Stage 2 advance (req 3.3a)", () => {
    const input = validCrew();
    input.members![1]!.is_pilot_in_command = true; // two PICs
    const result = advanceDispatch(
      { currentStage: "CREW" },
      "CREW",
      input,
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContain("PIC_MULTIPLE");
      expect(result.retainedInput).toBe(input);
    }
  });
});

// --- req 3.8: stage-advance restriction, exhaustively -----------------------

describe("stage-advance restriction matrix — req 3.8", () => {
  it("permits advancing to the current stage or any previously completed stage", () => {
    for (let currentIdx = 0; currentIdx < DISPATCH_STAGES.length; currentIdx++) {
      const current = DISPATCH_STAGES[currentIdx]!;
      for (let reqIdx = 0; reqIdx <= currentIdx; reqIdx++) {
        const requested = DISPATCH_STAGES[reqIdx]!;
        expect(checkStageAdvancePermitted(current, requested)).toBeNull();
      }
    }
  });

  it("rejects any request targeting a stage beyond the current one and names the incomplete stage", () => {
    for (let currentIdx = 0; currentIdx < DISPATCH_STAGES.length; currentIdx++) {
      const current = DISPATCH_STAGES[currentIdx]!;
      for (let reqIdx = currentIdx + 1; reqIdx < DISPATCH_STAGES.length; reqIdx++) {
        const requested = DISPATCH_STAGES[reqIdx]!;
        const err = checkStageAdvancePermitted(current, requested);
        expect(err).not.toBeNull();
        expect(err!.code).toBe("STAGE_ADVANCE_NOT_PERMITTED");
        // The error identifies the incomplete stage that may not be skipped:
        // the current stage is the first incomplete one.
        expect(err!.detail).toBe(current);
      }
    }
  });

  it("enforces the restriction inside advanceDispatch before any stage validation runs", () => {
    // Input is a fully valid Details submission, but the request skips ahead to
    // FLIGHT_PLAN from DETAILS: the advance restriction must fire first and be
    // the ONLY error, and the input must be retained.
    const input = validDetails();
    const result = advanceDispatch(
      { currentStage: "DETAILS" },
      "FLIGHT_PLAN",
      input,
      deps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(["STAGE_ADVANCE_NOT_PERMITTED"]);
      expect(result.errors[0]!.detail).toBe("DETAILS");
      expect(result.retainedInput).toBe(input);
    }
  });
});

// --- req 3.10: training-override rationale enforcement ----------------------
//
// RESOLVED: task 8.3 (mission authorization / audit events) has now landed in
// @virtualhems/cloud (`./mission-service.ts`), which exposes the override /
// authorization / rationale surface these placeholders were waiting on. The
// req-3.10 behavior is now covered by REAL tests against that surface in
// `./mission-service.test.ts` ("training-override rationale enforcement — req
// 3.10"), including the four cases below plus a fast-check property. The
// `it.todo` placeholders are therefore replaced by those real tests rather than
// left pending here.
