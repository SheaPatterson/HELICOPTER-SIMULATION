/**
 * AAR coverage model and the no-fabrication primitives (design Section 6.6,
 * requirements 7.2, 7.4, 7.4a, 7.6).
 *
 * The AAR engine derives every reported metric SOLELY from recorded telemetry
 * and mission events and NEVER substitutes a fabricated value for any metric,
 * regardless of whether a coverage limitation exists (req 7.4a, unconditional).
 * To make that guarantee representable in the type system, a metric that cannot
 * be derived from the available evidence is modeled as ABSENT — a typed
 * {@link DerivedMetric} whose `status` is `UNAVAILABLE` and whose `value` is
 * `undefined` — rather than a placeholder number. Every `UNAVAILABLE` metric is
 * accompanied by a {@link CoverageLimitation} naming the specific incomplete
 * evidence source (req 7.4), so a reader can always tell why a value is missing.
 */

/** The evidence sources an AAR metric can be derived from (req 7.4). */
export const EVIDENCE_SOURCES = [
  "TELEMETRY",
  "MISSION_EVENTS",
  "FLIGHT_PLAN",
  "TOUCHDOWN_DETECTION",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * The specific metric an AAR value belongs to. Used to tie a
 * {@link CoverageLimitation} to the metric it constrains.
 */
export const AAR_METRICS = [
  "TELEMETRY_COVERAGE",
  "ROUTE_EFFICIENCY_PERCENT",
  "MAX_PITCH_DEG",
  "MAX_ROLL_DEG",
  "TOUCHDOWN_G_FORCE",
  "RESERVE_FUEL_MINUTES",
  "SCENE_TIME_MINUTES",
] as const;
export type AarMetric = (typeof AAR_METRICS)[number];

/**
 * A single recorded coverage limitation (req 7.4): the specific evidence source
 * that was incomplete/absent and the metric(s) it constrained. A limitation is
 * NEVER a substituted value — it is the honest record that a value could not be
 * derived, or was derived from partial evidence.
 */
export interface CoverageLimitation {
  /** The metric the limitation constrains. */
  metric: AarMetric;
  /** The specific evidence source that was incomplete or absent (req 7.4). */
  source: EvidenceSource;
  /** Human-readable detail naming what was incomplete. */
  detail: string;
}

/**
 * A metric value derived strictly from recorded evidence. `DERIVED` carries a
 * finite numeric `value`; `UNAVAILABLE` carries no value at all (`value` is
 * `undefined`) because the evidence to derive it was incomplete/absent — never
 * a fabricated stand-in (req 7.4a). Keeping this a discriminated union makes it
 * impossible to read a fabricated number off an unavailable metric.
 */
export type DerivedMetric =
  | { status: "DERIVED"; value: number }
  | { status: "UNAVAILABLE"; value: undefined };

/** Construct a derived metric, guarding against non-finite (fabricated) input. */
export function derived(value: number): DerivedMetric {
  if (!Number.isFinite(value)) {
    // A non-finite result is not a legitimately derived value; surface it as
    // unavailable rather than emitting NaN/Infinity as if it were real.
    return unavailable();
  }
  return { status: "DERIVED", value };
}

/** Construct an explicitly unavailable metric (no fabricated stand-in). */
export function unavailable(): DerivedMetric {
  return { status: "UNAVAILABLE", value: undefined };
}

/** Narrowing helper: was this metric successfully derived from evidence? */
export function isDerived(
  metric: DerivedMetric,
): metric is { status: "DERIVED"; value: number } {
  return metric.status === "DERIVED";
}

/**
 * Accumulates the coverage limitations recorded while deriving a report
 * (req 7.4). Deduplicates identical (metric, source) entries so repeated gaps in
 * one source do not spam the report.
 */
export class LimitationLog {
  private readonly entries: CoverageLimitation[] = [];

  record(limitation: CoverageLimitation): void {
    const duplicate = this.entries.some(
      (e) => e.metric === limitation.metric && e.source === limitation.source,
    );
    if (!duplicate) {
      this.entries.push(limitation);
    }
  }

  /** All recorded limitations, in the order first recorded. */
  all(): CoverageLimitation[] {
    return [...this.entries];
  }

  has(metric: AarMetric): boolean {
    return this.entries.some((e) => e.metric === metric);
  }

  get size(): number {
    return this.entries.length;
  }
}
