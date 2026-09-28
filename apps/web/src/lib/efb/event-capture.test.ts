import { describe, expect, it, vi } from "vitest";
import type { ClinicalEvent } from "@virtualhems/contracts";
import {
  EVENT_DESTINATION_LABELS,
  PROVENANCE_KEYS,
  failedDestinations,
  fullFailure,
  isCrewRecordableEventType,
  isFullySubmitted,
  partialFailure,
  pendingDestinations,
  retryCrewEvent,
  stampCrewEvent,
  submissionFailureIndication,
  submitCrewEvent,
  type CrewEventDraft,
  type EventDestination,
  type EventDestinationPorts,
} from "./event-capture";

/**
 * Unit tests for the pure EFB crew-event capture / independent-destination
 * submission core (task 13.2; Requirements 6.5, 6.6, 6.6a). Task 13.3 is the
 * dedicated fuller suite; these cover the load-bearing semantics: provenance
 * stamping, independent destinations, partial-failure retry-only-failed, and
 * never-resubmit-a-succeeded-destination.
 */

const CREW_ID = "crew-000-0000-0000-000000000007";
const MISSION_ID = "mission-0000-0000-0000-000000000001";
const OCCURRED_AT = "2024-01-01T00:15:00.000Z";

function draft(overrides: Partial<CrewEventDraft> = {}): CrewEventDraft {
  return {
    mission_id: MISSION_ID,
    event_type: "ARRIVED_SCENE",
    occurred_at: OCCURRED_AT,
    ...overrides,
  };
}

/** A port that always succeeds. */
const ok = (): Promise<void> => Promise.resolve();
/** A port that always fails with a named message. */
const fail =
  (message: string) =>
  (): Promise<void> =>
    Promise.reject(new Error(message));

function ports(
  clinical: EventDestinationPorts["CLINICAL_ENGINE"],
  mission: EventDestinationPorts["MISSION_SERVICE"],
): EventDestinationPorts {
  return { CLINICAL_ENGINE: clinical, MISSION_SERVICE: mission };
}

describe("isCrewRecordableEventType (6.5)", () => {
  it("accepts the four crew-recordable events and rejects lifecycle-only ones", () => {
    expect(isCrewRecordableEventType("ARRIVED_SCENE")).toBe(true);
    expect(isCrewRecordableEventType("DEPARTED_SCENE")).toBe(true);
    expect(isCrewRecordableEventType("INTERVENTION")).toBe(true);
    expect(isCrewRecordableEventType("TOUCHDOWN")).toBe(true);
    expect(isCrewRecordableEventType("DISPATCHED")).toBe(false);
    expect(isCrewRecordableEventType("ABORTED")).toBe(false);
  });
});

describe("stampCrewEvent — provenance (6.5)", () => {
  it("stamps the recording crew member id and the event timestamp", () => {
    const event = stampCrewEvent(draft(), CREW_ID);
    expect(event.mission_id).toBe(MISSION_ID);
    expect(event.event_type).toBe("ARRIVED_SCENE");
    expect(event.occurred_at).toBe(OCCURRED_AT);
    expect(event.source).toBe("USER");
    expect(event.metadata[PROVENANCE_KEYS.recordedByCrewId]).toBe(CREW_ID);
    expect(event.metadata[PROVENANCE_KEYS.recordedAt]).toBe(OCCURRED_AT);
  });

  it("merges caller detail but never lets it clobber provenance keys", () => {
    const event = stampCrewEvent(
      draft({
        detail: {
          note: "RSI performed",
          // Attempt to overwrite provenance — must not win.
          [PROVENANCE_KEYS.recordedByCrewId]: "spoofed",
        },
      }),
      CREW_ID,
    );
    expect(event.metadata.note).toBe("RSI performed");
    expect(event.metadata[PROVENANCE_KEYS.recordedByCrewId]).toBe(CREW_ID);
  });
});

describe("submitCrewEvent — both destinations succeed (6.5)", () => {
  it("submits the SAME stamped event to both independent destinations", async () => {
    const seen: Record<string, ClinicalEvent> = {};
    const clinical = vi.fn(async (e: ClinicalEvent) => {
      seen.clinical = e;
    });
    const mission = vi.fn(async (e: ClinicalEvent) => {
      seen.mission = e;
    });
    const result = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(clinical, mission),
    );

    expect(isFullySubmitted(result)).toBe(true);
    expect(partialFailure(result)).toBe(false);
    expect(submissionFailureIndication(result)).toBeNull();

    // Same provenance-stamped event delivered to each destination.
    expect(seen.clinical).toEqual(seen.mission);
    expect(seen.clinical!.metadata[PROVENANCE_KEYS.recordedByCrewId]).toBe(
      CREW_ID,
    );
  });
});

describe("submitCrewEvent — independent destinations / partial failure (6.6a)", () => {
  it("records one FAILED and one SUCCEEDED when only Mission_Service fails", async () => {
    const clinical = vi.fn(ok);
    const mission = vi.fn(fail("mission down"));
    const result = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(clinical, mission),
    );

    expect(result.destinations.CLINICAL_ENGINE.status).toBe("SUCCEEDED");
    expect(result.destinations.MISSION_SERVICE.status).toBe("FAILED");
    expect(result.destinations.MISSION_SERVICE.error).toBe("mission down");

    expect(partialFailure(result)).toBe(true);
    expect(fullFailure(result)).toBe(false);
    expect(failedDestinations(result)).toEqual(["MISSION_SERVICE"]);

    // The indication NAMES the failed destination (6.6a).
    const indication = submissionFailureIndication(result);
    expect(indication).toContain(
      EVENT_DESTINATION_LABELS.MISSION_SERVICE,
    );
    expect(indication).not.toContain(
      EVENT_DESTINATION_LABELS.CLINICAL_ENGINE,
    );
  });

  it("records both FAILED on a full failure (6.6)", async () => {
    const result = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(fail("clinical down"), fail("mission down")),
    );
    expect(fullFailure(result)).toBe(true);
    expect(partialFailure(result)).toBe(false);
    expect(failedDestinations(result).sort()).toEqual(
      (["CLINICAL_ENGINE", "MISSION_SERVICE"] as EventDestination[]).sort(),
    );
  });
});

describe("retryCrewEvent — retry only the failed destination (6.6a)", () => {
  it("retries ONLY the failed destination and NEVER resubmits the succeeded one", async () => {
    const clinical = vi.fn(ok);
    const missionFirst = vi.fn(fail("mission down"));

    // First attempt: clinical succeeds, mission fails.
    const first = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(clinical, missionFirst),
    );
    expect(partialFailure(first)).toBe(true);
    expect(clinical).toHaveBeenCalledTimes(1);
    expect(missionFirst).toHaveBeenCalledTimes(1);

    // Retry with a now-healthy mission port and a spy on clinical.
    const clinicalRetry = vi.fn(ok);
    const missionRetry = vi.fn(ok);
    const retried = await retryCrewEvent(
      first,
      ports(clinicalRetry, missionRetry),
    );

    // Only the failed destination (mission) was retried; clinical NOT resubmitted.
    expect(clinicalRetry).not.toHaveBeenCalled();
    expect(missionRetry).toHaveBeenCalledTimes(1);

    expect(isFullySubmitted(retried)).toBe(true);
    expect(submissionFailureIndication(retried)).toBeNull();
    // The event data was retained across the retry (same stamped event).
    expect(retried.event).toEqual(first.event);
  });

  it("leaves the destination failed (still retryable) when the retry also fails", async () => {
    const first = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(ok, fail("mission down")),
    );
    const retried = await retryCrewEvent(
      first,
      ports(ok, fail("still down")),
    );
    expect(retried.destinations.CLINICAL_ENGINE.status).toBe("SUCCEEDED");
    expect(retried.destinations.MISSION_SERVICE.status).toBe("FAILED");
    expect(retried.destinations.MISSION_SERVICE.error).toBe("still down");
    expect(pendingDestinations(retried)).toEqual(["MISSION_SERVICE"]);
  });

  it("retries BOTH destinations after a full failure (6.6)", async () => {
    const first = await submitCrewEvent(
      draft(),
      CREW_ID,
      ports(fail("clinical down"), fail("mission down")),
    );
    expect(pendingDestinations(first).sort()).toEqual(
      (["CLINICAL_ENGINE", "MISSION_SERVICE"] as EventDestination[]).sort(),
    );

    const clinicalRetry = vi.fn(ok);
    const missionRetry = vi.fn(ok);
    const retried = await retryCrewEvent(
      first,
      ports(clinicalRetry, missionRetry),
    );
    expect(clinicalRetry).toHaveBeenCalledTimes(1);
    expect(missionRetry).toHaveBeenCalledTimes(1);
    expect(isFullySubmitted(retried)).toBe(true);
  });

  it("is a no-op that preserves the record when already fully submitted", async () => {
    const first = await submitCrewEvent(draft(), CREW_ID, ports(ok, ok));
    const clinicalRetry = vi.fn(ok);
    const missionRetry = vi.fn(ok);
    const retried = await retryCrewEvent(
      first,
      ports(clinicalRetry, missionRetry),
    );
    expect(clinicalRetry).not.toHaveBeenCalled();
    expect(missionRetry).not.toHaveBeenCalled();
    expect(retried).toEqual(first);
  });
});
