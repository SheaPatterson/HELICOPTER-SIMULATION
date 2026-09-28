/**
 * @virtualhems/contracts
 *
 * Shared, versioned contracts between the desktop bridge, cloud/API, and web
 * command terminal. This package is the single source of truth for the
 * normalized telemetry contract as well as the mission/dispatch, clinical, and
 * AAR structures (design Sections 4.1–4.6). The Rust bridge crate mirrors the
 * telemetry contract so adapters and ingestion share one definition.
 */

/**
 * Contract schema version. All versioned contracts in this package are governed
 * by this constant; producers stamp it onto emitted frames and consumers may
 * validate against it. Mirrored by `SCHEMA_VERSION` in the Rust bridge crate.
 */
export const SCHEMA_VERSION = "0.1.0" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

// Telemetry contract (design Sections 4.1, 4.3).
export {
  SIMULATOR_ENGINES,
  isSimulatorEngine,
  type SimulatorEngine,
  type Timestamp,
  type Uuid,
  type GeoPoint,
  type PositionVector,
  type FlightVector,
  type SystemsVector,
  type TelemetrySample,
  type TelemetryFrame,
} from "./telemetry.js";

// Mission and dispatch contracts (design Section 4.4).
export {
  MISSION_TYPES,
  MISSION_STATUSES,
  PATIENT_PRIORITIES,
  PAVE_DISPOSITIONS,
  type MissionType,
  type MissionStatus,
  type PatientPriority,
  type PaveDisposition,
  type WeatherSnapshot,
  type CrewRoster,
  type DispatchDetails,
  type PatientInput,
  type PAVERisk,
  type FlightPlan,
  type MissionDispatch,
} from "./mission.js";

// Clinical contracts (design Section 4.5).
export {
  MEDICAL_CONDITION_CATEGORIES,
  CLINICAL_EVENT_TYPES,
  CLINICAL_EVENT_SOURCES,
  type MedicalConditionCategory,
  type ClinicalEventType,
  type ClinicalEventSource,
  type MedicalCondition,
  type PatientState,
  type ClinicalEvent,
} from "./clinical.js";

// Infrastructure and AAR contracts (design Section 4.6).
export {
  HELIPAD_SURFACES,
  HELIPAD_PLACEMENTS,
  type HelipadSurface,
  type HelipadPlacement,
  type Helipad,
  type TacticalBriefing,
  type AARReport,
} from "./infrastructure.js";

// Shared degraded-state derivation and status model (design Section 6.7,
// Requirement 9). Pure, dependency-light derivation shared by web/EFB clients.
export {
  NOMINAL_MAX_AGE_SECONDS,
  STALE_MAX_AGE_SECONDS,
  DATA_AGE_REFRESH_INTERVAL_MS,
  LAST_KNOWN_AGE_THRESHOLD_SECONDS,
  GCS_MIN,
  GCS_MAX,
  GOLDEN_HOUR_REFRESH_INTERVAL_MS,
  SERVICE_STATES,
  VALUE_SOURCES,
  deriveUserVisibleStatus,
  areDataActionsDisabled,
  describeActionUnavailable,
  isAutomaticGoBlocked,
  buildStatusModel,
  formatDataAge,
  computeDataAgeSeconds,
  formatGoldenHour,
  clampGcsForDisplay,
  liveValue,
  lastKnownValue,
  unavailableValue,
  type ServiceState,
  type ConnectionHealth,
  type ServiceStatusInput,
  type ValueSource,
  type LastKnownValue,
  type WeatherGateInput,
  type StatusModel,
  type StatusModelInput,
} from "./status.js";

// Pure unit-conversion and normalization helpers (design Section 6.1).
export {
  metersToFeet,
  feetToMeters,
  metersToNauticalMiles,
  nauticalMilesToMeters,
  metersPerSecondToKnots,
  knotsToMetersPerSecond,
  metersPerSecondToFeetPerMinute,
  feetPerMinuteToMetersPerSecond,
  kilogramsToPounds,
  poundsToKilograms,
  radiansToDegrees,
  degreesToRadians,
  kelvinToCelsius,
  fahrenheitToCelsius,
  normalizeHeadingDeg,
  normalizeLongitudeDeg,
  clamp,
} from "./units.js";
