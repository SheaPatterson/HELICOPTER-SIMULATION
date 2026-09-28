"use client";

/**
 * `useCrewEventCapture` — the cockpit EFB crew-event capture hook (task 13.2;
 * Requirements 6.5, 6.6, 6.6a).
 *
 * This hook owns ONLY React state + async orchestration; ALL submission /
 * retry / provenance / partial-failure semantics live in the pure
 * `@/lib/efb` event-capture core. It:
 *  - submits a freshly recorded event to BOTH independent destinations via
 *    {@link submitCrewEvent} (6.5),
 *  - retains the last submission record so the entered data survives a failure
 *    and can be retried (6.6),
 *  - retries ONLY the failed destination via {@link retryCrewEvent}, never
 *    resubmitting the one that already succeeded (6.6a).
 *
 * The destination ports are injected so production wires the Clinical_Engine /
 * Mission_Service adapters and tests/local supply fakes; the hook never talks to
 * the network directly.
 */

import { useCallback, useState } from "react";
import type { Uuid } from "@virtualhems/contracts";
import {
  retryCrewEvent,
  submitCrewEvent,
  type CrewEventDraft,
  type CrewEventSubmission,
  type EventDestinationPorts,
} from "@/lib/efb";

export interface UseCrewEventCaptureOptions {
  /** The recording crew member's profile id (provenance, Requirement 6.5). */
  recordingCrewId: Uuid;
  /** Injected independent-destination ports (Clinical_Engine, Mission_Service). */
  ports: EventDestinationPorts;
}

export interface CrewEventCapture {
  /** The most recent submission record, or null before the first submit. */
  submission: CrewEventSubmission | null;
  /** True while a submit/retry is in flight. */
  submitting: boolean;
  /** Submit a freshly recorded event to both destinations (6.5). */
  submit: (draft: CrewEventDraft) => Promise<CrewEventSubmission>;
  /** Retry only the not-yet-succeeded destination(s) of the last submission (6.6a). */
  retry: () => Promise<CrewEventSubmission | null>;
  /** Clear the retained submission (after full success or dismissal). */
  reset: () => void;
}

/**
 * Manage crew-event submission + retry for the EFB (Requirements 6.5, 6.6,
 * 6.6a). Returns the retained submission record and the submit/retry actions.
 */
export function useCrewEventCapture(
  options: UseCrewEventCaptureOptions,
): CrewEventCapture {
  const { recordingCrewId, ports } = options;
  const [submission, setSubmission] = useState<CrewEventSubmission | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (draft: CrewEventDraft): Promise<CrewEventSubmission> => {
      setSubmitting(true);
      try {
        const result = await submitCrewEvent(draft, recordingCrewId, ports);
        setSubmission(result);
        return result;
      } finally {
        setSubmitting(false);
      }
    },
    [recordingCrewId, ports],
  );

  const retry = useCallback(async (): Promise<CrewEventSubmission | null> => {
    if (!submission) {
      return null;
    }
    setSubmitting(true);
    try {
      // retryCrewEvent retries ONLY not-yet-succeeded destinations (6.6a).
      const result = await retryCrewEvent(submission, ports);
      setSubmission(result);
      return result;
    } finally {
      setSubmitting(false);
    }
  }, [submission, ports]);

  const reset = useCallback(() => {
    setSubmission(null);
  }, []);

  return { submission, submitting, submit, retry, reset };
}
