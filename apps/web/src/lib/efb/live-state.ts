/**
 * Cockpit EFB live-state derivation (design Section 6.7 degraded-state model;
 * task 13.1; Requirements 6.3, 6.4, 6.8).
 *
 * PURE core that turns the most-recent realtime telemetry + patient state (plus
 * a wall-clock `nowMs`) into an honest, render-ready view of the live cockpit
 * values. It reuses task 12.1's shared status model in
 * `@virtualhems/contracts` — `deriveUserVisibleStatus`, the `LastKnownValue`
 * wrappers, `formatGoldenHour`, `clampGcsForDisplay`, `computeDataAgeSeconds`,
 * and the age thresholds — so there is one definition of "fresh vs. last-known
 * vs. unavailable" across every client. No React, no timers, no transport.
 *
 * Requirement mapping:
 *  - 6.3: the realtime hook refreshes the underlying data; this derivation is
 *         re-run each refresh, and the client re-renders at >= 2s (the timing
 *         contract lives in the hook — see live-telemetry hook / this module's
 *         {@link LIVE_REFRESH_INTERVAL_MS}).
 *  - 6.4: `goldenHourDisplay` is HH:MM:SS via `formatGoldenHour`; `gcsDisplay`
 *         is a clamped integer 3–15 via `clampGcsForDisplay`. Both are re-derived
 *         on each per-second tick from the current elapsed time / patient state.
 *  - 6.8: when a value's data age exceeds the last-known threshold (10s) or the
 *         value is unavailable, the view presents the LAST-KNOWN value tagged
 *         with its age and a degraded flag — never a fabricated value. This is
 *         enforced structurally through `LastKnownValue<T>` (`fabricated:false`).
 */

import {
  computeDataAgeSeconds,
  deriveUserVisibleStatus,
  formatGoldenHour,
  clampGcsForDisplay,
  lastKnownValue,
  liveValue,
  unavailableValue,
  LAST_KNOWN_AGE_THRESHOLD_SECONDS,
  type ConnectionHealth,
  type LastKnownValue,
  type PatientState,
  type ServiceState,
} from "@virtualhems/contracts";
import type { AssetStateUpdate } from "@virtualhems/cloud";

/**
 * Realtime refresh cadence for live telemetry / patient state. Requirement 6.3
 * mandates refreshing displayed values at least once every 2 seconds when data
 * is available; the live hook re-derives and re-renders at least this often.
 */
export const LIVE_REFRESH_INTERVAL_MS = 2000 as const;

/**
 * Golden Hour tick cadence. Requirement 6.4 mandates advancing the HH:MM:SS
 * timer at least once per second; the client re-derives the Golden Hour display
 * at least this often. (Re-exported convenience for the EFB; mirrors the shared
 * `GOLDEN_HOUR_REFRESH_INTERVAL_MS`.)
 */
export const GOLDEN_HOUR_TICK_INTERVAL_MS = 1000 as const;

/**
 * The most-recent realtime data the EFB holds, as delivered by the realtime
 * transport (see {@link EfbRealtimeTransport}). Both fields are optional: before
 * the first message arrives, or after a channel drop, the EFB may hold neither.
 */
export interface EfbLiveInput {
  /** Most-recent asset-state (telemetry) update, if any has been received. */
  asset?: AssetStateUpdate;
  /** Epoch ms at which {@link asset} was received by the client. */
  assetReceivedAtMs?: number;
  /** Most-recent patient-state update, if any has been received. */
  patient?: PatientState;
  /** Epoch ms at which {@link patient} was received by the client. */
  patientReceivedAtMs?: number;
  /** Bridge/cloud connection health for the service-state derivation. */
  bridge: ConnectionHealth;
  cloud: ConnectionHealth;
}

/**
 * A single presented telemetry field with provenance. `label`/`unit` describe
 * the field; `value` is a {@link LastKnownValue} so the UI can render live,
 * last-known-with-age, or nothing — never fabricated (Requirement 6.8).
 */
export interface PresentedField {
  key: string;
  label: string;
  unit: string;
  value: LastKnownValue<number>;
}

/**
 * The render-ready live-state view (Requirements 6.3, 6.4, 6.8).
 *
 * `serviceState` drives the continuously-visible degraded indicator. Every
 * numeric operational value is a {@link LastKnownValue}; `degraded` is true when
 * any presented value is last-known/unavailable (i.e. data age exceeded the
 * threshold or the datum is missing).
 */
export interface EfbLiveStateView {
  serviceState: ServiceState;
  /** True when any presented value is not live (age > 10s or unavailable). */
  degraded: boolean;
  /** Age of the telemetry datum in seconds, or `null` when none is held. */
  telemetryAgeSeconds: number | null;
  /** Age of the patient datum in seconds, or `null` when none is held. */
  patientAgeSeconds: number | null;
  /** Presented telemetry fields (position/flight/systems subset). */
  telemetry: PresentedField[];
  /** Golden Hour elapsed timer as HH:MM:SS (Requirement 6.4). */
  goldenHourDisplay: string;
  /** Golden Hour value wrapper (seconds) with provenance/age. */
  goldenHour: LastKnownValue<number>;
  /** Clamped integer GCS 3–15 for display, or `null` when unavailable. */
  gcsDisplay: number | null;
  /** GCS value wrapper with provenance/age. */
  gcs: LastKnownValue<number>;
  /** Whether the patient is flagged deteriorated (last-known aware). */
  deteriorated: LastKnownValue<boolean>;
}

/**
 * Wrap a numeric datum as live / last-known / unavailable based on its data age
 * (Requirement 6.8). At or below the last-known threshold (10s) the value is
 * LIVE; strictly above it the value is LAST_KNOWN with its age; a `null` datum
 * or `null` age yields UNAVAILABLE (the UI renders nothing, never a fabricated
 * value). Pure helper shared by every presented field.
 */
export function presentValue<T>(
  value: T | null | undefined,
  ageSeconds: number | null,
): LastKnownValue<T> {
  if (value === null || value === undefined || ageSeconds === null) {
    return unavailableValue<T>();
  }
  if (ageSeconds > LAST_KNOWN_AGE_THRESHOLD_SECONDS) {
    return lastKnownValue(value, ageSeconds);
  }
  return liveValue(value, ageSeconds);
}

/** True when a presented value is not authoritative-live (Requirement 6.8). */
function valueIsDegraded<T>(v: LastKnownValue<T>): boolean {
  return v.source !== "LIVE";
}

/**
 * Derive the render-ready live-state view from the most-recent realtime data
 * and the current wall-clock (Requirements 6.3, 6.4, 6.8).
 *
 * Pure and deterministic given its input: no timers, no `Date.now()` inside —
 * the caller supplies `nowMs` so tests pin time exactly and the client passes
 * the current time on each refresh/tick.
 */
export function resolveLiveState(
  input: EfbLiveInput,
  nowMs: number,
): EfbLiveStateView {
  const telemetryAgeSeconds = computeDataAgeSeconds(
    input.assetReceivedAtMs ?? null,
    nowMs,
  );
  const patientAgeSeconds = computeDataAgeSeconds(
    input.patientReceivedAtMs ?? null,
    nowMs,
  );

  // Service state uses the freshest data age we hold (the smaller age), so the
  // continuously-visible indicator reflects the best available liveness.
  const ages = [telemetryAgeSeconds, patientAgeSeconds].filter(
    (a): a is number => a !== null,
  );
  const dataAgeSeconds = ages.length > 0 ? Math.min(...ages) : Number.POSITIVE_INFINITY;
  const serviceState = deriveUserVisibleStatus({
    bridge: input.bridge,
    cloud: input.cloud,
    // When we hold no data at all, treat age as "very old" for the derivation
    // so it cannot report NOMINAL with nothing in hand.
    dataAgeSeconds: Number.isFinite(dataAgeSeconds)
      ? dataAgeSeconds
      : LAST_KNOWN_AGE_THRESHOLD_SECONDS + 1,
  });

  const asset = input.asset;
  const telemetry: PresentedField[] = [
    field("ground_speed_kts", "Ground Speed", "kts", asset?.flight.ground_speed_kts, telemetryAgeSeconds),
    field("altitude_msl_ft", "Altitude MSL", "ft", asset?.position.altitude_msl_ft, telemetryAgeSeconds),
    field("altitude_agl_ft", "Altitude AGL", "ft", asset?.position.altitude_agl_ft, telemetryAgeSeconds),
    field("heading_deg", "Heading", "°", asset?.flight.heading_deg, telemetryAgeSeconds),
    field("vertical_speed_fpm", "Vertical Speed", "fpm", asset?.flight.vertical_speed_fpm, telemetryAgeSeconds),
    field("fuel_remaining_lbs", "Fuel Remaining", "lbs", asset?.systems.fuel_remaining_lbs, telemetryAgeSeconds),
  ];

  const patient = input.patient;

  const goldenHour = presentValue<number>(
    patient?.elapsed_golden_hour_seconds ?? null,
    patientAgeSeconds,
  );
  const goldenHourDisplay =
    goldenHour.value === null ? formatGoldenHour(Number.NaN) : formatGoldenHour(goldenHour.value);

  const gcs = presentValue<number>(patient?.current_gcs ?? null, patientAgeSeconds);
  const gcsDisplay = gcs.value === null ? null : clampGcsForDisplay(gcs.value);

  const deteriorated = presentValue<boolean>(
    patient?.deteriorated ?? null,
    patientAgeSeconds,
  );

  const degraded =
    telemetry.some((f) => valueIsDegraded(f.value)) ||
    valueIsDegraded(goldenHour) ||
    valueIsDegraded(gcs) ||
    valueIsDegraded(deteriorated);

  return {
    serviceState,
    degraded,
    telemetryAgeSeconds,
    patientAgeSeconds,
    telemetry,
    goldenHourDisplay,
    goldenHour,
    gcsDisplay,
    gcs,
    deteriorated,
  };
}

/** Build a presented telemetry field (internal helper). */
function field(
  key: string,
  label: string,
  unit: string,
  value: number | null | undefined,
  ageSeconds: number | null,
): PresentedField {
  return { key, label, unit, value: presentValue<number>(value, ageSeconds) };
}
