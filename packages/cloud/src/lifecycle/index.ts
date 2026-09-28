/**
 * Full mission-lifecycle wiring boundary (task 19.1).
 *
 * Re-exports the composition module ({@link runMissionLifecycle}) and the
 * simulator-fixture telemetry source that stands in for the CI-only Rust bridge
 * output. This boundary owns NO subsystem logic — it only threads the existing
 * telemetry-ingestion, realtime-fanout, dispatch, clinical, and AAR ports into
 * a single deterministic end-to-end path.
 */

export {
  runMissionLifecycle,
  type MissionLifecycleInput,
  type MissionLifecycleDependencies,
  type MissionLifecycleResult,
  type LifecycleMissionIdentity,
  type LifecycleDispatchInputs,
  type LifecycleClinicalContext,
  type TelemetryStageOutcome,
} from "./mission-lifecycle.js";

export {
  SimulatorFixtureSource,
  type SimulatorFixtureConfig,
  type FixtureWaypoint,
  type FixtureFrame,
} from "./simulator-fixture.js";
