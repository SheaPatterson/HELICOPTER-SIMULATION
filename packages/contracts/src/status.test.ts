import { describe, expect, it } from "vitest";
import {
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
  NOMINAL_MAX_AGE_SECONDS,
  STALE_MAX_AGE_SECONDS,
  GCS_MIN,
  GCS_MAX,
  type ServiceState,
} from "./status.js";

/**
 * Example/boundary unit tests for the shared degraded-state derivation and
 * status model (design Section 6.7, Requirement 9). Covers every state
 * boundary (exact 2s, just over 2s, exact 10s, just over 10s), OFFLINE,
 * RECOVERING precedence, action-disabling (9.7), the no-fabrication value
 * contract (9.8), and the block-auto-GO-on-stale-weather rule (9.9).
 *
 * The universal degraded-state-honesty PROPERTY test lives in task 12.2; this
 * file intentionally covers examples and boundaries only.
 */

const connected = { connected: true } as const;
const disconnected = { connected: false } as const;

describe("deriveUserVisibleStatus — state boundaries (9.1–9.4)", () => {
  it("returns NOMINAL when both connected and age is 0 (9.1)", () => {
    expect(
      deriveUserVisibleStatus({ bridge: connected, cloud: connected, dataAgeSeconds: 0 }),
    ).toBe("NOMINAL");
  });

  it("returns NOMINAL at exactly the 2s boundary (inclusive) (9.1)", () => {
    expect(
      deriveUserVisibleStatus({
        bridge: connected,
        cloud: connected,
        dataAgeSeconds: NOMINAL_MAX_AGE_SECONDS, // 2
      }),
    ).toBe("NOMINAL");
  });

  it("returns DEGRADED just over 2s (2.001s) (9.3)", () => {
    expect(
      deriveUserVisibleStatus({ bridge: connected, cloud: connected, dataAgeSeconds: 2.001 }),
    ).toBe("DEGRADED");
  });

  it("returns DEGRADED at exactly the 10s boundary (inclusive) (9.3)", () => {
    expect(
      deriveUserVisibleStatus({
        bridge: connected,
        cloud: connected,
        dataAgeSeconds: STALE_MAX_AGE_SECONDS, // 10
      }),
    ).toBe("DEGRADED");
  });

  it("returns STALE just over 10s (10.001s) (9.4)", () => {
    expect(
      deriveUserVisibleStatus({ bridge: connected, cloud: connected, dataAgeSeconds: 10.001 }),
    ).toBe("STALE");
  });

  it("DEGRADED holds even when the bridge link is down, as long as cloud is up (9.3)", () => {
    expect(
      deriveUserVisibleStatus({ bridge: disconnected, cloud: connected, dataAgeSeconds: 5 }),
    ).toBe("DEGRADED");
  });
});

describe("deriveUserVisibleStatus — OFFLINE (9.2)", () => {
  it("returns OFFLINE when bridge connected but cloud disconnected, regardless of age", () => {
    expect(
      deriveUserVisibleStatus({ bridge: connected, cloud: disconnected, dataAgeSeconds: 0 }),
    ).toBe("OFFLINE");
    expect(
      deriveUserVisibleStatus({ bridge: connected, cloud: disconnected, dataAgeSeconds: 100 }),
    ).toBe("OFFLINE");
  });
});

describe("deriveUserVisibleStatus — RECOVERING precedence (9.5)", () => {
  it("returns RECOVERING when the bridge is reconnecting, overriding NOMINAL conditions", () => {
    expect(
      deriveUserVisibleStatus({
        bridge: { connected: true, reconnecting: true },
        cloud: connected,
        dataAgeSeconds: 0,
      }),
    ).toBe("RECOVERING");
  });

  it("returns RECOVERING when the cloud is reconnecting, overriding OFFLINE conditions", () => {
    expect(
      deriveUserVisibleStatus({
        bridge: connected,
        cloud: { connected: false, reconnecting: true },
        dataAgeSeconds: 0,
      }),
    ).toBe("RECOVERING");
  });

  it("returns RECOVERING when reconnecting even with stale data", () => {
    expect(
      deriveUserVisibleStatus({
        bridge: { connected: false, reconnecting: true },
        cloud: { connected: false },
        dataAgeSeconds: 999,
      }),
    ).toBe("RECOVERING");
  });
});

describe("deriveUserVisibleStatus — FAILED residual and input validation", () => {
  it("returns FAILED when neither link is connected and not reconnecting", () => {
    expect(
      deriveUserVisibleStatus({ bridge: disconnected, cloud: disconnected, dataAgeSeconds: 5 }),
    ).toBe("FAILED");
  });

  it("throws RangeError for negative or non-finite data age", () => {
    expect(() =>
      deriveUserVisibleStatus({ bridge: connected, cloud: connected, dataAgeSeconds: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      deriveUserVisibleStatus({ bridge: connected, cloud: connected, dataAgeSeconds: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      deriveUserVisibleStatus({
        bridge: connected,
        cloud: connected,
        dataAgeSeconds: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
  });
});

describe("areDataActionsDisabled / describeActionUnavailable (9.7)", () => {
  it("enables actions only in NOMINAL and DEGRADED", () => {
    expect(areDataActionsDisabled("NOMINAL")).toBe(false);
    expect(areDataActionsDisabled("DEGRADED")).toBe(false);
  });

  it("disables actions in OFFLINE, STALE, RECOVERING, FAILED", () => {
    const disabled: ServiceState[] = ["OFFLINE", "STALE", "RECOVERING", "FAILED"];
    for (const state of disabled) {
      expect(areDataActionsDisabled(state)).toBe(true);
    }
  });

  it("provides a non-null reason exactly when actions are disabled", () => {
    const all: ServiceState[] = ["NOMINAL", "OFFLINE", "DEGRADED", "STALE", "RECOVERING", "FAILED"];
    for (const state of all) {
      const reason = describeActionUnavailable(state);
      if (areDataActionsDisabled(state)) {
        expect(reason).toBeTypeOf("string");
        expect((reason as string).length).toBeGreaterThan(0);
      } else {
        expect(reason).toBeNull();
      }
    }
  });
});

describe("isAutomaticGoBlocked — required current weather (9.9)", () => {
  it("does not block when the policy does not require current weather", () => {
    expect(
      isAutomaticGoBlocked({
        available: false,
        dataAgeSeconds: null,
        policyRequiresCurrentWeather: false,
      }),
    ).toBe(false);
  });

  it("blocks when required weather is unavailable", () => {
    expect(
      isAutomaticGoBlocked({
        available: false,
        dataAgeSeconds: null,
        policyRequiresCurrentWeather: true,
      }),
    ).toBe(true);
  });

  it("blocks when required weather is stale (> 10s)", () => {
    expect(
      isAutomaticGoBlocked({
        available: true,
        dataAgeSeconds: 10.001,
        policyRequiresCurrentWeather: true,
      }),
    ).toBe(true);
  });

  it("does not block when required weather is present at exactly the 10s boundary", () => {
    expect(
      isAutomaticGoBlocked({
        available: true,
        dataAgeSeconds: STALE_MAX_AGE_SECONDS,
        policyRequiresCurrentWeather: true,
      }),
    ).toBe(false);
  });

  it("does not block when required weather is fresh", () => {
    expect(
      isAutomaticGoBlocked({
        available: true,
        dataAgeSeconds: 1,
        policyRequiresCurrentWeather: true,
      }),
    ).toBe(false);
  });
});

describe("no-fabrication value contract (9.8)", () => {
  it("liveValue marks source LIVE and never fabricated", () => {
    const v = liveValue(42, 0);
    expect(v).toEqual({ value: 42, source: "LIVE", ageSeconds: 0, fabricated: false });
  });

  it("lastKnownValue carries the value, its age, and fabricated:false", () => {
    const v = lastKnownValue("KAXQ", 12);
    expect(v).toEqual({ value: "KAXQ", source: "LAST_KNOWN", ageSeconds: 12, fabricated: false });
  });

  it("unavailableValue is null with no invented value or age", () => {
    const v = unavailableValue<number>();
    expect(v).toEqual({ value: null, source: "UNAVAILABLE", ageSeconds: null, fabricated: false });
  });
});

describe("buildStatusModel (9.6/9.7)", () => {
  it("bundles state, last-known timestamp, and action gate for a NOMINAL client", () => {
    const model = buildStatusModel({
      bridge: connected,
      cloud: connected,
      dataAgeSeconds: 1,
      lastKnownTimestampMs: 1_700_000_000_000,
    });
    expect(model).toEqual({
      state: "NOMINAL",
      lastKnownTimestampMs: 1_700_000_000_000,
      dataAgeSeconds: 1,
      actionsDisabled: false,
      actionUnavailableReason: null,
    });
  });

  it("reports disabled actions with a reason for a STALE client", () => {
    const model = buildStatusModel({
      bridge: connected,
      cloud: connected,
      dataAgeSeconds: 15,
      lastKnownTimestampMs: 1_700_000_000_000,
    });
    expect(model.state).toBe("STALE");
    expect(model.actionsDisabled).toBe(true);
    expect(model.actionUnavailableReason).toBeTypeOf("string");
  });
});

describe("data-age display helpers (9.6)", () => {
  it("formats ages across second/minute/hour magnitudes", () => {
    expect(formatDataAge(0)).toBe("0s");
    expect(formatDataAge(45)).toBe("45s");
    expect(formatDataAge(90)).toBe("1m 30s");
    expect(formatDataAge(3661)).toBe("1h 1m 1s");
  });

  it("renders an em dash for undefined/negative ages rather than a fabricated value", () => {
    expect(formatDataAge(-1)).toBe("—");
    expect(formatDataAge(Number.NaN)).toBe("—");
  });

  it("computes data age from a last-known timestamp and now", () => {
    expect(computeDataAgeSeconds(1_000_000, 1_005_000)).toBe(5);
  });

  it("clamps negative ages (clock skew) to zero", () => {
    expect(computeDataAgeSeconds(1_005_000, 1_000_000)).toBe(0);
  });

  it("returns null age when there is no last-known timestamp (9.8)", () => {
    expect(computeDataAgeSeconds(null, 1_000_000)).toBeNull();
  });
});

describe("formatGoldenHour — HH:MM:SS timer (6.4)", () => {
  it("renders zero as a zero-padded clock face", () => {
    expect(formatGoldenHour(0)).toBe("00:00:00");
  });

  it("zero-pads minutes and seconds", () => {
    expect(formatGoldenHour(65)).toBe("00:01:05");
  });

  it("renders exactly one hour", () => {
    expect(formatGoldenHour(3600)).toBe("01:00:00");
  });

  it("renders hours, minutes, and seconds together", () => {
    expect(formatGoldenHour(3661)).toBe("01:01:01");
  });

  it("keeps counting past a full Golden Hour without capping", () => {
    // 1h 15m 0s — a 20-minute scene delay pushes elapsed past 3600s.
    expect(formatGoldenHour(4500)).toBe("01:15:00");
  });

  it("floors fractional seconds rather than rounding", () => {
    expect(formatGoldenHour(59.9)).toBe("00:00:59");
  });

  it("renders a placeholder clock for non-finite/negative input (no fabrication)", () => {
    expect(formatGoldenHour(-1)).toBe("--:--:--");
    expect(formatGoldenHour(Number.NaN)).toBe("--:--:--");
    expect(formatGoldenHour(Number.POSITIVE_INFINITY)).toBe("--:--:--");
  });
});

describe("clampGcsForDisplay — integer 3–15 (6.4)", () => {
  it("passes through in-range integers", () => {
    expect(clampGcsForDisplay(GCS_MIN)).toBe(3);
    expect(clampGcsForDisplay(9)).toBe(9);
    expect(clampGcsForDisplay(GCS_MAX)).toBe(15);
  });

  it("clamps below the minimum up to 3", () => {
    expect(clampGcsForDisplay(0)).toBe(3);
    expect(clampGcsForDisplay(-4)).toBe(3);
  });

  it("clamps above the maximum down to 15", () => {
    expect(clampGcsForDisplay(20)).toBe(15);
  });

  it("floors fractional values to whole integers", () => {
    expect(clampGcsForDisplay(12.8)).toBe(12);
  });

  it("returns null for non-finite input rather than a fabricated GCS (6.8)", () => {
    expect(clampGcsForDisplay(Number.NaN)).toBeNull();
    expect(clampGcsForDisplay(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
