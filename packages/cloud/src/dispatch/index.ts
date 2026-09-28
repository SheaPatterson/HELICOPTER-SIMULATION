/**
 * Mission dispatch state machine boundary (design Section 6.3).
 *
 * Re-exports the pure Stage 1 (Details) / Stage 2 (Crew) gating core and its
 * injectable lookup port, plus the in-memory reference lookup used for tests and
 * local wiring. Stage 3/4 validation (task 8.2) and authorization/audit (task
 * 8.3) extend this boundary without changing its shape.
 */

export {
  DISPATCH_STAGES,
  MAX_WEATHER_AGE_MS,
  MIN_CREW_MEMBERS,
  MAX_CREW_MEMBERS,
  MIN_GCS,
  MAX_GCS,
  MIN_ROUTE_WAYPOINTS,
  DEFAULT_CRUISE_SPEED_KTS,
  DEFAULT_FUEL_BURN_LBS_PER_HOUR,
  DEFAULT_USABLE_FUEL_LBS,
  DEFAULT_MAX_PAVE_COMPONENT_SCORE,
  stageIndex,
  validateDetails,
  validateCrew,
  toCrewRoster,
  validatePatientInfo,
  deriveDispatchBaselineGcs,
  toPatientInput,
  calculatePaveRisk,
  calculateFlightPlan,
  validateFlightPlan,
  checkStageAdvancePermitted,
  advanceDispatch,
  type DispatchStage,
  type DispatchLookupPort,
  type ConditionResolverPort,
  type DispatchErrorCode,
  type DispatchError,
  type AdvanceResult,
  type AdvanceSuccess,
  type DetailsInput,
  type CrewMemberInput,
  type CrewInput,
  type PatientInfoInput,
  type PaveScoreInput,
  type PavePolicy,
  type FlightPlanInput,
  type ReservePolicy,
  type DispatchStageInput,
  type DispatchMissionContext,
  type AdvanceDispatchDependencies,
} from "./state-machine.js";

export {
  InMemoryDispatchLookup,
  type InMemoryLookupConfig,
} from "./in-memory-lookup.js";

export { InMemoryConditionResolver } from "./in-memory-condition-resolver.js";

// Mission authorization / gating enforcement / audit events (design Section 6.3;
// requirements 3.6, 3.7, 3.9, 3.10). The authorization/audit layer that wraps
// the dispatch core: it authorizes only when all stages pass, issues the code,
// sets DISPATCHED, publishes to the EFB, and appends the mission events.
export {
  MISSION_EVENT_TYPES,
  advanceMissionStage,
  authorizeMission,
  isNonEmptyRationale,
  InMemoryMissionEventSink,
  InMemoryMissionPublisher,
  type MissionEventType,
  type MissionEvent,
  type MissionEventSinkPort,
  type MissionPublisherPort,
  type AuthorizationCodeIssuer,
  type TrainingOverride,
  type AuthorizationErrorCode,
  type AuthorizationError,
  type AuthorizationSuccess,
  type AuthorizationFailure,
  type AuthorizationResult,
  type MissionServiceDependencies,
  type MissionIdentity,
  type AuthorizationMissionData,
  type AuthorizeMissionDependencies,
} from "./mission-service.js";
