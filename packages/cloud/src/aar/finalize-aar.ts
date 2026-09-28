/**
 * AAR finalization — compliance scoring, Policy_Version recording, immutable
 * persistence, and the pilot-logbook update (design Section 6.6; requirements
 * 7.3, 7.5).
 *
 * Task 14.1 ({@link generateAar}) established the pure metric-derivation core
 * and the unconditional no-fabrication guarantee, leaving the
 * `clinical_outcome_summary`, `compliance_findings`, and `score` fields at
 * documented, non-fabricated placeholders. This module layers the remaining
 * `generate_aar` steps from the design's Section 6.6 procedure onto that seam
 * WITHOUT reshaping 14.1's result:
 *
 *   report.compliance_findings ← evaluate_thresholds(report, policy)   (req 7.3)
 *   report.score               ← calculate_score(report, policy)       (req 7.3)
 *   record the Policy_Version in the report                            (req 7.3)
 *   persist_immutable_report(report)                                   (req 7.5)
 *   update_pilot_logbook(pilot_id, mission, report)                    (req 7.5)
 *
 * Compliance is evaluated against the effective {@link AarPolicy} — a typed
 * object carrying the `policy_version` and the six audit thresholds documented
 * in design Section 6.6 as defaults. Scoring reuses the {@link DerivedMetric}
 * model from task 14.1 so an ABSENT metric is handled honestly: it is scored
 * neither pass nor fail but UNDETERMINED, and no value is fabricated to fill the
 * gap (req 7.4a is preserved). Mission hours for the logbook are derived from
 * recorded evidence (mission-event or telemetry timestamps); when they cannot
 * be derived they are recorded as absent rather than fabricated.
 */

import type { Timestamp, Uuid } from "@virtualhems/contracts";

import { isDerived, type DerivedMetric } from "./coverage.js";
import { parseTimestampMs, SECONDS_PER_MINUTE } from "./metrics.js";
import {
  detectFabrication,
  generateAar,
  type AarMission,
  type DerivedMetrics,
  type GenerateAarDependencies,
  type GenerateAarSuccess,
  type AarReportDraft,
} from "./generate-aar.js";

// --- Effective audit policy (req 7.3) ---------------------------------------

/**
 * The comparison an audit threshold applies to its metric.
 * - `AT_MOST`: the metric passes when `value <= threshold` (upper bound).
 * - `AT_LEAST`: the metric passes when `value >= threshold` (lower bound).
 */
export type ThresholdDirection = "AT_MOST" | "AT_LEAST";

/**
 * The effective AAR audit policy in force for a mission (req 7.3 Policy_Version).
 * It carries the identified `policy_version` plus the six audit thresholds the
 * design (Section 6.6) documents as defaults. A caller may supply only
 * `policy_version` and rely on {@link resolveAarPolicy} to fill the documented
 * defaults, or override individual thresholds for an airframe-specific policy.
 */
export interface AarPolicy {
  /** The Policy_Version recorded in the report (req 7.3). */
  policy_version: string;
  /** Scene time upper bound in minutes (default 15). */
  scene_time_max_minutes?: number;
  /**
   * Route deviation upper bound as a percentage OVER the direct distance
   * (default +10, i.e. route_efficiency_percent must be <= 110).
   */
  route_deviation_max_percent?: number;
  /** Absolute pitch upper bound in degrees (default 15). */
  max_pitch_max_deg?: number;
  /** Absolute roll upper bound in degrees (default 30). */
  max_roll_max_deg?: number;
  /** Destination reserve lower bound in minutes VFR (default 20). */
  reserve_min_minutes?: number;
  /** Touchdown G-force upper bound (default 1.5). */
  touchdown_g_force_max?: number;
}

/** The documented default audit thresholds (design Section 6.6). */
export const DEFAULT_AAR_THRESHOLDS = {
  scene_time_max_minutes: 15,
  route_deviation_max_percent: 10,
  max_pitch_max_deg: 15,
  max_roll_max_deg: 30,
  reserve_min_minutes: 20,
  touchdown_g_force_max: 1.5,
} as const;

/**
 * The effective, fully-resolved audit policy: the Policy_Version plus every
 * threshold materialized (documented default when the caller omitted it). Every
 * threshold is finite and positive.
 */
export interface ResolvedAarPolicy {
  policy_version: string;
  scene_time_max_minutes: number;
  route_efficiency_max_percent: number;
  max_pitch_max_deg: number;
  max_roll_max_deg: number;
  reserve_min_minutes: number;
  touchdown_g_force_max: number;
}

/** Pick a finite, positive override or fall back to the documented default. */
function resolveThreshold(override: number | undefined, fallback: number): number {
  return typeof override === "number" && Number.isFinite(override) && override > 0
    ? override
    : fallback;
}

/**
 * Resolve an {@link AarPolicy} to its effective thresholds (req 7.3). Omitted or
 * non-finite/non-positive thresholds fall back to the documented Section 6.6
 * defaults. Route deviation is expressed as an upper bound on
 * `route_efficiency_percent` (100% + the allowed deviation): a +10% deviation
 * means efficiency must not exceed 110%.
 */
export function resolveAarPolicy(policy: AarPolicy): ResolvedAarPolicy {
  const deviation = resolveThreshold(
    policy.route_deviation_max_percent,
    DEFAULT_AAR_THRESHOLDS.route_deviation_max_percent,
  );
  return {
    policy_version: policy.policy_version,
    scene_time_max_minutes: resolveThreshold(
      policy.scene_time_max_minutes,
      DEFAULT_AAR_THRESHOLDS.scene_time_max_minutes,
    ),
    route_efficiency_max_percent: 100 + deviation,
    max_pitch_max_deg: resolveThreshold(
      policy.max_pitch_max_deg,
      DEFAULT_AAR_THRESHOLDS.max_pitch_max_deg,
    ),
    max_roll_max_deg: resolveThreshold(
      policy.max_roll_max_deg,
      DEFAULT_AAR_THRESHOLDS.max_roll_max_deg,
    ),
    reserve_min_minutes: resolveThreshold(
      policy.reserve_min_minutes,
      DEFAULT_AAR_THRESHOLDS.reserve_min_minutes,
    ),
    touchdown_g_force_max: resolveThreshold(
      policy.touchdown_g_force_max,
      DEFAULT_AAR_THRESHOLDS.touchdown_g_force_max,
    ),
  };
}

// --- Compliance evaluation (req 7.3) ----------------------------------------

/** The outcome of evaluating one audit threshold against a metric. */
export type ComplianceStatus = "PASS" | "FAIL" | "UNDETERMINED";

/**
 * A single compliance finding: the audit signal evaluated, the threshold and
 * direction it applied, the derived value (or `null` when the metric was
 * ABSENT), and the pass/fail/undetermined outcome. An ABSENT metric is
 * UNDETERMINED — never scored as a pass and never fabricated (req 7.4a).
 */
export interface ComplianceFinding {
  signal: string;
  direction: ThresholdDirection;
  threshold: number;
  value: number | null;
  status: ComplianceStatus;
  detail: string;
}

interface SignalSpec {
  signal: string;
  metric: keyof DerivedMetrics;
  direction: ThresholdDirection;
  threshold: number;
  unit: string;
}

/** Build the six audit-signal specs from the effective policy. */
function signalSpecs(policy: ResolvedAarPolicy): SignalSpec[] {
  return [
    {
      signal: "SCENE_TIME",
      metric: "scene_time_minutes",
      direction: "AT_MOST",
      threshold: policy.scene_time_max_minutes,
      unit: "min",
    },
    {
      signal: "ROUTE_DEVIATION",
      metric: "route_efficiency_percent",
      direction: "AT_MOST",
      threshold: policy.route_efficiency_max_percent,
      unit: "%",
    },
    {
      signal: "MAX_PITCH",
      metric: "max_pitch_deg",
      direction: "AT_MOST",
      threshold: policy.max_pitch_max_deg,
      unit: "deg",
    },
    {
      signal: "MAX_ROLL",
      metric: "max_roll_deg",
      direction: "AT_MOST",
      threshold: policy.max_roll_max_deg,
      unit: "deg",
    },
    {
      signal: "DESTINATION_RESERVE",
      metric: "reserve_fuel_minutes",
      direction: "AT_LEAST",
      threshold: policy.reserve_min_minutes,
      unit: "min",
    },
    {
      signal: "TOUCHDOWN_G_FORCE",
      metric: "touchdown_g_force",
      direction: "AT_MOST",
      threshold: policy.touchdown_g_force_max,
      unit: "G",
    },
  ];
}

/** Compare a derived value against a threshold in the given direction. */
function withinThreshold(
  value: number,
  direction: ThresholdDirection,
  threshold: number,
): boolean {
  // Req 7.3: a metric mathematically equal to the threshold sits exactly on the
  // compliant boundary and must PASS. Derived metrics can accumulate IEEE-754
  // float noise (e.g. 22/20*100 -> 110.00000000000001 for a mission at the
  // +10% route-deviation limit), so treat near-equal values as on-boundary for
  // both directions before applying the strict comparison.
  const epsilon = 1e-9 * Math.max(1, Math.abs(threshold));
  if (Math.abs(value - threshold) <= epsilon) {
    return true;
  }
  return direction === "AT_MOST" ? value <= threshold : value >= threshold;
}

/**
 * Evaluate the derived metrics against the effective policy's audit thresholds
 * (req 7.3). Produces one {@link ComplianceFinding} per threshold: PASS/FAIL
 * when the metric was DERIVED, and UNDETERMINED when the metric is ABSENT — an
 * absent metric is never scored as a pass and no value is fabricated to fill it
 * (req 7.4a). The result also carries the effective `policy_version`.
 */
export function evaluateCompliance(
  metrics: DerivedMetrics,
  policy: ResolvedAarPolicy,
): { policy_version: string; findings: ComplianceFinding[] } {
  const findings = signalSpecs(policy).map((spec): ComplianceFinding => {
    const metric: DerivedMetric = metrics[spec.metric];
    const arrow = spec.direction === "AT_MOST" ? "<=" : ">=";

    if (!isDerived(metric)) {
      return {
        signal: spec.signal,
        direction: spec.direction,
        threshold: spec.threshold,
        value: null,
        status: "UNDETERMINED",
        detail: `${spec.signal}: metric unavailable (limited coverage); not scored against ${arrow} ${spec.threshold} ${spec.unit}`,
      };
    }

    const pass = withinThreshold(metric.value, spec.direction, spec.threshold);
    return {
      signal: spec.signal,
      direction: spec.direction,
      threshold: spec.threshold,
      value: metric.value,
      status: pass ? "PASS" : "FAIL",
      detail: `${spec.signal}: ${metric.value} ${spec.unit} ${arrow} ${spec.threshold} ${spec.unit} — ${pass ? "PASS" : "FAIL"}`,
    };
  });

  return { policy_version: policy.policy_version, findings };
}

/**
 * Calculate the overall compliance score as the percentage of DETERMINED
 * signals that passed (req 7.3). UNDETERMINED signals (ABSENT metrics) are
 * excluded from the denominator rather than counted as passes or failures, so
 * limited coverage never inflates or deflates the score with a fabricated
 * judgement. When no signal could be determined, the score is 0 and every
 * signal is limited.
 */
export function calculateScore(findings: readonly ComplianceFinding[]): number {
  const determined = findings.filter((f) => f.status !== "UNDETERMINED");
  if (determined.length === 0) return 0;
  const passed = determined.filter((f) => f.status === "PASS").length;
  return (passed / determined.length) * 100;
}

// --- Mission hours (req 7.5) ------------------------------------------------

/**
 * Mission hours derived for the logbook (req 7.5). `hours` is the elapsed flight
 * time in hours when it could be derived from recorded evidence, or `null` when
 * it could not (never fabricated). `derived_from` names the evidence used.
 */
export interface MissionHours {
  hours: number | null;
  derived_from: "MISSION_EVENTS" | "TELEMETRY" | "NONE";
  detail: string;
}

/**
 * Derive mission hours from recorded evidence (req 7.5). Prefers the recorded
 * mission-event span (first DISPATCHED/first event → TOUCHDOWN/last event); if
 * events cannot bound it, falls back to the telemetry timestamp span. When
 * neither yields a usable, ordered span, hours are ABSENT (`null`) — recorded
 * honestly rather than fabricated.
 */
export function deriveMissionHours(
  success: Pick<GenerateAarSuccess, "report">,
  evidence: { firstEventMs?: number; lastEventMs?: number; firstFrameMs?: number; lastFrameMs?: number },
): MissionHours {
  const spanHours = (fromMs: number, toMs: number): number =>
    (toMs - fromMs) / 1000 / SECONDS_PER_MINUTE / 60;

  const { firstEventMs, lastEventMs, firstFrameMs, lastFrameMs } = evidence;

  if (
    firstEventMs !== undefined &&
    lastEventMs !== undefined &&
    lastEventMs >= firstEventMs
  ) {
    return {
      hours: spanHours(firstEventMs, lastEventMs),
      derived_from: "MISSION_EVENTS",
      detail: "elapsed flight time derived from recorded mission-event span",
    };
  }

  if (
    firstFrameMs !== undefined &&
    lastFrameMs !== undefined &&
    lastFrameMs >= firstFrameMs
  ) {
    return {
      hours: spanHours(firstFrameMs, lastFrameMs),
      derived_from: "TELEMETRY",
      detail: "elapsed flight time derived from recorded telemetry timestamp span",
    };
  }

  // Reference the report so the signature ties hours to a generated report even
  // when no span is derivable; nothing is fabricated.
  void success.report;
  return {
    hours: null,
    derived_from: "NONE",
    detail: "no ordered mission-event or telemetry timestamp span; mission hours cannot be derived",
  };
}

// --- Finalized report (req 7.3, 7.5) ----------------------------------------

/**
 * The mission outcome recorded in the logbook (req 7.5). Derived from the
 * mission status, not fabricated.
 */
export type MissionOutcome = "COMPLETED" | "ABORTED" | "OTHER";

/**
 * The finalized AAR report: task 14.1's {@link AarReportDraft} with the
 * compliance fields filled and the effective Policy_Version recorded (req 7.3).
 * `compliance_findings` is the {@link AARReport} contract's `string[]` (the
 * human-readable finding details); `compliance_evaluation` carries the
 * structured findings alongside for downstream use without reshaping the
 * contract. `policy_version` records the Policy_Version in the report (req 7.3).
 */
export interface FinalizedAarReport extends AarReportDraft {
  policy_version: string;
  compliance_evaluation: ComplianceFinding[];
}

// --- Immutable persistence port (req 7.5) -----------------------------------

/**
 * An immutably-persisted report record (req 7.5). Carries the finalized report
 * plus the immutable version assigned at persist time.
 */
export interface StoredAarReport {
  mission_id: Uuid;
  version: number;
  report: FinalizedAarReport;
  persisted_at: Timestamp;
}

/** The outcome of an immutable persist attempt. */
export type PersistResult =
  | { ok: true; stored: StoredAarReport; alreadyExisted: false }
  | { ok: false; existing: StoredAarReport; alreadyExisted: true };

/**
 * Injectable append-only store for completed AAR reports (req 7.5). Persistence
 * is write-once per mission: an attempt to persist a report for a mission that
 * already has one MUST NOT overwrite the existing record — it either rejects the
 * attempt (returning the existing record) or versions the new report
 * immutably, per the implementation. The production seam is the `aar_reports`
 * table (design Section 8), which enforces immutability at the database layer.
 */
export interface AarReportStorePort {
  /** Persist a finalized report immutably. Never overwrites an existing record. */
  persist(report: FinalizedAarReport, at: Timestamp): PersistResult;
  /** The immutably-stored record for a mission, if one exists. */
  get(missionId: Uuid): StoredAarReport | undefined;
}

/**
 * In-memory, write-once {@link AarReportStorePort} for deterministic tests. A
 * mission's first report is stored as version 1; any later persist for the same
 * mission is REJECTED (the stored record is returned unchanged, never
 * overwritten), modeling the immutability the `aar_reports` table enforces in
 * production. Stored records are deep-frozen and returned as copies so a caller
 * cannot mutate the persisted report after the fact.
 */
export class InMemoryAarReportStore implements AarReportStorePort {
  private readonly byMission = new Map<Uuid, StoredAarReport>();

  persist(report: FinalizedAarReport, at: Timestamp): PersistResult {
    const existing = this.byMission.get(report.mission_id);
    if (existing !== undefined) {
      // Write-once: reject the overwrite, return the existing immutable record.
      return { ok: false, existing: this.copy(existing), alreadyExisted: true };
    }
    const stored: StoredAarReport = deepFreeze({
      mission_id: report.mission_id,
      version: 1,
      report: structuredClone(report),
      persisted_at: at,
    });
    this.byMission.set(report.mission_id, stored);
    return { ok: true, stored: this.copy(stored), alreadyExisted: false };
  }

  get(missionId: Uuid): StoredAarReport | undefined {
    const stored = this.byMission.get(missionId);
    return stored === undefined ? undefined : this.copy(stored);
  }

  private copy(stored: StoredAarReport): StoredAarReport {
    return structuredClone(stored);
  }
}

/** Recursively freeze an object so a stored record cannot be mutated in place. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// --- Pilot logbook port (req 7.5) -------------------------------------------

/**
 * A single appended pilot-logbook entry (req 7.5): the mission it records, the
 * derived mission hours (or `null` when not derivable — never fabricated), the
 * mission outcome, the Policy_Version the report was scored under, and the
 * compliance score.
 */
export interface LogbookEntry {
  pilot_id: Uuid;
  mission_id: Uuid;
  mission_hours: number | null;
  outcome: MissionOutcome;
  policy_version: string;
  score: number;
  recorded_at: Timestamp;
}

/**
 * Injectable append-only pilot logbook (req 7.5). `append` adds one entry; the
 * logbook is never rewritten. The production seam is the pilot logbook table
 * surfaced at `/dashboard/logbook` (design Section 5.2).
 */
export interface PilotLogbookPort {
  append(entry: LogbookEntry): void;
  entriesFor(pilotId: Uuid): LogbookEntry[];
}

/**
 * In-memory append-only {@link PilotLogbookPort} for deterministic tests.
 * Entries are appended in call order and returned as copies; existing entries
 * are never mutated or removed.
 */
export class InMemoryPilotLogbook implements PilotLogbookPort {
  private readonly entries: LogbookEntry[] = [];

  append(entry: LogbookEntry): void {
    this.entries.push({ ...entry });
  }

  entriesFor(pilotId: Uuid): LogbookEntry[] {
    return this.entries.filter((e) => e.pilot_id === pilotId).map((e) => ({ ...e }));
  }

  get size(): number {
    return this.entries.length;
  }
}

// --- Finalize composition (req 7.3, 7.5) ------------------------------------

/** Map a mission status to the logbook outcome (req 7.5), never fabricated. */
function outcomeFor(mission: Pick<AarMission, "status">): MissionOutcome {
  if (mission.status === "COMPLETED") return "COMPLETED";
  if (mission.status === "ABORTED") return "OTHER";
  return "OTHER";
}

export const FINALIZE_ERROR_CODES = [
  "REPORT_ALREADY_EXISTS",
  "FABRICATION_DETECTED",
] as const;
export type FinalizeErrorCode = (typeof FINALIZE_ERROR_CODES)[number];

export interface FinalizeError {
  code: FinalizeErrorCode;
  message: string;
}

export interface FinalizeAarSuccess {
  ok: true;
  /** The finalized report with compliance findings, score, and Policy_Version. */
  report: FinalizedAarReport;
  /** The structured compliance findings (req 7.3). */
  findings: ComplianceFinding[];
  /** The immutably-persisted record (req 7.5). */
  stored: StoredAarReport;
  /** The appended pilot-logbook entry (req 7.5). */
  logbookEntry: LogbookEntry;
  /** The derived mission hours (req 7.5). */
  missionHours: MissionHours;
  /** The effective, fully-resolved audit policy (req 7.3). */
  policy: ResolvedAarPolicy;
}

export type FinalizeAarResult =
  | FinalizeAarSuccess
  | { ok: false; error: FinalizeError }
  | Extract<ReturnType<typeof generateAar>, { ok: false }>;

/** Dependencies wired into {@link finalizeAar}: 14.1 deps + policy + ports. */
export interface FinalizeAarDependencies extends GenerateAarDependencies {
  /** The effective audit policy (req 7.3). */
  policy: AarPolicy;
  /** The immutable report store (req 7.5). */
  store: AarReportStorePort;
  /** The pilot logbook (req 7.5). */
  logbook: PilotLogbookPort;
}

/**
 * Finalize a mission's after-action report (design Section 6.6; req 7.3, 7.5).
 *
 * Runs task 14.1's {@link generateAar} to derive the metrics, then completes the
 * design's `generate_aar` procedure:
 *   1. evaluate the derived metrics against the effective Policy_Version's audit
 *      thresholds → `compliance_findings` and `score`, honestly marking an
 *      ABSENT metric UNDETERMINED rather than passing or fabricating it (req 7.3);
 *   2. record the Policy_Version in the report (req 7.3);
 *   3. persist the finalized report IMMUTABLY — an existing report for the
 *      mission is never overwritten (req 7.5);
 *   4. append a pilot-logbook entry with the derived mission hours and the
 *      mission outcome (req 7.5).
 *
 * 14.1's derivation and no-fabrication guarantee are preserved unchanged: on any
 * `generateAar` failure this returns that failure verbatim, and the finalized
 * report is re-checked by {@link detectFabrication} before persistence.
 */
export function finalizeAar(
  missionId: Uuid,
  deps: FinalizeAarDependencies,
): FinalizeAarResult {
  const generated = generateAar(missionId, {
    loaders: deps.loaders,
    ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
  });
  if (!generated.ok) {
    return generated;
  }

  const mission = deps.loaders.loadMission(missionId);
  const events = deps.loaders.loadMissionEvents(missionId);
  const frames = deps.loaders.loadTelemetry(missionId);

  const resolvedPolicy = resolveAarPolicy(deps.policy);
  const { findings } = evaluateCompliance(generated.metrics, resolvedPolicy);
  const score = calculateScore(findings);

  // Record the Policy_Version and the compliance results in the report (req 7.3).
  const finalized: FinalizedAarReport = {
    ...generated.report,
    compliance_findings: findings.map((f) => f.detail),
    score,
    policy_version: resolvedPolicy.policy_version,
    compliance_evaluation: findings,
  };

  // Preserve 14.1's no-fabrication guarantee across finalization: scoring must
  // not have introduced a fabricated metric value (req 7.4a).
  const fabrication = detectFabrication(finalized, generated.metrics);
  if (fabrication !== undefined) {
    return {
      ok: false,
      error: { code: "FABRICATION_DETECTED", message: fabrication },
    };
  }

  // Persist immutably (req 7.5). Write-once: never overwrite an existing report.
  const persist = deps.store.persist(finalized, finalized.generated_at);
  if (!persist.ok) {
    return {
      ok: false,
      error: {
        code: "REPORT_ALREADY_EXISTS",
        message: `an immutable AAR report already exists for mission ${missionId}; refusing to overwrite`,
      },
    };
  }

  // Derive mission hours from recorded evidence (req 7.5).
  const eventMs = events
    .map((e) => parseTimestampMs(e.occurred_at))
    .filter((ms): ms is number => ms !== undefined)
    .sort((a, b) => a - b);
  const frameMs = frames
    .map((f) => parseTimestampMs(f.observed_at))
    .filter((ms): ms is number => ms !== undefined)
    .sort((a, b) => a - b);

  const missionHours = deriveMissionHours(generated, {
    firstEventMs: eventMs[0],
    lastEventMs: eventMs[eventMs.length - 1],
    firstFrameMs: frameMs[0],
    lastFrameMs: frameMs[frameMs.length - 1],
  });

  // Append the pilot-logbook entry with mission hours + outcome (req 7.5).
  const pilotId = mission?.pilot_id ?? generated.report.mission_id;
  const logbookEntry: LogbookEntry = {
    pilot_id: pilotId,
    mission_id: missionId,
    mission_hours: missionHours.hours,
    outcome: mission !== undefined ? outcomeFor(mission) : "OTHER",
    policy_version: resolvedPolicy.policy_version,
    score,
    recorded_at: finalized.generated_at,
  };
  deps.logbook.append(logbookEntry);

  return {
    ok: true,
    report: finalized,
    findings,
    stored: persist.stored,
    logbookEntry,
    missionHours,
    policy: resolvedPolicy,
  };
}
