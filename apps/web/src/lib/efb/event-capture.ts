/**
 * Cockpit EFB crew-event capture and independent-destination submission
 * (design Section 3.4 operational sequence, Section 6.7 degraded-state table
 * "EFB event submission partial failure"; task 13.2; Requirements 6.5, 6.6,
 * 6.6a, 6.7).
 *
 * This module is the PURE, transport-free, framework-free core of EFB crew-event
 * submission. A crew member records a scene arrival / scene departure /
 * intervention / status event; the EFB must submit that event to TWO
 * INDEPENDENT destinations — the Clinical_Engine and the Mission_Service — with
 * provenance identifying the recording crew member and the event timestamp. The
 * two submissions succeed or fail independently; on a partial failure the EFB
 * retains the event, retries ONLY the failed destination, never resubmits the
 * one that already succeeded, and shows a partial-failure indication naming the
 * failed destination.
 *
 * The destinations are injected as ports so the core has no network/React/timer
 * dependency and the independent-destination / retry semantics are directly
 * unit-testable (task 13.3 is the dedicated fuller suite; this file carries the
 * logic under test).
 *
 * Requirement mapping:
 *  - 6.5: {@link stampCrewEvent} builds a {@link ClinicalEvent} whose provenance
 *         (recording crew member id + event timestamp) is carried in `metadata`
 *         and `occurred_at`; {@link submitCrewEvent} submits it to BOTH
 *         destinations.
 *  - 6.6: a failed submission retains the entered event data (it lives in the
 *         returned {@link CrewEventSubmission}) and is retryable via
 *         {@link retryCrewEvent}; the submission reports a failure indication.
 *  - 6.6a: the Clinical_Engine and Mission_Service are modelled as INDEPENDENT
 *         destinations with per-destination status. {@link retryCrewEvent}
 *         retries ONLY destinations that are not already `SUCCEEDED`, so a
 *         succeeded destination is never resubmitted; {@link failedDestinations}
 *         / {@link partialFailure} name the failed destination(s) for the UI.
 *  - 6.7 is served by the sibling `checklist-briefing.ts` module (interactive
 *         checklists + helipad navigation / LZ briefing content).
 */

import type {
  ClinicalEvent,
  ClinicalEventType,
  Timestamp,
  Uuid,
} from "@virtualhems/contracts";

/**
 * The crew-recordable event types in the EFB (Requirement 6.5): scene arrival,
 * scene departure, intervention, and status. "Status" maps onto the shared
 * {@link ClinicalEventType} `TOUCHDOWN` lifecycle marker; the four here are the
 * subset a crew member records by hand in the cockpit. Kept as a named constant
 * so the UI and the core agree on exactly which events are crew-recordable.
 */
export const CREW_RECORDABLE_EVENT_TYPES = [
  "ARRIVED_SCENE",
  "DEPARTED_SCENE",
  "INTERVENTION",
  "TOUCHDOWN",
] as const satisfies readonly ClinicalEventType[];
export type CrewRecordableEventType =
  (typeof CREW_RECORDABLE_EVENT_TYPES)[number];

/** True when `t` is one of the crew-recordable event types (Requirement 6.5). */
export function isCrewRecordableEventType(
  t: ClinicalEventType,
): t is CrewRecordableEventType {
  return (CREW_RECORDABLE_EVENT_TYPES as readonly ClinicalEventType[]).includes(
    t,
  );
}

/**
 * The two INDEPENDENT destinations a crew-recorded event is submitted to
 * (Requirement 6.6a). They are enumerated so per-destination status can be
 * tracked, iterated, and named in the partial-failure indication without magic
 * strings.
 */
export const EVENT_DESTINATIONS = [
  "CLINICAL_ENGINE",
  "MISSION_SERVICE",
] as const;
export type EventDestination = (typeof EVENT_DESTINATIONS)[number];

/** Human-readable label for a destination, used in the failure indication. */
export const EVENT_DESTINATION_LABELS: Record<EventDestination, string> = {
  CLINICAL_ENGINE: "Clinical Engine",
  MISSION_SERVICE: "Mission Service",
};

/**
 * What a crew member entered when recording an event, before provenance is
 * stamped (Requirement 6.5). The event timestamp and recording crew member are
 * added by {@link stampCrewEvent}; the caller supplies only the mission, the
 * kind of event, and any free-form detail metadata.
 */
export interface CrewEventDraft {
  mission_id: Uuid;
  event_type: CrewRecordableEventType;
  /**
   * The moment the event occurred / was recorded, as an ISO-8601 timestamp.
   * This is the event-timestamp provenance element (Requirement 6.5).
   */
  occurred_at: Timestamp;
  /**
   * Free-form detail the crew entered (e.g. intervention note). Merged into the
   * submitted event metadata; provenance keys are added, never overwritten.
   */
  detail?: Record<string, string>;
}

/**
 * Metadata provenance keys stamped onto every crew-recorded event
 * (Requirement 6.5). Centralised so producers (this module) and consumers
 * (Clinical_Engine / Mission_Service adapters, tests) agree on the key names.
 */
export const PROVENANCE_KEYS = {
  /** The recording crew member's profile id. */
  recordedByCrewId: "recorded_by_crew_id",
  /** Echo of the event timestamp (also carried in `occurred_at`). */
  recordedAt: "recorded_at",
} as const;

/**
 * Build the shared {@link ClinicalEvent} for a crew draft, stamping provenance
 * that identifies the recording crew member and the event timestamp
 * (Requirement 6.5).
 *
 * Pure: given the same draft and crew id it always yields the same event. The
 * `source` is `USER` (a crew member recorded it by hand). Caller-supplied
 * `detail` is merged first, then the provenance keys are written last so
 * provenance can never be clobbered by a colliding detail key.
 */
export function stampCrewEvent(
  draft: CrewEventDraft,
  recordingCrewId: Uuid,
): ClinicalEvent {
  return {
    mission_id: draft.mission_id,
    event_type: draft.event_type,
    occurred_at: draft.occurred_at,
    source: "USER",
    metadata: {
      ...(draft.detail ?? {}),
      [PROVENANCE_KEYS.recordedByCrewId]: recordingCrewId,
      [PROVENANCE_KEYS.recordedAt]: draft.occurred_at,
    },
  };
}

/**
 * An injectable submission port for a single destination (Requirement 6.6a).
 * The Clinical_Engine and Mission_Service adapters each implement this; tests
 * supply deterministic fakes. It resolves on success and REJECTS (throws) on
 * failure — the core turns a rejection into a `FAILED` per-destination status,
 * so a failing destination never taints the other.
 */
export type EventDestinationPort = (event: ClinicalEvent) => Promise<void>;

/** The set of ports, one per independent destination (Requirement 6.6a). */
export type EventDestinationPorts = Record<
  EventDestination,
  EventDestinationPort
>;

/** Per-destination submission status (Requirement 6.6/6.6a). */
export type DestinationStatus = "PENDING" | "SUCCEEDED" | "FAILED";

/** The outcome recorded for a single destination after an attempt. */
export interface DestinationResult {
  status: DestinationStatus;
  /** Non-sensitive failure message when `status` is `FAILED`, else undefined. */
  error?: string;
}

/**
 * The retained, retryable submission record for one crew-recorded event
 * (Requirements 6.6, 6.6a). It holds the stamped event (so the entered data is
 * RETAINED across retries — nothing is re-entered) and the per-destination
 * status map. This is the single value the UI renders and hands back to
 * {@link retryCrewEvent}; it is immutable — each attempt returns a NEW record.
 */
export interface CrewEventSubmission {
  /** The stamped event with provenance — retained verbatim across retries. */
  event: ClinicalEvent;
  /** The recording crew member id (provenance, also in `event.metadata`). */
  recordingCrewId: Uuid;
  /** Per-destination outcome; both destinations are always present. */
  destinations: Record<EventDestination, DestinationResult>;
}

/** The destinations still needing submission: not yet `SUCCEEDED`. */
export function pendingDestinations(
  submission: CrewEventSubmission,
): EventDestination[] {
  return EVENT_DESTINATIONS.filter(
    (d) => submission.destinations[d].status !== "SUCCEEDED",
  );
}

/** The destinations whose most recent attempt FAILED (for the UI indication). */
export function failedDestinations(
  submission: CrewEventSubmission,
): EventDestination[] {
  return EVENT_DESTINATIONS.filter(
    (d) => submission.destinations[d].status === "FAILED",
  );
}

/** True when EVERY destination has succeeded (nothing left to retry). */
export function isFullySubmitted(submission: CrewEventSubmission): boolean {
  return EVENT_DESTINATIONS.every(
    (d) => submission.destinations[d].status === "SUCCEEDED",
  );
}

/**
 * True when submission PARTIALLY failed: at least one destination succeeded AND
 * at least one failed (Requirement 6.6a). Drives the partial-failure indication
 * that names the failed destination.
 */
export function partialFailure(submission: CrewEventSubmission): boolean {
  const succeeded = EVENT_DESTINATIONS.filter(
    (d) => submission.destinations[d].status === "SUCCEEDED",
  );
  const failed = failedDestinations(submission);
  return succeeded.length > 0 && failed.length > 0;
}

/** True when EVERY destination failed (full failure — retry both, 6.6). */
export function fullFailure(submission: CrewEventSubmission): boolean {
  return EVENT_DESTINATIONS.every(
    (d) => submission.destinations[d].status === "FAILED",
  );
}

/**
 * A concise, human-readable indication of the submission outcome for the crew
 * (Requirements 6.6, 6.6a). Names the failed destination(s) on partial or full
 * failure. Returns `null` when fully submitted (nothing to indicate).
 */
export function submissionFailureIndication(
  submission: CrewEventSubmission,
): string | null {
  const failed = failedDestinations(submission);
  if (failed.length === 0) {
    return null;
  }
  const names = failed.map((d) => EVENT_DESTINATION_LABELS[d]).join(" and ");
  if (partialFailure(submission)) {
    return `Partial submission failure: ${names} did not accept the event. Retry only ${names}.`;
  }
  return `Submission failed: ${names} did not accept the event. Retry the submission.`;
}

/**
 * Attempt submission to the given destinations, INDEPENDENTLY (Requirement
 * 6.6a). Each port is invoked and its result recorded on its own; one
 * destination's rejection never affects the other's status. Destinations not in
 * `targets` keep their prior result untouched — this is how a succeeded
 * destination is preserved and never resubmitted.
 *
 * Internal helper shared by {@link submitCrewEvent} and {@link retryCrewEvent}.
 */
async function attempt(
  event: ClinicalEvent,
  recordingCrewId: Uuid,
  ports: EventDestinationPorts,
  prior: Record<EventDestination, DestinationResult>,
  targets: readonly EventDestination[],
): Promise<CrewEventSubmission> {
  // Fire the targeted destinations independently and settle each on its own.
  const attempts = targets.map(async (destination) => {
    try {
      await ports[destination](event);
      return [destination, { status: "SUCCEEDED" } as DestinationResult] as const;
    } catch (err) {
      return [
        destination,
        {
          status: "FAILED",
          error: errorMessage(err),
        } as DestinationResult,
      ] as const;
    }
  });

  const settled = await Promise.all(attempts);

  // Start from the prior results so untargeted (already-succeeded) destinations
  // are carried forward verbatim — never resubmitted, never downgraded.
  const destinations: Record<EventDestination, DestinationResult> = {
    CLINICAL_ENGINE: prior.CLINICAL_ENGINE,
    MISSION_SERVICE: prior.MISSION_SERVICE,
  };
  for (const [destination, result] of settled) {
    destinations[destination] = result;
  }

  return { event, recordingCrewId, destinations };
}

/**
 * Submit a freshly-recorded crew event to BOTH independent destinations
 * (Requirements 6.5, 6.6, 6.6a).
 *
 * Stamps provenance (recording crew member + event timestamp), then submits to
 * the Clinical_Engine and Mission_Service independently. The returned
 * {@link CrewEventSubmission} retains the stamped event and the per-destination
 * outcome; callers inspect {@link partialFailure} / {@link failedDestinations}
 * to render the indication and later pass the record to {@link retryCrewEvent}.
 *
 * Never throws for a destination failure: a rejected port becomes a `FAILED`
 * status on that destination only.
 */
export async function submitCrewEvent(
  draft: CrewEventDraft,
  recordingCrewId: Uuid,
  ports: EventDestinationPorts,
): Promise<CrewEventSubmission> {
  const event = stampCrewEvent(draft, recordingCrewId);
  const pristine: Record<EventDestination, DestinationResult> = {
    CLINICAL_ENGINE: { status: "PENDING" },
    MISSION_SERVICE: { status: "PENDING" },
  };
  return attempt(event, recordingCrewId, ports, pristine, EVENT_DESTINATIONS);
}

/**
 * Retry submission of a previously-attempted event to ONLY the destinations
 * that have not already succeeded (Requirements 6.6, 6.6a).
 *
 * The retained event data is reused verbatim (nothing is re-entered), so the
 * same provenance is preserved. Destinations already `SUCCEEDED` are NOT
 * resubmitted — their prior success is carried forward. A full failure retries
 * both; a partial failure retries only the failed one. Retrying a
 * fully-submitted record is a no-op that returns an equivalent record.
 */
export async function retryCrewEvent(
  submission: CrewEventSubmission,
  ports: EventDestinationPorts,
): Promise<CrewEventSubmission> {
  const targets = pendingDestinations(submission);
  if (targets.length === 0) {
    // Nothing to do — already fully submitted. Return the record unchanged.
    return submission;
  }
  return attempt(
    submission.event,
    submission.recordingCrewId,
    ports,
    submission.destinations,
    targets,
  );
}

/** Extract a non-sensitive message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === "string" && err.length > 0) {
    return err;
  }
  return "Submission was rejected by the destination.";
}
