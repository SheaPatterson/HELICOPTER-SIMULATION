"use client";

/**
 * Crew-event capture control for the cockpit EFB (task 13.2; Requirements 6.5,
 * 6.6, 6.6a).
 *
 * Presentational shell. The crew records a scene arrival / departure /
 * intervention / status event; this control submits it to BOTH independent
 * destinations, shows per-destination success / partial-failure / failure
 * indications NAMING the failed destination, and offers a retry that targets
 * ONLY the failed destination. All logic lives in {@link useCrewEventCapture}
 * and the pure `@/lib/efb` core — this component holds only the draft form state.
 */

import { useState, type ReactNode } from "react";
import type { Uuid } from "@virtualhems/contracts";
import {
  CREW_RECORDABLE_EVENT_TYPES,
  EVENT_DESTINATIONS,
  EVENT_DESTINATION_LABELS,
  submissionFailureIndication,
  type CrewEventDraft,
  type CrewRecordableEventType,
  type EventDestinationPorts,
  type EventDestination,
} from "@/lib/efb";
import { useCrewEventCapture } from "./use-crew-event-capture";

export interface CrewEventCaptureProps {
  missionId: Uuid;
  recordingCrewId: Uuid;
  ports: EventDestinationPorts;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

const EVENT_TYPE_LABELS: Record<CrewRecordableEventType, string> = {
  ARRIVED_SCENE: "Scene arrival",
  DEPARTED_SCENE: "Scene departure",
  INTERVENTION: "Intervention",
  TOUCHDOWN: "Status / touchdown",
};

export function CrewEventCapture({
  missionId,
  recordingCrewId,
  ports,
  now,
}: CrewEventCaptureProps): ReactNode {
  const clock = now ?? Date.now;
  const [eventType, setEventType] =
    useState<CrewRecordableEventType>("ARRIVED_SCENE");
  const [detail, setDetail] = useState("");

  const capture = useCrewEventCapture({ recordingCrewId, ports });
  const submission = capture.submission;

  const onRecord = (): void => {
    const draft: CrewEventDraft = {
      mission_id: missionId,
      event_type: eventType,
      occurred_at: new Date(clock()).toISOString(),
      ...(detail.trim().length > 0 ? { detail: { note: detail.trim() } } : {}),
    };
    void capture.submit(draft);
  };

  const failureIndication = submission
    ? submissionFailureIndication(submission)
    : null;

  return (
    <section aria-label="Record crew event">
      <h2>Record event</h2>

      <label>
        Event type
        <select
          aria-label="Event type"
          value={eventType}
          onChange={(e) =>
            setEventType(e.target.value as CrewRecordableEventType)
          }
        >
          {CREW_RECORDABLE_EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Detail (optional)
        <input
          aria-label="Event detail"
          type="text"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
      </label>

      <button
        type="button"
        onClick={onRecord}
        disabled={capture.submitting}
        aria-label="Submit event"
      >
        {capture.submitting ? "Submitting…" : "Record and submit"}
      </button>

      {submission ? (
        <div aria-label="Submission status">
          <ul aria-label="Destination status">
            {EVENT_DESTINATIONS.map((d) => (
              <DestinationRow
                key={d}
                destination={d}
                status={submission.destinations[d].status}
                error={submission.destinations[d].error}
              />
            ))}
          </ul>

          {/* Requirement 6.6/6.6a: failure indication naming the destination. */}
          {failureIndication ? (
            <p role="alert" aria-label="Submission failure indication">
              {failureIndication}
            </p>
          ) : (
            <p aria-label="Submission succeeded">
              Event submitted to both destinations.
            </p>
          )}

          {/* Requirement 6.6a: retry targets only the not-yet-succeeded destination. */}
          {failureIndication ? (
            <button
              type="button"
              onClick={() => void capture.retry()}
              disabled={capture.submitting}
              aria-label="Retry failed destination"
            >
              Retry failed destination
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DestinationRow({
  destination,
  status,
  error,
}: {
  destination: EventDestination;
  status: string;
  error?: string;
}): ReactNode {
  return (
    <li aria-label={EVENT_DESTINATION_LABELS[destination]} data-status={status}>
      <span>{EVENT_DESTINATION_LABELS[destination]}: </span>
      <span aria-label="destination status">{status}</span>
      {error ? <small aria-label="destination error"> ({error})</small> : null}
    </li>
  );
}
