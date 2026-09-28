/**
 * AAR metric derivation (design Section 6.6, requirement 7.2).
 *
 * Each function here derives ONE reported metric SOLELY from the recorded
 * telemetry frames and/or mission events it is handed (req 7.2). None of them
 * read a clock or a live database, and none of them fabricate a value: when the
 * evidence needed for a metric is incomplete or absent, the function returns an
 * {@link unavailable} {@link DerivedMetric} and records the specific
 * {@link CoverageLimitation} through the supplied {@link LimitationLog}
 * (req 7.4, 7.4a). The touchdown-detection functions additionally honor the
 * authorized manual-completion path (req 7.6) via {@link findTouchdown}.
 */

import type {
  ClinicalEvent,
  FlightPlan,
  TelemetryFrame,
} from "@virtualhems/contracts";

import {
  derived,
  unavailable,
  type DerivedMetric,
  type LimitationLog,
} from "./coverage.js";

/** Standard gravitational acceleration in feet per second squared (g in fps^2). */
export const STANDARD_GRAVITY_FPS2 = 32.174;

/** Seconds in a minute (scene-time / reserve conversions, req 7.2). */
export const SECONDS_PER_MINUTE = 60;

// --- Ordering + parsing helpers ---------------------------------------------

/** Parse an ISO timestamp to epoch milliseconds; `undefined` if unparseable. */
export function parseTimestampMs(iso: string): number | undefined {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Return telemetry frames ordered by (sequence_number asc, observed_at asc) so
 * derivation is deterministic regardless of the order frames were loaded in.
 * Frames are not mutated; a sorted copy is returned.
 */
export function orderFrames(frames: readonly TelemetryFrame[]): TelemetryFrame[] {
  return [...frames].sort((a, b) => {
    if (a.sequence_number !== b.sequence_number) {
      return a.sequence_number - b.sequence_number;
    }
    const at = parseTimestampMs(a.observed_at) ?? 0;
    const bt = parseTimestampMs(b.observed_at) ?? 0;
    return at - bt;
  });
}

// --- Telemetry coverage (req 7.2, 7.4) --------------------------------------

/**
 * How many frames the session was expected to produce. When the bridge/session
 * records the expected frame count (from the sample rate × session duration) it
 * is authoritative; otherwise the highest received sequence number bounds the
 * expectation. Coverage is `received / expected`.
 */
export interface CoverageEvidence {
  /**
   * The number of frames the session was expected to have produced, if known
   * from recorded session metadata. Absent when the platform did not record it.
   */
  expectedFrameCount?: number;
  /**
   * When true, a manual completion event marked the telemetry-coverage
   * limitation because no telemetry touchdown was detected (req 7.6). This does
   * NOT fabricate a coverage number; it forces the limitation to be recorded.
   */
  manualCompletion?: boolean;
}

/**
 * Derive telemetry coverage as a percentage of expected-vs-received frames
 * (req 7.2). Coverage is only DERIVED when an expected frame count is available
 * to compare against; without it, coverage is UNAVAILABLE and a limitation is
 * recorded (req 7.4) rather than assuming 100%. When fewer frames arrived than
 * expected, coverage is below 100% and a limitation is recorded (req 7.4). A
 * manual-completion marker always records the telemetry-coverage limitation
 * (req 7.6).
 */
export function calculateCoverage(
  frames: readonly TelemetryFrame[],
  evidence: CoverageEvidence,
  limitations: LimitationLog,
): DerivedMetric {
  if (evidence.manualCompletion === true) {
    // Req 7.6: an authorized manual completion event marks the telemetry
    // coverage limitation. The report still generates.
    limitations.record({
      metric: "TELEMETRY_COVERAGE",
      source: "TOUCHDOWN_DETECTION",
      detail:
        "telemetry touchdown not detected; mission closed by authorized manual completion event",
    });
  }

  const expected = evidence.expectedFrameCount;
  if (expected === undefined || !Number.isFinite(expected) || expected <= 0) {
    limitations.record({
      metric: "TELEMETRY_COVERAGE",
      source: "TELEMETRY",
      detail:
        "expected telemetry frame count is unavailable; coverage cannot be derived from recorded evidence",
    });
    return unavailable();
  }

  const received = frames.length;
  const percent = Math.min(100, (received / expected) * 100);

  if (received < expected) {
    limitations.record({
      metric: "TELEMETRY_COVERAGE",
      source: "TELEMETRY",
      detail: `received ${received} of ${expected} expected telemetry frames`,
    });
  }

  return derived(percent);
}

// --- Route efficiency (req 7.2) ---------------------------------------------

/**
 * Derive route efficiency as the planned-versus-direct distance percentage
 * (req 7.2): `planned_distance_nm / direct_distance_nm * 100`. A value of 100
 * means the planned route equals the direct great-circle distance; higher means
 * a longer (less efficient) planned route. Requires a flight plan carrying both
 * finite, positive distances; otherwise the metric is UNAVAILABLE and a
 * FLIGHT_PLAN limitation is recorded (req 7.4, 7.4a).
 */
export function calculateRouteEfficiency(
  flightPlan: Pick<FlightPlan, "direct_distance_nm" | "planned_distance_nm"> | undefined,
  limitations: LimitationLog,
): DerivedMetric {
  if (flightPlan === undefined) {
    limitations.record({
      metric: "ROUTE_EFFICIENCY_PERCENT",
      source: "FLIGHT_PLAN",
      detail: "flight plan is unavailable; route efficiency cannot be derived",
    });
    return unavailable();
  }

  const { direct_distance_nm: direct, planned_distance_nm: planned } = flightPlan;

  if (
    !Number.isFinite(direct) ||
    !Number.isFinite(planned) ||
    direct <= 0 ||
    planned < 0
  ) {
    limitations.record({
      metric: "ROUTE_EFFICIENCY_PERCENT",
      source: "FLIGHT_PLAN",
      detail:
        "flight plan direct/planned distance is missing or non-positive; route efficiency cannot be derived",
    });
    return unavailable();
  }

  return derived((planned / direct) * 100);
}

// --- Max absolute pitch / roll (req 7.2) ------------------------------------

/**
 * Derive the maximum absolute pitch (or roll) in degrees over the recorded
 * frames (req 7.2). With no frames there is nothing to derive, so the metric is
 * UNAVAILABLE and a TELEMETRY limitation is recorded (req 7.4). Frames whose
 * value is non-finite are skipped (they are not evidence); if that leaves no
 * usable value the metric is UNAVAILABLE.
 */
export function maximumAbsolute(
  frames: readonly TelemetryFrame[],
  axis: "pitch_deg" | "roll_deg",
  limitations: LimitationLog,
): DerivedMetric {
  const metric = axis === "pitch_deg" ? "MAX_PITCH_DEG" : "MAX_ROLL_DEG";

  if (frames.length === 0) {
    limitations.record({
      metric,
      source: "TELEMETRY",
      detail: `no telemetry frames recorded; ${axis} cannot be derived`,
    });
    return unavailable();
  }

  let max: number | undefined;
  for (const frame of frames) {
    const raw = frame.flight[axis];
    if (!Number.isFinite(raw)) continue;
    const abs = Math.abs(raw);
    if (max === undefined || abs > max) max = abs;
  }

  if (max === undefined) {
    limitations.record({
      metric,
      source: "TELEMETRY",
      detail: `no finite ${axis} values in recorded telemetry`,
    });
    return unavailable();
  }

  return derived(max);
}

// --- Touchdown detection + G-force (req 7.2, 7.6) ---------------------------

/** The result of locating the touchdown moment across telemetry + events. */
export interface TouchdownDetection {
  /** True when a touchdown was detected from telemetry or a touchdown event. */
  detected: boolean;
  /** The telemetry frame at/for touchdown, when identifiable. */
  frame?: TelemetryFrame;
  /** The recorded TOUCHDOWN mission event, when present. */
  event?: ClinicalEvent;
  /** How the touchdown was established (for provenance / limitations). */
  via: "TELEMETRY_EVENT" | "TELEMETRY_FRAME" | "NONE";
}

/**
 * Locate the touchdown moment from recorded evidence (req 7.2, 7.6). A recorded
 * TOUCHDOWN mission event is authoritative; its `occurred_at` is matched to the
 * nearest telemetry frame to source the G-force. Absent a touchdown event, a
 * touchdown is inferred from telemetry only when a frame shows the aircraft at
 * the surface (near-zero AGL). When neither exists, detection is `NONE` — the
 * caller records the limitation and (for a manual completion) still generates
 * the report (req 7.6). No touchdown is ever fabricated.
 */
export function findTouchdown(
  frames: readonly TelemetryFrame[],
  events: readonly ClinicalEvent[],
): TouchdownDetection {
  const ordered = orderFrames(frames);
  const touchdownEvent = events.find((e) => e.event_type === "TOUCHDOWN");

  if (touchdownEvent !== undefined) {
    const eventMs = parseTimestampMs(touchdownEvent.occurred_at);
    let nearest: TelemetryFrame | undefined;
    if (eventMs !== undefined) {
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const frame of ordered) {
        const frameMs = parseTimestampMs(frame.observed_at);
        if (frameMs === undefined) continue;
        const delta = Math.abs(frameMs - eventMs);
        if (delta < bestDelta) {
          bestDelta = delta;
          nearest = frame;
        }
      }
    }
    return {
      detected: true,
      frame: nearest,
      event: touchdownEvent,
      via: "TELEMETRY_EVENT",
    };
  }

  // Infer from telemetry: last frame at/near the surface with ~zero vertical
  // speed. This is a conservative, evidence-based inference — not fabrication.
  const groundedFrame = [...ordered]
    .reverse()
    .find(
      (f) =>
        Number.isFinite(f.position.altitude_agl_ft) &&
        f.position.altitude_agl_ft <= 3 &&
        Number.isFinite(f.flight.vertical_speed_fpm) &&
        Math.abs(f.flight.vertical_speed_fpm) <= 100,
    );

  if (groundedFrame !== undefined) {
    return { detected: true, frame: groundedFrame, via: "TELEMETRY_FRAME" };
  }

  return { detected: false, via: "NONE" };
}

/**
 * Derive the touchdown G-force from the touchdown frame/event (req 7.2). The
 * G-force is computed from the recorded descent rate at touchdown: a hard
 * landing (higher downward vertical speed) yields a higher G. When no touchdown
 * was detected, or the touchdown frame carries no usable vertical speed, the
 * metric is UNAVAILABLE and a limitation is recorded (req 7.4, 7.4a, 7.6) — the
 * G-force is never fabricated.
 */
export function identifyTouchdownGForce(
  detection: TouchdownDetection,
  limitations: LimitationLog,
): DerivedMetric {
  if (!detection.detected) {
    limitations.record({
      metric: "TOUCHDOWN_G_FORCE",
      source: "TOUCHDOWN_DETECTION",
      detail: "no touchdown detected; touchdown G-force cannot be derived",
    });
    return unavailable();
  }

  const frame = detection.frame;
  if (frame === undefined || !Number.isFinite(frame.flight.vertical_speed_fpm)) {
    limitations.record({
      metric: "TOUCHDOWN_G_FORCE",
      source: "TELEMETRY",
      detail:
        "touchdown detected but no telemetry frame with a finite vertical speed is available for the touchdown moment",
    });
    return unavailable();
  }

  // Vertical speed at touchdown (fpm) → downward rate in feet/second. A steady
  // (level) touchdown reads ~1.0 G; downward momentum at contact adds load.
  // g_force = 1 + |descent_fps| / g. This is derived purely from the recorded
  // descent rate, not fabricated.
  const descentFps = Math.abs(frame.flight.vertical_speed_fpm) / SECONDS_PER_MINUTE;
  const gForce = 1 + descentFps / STANDARD_GRAVITY_FPS2;

  return derived(gForce);
}

// --- Destination reserve minutes (req 7.2) ----------------------------------

/**
 * Derive the destination reserve fuel in minutes (req 7.2). The reserve at the
 * destination is taken from the recorded flight plan
 * (`reserve_at_destination_minutes`), which the dispatch flight-plan stage
 * computed from evidence. Absent a flight plan carrying a finite reserve, the
 * metric is UNAVAILABLE and a FLIGHT_PLAN limitation is recorded (req 7.4,
 * 7.4a) rather than assuming a reserve.
 */
export function calculateReserveMinutes(
  flightPlan: Pick<FlightPlan, "reserve_at_destination_minutes"> | undefined,
  limitations: LimitationLog,
): DerivedMetric {
  const reserve = flightPlan?.reserve_at_destination_minutes;
  if (reserve === undefined || !Number.isFinite(reserve) || reserve < 0) {
    limitations.record({
      metric: "RESERVE_FUEL_MINUTES",
      source: "FLIGHT_PLAN",
      detail:
        "destination reserve fuel is unavailable in the flight plan; reserve minutes cannot be derived",
    });
    return unavailable();
  }
  return derived(reserve);
}

// --- Scene time minutes (req 7.2) -------------------------------------------

/**
 * Derive scene duration in minutes from the recorded ARRIVED_SCENE and
 * DEPARTED_SCENE mission events (req 7.2). Requires both a scene-arrival and a
 * scene-departure event with parseable, ordered timestamps; if either is
 * missing or out of order the metric is UNAVAILABLE and a MISSION_EVENTS
 * limitation is recorded (req 7.4, 7.4a) rather than assuming a duration.
 */
export function calculateSceneDuration(
  events: readonly ClinicalEvent[],
  limitations: LimitationLog,
): DerivedMetric {
  const arrival = events.find((e) => e.event_type === "ARRIVED_SCENE");
  const departure = events.find((e) => e.event_type === "DEPARTED_SCENE");

  if (arrival === undefined || departure === undefined) {
    limitations.record({
      metric: "SCENE_TIME_MINUTES",
      source: "MISSION_EVENTS",
      detail:
        "scene arrival and/or departure event is missing; scene time cannot be derived",
    });
    return unavailable();
  }

  const arrivalMs = parseTimestampMs(arrival.occurred_at);
  const departureMs = parseTimestampMs(departure.occurred_at);

  if (
    arrivalMs === undefined ||
    departureMs === undefined ||
    departureMs < arrivalMs
  ) {
    limitations.record({
      metric: "SCENE_TIME_MINUTES",
      source: "MISSION_EVENTS",
      detail:
        "scene arrival/departure timestamps are unparseable or out of order; scene time cannot be derived",
    });
    return unavailable();
  }

  const minutes = (departureMs - arrivalMs) / 1000 / SECONDS_PER_MINUTE;
  return derived(minutes);
}
