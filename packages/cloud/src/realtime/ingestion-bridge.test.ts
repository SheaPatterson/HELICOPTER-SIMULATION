import { describe, expect, it } from "vitest";
import type { PersistedTelemetryFrame } from "../telemetry/ingestion.js";
import type { FlightVector, PositionVector, SystemsVector } from "@virtualhems/contracts";
import { RealtimeFanout } from "./fanout.js";
import { InMemoryRealtimeBroadcaster } from "./in-memory-broadcaster.js";
import {
  publishAcceptedFrame,
  toAcceptedFrameView,
  type AcceptedFrameContext,
} from "./ingestion-bridge.js";

const PILOT_1 = "11111111-1111-1111-1111-111111111111";
const SESSION_1 = "22222222-2222-2222-2222-222222222222";
const MISSION_1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const REGION = "WPA";

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

const persisted: PersistedTelemetryFrame = {
  frame_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  pilot_id: PILOT_1,
  session_id: SESSION_1,
  sequence_number: 42,
  source_engine: "MSFS2024",
  source_observed_at: "2024-01-01T00:00:00.000Z",
  received_at: "2024-01-01T00:00:00.150Z",
  schema_version: "0.1.0",
};

const context: AcceptedFrameContext = {
  region: REGION,
  mission_id: MISSION_1,
  position: POSITION,
  flight: FLIGHT,
  systems: SYSTEMS,
};

describe("ingestion -> realtime bridge", () => {
  it("maps a persisted frame + context onto the fanout view, carrying timestamps and sequence", () => {
    const view = toAcceptedFrameView(persisted, context);
    expect(view).toEqual({
      pilot_id: PILOT_1,
      mission_id: MISSION_1,
      region: REGION,
      position: POSITION,
      flight: FLIGHT,
      systems: SYSTEMS,
      observed_at: "2024-01-01T00:00:00.000Z",
      received_at: "2024-01-01T00:00:00.150Z",
      sequence_number: 42,
    });
  });

  it("omits mission_id when the frame has no mission context", () => {
    const view = toAcceptedFrameView(persisted, { ...context, mission_id: undefined });
    expect("mission_id" in view).toBe(false);
  });

  it("publishes accepted asset state to the region and mission channels", async () => {
    const broadcaster = new InMemoryRealtimeBroadcaster();
    const fanout = new RealtimeFanout(broadcaster);

    const result = await publishAcceptedFrame(fanout, persisted, context);

    expect(result.channels).toEqual([
      "region:WPA:assets",
      `mission:${MISSION_1}`,
    ]);
    expect(result.payload.kind).toBe("ASSET_STATE");
    expect(broadcaster.channels()).toEqual(result.channels);
  });
});
