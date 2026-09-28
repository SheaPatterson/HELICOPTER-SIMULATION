/**
 * Telemetry ingestion boundary (design Section 6.1).
 *
 * Re-exports the pure ingestion core and its injectable interfaces, plus the
 * in-memory reference repository used for tests and local wiring.
 */

export {
  ingestTelemetry,
  DuplicateFrameError,
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
} from "./ingestion.js";

export { InMemoryTelemetryRepository } from "./in-memory-repository.js";
