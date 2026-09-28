import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  FlightVector,
  PatientState,
  PositionVector,
  SystemsVector,
} from "@virtualhems/contracts";
import {
  canSubscribe,
  channelsForAssetState,
  channelsForMissionUpdate,
  deriveAssetStateUpdate,
  deriveMissionUpdate,
  isOperationalRole,
  missionChannel,
  OPERATIONAL_ROLES,
  RealtimeFanout,
  regionAssetsChannel,
  type AcceptedFrameView,
  type AssetStateUpdate,
  type MissionUpdate,
  type MissionUpdateInput,
  type OperationalRole,
  type SubscriberContext,
} from "./fanout.js";
import { InMemoryRealtimeBroadcaster } from "./in-memory-broadcaster.js";

const REGION_A = "WPA"; // Western Pennsylvania
const REGION_B = "TRISTATE";
const MISSION_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MISSION_2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PILOT_1 = "11111111-1111-1111-1111-111111111111";

const POSITION: PositionVector = {
  latitude_deg: 40.44,
  longitude_deg: -79.99,
  altitude_msl_ft: 1200,
  altitude_agl_ft: 800,
};
const FLIGHT: FlightVector = {
  ground_speed_kts: 120,
  heading_deg: 270,
  vertical_speed_fpm: 0,
  pitch_deg: 2,
  roll_deg: 0,
};
const SYSTEMS: SystemsVector = {
  fuel_remaining_lbs: 900,
  engine_torque_pct: 65,
};

function frame(overrides: Partial<AcceptedFrameView> = {}): AcceptedFrameView {
  return {
    pilot_id: PILOT_1,
    region: REGION_A,
    position: POSITION,
    flight: FLIGHT,
    systems: SYSTEMS,
    observed_at: "2024-01-01T00:00:00.000Z",
    received_at: "2024-01-01T00:00:00.200Z",
    sequence_number: 7,
    ...overrides,
  };
}

function crew(
  role: OperationalRole,
  region: string,
  mission_ids: string[],
): SubscriberContext {
  return { role, region, mission_ids };
}

describe("channel naming", () => {
  it("region assets channel encodes the region", () => {
    expect(regionAssetsChannel(REGION_A)).toBe("region:WPA:assets");
  });

  it("mission channel encodes the mission id", () => {
    expect(missionChannel(MISSION_1)).toBe(`mission:${MISSION_1}`);
  });

  it("isOperationalRole recognizes the known roles and rejects others", () => {
    for (const r of OPERATIONAL_ROLES) {
      expect(isOperationalRole(r)).toBe(true);
    }
    expect(isOperationalRole("dispatcher")).toBe(false);
    expect(isOperationalRole(undefined)).toBe(false);
  });
});

describe("payload derivation", () => {
  it("derives asset state carrying the operational subset only", () => {
    const update = deriveAssetStateUpdate(frame({ mission_id: MISSION_1 }));
    expect(update).toEqual<AssetStateUpdate>({
      kind: "ASSET_STATE",
      pilot_id: PILOT_1,
      mission_id: MISSION_1,
      region: REGION_A,
      position: POSITION,
      flight: FLIGHT,
      systems: SYSTEMS,
      observed_at: "2024-01-01T00:00:00.000Z",
      received_at: "2024-01-01T00:00:00.200Z",
      sequence_number: 7,
    });
  });

  it("omits mission_id when the asset is not flying a mission", () => {
    const update = deriveAssetStateUpdate(frame());
    expect(update.mission_id).toBeUndefined();
    expect("mission_id" in update).toBe(false);
  });

  it("derives a mission update with patient state when present", () => {
    const patient_state: PatientState = {
      mission_id: MISSION_1,
      baseline_gcs: 14,
      current_gcs: 12,
      elapsed_golden_hour_seconds: 600,
      elapsed_scene_seconds: 120,
      physiological_flags: ["HYPOTENSION"],
      deteriorated: true,
      updated_at: "2024-01-01T00:10:00.000Z",
    };
    const input: MissionUpdateInput = {
      mission_id: MISSION_1,
      region: REGION_A,
      status: "ON_SCENE",
      patient_state,
      updated_at: "2024-01-01T00:10:00.000Z",
    };
    const update = deriveMissionUpdate(input);
    expect(update).toEqual<MissionUpdate>({
      kind: "MISSION_UPDATE",
      mission_id: MISSION_1,
      region: REGION_A,
      status: "ON_SCENE",
      patient_state,
      updated_at: "2024-01-01T00:10:00.000Z",
    });
  });
});

describe("channel scoping for a payload", () => {
  it("publishes asset state to the region channel, and mission channel when assigned", () => {
    const withMission = deriveAssetStateUpdate(frame({ mission_id: MISSION_1 }));
    expect(channelsForAssetState(withMission)).toEqual([
      "region:WPA:assets",
      `mission:${MISSION_1}`,
    ]);

    const noMission = deriveAssetStateUpdate(frame());
    expect(channelsForAssetState(noMission)).toEqual(["region:WPA:assets"]);
  });

  it("publishes mission updates (and patient state) only on the mission channel, never region-wide", () => {
    const update = deriveMissionUpdate({
      mission_id: MISSION_1,
      region: REGION_A,
      status: "EN_ROUTE_HOSPITAL",
      updated_at: "2024-01-01T00:20:00.000Z",
    });
    const channels = channelsForMissionUpdate(update);
    expect(channels).toEqual([`mission:${MISSION_1}`]);
    expect(channels.some((c) => c.startsWith("region:"))).toBe(false);
  });
});

describe("subscription authorization (who receives what)", () => {
  it("lets any role join the assets channel for their own region only", () => {
    for (const role of OPERATIONAL_ROLES) {
      const sameRegion = crew(role, REGION_A, []);
      expect(canSubscribe(sameRegion, regionAssetsChannel(REGION_A))).toBe(true);
      expect(canSubscribe(sameRegion, regionAssetsChannel(REGION_B))).toBe(false);
    }
  });

  it("lets assigned crew join their mission channel", () => {
    const assigned = crew("CAPTAIN", REGION_A, [MISSION_1]);
    expect(canSubscribe(assigned, missionChannel(MISSION_1))).toBe(true);
  });

  it("denies operational crew a mission channel they are not assigned to", () => {
    for (const role of ["TRAINEE", "OFFICER", "CAPTAIN"] as OperationalRole[]) {
      const unassigned = crew(role, REGION_A, [MISSION_2]);
      expect(canSubscribe(unassigned, missionChannel(MISSION_1))).toBe(false);
    }
  });

  it("lets broad-visibility roles (INSTRUCTOR/ADMIN) observe any mission channel", () => {
    for (const role of ["INSTRUCTOR", "ADMIN"] as OperationalRole[]) {
      const observer = crew(role, REGION_A, []);
      expect(canSubscribe(observer, missionChannel(MISSION_1))).toBe(true);
      expect(canSubscribe(observer, missionChannel(MISSION_2))).toBe(true);
    }
  });

  it("fails closed on unknown or malformed channel names", () => {
    const admin = crew("ADMIN", REGION_A, [MISSION_1]);
    expect(canSubscribe(admin, "clinical:secret")).toBe(false);
    expect(canSubscribe(admin, "region::assets")).toBe(false);
    expect(canSubscribe(admin, "mission:")).toBe(false);
    expect(canSubscribe(admin, "")).toBe(false);
  });
});

describe("RealtimeFanout end-to-end via injected broadcaster", () => {
  it("broadcasts asset state to the region channel and the mission channel", async () => {
    const broadcaster = new InMemoryRealtimeBroadcaster();
    const fanout = new RealtimeFanout(broadcaster);

    const result = await fanout.broadcastAssetState(frame({ mission_id: MISSION_1 }));

    expect(result.channels).toEqual([
      "region:WPA:assets",
      `mission:${MISSION_1}`,
    ]);
    expect(broadcaster.channels()).toEqual(result.channels);
    for (const m of broadcaster.published()) {
      expect(m.payload.kind).toBe("ASSET_STATE");
    }
  });

  it("does not leak patient state onto any region channel", async () => {
    const broadcaster = new InMemoryRealtimeBroadcaster();
    const fanout = new RealtimeFanout(broadcaster);

    await fanout.broadcastMissionUpdate({
      mission_id: MISSION_1,
      region: REGION_A,
      status: "ON_SCENE",
      patient_state: {
        mission_id: MISSION_1,
        baseline_gcs: 15,
        current_gcs: 10,
        elapsed_golden_hour_seconds: 1000,
        elapsed_scene_seconds: 300,
        physiological_flags: [],
        deteriorated: true,
        updated_at: "2024-01-01T00:15:00.000Z",
      },
      updated_at: "2024-01-01T00:15:00.000Z",
    });

    const regionMessages = broadcaster
      .published()
      .filter((m) => m.channel.startsWith("region:"));
    expect(regionMessages).toHaveLength(0);
    expect(broadcaster.messagesOn(`mission:${MISSION_1}`)).toHaveLength(1);
  });
});

describe("scoping invariants (property-based)", () => {
  const regionArb = fc.constantFrom(REGION_A, REGION_B, "REGION_C");
  const roleArb = fc.constantFrom(...OPERATIONAL_ROLES);
  const missionArb = fc.constantFrom(MISSION_1, MISSION_2, "cccccccc-cccc-cccc-cccc-cccccccccccc");

  it("every asset-state publish channel is one an authorized subscriber can join", () => {
    fc.assert(
      fc.property(
        regionArb,
        fc.option(missionArb, { nil: undefined }),
        (region, mission_id) => {
          const update = deriveAssetStateUpdate(frame({ region, mission_id }));
          const channels = channelsForAssetState(update);

          // A same-region crew member assigned to the mission is authorized on
          // every channel the payload is published to.
          const authorized = crew(
            "CAPTAIN",
            region,
            mission_id === undefined ? [] : [mission_id],
          );
          for (const channel of channels) {
            expect(canSubscribe(authorized, channel)).toBe(true);
          }
        },
      ),
    );
  });

  it("a crew member in a different region is never authorized on the region assets channel", () => {
    fc.assert(
      fc.property(regionArb, roleArb, (region, role) => {
        const otherRegion = region === REGION_A ? REGION_B : REGION_A;
        const outsider = crew(role, otherRegion, []);
        expect(canSubscribe(outsider, regionAssetsChannel(region))).toBe(false);
      }),
    );
  });

  it("operational crew never join an unassigned mission channel; broad roles always do", () => {
    fc.assert(
      fc.property(roleArb, missionArb, (role, mission_id) => {
        const unassigned = crew(role, REGION_A, []);
        const result = canSubscribe(unassigned, missionChannel(mission_id));
        const broad = role === "INSTRUCTOR" || role === "ADMIN";
        expect(result).toBe(broad);
      }),
    );
  });
});
