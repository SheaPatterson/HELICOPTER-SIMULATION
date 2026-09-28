/**
 * Cockpit EFB pure core (task 13.1). Framework-free, transport-free modules the
 * React components under `app/dashboard/efb` render. Kept separate from the
 * components so the authorization/derivation/formatting logic is directly
 * unit-testable (task 13.3).
 */

export {
  CREW_SEATS,
  crewSeatFor,
  isAssignedCrew,
  resolveEfbMissionView,
  type CrewSeat,
  type EfbViewer,
  type AuthorizedMissionPackage,
  type AuthorizedEfbView,
  type UnauthorizedEfbView,
  type EfbMissionView,
} from "./mission-view";

export {
  LIVE_REFRESH_INTERVAL_MS,
  GOLDEN_HOUR_TICK_INTERVAL_MS,
  presentValue,
  resolveLiveState,
  type EfbLiveInput,
  type PresentedField,
  type EfbLiveStateView,
} from "./live-state";

export {
  InMemoryEfbRealtimeTransport,
  type EfbRealtimeMessage,
  type EfbRealtimeListener,
  type EfbTransportConnection,
  type EfbConnectionListener,
  type EfbRealtimeTransport,
} from "./realtime-transport";

export {
  CREW_RECORDABLE_EVENT_TYPES,
  EVENT_DESTINATIONS,
  EVENT_DESTINATION_LABELS,
  PROVENANCE_KEYS,
  isCrewRecordableEventType,
  stampCrewEvent,
  submitCrewEvent,
  retryCrewEvent,
  pendingDestinations,
  failedDestinations,
  isFullySubmitted,
  partialFailure,
  fullFailure,
  submissionFailureIndication,
  type CrewRecordableEventType,
  type EventDestination,
  type CrewEventDraft,
  type EventDestinationPort,
  type EventDestinationPorts,
  type DestinationStatus,
  type DestinationResult,
  type CrewEventSubmission,
} from "./event-capture";

export {
  defaultMissionChecklists,
  toggleChecklistItem,
  checklistProgress,
  resolveHelipadBriefing,
  type ChecklistItem,
  type Checklist,
  type ChecklistProgress,
  type HelipadBriefing,
} from "./checklist-briefing";
