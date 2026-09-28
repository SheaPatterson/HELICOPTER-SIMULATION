/**
 * Shared degraded-state derivation and status model (design Section 6.7,
 * Requirement 9). This is the single, pure, dependency-light source of truth
 * that every client (web command terminal, cockpit EFB) uses to derive the
 * user-visible service state, decide when data-dependent actions must be
 * disabled, and enforce the "no fabricated values" contract.
 *
 * This module owns ONLY the pure derivation and the status model the UI
 * renders. The actual continuously-visible indicator and the per-second data
 * age refresh are client concerns (EFB/web tasks 13/17); see
 * `driveDataAge` / `AgeRefreshNote` below for the documented refresh contract
 * clients follow.
 *
 * Requirement mapping:
 *  - 9.1 NOMINAL   : bridge connected AND cloud connected AND data_age <= 2s
 *  - 9.2 OFFLINE   : bridge connected AND cloud NOT connected
 *  - 9.3 DEGRADED  : cloud connected AND 2s < data_age <= 10s
 *  - 9.4 STALE     : cloud connected AND data_age > 10s
 *  - 9.5 RECOVERING: a reconnecting condition is active on bridge or cloud
 *                    (takes precedence while set)
 *  - 9.6 display   : `formatDataAge` + `DATA_AGE_REFRESH_INTERVAL_MS` support
 *                    the once-per-second age display; `StatusModel` carries the
 *                    state + last-known timestamp for the indicator
 *  - 9.7 disable   : `areDataActionsDisabled` / `describeActionUnavailable`
 *  - 9.8 honesty   : `LastKnownValue<T>` carries `fabricated: false` + a source
 *                    marker so clients render last-known-with-age or nothing,
 *                    never invented values
 *  - 9.9 auto-GO   : `isAutomaticGoBlocked`
 *
 * Note on the design pseudocode: design Section 6.7 lists
 * `{ NOMINAL, DEGRADED, OFFLINE, RECOVERING, FAILED }` and returns FAILED as
 * the terminal else. The approved acceptance criteria (9.1–9.5) refine this to
 * a STALE state for `cloud connected AND data_age > 10s` and make RECOVERING
 * the reconnecting case. This module implements the acceptance-criteria
 * behavior (the authoritative requirement) and retains `FAILED` in the enum for
 * the residual terminal case (neither connected, not reconnecting).
 */

/** Age threshold (seconds) at or below which fresh data is NOMINAL (9.1). */
export const NOMINAL_MAX_AGE_SECONDS = 2 as const;

/** Age threshold (seconds) at or below which cloud-connected data is DEGRADED
 *  rather than STALE (9.3 / 9.4 boundary). */
export const STALE_MAX_AGE_SECONDS = 10 as const;

/**
 * Display refresh cadence for the data-age readout. Requirement 9.6 mandates
 * updating the displayed age at least once every second; clients drive a timer
 * at this interval. Exported so every client uses one cadence.
 */
export const DATA_AGE_REFRESH_INTERVAL_MS = 1000 as const;

/**
 * User-visible service state.
 *
 * `FAILED` is the residual terminal case (neither connected and not
 * reconnecting); it is not one of the primary 9.1–9.5 states but is retained
 * from the design enum so the union is exhaustive.
 */
export const SERVICE_STATES = [
  "NOMINAL",
  "OFFLINE",
  "DEGRADED",
  "STALE",
  "RECOVERING",
  "FAILED",
] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

/** Connection health for one link (bridge or cloud). */
export interface ConnectionHealth {
  /** The link currently has an established, usable connection. */
  connected: boolean;
  /** A reconnect attempt is actively in progress on this link (9.5). */
  reconnecting?: boolean;
}

/**
 * Input to {@link deriveUserVisibleStatus}.
 *
 * `dataAgeSeconds` is the age of the most recent authoritative data the client
 * holds, measured in seconds. It must be a finite, non-negative number.
 */
export interface ServiceStatusInput {
  bridge: ConnectionHealth;
  cloud: ConnectionHealth;
  dataAgeSeconds: number;
}

/**
 * Source of a displayed value. Every operational value a client renders while
 * degraded must be tagged so the UI can honestly present provenance (9.8).
 *  - `LIVE`       : authoritative, current value
 *  - `LAST_KNOWN` : a previously received value shown with an age indicator
 *  - `UNAVAILABLE`: no value to show; the UI shows nothing (never invented)
 */
export const VALUE_SOURCES = ["LIVE", "LAST_KNOWN", "UNAVAILABLE"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

/**
 * A value wrapper that structurally enforces the no-fabrication contract (9.8).
 * `fabricated` is a literal `false`: there is no representation for a fabricated
 * value, so a client can never accidentally present invented data as
 * authoritative. When no value is available, `value` is `null` and `source` is
 * `UNAVAILABLE` — the UI renders nothing rather than a placeholder number.
 */
export interface LastKnownValue<T> {
  /** The value, or `null` when unavailable. Never a fabricated substitute. */
  value: T | null;
  /** Provenance of the value. */
  source: ValueSource;
  /** Age of the value in seconds, or `null` when unavailable. */
  ageSeconds: number | null;
  /** Structural guarantee that this value was never fabricated. */
  fabricated: false;
}

/** Construct a live (authoritative) value wrapper. */
export function liveValue<T>(value: T, ageSeconds = 0): LastKnownValue<T> {
  return { value, source: "LIVE", ageSeconds, fabricated: false };
}

/** Construct a last-known value wrapper (shown with an age indicator, 9.8). */
export function lastKnownValue<T>(
  value: T,
  ageSeconds: number,
): LastKnownValue<T> {
  return { value, source: "LAST_KNOWN", ageSeconds, fabricated: false };
}

/** Construct an unavailable value wrapper (the UI shows nothing, 9.8). */
export function unavailableValue<T>(): LastKnownValue<T> {
  return { value: null, source: "UNAVAILABLE", ageSeconds: null, fabricated: false };
}

/**
 * Derive the user-visible service state from bridge/cloud health and data age
 * (design Section 6.7, Requirements 9.1–9.5).
 *
 * Evaluation order is significant:
 *  1. RECOVERING takes precedence whenever a reconnect is active on either
 *     link (9.5), regardless of the other conditions.
 *  2. NOMINAL when both links are connected and data is fresh (<= 2s) (9.1).
 *  3. OFFLINE when the bridge is connected but the cloud is not (9.2).
 *  4. DEGRADED when the cloud is connected and 2s < age <= 10s (9.3).
 *  5. STALE when the cloud is connected and age > 10s (9.4).
 *  6. FAILED otherwise (neither reconnecting nor matching the above).
 *
 * @throws RangeError if `dataAgeSeconds` is not a finite, non-negative number.
 */
export function deriveUserVisibleStatus(input: ServiceStatusInput): ServiceState {
  const { bridge, cloud, dataAgeSeconds } = input;

  if (!Number.isFinite(dataAgeSeconds) || dataAgeSeconds < 0) {
    throw new RangeError(
      `dataAgeSeconds must be a finite, non-negative number; received ${String(
        dataAgeSeconds,
      )}`,
    );
  }

  // 9.5: RECOVERING takes precedence while a reconnect is active on either link.
  if (bridge.reconnecting === true || cloud.reconnecting === true) {
    return "RECOVERING";
  }

  // 9.1: both connected and fresh.
  if (bridge.connected && cloud.connected && dataAgeSeconds <= NOMINAL_MAX_AGE_SECONDS) {
    return "NOMINAL";
  }

  // 9.2: bridge up, cloud down.
  if (bridge.connected && !cloud.connected) {
    return "OFFLINE";
  }

  // 9.3: cloud up, moderately aged data (> 2s and <= 10s).
  if (cloud.connected && dataAgeSeconds <= STALE_MAX_AGE_SECONDS) {
    return "DEGRADED";
  }

  // 9.4: cloud up, stale data (> 10s).
  if (cloud.connected && dataAgeSeconds > STALE_MAX_AGE_SECONDS) {
    return "STALE";
  }

  // Residual terminal case: neither connected, not reconnecting.
  return "FAILED";
}

/** Service states in which data is not authoritative/current for actions. */
const NON_AUTHORITATIVE_STATES: ReadonlySet<ServiceState> = new Set<ServiceState>([
  "OFFLINE",
  "STALE",
  "RECOVERING",
  "FAILED",
]);

/**
 * Whether data-dependent actions must be disabled (Requirement 9.7 / 9.8).
 *
 * Actions that require authoritative current data are disabled whenever the
 * derived state is not one where current data is trustworthy, i.e. any state
 * other than NOMINAL or DEGRADED. Equivalently, data older than the stale
 * threshold (> 10s) or an unavailable/unconnected condition disables actions.
 */
export function areDataActionsDisabled(state: ServiceState): boolean {
  return NON_AUTHORITATIVE_STATES.has(state);
}

/**
 * Human-readable reason an action is unavailable (Requirement 9.7 requires the
 * client indicate *why*). Returns `null` when actions are enabled.
 */
export function describeActionUnavailable(state: ServiceState): string | null {
  switch (state) {
    case "OFFLINE":
      return "Cloud services are unavailable; current data cannot be confirmed.";
    case "STALE":
      return "Data is stale (older than 10 seconds); a current update is required.";
    case "RECOVERING":
      return "Reconnecting to services; current data is not yet confirmed.";
    case "FAILED":
      return "Services are unavailable; no current data is available.";
    case "NOMINAL":
    case "DEGRADED":
      return null;
    default: {
      // Exhaustiveness guard.
      const _never: never = state;
      return _never;
    }
  }
}

/**
 * Weather availability for the automatic-GO gate (Requirement 9.9).
 *  - `available`         : a current weather observation is present
 *  - `dataAgeSeconds`    : age of that observation in seconds (if available)
 *  - `policyRequiresCurrentWeather` : the effective policy requires current
 *    weather for automatic authorization
 */
export interface WeatherGateInput {
  available: boolean;
  dataAgeSeconds: number | null;
  policyRequiresCurrentWeather: boolean;
}

/**
 * Whether automatic GO authorization must be blocked because required current
 * weather is unavailable or stale (Requirement 9.9).
 *
 * Automatic GO is blocked when the effective policy requires current weather
 * AND the weather is either unavailable or older than the stale threshold
 * (> 10s). When the policy does not require current weather, this never blocks.
 */
export function isAutomaticGoBlocked(input: WeatherGateInput): boolean {
  if (!input.policyRequiresCurrentWeather) {
    return false;
  }
  if (!input.available || input.dataAgeSeconds === null) {
    return true;
  }
  return input.dataAgeSeconds > STALE_MAX_AGE_SECONDS;
}

/**
 * Full status model a client renders (Requirement 9.6 / 9.7). Carries the
 * derived state, the last-known timestamp for display, and the action-gate
 * result so the continuously-visible indicator and any action controls can be
 * driven from one derived object.
 */
export interface StatusModel {
  state: ServiceState;
  /** Last-known authoritative data timestamp (epoch ms), or `null`. */
  lastKnownTimestampMs: number | null;
  /** Data age in seconds at derivation time. */
  dataAgeSeconds: number;
  /** Whether data-dependent actions are disabled (9.7). */
  actionsDisabled: boolean;
  /** Why actions are unavailable, or `null` when enabled (9.7). */
  actionUnavailableReason: string | null;
}

/** Input to {@link buildStatusModel}: connection + age + last-known timestamp. */
export interface StatusModelInput extends ServiceStatusInput {
  /** Last-known authoritative data timestamp (epoch ms), or `null`. */
  lastKnownTimestampMs: number | null;
}

/**
 * Build the full {@link StatusModel} a client renders (Requirement 9.6/9.7).
 * Pure and deterministic given its input.
 */
export function buildStatusModel(input: StatusModelInput): StatusModel {
  const state = deriveUserVisibleStatus(input);
  return {
    state,
    lastKnownTimestampMs: input.lastKnownTimestampMs,
    dataAgeSeconds: input.dataAgeSeconds,
    actionsDisabled: areDataActionsDisabled(state),
    actionUnavailableReason: describeActionUnavailable(state),
  };
}

/**
 * Format a data age (seconds) as a compact, monotonically readable string for
 * the age indicator (Requirement 9.6). Pure; the client re-invokes it on each
 * {@link DATA_AGE_REFRESH_INTERVAL_MS} tick with an updated age.
 *
 * Examples: 0 -> "0s", 45 -> "45s", 90 -> "1m 30s", 3661 -> "1h 1m 1s".
 */
export function formatDataAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Compute the current data age in seconds from a last-known timestamp and the
 * current wall-clock (Requirement 9.6). Clients call this on each per-second
 * tick to refresh the displayed age without re-fetching data.
 *
 * Returns `null` when there is no last-known timestamp (age is undefined and
 * the UI must show nothing rather than a fabricated age, per 9.8).
 */
export function computeDataAgeSeconds(
  lastKnownTimestampMs: number | null,
  nowMs: number,
): number | null {
  if (lastKnownTimestampMs === null) {
    return null;
  }
  return Math.max(0, (nowMs - lastKnownTimestampMs) / 1000);
}

// --- Golden Hour + GCS presentation (Requirement 6.4) ------------------------

/**
 * Data-age threshold (seconds) beyond which live telemetry / patient state is
 * treated as too old to present as current, so the cockpit EFB shows the
 * last-known value with an age indicator instead (Requirement 6.8). This
 * mirrors the STALE boundary used by {@link deriveUserVisibleStatus}: at or
 * below the threshold the value is presented live; strictly above it the value
 * is presented as last-known.
 */
export const LAST_KNOWN_AGE_THRESHOLD_SECONDS = STALE_MAX_AGE_SECONDS;

/** Minimum valid Glasgow Coma Scale value (Requirement 6.4). */
export const GCS_MIN = 3 as const;

/** Maximum valid Glasgow Coma Scale value (Requirement 6.4). */
export const GCS_MAX = 15 as const;

/**
 * Golden Hour timer display refresh cadence. Requirement 6.4 mandates updating
 * the displayed Golden Hour elapsed time at least once per second; clients
 * drive a timer at this interval. Exported so every client uses one cadence.
 */
export const GOLDEN_HOUR_REFRESH_INTERVAL_MS = 1000 as const;

/**
 * Format an elapsed number of seconds as a zero-padded `HH:MM:SS` string for
 * the Golden Hour timer (Requirement 6.4). Pure; the cockpit EFB re-invokes it
 * on each {@link GOLDEN_HOUR_REFRESH_INTERVAL_MS} tick with the current elapsed
 * time so the timer advances at least once per second.
 *
 * Distinct from {@link formatDataAge} (a compact `1m 30s` age readout): the
 * Golden Hour timer is a fixed-width clock face, so this always renders three
 * two-digit fields. Hours are not capped at 24 (a Golden Hour is 3600s, but the
 * formatter is total-elapsed-safe and keeps counting past an hour).
 *
 * Examples: 0 -> "00:00:00", 65 -> "00:01:05", 3661 -> "01:01:01".
 * Non-finite or negative input renders "--:--:--" (never a fabricated time).
 */
export function formatGoldenHour(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--:--";
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Clamp and normalize a Glasgow Coma Scale value to a display-safe integer in
 * the range [{@link GCS_MIN}, {@link GCS_MAX}] (Requirement 6.4). Fractional
 * inputs are floored to whole integers; out-of-range inputs are clamped to the
 * nearest bound. Returns `null` for non-finite input so the UI shows nothing
 * rather than a fabricated GCS (Requirement 6.8 / no-fabrication).
 */
export function clampGcsForDisplay(gcs: number): number | null {
  if (!Number.isFinite(gcs)) {
    return null;
  }
  const whole = Math.floor(gcs);
  if (whole < GCS_MIN) return GCS_MIN;
  if (whole > GCS_MAX) return GCS_MAX;
  return whole;
}
