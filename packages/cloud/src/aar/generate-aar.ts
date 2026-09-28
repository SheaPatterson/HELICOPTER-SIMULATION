/**
 * The `generate_aar` engine — metric derivation and the unconditional
 * no-fabrication guarantee (design Section 6.6; requirements 7.1, 7.2, 7.4,
 * 7.4a, 7.6).
 *
 * This is the pure, deterministic, testable core of the AAR_Engine (task 14.1).
 * It mirrors the design's `generate_aar` procedure but is scoped to metric
 * derivation and no-fabrication; compliance scoring, immutable persistence and
 * the pilot-logbook update (task 14.2), the auditability property test
 * (task 14.3), and the touchdown-to-report integration test (task 14.4) layer
 * onto the seams left here without reshaping the result.
 *
 * Evidence enters through injectable loaders ({@link AarLoaders}) — mission,
 * telemetry frames, and mission events — so the engine runs with no live DB and
 * derives every metric SOLELY from the provided evidence (req 7.2, 7.4a). A
 * metric that cannot be derived is represented ABSENT (a typed unavailable
 * {@link DerivedMetric}), never a fabricated number, and the specific coverage
 * limitation is recorded (req 7.4). The authorized manual-completion path marks
 * the telemetry-coverage limitation and still lets the report generate when no
 * telemetry touchdown was detected (req 7.6). A final assertion guarantees no
 * reported number was fabricated (req 7.4a).
 */

import type {
  AARReport,
  ClinicalEvent,
  FlightPlan,
  MissionStatus,
  TelemetryFrame,
  Timestamp,
  Uuid,
} from "@virtualhems/contracts";

import {
  LimitationLog,
  isDerived,
  type CoverageLimitation,
  type DerivedMetric,
} from "./coverage.js";
import {
  calculateCoverage,
  calculateReserveMinutes,
  calculateRouteEfficiency,
  calculateSceneDuration,
  findTouchdown,
  identifyTouchdownGForce,
  maximumAbsolute,
  orderFrames,
  type TouchdownDetection,
} from "./metrics.js";

// --- Loader ports (design 6.6 `load_*` seam) --------------------------------

/**
 * The completed mission context the AAR audits. Only the fields metric
 * derivation needs are modeled; scoring/policy (task 14.2) extend this.
 */
export interface AarMission {
  mission_id: Uuid;
  pilot_id: Uuid;
  status: MissionStatus;
  flight_plan?: Pick<
    FlightPlan,
    "direct_distance_nm" | "planned_distance_nm" | "reserve_at_destination_minutes"
  >;
  /**
   * The number of telemetry frames the session was expected to produce (from
   * the recorded sample rate × session duration), when the platform recorded
   * it. Absent forces the telemetry-coverage limitation (req 7.4).
   */
  expected_frame_count?: number;
}

/**
 * An authorized manual completion event (req 7.6). Present only when a touchdown
 * was NOT detected from telemetry and an authorized actor closed the mission; it
 * carries provenance and forces the telemetry-coverage limitation. It never
 * supplies a fabricated metric value.
 */
export interface ManualCompletionEvent {
  authorized_by: Uuid;
  occurred_at: Timestamp;
  reason: string;
}

/**
 * Injectable evidence loaders (design 6.6 `load_completed_mission`,
 * `load_telemetry`, `load_mission_events`). Synchronous so the derivation core
 * stays pure; an async DB adapter resolves the evidence first and hands it in.
 */
export interface AarLoaders {
  loadMission(missionId: Uuid): AarMission | undefined;
  loadTelemetry(missionId: Uuid): TelemetryFrame[];
  loadMissionEvents(missionId: Uuid): ClinicalEvent[];
  /** Returns the authorized manual completion event, if one closed the mission. */
  loadManualCompletion?(missionId: Uuid): ManualCompletionEvent | undefined;
}

/** A clock seam so `generated_at` is testable/deterministic (req 7.1). */
export interface AarClock {
  now(): Date;
}

/** Dependencies wired into the engine. */
export interface GenerateAarDependencies {
  loaders: AarLoaders;
  /** Defaults to the system clock when omitted. */
  clock?: AarClock;
}

// --- Error model ------------------------------------------------------------

export const AAR_ERROR_CODES = [
  "MISSION_NOT_FOUND",
  "MISSION_NOT_COMPLETED",
  "NO_TOUCHDOWN_WITHOUT_MANUAL_COMPLETION",
  "FABRICATION_DETECTED",
] as const;
export type AarErrorCode = (typeof AAR_ERROR_CODES)[number];

export interface AarError {
  code: AarErrorCode;
  message: string;
}

// --- Result model -----------------------------------------------------------

/**
 * The per-metric derivation view produced alongside the report. It exposes the
 * typed {@link DerivedMetric} for each metric so a caller can distinguish a
 * DERIVED value from an ABSENT one without inspecting the flattened numeric
 * report — the report itself only ever carries derived numbers (or the schema's
 * optional field for touchdown G-force).
 */
export interface DerivedMetrics {
  telemetry_coverage: DerivedMetric;
  route_efficiency_percent: DerivedMetric;
  max_pitch_deg: DerivedMetric;
  max_roll_deg: DerivedMetric;
  touchdown_g_force: DerivedMetric;
  reserve_fuel_minutes: DerivedMetric;
  scene_time_minutes: DerivedMetric;
}

export interface GenerateAarSuccess {
  ok: true;
  /**
   * The immutable-shaped report. Numeric fields carry ONLY derived values; a
   * metric that could not be derived is `null` (never a fabricated number), and
   * the matching limitation names the incomplete source. `touchdown_g_force`
   * stays the schema's optional field, absent when not derived.
   */
  report: AarReportDraft;
  /** The typed per-metric derivation (DERIVED vs UNAVAILABLE). */
  metrics: DerivedMetrics;
  /** The specific coverage limitations recorded (req 7.4). */
  limitations: CoverageLimitation[];
  /** How the touchdown was established, for provenance (req 7.6). */
  touchdown: TouchdownDetection;
}

export interface GenerateAarFailure {
  ok: false;
  error: AarError;
}

export type GenerateAarResult = GenerateAarSuccess | GenerateAarFailure;

/**
 * The report draft this task produces. It is the {@link AARReport} contract with
 * the derivable numeric metrics widened to `number | null` so an ABSENT metric
 * is represented honestly as `null` rather than a fabricated number (req 7.4a).
 * `clinical_outcome_summary`, `compliance_findings`, and `score` are filled by
 * task 14.2 (compliance scoring); this task leaves them at documented,
 * non-fabricated defaults and carries the derived metrics + limitations.
 */
export interface AarReportDraft
  extends Omit<
    AARReport,
    | "telemetry_coverage"
    | "route_efficiency_percent"
    | "max_pitch_deg"
    | "max_roll_deg"
    | "reserve_fuel_minutes"
    | "scene_time_minutes"
  > {
  telemetry_coverage: number | null;
  route_efficiency_percent: number | null;
  max_pitch_deg: number | null;
  max_roll_deg: number | null;
  reserve_fuel_minutes: number | null;
  scene_time_minutes: number | null;
  /** The recorded coverage limitations, carried on the report (req 7.4). */
  coverage_limitations: CoverageLimitation[];
}

const SYSTEM_CLOCK: AarClock = { now: () => new Date() };

/** Flatten a derived metric to the report's `number | null` field (no fabrication). */
function toReportValue(metric: DerivedMetric): number | null {
  return isDerived(metric) ? metric.value : null;
}

/**
 * Generate the after-action report for a completed mission (design Section 6.6).
 *
 * Loads the mission, telemetry, and events through the injected loaders, then
 * derives each reported metric SOLELY from that evidence (req 7.2). Any metric
 * that cannot be derived is left ABSENT (`null` / optional-absent) with a
 * specific coverage limitation recorded (req 7.4); no value is ever fabricated
 * (req 7.4a). When no telemetry touchdown is detected, the report generates only
 * if an authorized manual completion event is present, and that path marks the
 * telemetry-coverage limitation (req 7.6). A final guard asserts every reported
 * number was derived, returning a `FABRICATION_DETECTED` error rather than
 * emitting a fabricated value (req 7.4a).
 *
 * Timeliness (req 7.1): this core is synchronous and allocation-light so it
 * completes far within the 30-second budget; the touchdown-to-report timing is
 * covered by the integration test in task 14.4.
 */
export function generateAar(
  missionId: Uuid,
  deps: GenerateAarDependencies,
): GenerateAarResult {
  const clock = deps.clock ?? SYSTEM_CLOCK;

  const mission = deps.loaders.loadMission(missionId);
  if (mission === undefined) {
    return {
      ok: false,
      error: { code: "MISSION_NOT_FOUND", message: `mission ${missionId} not found` },
    };
  }
  if (mission.status !== "COMPLETED") {
    return {
      ok: false,
      error: {
        code: "MISSION_NOT_COMPLETED",
        message: `mission ${missionId} is ${mission.status}, not COMPLETED`,
      },
    };
  }

  const frames = orderFrames(deps.loaders.loadTelemetry(missionId));
  const events = deps.loaders.loadMissionEvents(missionId);
  const manualCompletion = deps.loaders.loadManualCompletion?.(missionId);

  const limitations = new LimitationLog();

  const touchdown = findTouchdown(frames, events);

  // Req 7.6: no telemetry touchdown detected — the report may generate ONLY via
  // an authorized manual completion event, which marks the telemetry-coverage
  // limitation. Without it there is no authorized basis to close the report.
  if (!touchdown.detected && manualCompletion === undefined) {
    return {
      ok: false,
      error: {
        code: "NO_TOUCHDOWN_WITHOUT_MANUAL_COMPLETION",
        message:
          "no touchdown detected from telemetry and no authorized manual completion event recorded",
      },
    };
  }

  const usedManualCompletion = !touchdown.detected && manualCompletion !== undefined;

  const telemetryCoverage = calculateCoverage(
    frames,
    {
      expectedFrameCount: mission.expected_frame_count,
      manualCompletion: usedManualCompletion,
    },
    limitations,
  );
  const routeEfficiency = calculateRouteEfficiency(mission.flight_plan, limitations);
  const maxPitch = maximumAbsolute(frames, "pitch_deg", limitations);
  const maxRoll = maximumAbsolute(frames, "roll_deg", limitations);
  const touchdownGForce = identifyTouchdownGForce(touchdown, limitations);
  const reserveMinutes = calculateReserveMinutes(mission.flight_plan, limitations);
  const sceneMinutes = calculateSceneDuration(events, limitations);

  const metrics: DerivedMetrics = {
    telemetry_coverage: telemetryCoverage,
    route_efficiency_percent: routeEfficiency,
    max_pitch_deg: maxPitch,
    max_roll_deg: maxRoll,
    touchdown_g_force: touchdownGForce,
    reserve_fuel_minutes: reserveMinutes,
    scene_time_minutes: sceneMinutes,
  };

  const generatedAt: Timestamp = clock.now().toISOString();

  const report: AarReportDraft = {
    mission_id: missionId,
    telemetry_coverage: toReportValue(telemetryCoverage),
    route_efficiency_percent: toReportValue(routeEfficiency),
    max_pitch_deg: toReportValue(maxPitch),
    max_roll_deg: toReportValue(maxRoll),
    // Optional in the schema: present only when derived, never fabricated.
    ...(isDerived(touchdownGForce)
      ? { touchdown_g_force: touchdownGForce.value }
      : {}),
    reserve_fuel_minutes: toReportValue(reserveMinutes),
    scene_time_minutes: toReportValue(sceneMinutes),
    // Filled by task 14.2 (compliance scoring); documented non-fabricated
    // placeholders here — not derived metrics, so they carry no fabricated number.
    clinical_outcome_summary: "",
    compliance_findings: [],
    score: 0,
    generated_at: generatedAt,
    coverage_limitations: limitations.all(),
  };

  // Req 7.4a: the unconditional no-fabrication guarantee. Every derivable metric
  // that carries a value must be a genuinely derived, finite number; anything
  // else means a value slipped in that was not derived from recorded evidence.
  const fabrication = detectFabrication(report, metrics);
  if (fabrication !== undefined) {
    return {
      ok: false,
      error: { code: "FABRICATION_DETECTED", message: fabrication },
    };
  }

  return { ok: true, report, metrics, limitations: limitations.all(), touchdown };
}

/**
 * Guard the no-fabrication invariant (req 7.4a): a report field is only allowed
 * to carry a number when the matching metric was DERIVED, and every present
 * number must be finite. Returns a message describing the first violation, or
 * `undefined` when the report is clean. Used both internally and by the
 * task-14.3 auditability property test.
 */
export function detectFabrication(
  report: AarReportDraft,
  metrics: DerivedMetrics,
): string | undefined {
  const checks: Array<{
    name: keyof DerivedMetrics;
    reported: number | null | undefined;
    metric: DerivedMetric;
  }> = [
    { name: "telemetry_coverage", reported: report.telemetry_coverage, metric: metrics.telemetry_coverage },
    {
      name: "route_efficiency_percent",
      reported: report.route_efficiency_percent,
      metric: metrics.route_efficiency_percent,
    },
    { name: "max_pitch_deg", reported: report.max_pitch_deg, metric: metrics.max_pitch_deg },
    { name: "max_roll_deg", reported: report.max_roll_deg, metric: metrics.max_roll_deg },
    {
      name: "touchdown_g_force",
      reported: report.touchdown_g_force,
      metric: metrics.touchdown_g_force,
    },
    {
      name: "reserve_fuel_minutes",
      reported: report.reserve_fuel_minutes,
      metric: metrics.reserve_fuel_minutes,
    },
    { name: "scene_time_minutes", reported: report.scene_time_minutes, metric: metrics.scene_time_minutes },
  ];

  for (const { name, reported, metric } of checks) {
    const hasNumber = typeof reported === "number";
    if (isDerived(metric)) {
      // A derived metric must appear as its exact, finite derived value.
      if (!hasNumber || !Number.isFinite(reported) || reported !== metric.value) {
        return `metric ${name} was derived (${metric.value}) but the report carries ${String(reported)}`;
      }
    } else {
      // An unavailable metric must NOT carry a number (no fabricated stand-in).
      if (hasNumber) {
        return `metric ${name} is unavailable but the report carries a fabricated value ${String(reported)}`;
      }
    }
  }

  return undefined;
}

// --- In-memory loaders (deterministic tests / no live DB) -------------------

/** Seed for {@link InMemoryAarLoaders}. */
export interface InMemoryAarSeed {
  mission: AarMission;
  telemetry?: readonly TelemetryFrame[];
  events?: readonly ClinicalEvent[];
  manualCompletion?: ManualCompletionEvent;
}

/**
 * In-memory {@link AarLoaders} for deterministic use and tests — the analogue of
 * the recommendation module's in-memory provider. It serves seeded evidence for
 * one mission and returns copies so callers cannot mutate the seed; the PostGIS/
 * Supabase-backed loaders (task 2.x / the DB layer) are the production seam.
 */
export class InMemoryAarLoaders implements AarLoaders {
  constructor(private readonly seed: InMemoryAarSeed) {}

  loadMission(missionId: Uuid): AarMission | undefined {
    return this.seed.mission.mission_id === missionId
      ? this.seed.mission
      : undefined;
  }

  loadTelemetry(missionId: Uuid): TelemetryFrame[] {
    if (this.seed.mission.mission_id !== missionId) return [];
    return [...(this.seed.telemetry ?? [])];
  }

  loadMissionEvents(missionId: Uuid): ClinicalEvent[] {
    if (this.seed.mission.mission_id !== missionId) return [];
    return [...(this.seed.events ?? [])];
  }

  loadManualCompletion(missionId: Uuid): ManualCompletionEvent | undefined {
    if (this.seed.mission.mission_id !== missionId) return undefined;
    return this.seed.manualCompletion;
  }
}
