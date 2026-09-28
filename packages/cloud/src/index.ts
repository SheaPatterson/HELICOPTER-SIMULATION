/**
 * @virtualhems/cloud
 *
 * Cloud/API boundary for Virtual HEMS. This package will host telemetry
 * ingestion, the realtime fanout, the mission/dispatch service, the clinical
 * Golden Hour engine, spatial facility recommendation, and the AAR engine.
 *
 * Task 1.1 establishes the package boundary and its dependency on the shared
 * contracts package only. Service implementations arrive in later tasks.
 */

import { SCHEMA_VERSION } from "@virtualhems/contracts";

/** The contract schema version this cloud boundary is built against. */
export const CLOUD_CONTRACT_SCHEMA_VERSION = SCHEMA_VERSION;

// Telemetry ingestion boundary (design Section 6.1; requirements 1.1, 1.2, 1.7, 2.7).
export {
  ingestTelemetry,
  DuplicateFrameError,
  InMemoryTelemetryRepository,
  type TelemetryIngestRequest,
  type AuthenticatedPilot,
  type PersistedTelemetryFrame,
  type TelemetryAck,
  type IngestResult,
  type IngestError,
  type IngestErrorCode,
  type TelemetryAuthenticator,
  type TelemetryRepository,
  type PersistTelemetryInput,
  type IngestDependencies,
} from "./telemetry/index.js";

// Realtime asset-state fanout boundary (design Section 3.4, Section 5.3
// authorization model; requirement 6.3).
export {
  OPERATIONAL_ROLES,
  isOperationalRole,
  RealtimeFanout,
  InMemoryRealtimeBroadcaster,
  regionAssetsChannel,
  missionChannel,
  channelsForAssetState,
  channelsForMissionUpdate,
  canSubscribe,
  deriveAssetStateUpdate,
  deriveMissionUpdate,
  toAcceptedFrameView,
  publishAcceptedFrame,
  type OperationalRole,
  type AssetStateUpdate,
  type MissionUpdate,
  type RealtimeUpdate,
  type AcceptedFrameView,
  type MissionUpdateInput,
  type RealtimeBroadcaster,
  type FanoutResult,
  type SubscriberContext,
  type PublishedMessage,
  type AcceptedFrameContext,
} from "./realtime/index.js";

// Mission dispatch state machine boundary (design Section 6.3; requirements 3.1,
// 3.2, 3.3, 3.3a, 3.8). Stage 1 Details + Stage 2 Crew gating and the
// stage-advance restriction. Stage 3/4 (task 8.2) and authorization/audit
// (task 8.3) extend this boundary.
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
  InMemoryDispatchLookup,
  InMemoryConditionResolver,
  MISSION_EVENT_TYPES,
  advanceMissionStage,
  authorizeMission,
  isNonEmptyRationale,
  InMemoryMissionEventSink,
  InMemoryMissionPublisher,
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
  type InMemoryLookupConfig,
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
} from "./dispatch/index.js";

// Clinical Golden Hour engine boundary (design Section 6.4; requirements 4.1,
// 4.2–4.9). Task 9.1 provides condition resolution/validation and Golden Hour
// timer initiation; task 9.2 adds the deterministic deterioration / GCS-clamp /
// monotonic-state update (update_patient_state, req 4.2–4.7).
export {
  GCS_MIN,
  GCS_MAX,
  validateCondition,
  resolveCondition,
  GOLDEN_HOUR_DURATION_SECONDS,
  SCENE_CALL_MISSION_TYPE,
  DISPATCH_EVENT_TYPE,
  deriveBaselineGcs,
  initiateGoldenHour,
  DEFAULT_SCENE_TARGET_SECONDS,
  MIN_SCENE_TARGET_SECONDS,
  MAX_SCENE_TARGET_SECONDS,
  SECONDS_PER_MINUTE,
  SCENE_START_EVENT_TYPE,
  SCENE_END_EVENT_TYPE,
  DEFAULT_GCS_POINTS_PER_DECAY_UNIT,
  DEFAULT_VITAL_EFFECT_AFTER_MINUTES,
  VITAL_EFFECT_FLAG,
  secondsBetween,
  resolvePolicy,
  calculateSceneSeconds,
  calculateDecayPenalty,
  deriveFlags,
  updatePatientState,
  type ConditionErrorCode,
  type ConditionError,
  type ConditionResolution,
  type UnresolvedCondition,
  type GoldenHourErrorCode,
  type GoldenHourError,
  type GoldenHourTimer,
  type GoldenHourInitiation,
  type GoldenHourResult,
  type GoldenHourDispatchInput,
  type ClinicalPolicy,
  type ResolvedClinicalPolicy,
  type DeteriorationErrorCode,
  type DeteriorationError,
  type DeteriorationPenalty,
  type DeteriorationResult,
  type UpdatePatientStateInput,
} from "./clinical/index.js";

// Spatial facility recommendation boundary (design Section 6.5; requirements
// 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8). Task 11.1 provides eligibility filtering,
// missing-input ineligibility with provenance, deterministic ordering, and the
// explicit no-match result; task 11.2 adds the complete recommended-facility
// provenance (req 5.2) and the Ironpine tactical-briefing boundary with a
// deterministic spatial-only fallback that marks the AI recommendation absent
// when Ironpine is unavailable (req 5.7) on top of this seam.
export {
  EARTH_RADIUS_NM,
  haversineDistanceNm,
  HELIPAD_STATUSES,
  ELIGIBILITY_CHECKS,
  RECOMMENDATION_OUTCOMES,
  InMemoryCandidateProvider,
  capabilityMatches,
  helipadIsOperational,
  routeIsPermissible,
  scoreFacility,
  orderEligible,
  recommendFacility,
  type FacilityCandidate,
  type HelipadStatus,
  type WeatherObservation,
  type RouteConstraints,
  type EligibilityCheck,
  type CheckResult,
  type FacilityProvenance,
  type RankedFacility,
  type RecommendationOutcome,
  type RecommendationResult,
  type PatientLocation,
  type CandidateProviderPort,
  type RecommendFacilityInput,
  type RecommendFacilityDependencies,
  recommendWithBriefing,
  UnavailableIronpineBriefing,
  ThrowingIronpineBriefing,
  InMemoryIronpineBriefing,
  type RecommendedFacilityProvenance,
  type RecommendedFacility,
  type IronpineBriefingContext,
  type IronpineBriefingPort,
  type IronpineBriefingOutcome,
  type BriefedRecommendationResult,
  type RecommendWithBriefingDependencies,
} from "./recommendation/index.js";

// Security boundary: credential validation/authorization, the simulation-only
// data policy, and platform-wide audit logging (design Section 5.3; task 16.1;
// requirements 8.1, 8.2, 8.9, 8.10, 8.11).
export {
  CREDENTIAL_VALIDATION_DEADLINE_MS,
  validateCredential,
  authorize,
  InMemoryCredentialVerifier,
  PII_IDENTIFIER_KINDS,
  SIMULATION_ONLY_POLICY,
  scanForIdentifiers,
  containsRealIdentifiers,
  rejectIfContainsRealIdentifiers,
  AUDITABLE_ACTIONS,
  AUDIT_APPEND_DEADLINE_MS,
  AuditAppendFailedError,
  withAudit,
  InMemoryAuditLogSink,
  FailingAuditLogSink,
  type CredentialDenialReason,
  type CredentialVerification,
  type CredentialVerifierPort,
  type AuthorizationGrant,
  type AuthorizationDenial,
  type AuthorizationDecision,
  type ValidateCredentialDependencies,
  type SeededCredential,
  type PiiIdentifierKind,
  type PiiMatch,
  type SimulationOnlyViolation,
  type SimulationOnlyAccepted,
  type SimulationOnlyResult,
  type AuditableAction,
  type AuditRecord,
  type AuditTarget,
  type AuditLogSinkPort,
  type AuditRecordInput,
  type WithAuditDependencies,
} from "./security/index.js";

// After-Action Review engine boundary (design Section 4.6 / Section 6.6;
// requirements 7.1, 7.2, 7.4, 7.4a, 7.6). Task 14.1 provides the pure metric
// derivation + the unconditional no-fabrication guarantee (metrics derived
// solely from recorded telemetry/events; a non-derivable metric is ABSENT with
// a specific coverage limitation, never a fabricated value) and the authorized
// manual-completion path. Task 14.2 adds compliance scoring against the
// effective Policy_Version's audit thresholds (recording the Policy_Version in
// the report), immutable write-once persistence, and the pilot-logbook update
// (mission hours + outcome) on top of these seams (req 7.3, 7.5).
export {
  EVIDENCE_SOURCES,
  AAR_METRICS,
  derived,
  unavailable,
  isDerived,
  LimitationLog,
  STANDARD_GRAVITY_FPS2,
  SECONDS_PER_MINUTE as AAR_SECONDS_PER_MINUTE,
  parseTimestampMs,
  orderFrames,
  calculateCoverage,
  calculateRouteEfficiency,
  maximumAbsolute,
  findTouchdown,
  identifyTouchdownGForce,
  calculateReserveMinutes,
  calculateSceneDuration,
  AAR_ERROR_CODES,
  generateAar,
  detectFabrication,
  InMemoryAarLoaders,
  type EvidenceSource,
  type AarMetric,
  type CoverageLimitation,
  type DerivedMetric,
  type CoverageEvidence,
  type TouchdownDetection,
  type AarMission,
  type ManualCompletionEvent,
  type AarLoaders,
  type AarClock,
  type GenerateAarDependencies,
  type AarErrorCode,
  type AarError,
  type DerivedMetrics,
  type AarReportDraft,
  type GenerateAarSuccess,
  type GenerateAarFailure,
  type GenerateAarResult,
  DEFAULT_AAR_THRESHOLDS,
  resolveAarPolicy,
  evaluateCompliance,
  calculateScore,
  deriveMissionHours,
  InMemoryAarReportStore,
  InMemoryPilotLogbook,
  FINALIZE_ERROR_CODES,
  finalizeAar,
  type ThresholdDirection,
  type AarPolicy,
  type ResolvedAarPolicy,
  type ComplianceStatus,
  type ComplianceFinding,
  type MissionHours,
  type MissionOutcome,
  type FinalizedAarReport,
  type StoredAarReport,
  type PersistResult,
  type AarReportStorePort,
  type LogbookEntry,
  type PilotLogbookPort,
  type FinalizeErrorCode,
  type FinalizeError,
  type FinalizeAarSuccess,
  type FinalizeAarResult,
  type FinalizeAarDependencies,
} from "./aar/index.js";

// Non-punitive safety reporting boundary — VIRS (design Section 5.1
// `virs_reports`, Section 5.3; task 18.1; requirements 11.1, 11.2, 11.3, 11.4).
// Task 18.1 provides field-specific validation that retains the entered
// narrative (req 11.2), the submission flow that persists a valid report with a
// confirmation over an injectable store (req 11.1) and preserves a >= 24h local
// draft with a not-saved status on a service failure (req 11.4), and the
// safety-reviewer-only narrative retrieval + public-safe projection that never
// includes the narrative (req 11.3). Task 18.2 adds the fuller test suite.
export {
  NARRATIVE_MIN_LENGTH,
  NARRATIVE_MAX_LENGTH,
  VIRS_PERSIST_DEADLINE_MS,
  DRAFT_MIN_RETENTION_MS,
  DEFAULT_ACCESS_CONTROL,
  SAFETY_REVIEWER_ROLE,
  VIRS_INCIDENT_CATEGORIES,
  validateVirsSubmission,
  submitVirsReport,
  buildLocalDraft,
  canRetrieveNarrative,
  retrieveVirsNarrative,
  toPublicProjection,
  InMemoryVirsStore,
  FailingVirsStore,
  InMemoryVirsDraftStore,
  type SafetyReviewerRole,
  type VirsIncidentCategory,
  type VirsFieldErrorField,
  type VirsValidationErrorCode,
  type VirsFieldError,
  type VirsSubmissionInput,
  type ValidVirsSubmission,
  type VirsValidationSuccess,
  type VirsValidationFailure,
  type VirsValidationResult,
  type PersistVirsInput,
  type PersistedVirsReport,
  type VirsStorePort,
  type VirsLocalDraft,
  type VirsDraftStorePort,
  type VirsSubmissionStatus,
  type VirsSubmissionConfirmation,
  type VirsSubmissionValidationError,
  type VirsSubmissionNotSaved,
  type VirsSubmissionResult,
  type SubmitVirsDependencies,
  type VirsViewerContext,
  type NarrativeAccessDenialReason,
  type NarrativeRetrievalGranted,
  type NarrativeRetrievalDenied,
  type NarrativeRetrievalResult,
  type VirsPublicProjection,
} from "./safety/index.js";

// Full mission-lifecycle wiring boundary (task 19.1; design Section 11.2 flow
// 9; requirements 1.1, 2.4, 3.7, 4.2, 6.1, 7.1). This is the INTEGRATION-WIRING
// that composes the telemetry-ingestion, realtime-fanout, four-stage-dispatch,
// clinical Golden Hour/deterioration, and AAR subsystems into a single
// deterministic end-to-end path: simulator fixture → ingestion → realtime
// map/EFB → dispatch → authorized EFB package → scene events → deterioration →
// touchdown → AAR → logbook/archive. It re-implements no subsystem; each stays
// behind its existing injectable port. The Rust bridge is CI-only, so the
// "simulator fixture → bridge → normalized telemetry" hop is modeled by
// SimulatorFixtureSource emitting the normalized telemetry contract.
export {
  runMissionLifecycle,
  SimulatorFixtureSource,
  type MissionLifecycleInput,
  type MissionLifecycleDependencies,
  type MissionLifecycleResult,
  type LifecycleMissionIdentity,
  type LifecycleDispatchInputs,
  type LifecycleClinicalContext,
  type TelemetryStageOutcome,
  type SimulatorFixtureConfig,
  type FixtureWaypoint,
  type FixtureFrame,
} from "./lifecycle/index.js";
