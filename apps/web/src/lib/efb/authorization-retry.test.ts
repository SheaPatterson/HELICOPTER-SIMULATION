import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { CrewRoster, MissionDispatch } from "@virtualhems/contracts";
import { resolveEfbMissionView, crewSeatFor } from "./mission-view";
import {
  EVENT_DESTINATIONS,
  EVENT_DESTINATION_LABELS,
  PROVENANCE_KEYS,
  failedDestinations,
  fullFailure,
  isFullySubmitted,
  partialFailure,
  pendingDestinations,
  retryCrewEvent,
  submissionFailureIndication,
  submitCrewEvent,
  type CrewEventDraft,
  type CrewEventSubmission,
  type DestinationStatus,
  type EventDestination,
  type EventDestinationPort,
  type EventDestinationPorts,
} from "./event-capture";

/**
 * Task 13.3 — dedicated unit + property tests for EFB authorization gating
 * (Requirement 6.2) and partial-failure retry semantics (Requirement 6.6a).
 *
 * These complement the 13.1/13.2 example tests with exhaustive gating over
 * arbitrary rosters/viewers and invariant-level retry checks (never resubmit a
 * succeeded destination, retain event data across arbitrarily many retries,
 * retry-only-failed, idempotence once fully submitted). We test the REAL public
 * surface from mission-view.ts / event-capture.ts — no invented functions.
 */

// ---------------------------------------------------------------------------
// Shared fixtures / builders
// ---------------------------------------------------------------------------

const PIC = "pic-0000-0000-0000-000000000001";
const NURSE = "nurse-000-0000-0000-000000000002";
const MEDIC = "medic-000-0000-0000-000000000003";
const CREW_ID = "crew-000-0000-0000-000000000007";
const MISSION_ID = "mission-0000-0000-0000-000000000001";
const OCCURRED_AT = "2024-01-01T00:15:00.000Z";

function buildMission(
  overrides: Partial<MissionDispatch> = {},
): MissionDispatch {
  return {
    mission_id: MISSION_ID,
    mission_code: "STAT-42",
    details: {
      mission_type: "SCENE_CALL",
      assigned_base_id: "base-1",
      assigned_airframe_id: "airframe-1",
      destination_hospital_id: "hosp-1",
      weather_snapshot: { observed_at: "2024-01-01T00:00:00.000Z" },
    },
    crew: {
      pilot_in_command_id: PIC,
      flight_nurse_id: NURSE,
      flight_paramedic_id: MEDIC,
    },
    patient: {
      simulated_patient_id: "patient-1",
      age_years: 44,
      gender: "M",
      weight_lbs: 190,
      condition_id: "cond-1",
      clinical_summary: "Simulated trauma — confidential clinical detail",
      interventions: "None",
      baseline_gcs: 13,
    },
    risk: {
      pilot_score: 1,
      aircraft_score: 1,
      environment_score: 1,
      external_score: 1,
      total_score: 4,
      disposition: "GO",
      rationale: [],
    },
    flight_plan: {
      route: [],
      direct_distance_nm: 20,
      planned_distance_nm: 22,
      estimated_fuel_burn_lbs: 300,
      reserve_requirement_minutes: 20,
      reserve_at_destination_minutes: 25,
    },
    status: "DISPATCHED",
    authorization_code: "AUTH-XYZ",
    ...overrides,
  };
}

function draft(overrides: Partial<CrewEventDraft> = {}): CrewEventDraft {
  return {
    mission_id: MISSION_ID,
    event_type: "ARRIVED_SCENE",
    occurred_at: OCCURRED_AT,
    ...overrides,
  };
}

const ok: EventDestinationPort = () => Promise.resolve();
const fail =
  (message: string): EventDestinationPort =>
  () =>
    Promise.reject(new Error(message));

function ports(
  clinical: EventDestinationPort,
  mission: EventDestinationPort,
): EventDestinationPorts {
  return { CLINICAL_ENGINE: clinical, MISSION_SERVICE: mission };
}

// ---------------------------------------------------------------------------
// Authorization gating (Requirement 6.2)
// ---------------------------------------------------------------------------

describe("authorization gating — assigned crew are authorized (6.1/6.2)", () => {
  it("authorizes exactly the three occupied crew seats", () => {
    const mission = buildMission();
    for (const id of [PIC, NURSE, MEDIC]) {
      const view = resolveEfbMissionView(mission, { viewer_id: id });
      expect(view.authorized).toBe(true);
    }
  });
});

describe("authorization gating — non-assigned viewers withheld (6.2)", () => {
  it("withholds and exposes NO package field for a stranger", () => {
    const mission = buildMission();
    const view = resolveEfbMissionView(mission, {
      viewer_id: "stranger-000-0000-0000-000000000099",
    });
    if (view.authorized) throw new Error("expected unauthorized");
    // Structural withholding: only the echoed id + a reason string exist.
    expect(Object.keys(view).sort()).toEqual(
      ["authorized", "reason", "requested_mission_id"].sort(),
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(mission.mission_code);
    expect(serialized).not.toContain(mission.patient.clinical_summary);
    expect(serialized).not.toContain(mission.authorization_code!);
    expect(serialized).not.toContain(mission.details.assigned_base_id);
  });

  it("does not authorize on a purely empty-string / undefined seat collision", () => {
    // A roster with an absent nurse seat must not authorize a viewer whose id
    // is undefined-like; only an exact id match on an occupied seat authorizes.
    const mission = buildMission({
      crew: { pilot_in_command_id: PIC },
    });
    expect(
      resolveEfbMissionView(mission, { viewer_id: NURSE }).authorized,
    ).toBe(false);
    expect(
      resolveEfbMissionView(mission, { viewer_id: MEDIC }).authorized,
    ).toBe(false);
  });
});

describe("authorization gating — PROPERTY: only assigned crew ever see the package (6.2)", () => {
  // An arbitrary roster with 0..3 occupied seats drawn from a small id pool,
  // plus an arbitrary viewer id. The authorization decision MUST match, exactly,
  // whether the viewer occupies a seat — never more permissive, never less.
  const idPool = ["A", "B", "C", "D", "E"] as const;
  const idArb = fc.constantFrom(...idPool);
  const optionalIdArb = fc.option(idArb, { nil: undefined });

  const rosterArb: fc.Arbitrary<CrewRoster> = fc
    .record({
      pilot_in_command_id: idArb,
      flight_nurse_id: optionalIdArb,
      flight_paramedic_id: optionalIdArb,
    })
    .map((r) => {
      const roster: CrewRoster = { pilot_in_command_id: r.pilot_in_command_id };
      if (r.flight_nurse_id !== undefined) {
        roster.flight_nurse_id = r.flight_nurse_id;
      }
      if (r.flight_paramedic_id !== undefined) {
        roster.flight_paramedic_id = r.flight_paramedic_id;
      }
      return roster;
    });

  it("authorized IFF the viewer occupies a crew seat, and withholds otherwise", () => {
    fc.assert(
      fc.property(rosterArb, idArb, (crew, viewerId) => {
        const mission = buildMission({ crew });
        const view = resolveEfbMissionView(mission, { viewer_id: viewerId });
        const seat = crewSeatFor(crew, viewerId);
        const expectedAuthorized = seat !== null;

        expect(view.authorized).toBe(expectedAuthorized);

        if (view.authorized) {
          // Authorized viewers get the package with a seat that actually maps
          // to their id on the roster.
          expect(view.package.viewer_seat).toBe(seat);
          expect(view.package.mission_id).toBe(mission.mission_id);
        } else {
          // Withheld: no confidential fields leak, regardless of roster shape.
          const serialized = JSON.stringify(view);
          expect(serialized).not.toContain(mission.mission_code);
          expect(serialized).not.toContain(mission.patient.clinical_summary);
          expect(serialized).not.toContain(mission.authorization_code!);
        }
      }),
    );
  });

  it("a viewer id absent from the roster is ALWAYS withheld", () => {
    fc.assert(
      fc.property(rosterArb, (crew) => {
        // "Z" is never in the id pool, so it can never occupy a seat.
        const mission = buildMission({ crew });
        const view = resolveEfbMissionView(mission, { viewer_id: "Z" });
        expect(view.authorized).toBe(false);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Partial-failure retry semantics (Requirement 6.6a)
// ---------------------------------------------------------------------------

describe("partial-failure retry — retry ONLY the failed destination (6.6a)", () => {
  it("retries only Clinical_Engine when it alone failed, never resubmits Mission_Service", async () => {
    const first = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(fail("clinical down"), ok),
    );
    expect(partialFailure(first)).toBe(true);
    expect(failedDestinations(first)).toEqual(["CLINICAL_ENGINE"]);

    const clinicalRetry = vi.fn(ok);
    const missionRetry = vi.fn(ok);
    const retried = await retryCrewEvent(
      first,
      ports(clinicalRetry, missionRetry),
    );

    expect(clinicalRetry).toHaveBeenCalledTimes(1);
    expect(missionRetry).not.toHaveBeenCalled();
    expect(isFullySubmitted(retried)).toBe(true);
    expect(retried.destinations.MISSION_SERVICE.status).toBe("SUCCEEDED");
  });

  it("the failure indication names ONLY the failed destination on partial failure", async () => {
    const first = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(ok, fail("mission down")),
    );
    const indication = submissionFailureIndication(first);
    expect(indication).not.toBeNull();
    expect(indication).toContain(EVENT_DESTINATION_LABELS.MISSION_SERVICE);
    expect(indication).not.toContain(EVENT_DESTINATION_LABELS.CLINICAL_ENGINE);
  });
});

describe("partial-failure retry — event data retained across retries (6.6)", () => {
  it("preserves the stamped event and provenance verbatim across multiple retries", async () => {
    const first = await submitCrewEvent(
      draft({ detail: { note: "IV access established" } }),
      CREW_ID,
      ports(ok, fail("mission down")),
    );
    const originalEvent = first.event;

    // Retry twice: still failing, then succeeding. The retained event data must
    // never be re-derived or lost.
    const second = await retryCrewEvent(first, ports(ok, fail("still down")));
    const third = await retryCrewEvent(second, ports(ok, ok));

    for (const record of [first, second, third]) {
      expect(record.event).toEqual(originalEvent);
      expect(record.recordingCrewId).toBe(CREW_ID);
      expect(record.event.metadata[PROVENANCE_KEYS.recordedByCrewId]).toBe(
        CREW_ID,
      );
      expect(record.event.metadata[PROVENANCE_KEYS.recordedAt]).toBe(
        OCCURRED_AT,
      );
      expect(record.event.metadata.note).toBe("IV access established");
    }
    expect(isFullySubmitted(third)).toBe(true);
  });
});

/**
 * Drive a submission through an arbitrary sequence of per-destination attempt
 * outcomes, always retrying via {@link retryCrewEvent}, and assert the core
 * invariants hold at every step. This is the load-bearing 6.6a property.
 */
describe("partial-failure retry — PROPERTY: never-resubmit-succeeded & retain (6.6a)", () => {
  // Each retry round is described by whether each destination's port succeeds.
  const outcomeArb = fc.record({
    CLINICAL_ENGINE: fc.boolean(),
    MISSION_SERVICE: fc.boolean(),
  });

  it("a succeeded destination is NEVER re-invoked, and only pending destinations are attempted", async () => {
    await fc.assert(
      fc.asyncProperty(
        // The initial attempt outcome + a sequence of retry-round outcomes.
        outcomeArb,
        fc.array(outcomeArb, { minLength: 0, maxLength: 6 }),
        async (initial, retries) => {
          const portFor =
            (succeed: boolean): EventDestinationPort =>
            () =>
              succeed ? Promise.resolve() : Promise.reject(new Error("x"));

          let submission: CrewEventSubmission = await submitCrewEvent(
            draft(),
            CREW_ID,
            ports(portFor(initial.CLINICAL_ENGINE), portFor(initial.MISSION_SERVICE)),
          );

          const originalEvent = submission.event;

          for (const round of retries) {
            const before: Record<EventDestination, DestinationStatus> = {
              CLINICAL_ENGINE: submission.destinations.CLINICAL_ENGINE.status,
              MISSION_SERVICE: submission.destinations.MISSION_SERVICE.status,
            };
            const expectedTargets = pendingDestinations(submission);

            const spies: Record<EventDestination, ReturnType<typeof vi.fn>> = {
              CLINICAL_ENGINE: vi.fn(portFor(round.CLINICAL_ENGINE)),
              MISSION_SERVICE: vi.fn(portFor(round.MISSION_SERVICE)),
            };

            submission = await retryCrewEvent(
              submission,
              ports(spies.CLINICAL_ENGINE, spies.MISSION_SERVICE),
            );

            for (const dest of EVENT_DESTINATIONS) {
              if (before[dest] === "SUCCEEDED") {
                // Invariant 1: never resubmit a succeeded destination...
                expect(spies[dest]).not.toHaveBeenCalled();
                // ...and its status stays SUCCEEDED.
                expect(submission.destinations[dest].status).toBe("SUCCEEDED");
              } else {
                // Invariant 2: only pending destinations are attempted.
                expect(expectedTargets).toContain(dest);
                expect(spies[dest]).toHaveBeenCalledTimes(1);
              }
            }

            // Invariant 3: the event data is retained verbatim across retries.
            expect(submission.event).toEqual(originalEvent);
          }

          // Invariant 4: status classification is internally consistent.
          const succeeded = EVENT_DESTINATIONS.filter(
            (d) => submission.destinations[d].status === "SUCCEEDED",
          );
          const failed = failedDestinations(submission);
          expect(isFullySubmitted(submission)).toBe(succeeded.length === 2);
          expect(partialFailure(submission)).toBe(
            succeeded.length === 1 && failed.length === 1,
          );
          expect(fullFailure(submission)).toBe(failed.length === 2);
          // Invariant 5: the indication is null iff fully submitted, else names
          // every currently-failed destination.
          const indication = submissionFailureIndication(submission);
          if (isFullySubmitted(submission)) {
            expect(indication).toBeNull();
          } else {
            expect(indication).not.toBeNull();
            for (const dest of failed) {
              expect(indication).toContain(EVENT_DESTINATION_LABELS[dest]);
            }
          }
        },
      ),
    );
  });

  it("once fully submitted, further retries are a no-op that invokes no port", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (extraRetries) => {
        let submission = await submitCrewEvent(draft(), CREW_ID, ports(ok, ok));
        expect(isFullySubmitted(submission)).toBe(true);

        for (let i = 0; i < extraRetries; i++) {
          const clinicalRetry = vi.fn(ok);
          const missionRetry = vi.fn(ok);
          const before = submission;
          submission = await retryCrewEvent(
            submission,
            ports(clinicalRetry, missionRetry),
          );
          expect(clinicalRetry).not.toHaveBeenCalled();
          expect(missionRetry).not.toHaveBeenCalled();
          expect(submission).toEqual(before);
        }
      }),
    );
  });
});
