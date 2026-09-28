/**
 * After-Action Review (AAR) engine boundary — metric derivation and the
 * unconditional no-fabrication guarantee (design Section 4.6 / Section 6.6).
 *
 * Task 14.1 establishes the pure, deterministic derivation core: it derives
 * telemetry coverage, route efficiency, max |pitch|/|roll|, touchdown G-force,
 * destination reserve minutes, and scene minutes SOLELY from the recorded
 * telemetry and mission events supplied through injectable loaders (req 7.2),
 * represents any metric that cannot be derived as ABSENT rather than a
 * fabricated number and records the specific coverage limitation (req 7.4,
 * 7.4a), and honors the authorized manual-completion path when no telemetry
 * touchdown is detected (req 7.6). The synchronous, allocation-light core
 * comfortably fits the 30-second budget (req 7.1).
 *
 * Clean seams are left for the follow-on tasks without reshaping this result:
 * task 14.2 (compliance scoring, immutable persistence, pilot-logbook update),
 * task 14.3 (auditability property test — see {@link detectFabrication}), and
 * task 14.4 (touchdown-to-report integration test).
 */

export {
  EVIDENCE_SOURCES,
  AAR_METRICS,
  derived,
  unavailable,
  isDerived,
  LimitationLog,
  type EvidenceSource,
  type AarMetric,
  type CoverageLimitation,
  type DerivedMetric,
} from "./coverage.js";

export {
  STANDARD_GRAVITY_FPS2,
  SECONDS_PER_MINUTE,
  parseTimestampMs,
  orderFrames,
  calculateCoverage,
  calculateRouteEfficiency,
  maximumAbsolute,
  findTouchdown,
  identifyTouchdownGForce,
  calculateReserveMinutes,
  calculateSceneDuration,
  type CoverageEvidence,
  type TouchdownDetection,
} from "./metrics.js";

export {
  AAR_ERROR_CODES,
  generateAar,
  detectFabrication,
  InMemoryAarLoaders,
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
} from "./generate-aar.js";

export {
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
} from "./finalize-aar.js";
