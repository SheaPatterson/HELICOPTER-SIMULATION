import { describe, expect, it } from "vitest";
import type { PatientState } from "@virtualhems/contracts";
import type { AssetStateUpdate } from "@virtualhems/cloud";
import { presentValue, resolveLiveState, type EfbLiveInput } from "./live-state";

/**
 * Unit tests for the pure cockpit EFB live-state derivation (task 13.1;
 * Requirements 6.3, 6.4, 6.8). Covers live vs. last-known vs. unavailable value
 * provenance, the HH:MM:SS Golden Hour timer, the GCS integer clamp, and the
 * degraded-when-stale behavior. Time is injected (`nowMs`) so ages are exact.
 */

const NOW = 1_700_000_000_000;

function buildAsset(overrides: Partial<AssetStateUpdate> = {}): AssetStateUpdate {
  return {
    kind: "ASSET_STATE",
    pilot_id: "pilot-1",
    region: "wpa",
    position: {
      latitude_deg: 40,
      longitude_deg: -80,
      altitude_msl_ft: 1200,
      altitude_agl_ft: 800,
    },
    flight: {
      ground_speed_kts: 120,
      heading_deg: 90,
      vertical_speed_fpm: 300,
      pitch_deg: 2,
      roll_deg: 1,
    },
    systems: {
      fuel_remaining_lbs: 900,
      engine_torque_pct: 65,
    },
    observed_at: "2024-01-01T00:00:00.000Z",
    received_at: "2024-01-01T00:00:00.100Z",
    sequence_number: 1,
    ...overrides,
  };
}

function buildPatient(overrides: Partial<PatientState> = {}): PatientState {
  return {
    mission_id: "mission-1",
    baseline_gcs: 14,
    current_gcs: 12,
    elapsed_golden_hour_seconds: 65,
    elapsed_scene_seconds: 30,
    physiological_flags: [],
    deteriorated: false,
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const bothConnected = {
  bridge: { connected: true },
  cloud: { connected: true },
} as const;

describe("presentValue provenance (6.8)", () => {
  it("marks fresh data (<= 10s) LIVE", () => {
    expect(presentValue(120, 5)).toEqual({
      value: 120,
      source: "LIVE",
      ageSeconds: 5,
      fabricated: false,
    });
  });

  it("marks data older than 10s as LAST_KNOWN with its age", () => {
    expect(presentValue(120, 12)).toEqual({
      value: 120,
      source: "LAST_KNOWN",
      ageSeconds: 12,
      fabricated: false,
    });
  });

  it("holds data LIVE exactly at the 10s boundary", () => {
    expect(presentValue(1, 10).source).toBe("LIVE");
  });

  it("marks a null value or null age UNAVAILABLE (never fabricated)", () => {
    expect(presentValue(null, 5).source).toBe("UNAVAILABLE");
    expect(presentValue(120, null).source).toBe("UNAVAILABLE");
    expect(presentValue(null, 5).value).toBeNull();
  });
});

describe("resolveLiveState — fresh data (6.3/6.4)", () => {
  it("presents live telemetry and a HH:MM:SS Golden Hour + integer GCS", () => {
    const input: EfbLiveInput = {
      ...bothConnected,
      asset: buildAsset(),
      assetReceivedAtMs: NOW - 1000, // 1s old
      patient: buildPatient(),
      patientReceivedAtMs: NOW - 1000,
    };
    const view = resolveLiveState(input, NOW);

    expect(view.serviceState).toBe("NOMINAL");
    expect(view.degraded).toBe(false);
    expect(view.goldenHourDisplay).toBe("00:01:05"); // 65s
    expect(view.gcsDisplay).toBe(12);

    const speed = view.telemetry.find((f) => f.key === "ground_speed_kts");
    expect(speed?.value.value).toBe(120);
    expect(speed?.value.source).toBe("LIVE");
  });

  it("clamps an out-of-range GCS to the 3–15 integer band", () => {
    const view = resolveLiveState(
      {
        ...bothConnected,
        patient: buildPatient({ current_gcs: 99 }),
        patientReceivedAtMs: NOW,
      },
      NOW,
    );
    expect(view.gcsDisplay).toBe(15);
  });

  it("advances the Golden Hour timer past a full hour (scene delay)", () => {
    const view = resolveLiveState(
      {
        ...bothConnected,
        patient: buildPatient({ elapsed_golden_hour_seconds: 4500 }), // 1h15m
        patientReceivedAtMs: NOW,
      },
      NOW,
    );
    expect(view.goldenHourDisplay).toBe("01:15:00");
  });
});

describe("resolveLiveState — degraded / last-known (6.8)", () => {
  it("shows last-known telemetry with an age when data age > 10s", () => {
    const input: EfbLiveInput = {
      ...bothConnected,
      asset: buildAsset(),
      assetReceivedAtMs: NOW - 15_000, // 15s old
      patient: buildPatient(),
      patientReceivedAtMs: NOW - 15_000,
    };
    const view = resolveLiveState(input, NOW);

    expect(view.degraded).toBe(true);
    expect(view.serviceState).toBe("STALE");
    const speed = view.telemetry.find((f) => f.key === "ground_speed_kts");
    expect(speed?.value.source).toBe("LAST_KNOWN");
    expect(speed?.value.ageSeconds).toBe(15);
    // The value is retained (last-known), never blanked or fabricated.
    expect(speed?.value.value).toBe(120);
  });

  it("shows nothing (unavailable) and never fabricates when no data is held", () => {
    const view = resolveLiveState({ ...bothConnected }, NOW);
    expect(view.degraded).toBe(true);
    expect(view.gcsDisplay).toBeNull();
    expect(view.goldenHourDisplay).toBe("--:--:--");
    for (const f of view.telemetry) {
      expect(f.value.source).toBe("UNAVAILABLE");
      expect(f.value.value).toBeNull();
    }
  });

  it("reports RECOVERING when a link is reconnecting", () => {
    const view = resolveLiveState(
      {
        bridge: { connected: false, reconnecting: true },
        cloud: { connected: true },
        asset: buildAsset(),
        assetReceivedAtMs: NOW,
      },
      NOW,
    );
    expect(view.serviceState).toBe("RECOVERING");
  });
});
