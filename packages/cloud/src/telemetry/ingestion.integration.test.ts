/**
 * Integration tests for telemetry ingestion (task 7.3; requirements 1.1, 2.7).
 *
 * Where the unit tests in `ingestion.test.ts` exercise individual validation
 * and disposition branches, these tests drive the full ingestion boundary
 * end-to-end: realistic per-engine simulator fixtures flow through
 * {@link ingestTelemetry} into an {@link InMemoryTelemetryRepository} — the same
 * repository that reproduces the DB `(pilot_id, session_id, sequence_number)`
 * unique-key collision as a {@link DuplicateFrameError}.
 *
 * Coverage:
 * - req 1.1: MSFS (MSFS2020/MSFS2024) and X-Plane (XPLANE11/XPLANE12) fixtures
 *   all map into the one normalized contract and are accepted.
 * - req 2.7: replaying a frame with a repeated `(pilot_id, session_id,
 *   sequence_number)` returns an equivalent `duplicate` ack and creates no
 *   duplicate persisted row, including replaying an earlier sequence after
 *   later frames have already landed.
 */

import { describe, expect, it } from "vitest";
import {
  SIMULATOR_ENGINES,
  type SimulatorEngine,
} from "@virtualhems/contracts";
import {
  ingestTelemetry,
  type AuthenticatedPilot,
  type IngestDependencies,
  type TelemetryAuthenticator,
  type TelemetryIngestRequest,
} from "./ingestion.js";
import { InMemoryTelemetryRepository } from "./in-memory-repository.js";

const PILOT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SESSION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FIXED_NOW = new Date("2024-06-01T12:00:00.000Z");

function authAs(pilot_id: string): TelemetryAuthenticator {
  return {
    async authenticate(): Promise<AuthenticatedPilot | null> {
      return { pilot_id };
    },
  };
}

function makeDeps(
  overrides: Partial<IngestDependencies> = {},
): IngestDependencies & { repository: InMemoryTelemetryRepository } {
  const repository =
    (overrides.repository as InMemoryTelemetryRepository) ??
    new InMemoryTelemetryRepository();
  return {
    authenticator: overrides.authenticator ?? authAs(PILOT_ID),
    repository,
    now: overrides.now ?? (() => FIXED_NOW),
  };
}

/**
 * A realistic normalized telemetry fixture as a bridge adapter would emit it
 * after converting native simulator units to the shared contract units. Each
 * engine fixture uses distinct-but-in-range values so the test proves every
 * source engine maps into the same one contract (req 1.1). The observed
 * timestamp is stamped slightly in the past to sit inside the accepted window.
 */
interface EngineFixture {
  engine: SimulatorEngine;
  request: (seq: number) => TelemetryIngestRequest;
}

function frameId(engine: string, seq: number): string {
  // Deterministic, unique-per-(engine,seq) UUID-shaped id.
  const tag = engine.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "0");
  const s = String(seq).padStart(12, "0");
  return `${tag}-0000-4000-8000-${s}`;
}

const ENGINE_FIXTURES: EngineFixture[] = [
  {
    // MSFS 2020 — SimConnect-sourced state, normalized to the contract units.
    engine: "MSFS2020",
    request: (seq) => ({
      frame_id: frameId("MSFS2020", seq),
      session_id: SESSION_ID,
      source_engine: "MSFS2020",
      source_sequence: seq,
      sequence_number: seq,
      observed_at: new Date(FIXED_NOW.getTime() - 500).toISOString(),
      position: {
        latitude_deg: 40.4406,
        longitude_deg: -79.9959,
        altitude_msl_ft: 1150,
        altitude_agl_ft: 300,
      },
      flight: {
        ground_speed_kts: 95,
        heading_deg: 145.5,
        vertical_speed_fpm: 450,
        pitch_deg: 3.2,
        roll_deg: -2.1,
      },
      systems: {
        fuel_remaining_lbs: 1120,
        engine_torque_pct: 72,
        tot_celsius: 720,
        rotor_rpm_pct: 100,
        outside_air_temp_c: 14,
      },
      is_delta: false,
      schema_version: "0.1.0",
    }),
  },
  {
    // MSFS 2024 — same contract, different in-range values and optional fields.
    engine: "MSFS2024",
    request: (seq) => ({
      frame_id: frameId("MSFS2024", seq),
      session_id: SESSION_ID,
      source_engine: "MSFS2024",
      source_sequence: seq,
      sequence_number: seq,
      observed_at: new Date(FIXED_NOW.getTime() - 250).toISOString(),
      position: {
        latitude_deg: 41.1234,
        longitude_deg: -80.3321,
        altitude_msl_ft: 2200,
        altitude_agl_ft: 1500,
      },
      flight: {
        ground_speed_kts: 118,
        heading_deg: 0, // lower inclusive bound
        vertical_speed_fpm: -600,
        pitch_deg: -1.5,
        roll_deg: 8.0,
      },
      systems: {
        fuel_remaining_lbs: 980,
        engine_torque_pct: 88,
        rotor_rpm_pct: 99,
      },
      is_delta: true,
      schema_version: "0.1.0",
    }),
  },
  {
    // X-Plane 11 — FlyWithLua-sourced state over the local UDP socket, normalized.
    engine: "XPLANE11",
    request: (seq) => ({
      frame_id: frameId("XPLANE11", seq),
      session_id: SESSION_ID,
      source_engine: "XPLANE11",
      source_sequence: seq,
      sequence_number: seq,
      observed_at: new Date(FIXED_NOW.getTime() - 1000).toISOString(),
      position: {
        latitude_deg: 39.8765,
        longitude_deg: -80.8888,
        altitude_msl_ft: 800,
        altitude_agl_ft: 120,
      },
      flight: {
        ground_speed_kts: 60,
        heading_deg: 359.9, // just under the exclusive upper bound
        vertical_speed_fpm: 0,
        pitch_deg: 0,
        roll_deg: 0,
      },
      systems: {
        fuel_remaining_lbs: 1340,
        engine_torque_pct: 54,
        tot_celsius: 640,
      },
      is_delta: false,
      schema_version: "0.1.0",
    }),
  },
  {
    // X-Plane 12 — minimal optional-systems footprint, still one contract.
    engine: "XPLANE12",
    request: (seq) => ({
      frame_id: frameId("XPLANE12", seq),
      session_id: SESSION_ID,
      source_engine: "XPLANE12",
      source_sequence: seq,
      sequence_number: seq,
      observed_at: FIXED_NOW.toISOString(),
      position: {
        latitude_deg: 40.0,
        longitude_deg: -80.0,
        altitude_msl_ft: 3400,
        altitude_agl_ft: 2900,
      },
      flight: {
        ground_speed_kts: 132,
        heading_deg: 270,
        vertical_speed_fpm: 250,
        pitch_deg: 5.5,
        roll_deg: -12.0,
      },
      systems: {
        fuel_remaining_lbs: 760,
        engine_torque_pct: 91,
      },
      is_delta: true,
      schema_version: "0.1.0",
    }),
  },
];

describe("telemetry ingestion integration — req 1.1: MSFS & X-Plane fixtures map to one contract", () => {
  it("covers every supported engine with a realistic fixture", () => {
    // Guard: the fixture set stays in lockstep with the supported engines so
    // this integration surface fails loudly if a new engine is added.
    const fixtureEngines = ENGINE_FIXTURES.map((f) => f.engine).sort();
    expect(fixtureEngines).toEqual([...SIMULATOR_ENGINES].sort());
  });

  it.each(ENGINE_FIXTURES.map((f) => [f.engine, f] as const))(
    "accepts a normalized %s fixture into the one contract",
    async (_engine, fixture) => {
      const deps = makeDeps();
      const request = fixture.request(1);
      const result = await ingestTelemetry(request, "token", deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ack.disposition).toBe("accepted");
        // Persisted under the authenticated principal, keyed by the request.
        expect(result.ack.pilot_id).toBe(PILOT_ID);
        expect(result.ack.session_id).toBe(request.session_id);
        expect(result.ack.sequence_number).toBe(request.sequence_number);
        // Source vs cloud-receive timestamps stay distinct (req 1.7 alongside 1.1).
        expect(result.ack.source_observed_at).toBe(request.observed_at);
        expect(result.ack.received_at).toBe(FIXED_NOW.toISOString());
      }
      expect(deps.repository.size()).toBe(1);
    },
  );

  it("ingests a mixed MSFS + X-Plane stream in one session into a single normalized store", async () => {
    // A realistic session might switch or interleave engines; every frame maps
    // into the same contract and is accepted so long as sequence stays ordered.
    const deps = makeDeps();
    let seq = 0;
    for (const fixture of ENGINE_FIXTURES) {
      seq += 1;
      const result = await ingestTelemetry(fixture.request(seq), "token", deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.ack.disposition).toBe("accepted");
    }
    // All four engine fixtures landed as distinct rows in the one session.
    expect(deps.repository.size()).toBe(ENGINE_FIXTURES.length);
    const latest = await deps.repository.latestAcceptedSequence(PILOT_ID, SESSION_ID);
    expect(latest).toBe(ENGINE_FIXTURES.length);
  });
});

describe("telemetry ingestion integration — req 2.7: duplicate-frame idempotency on replay", () => {
  it("replaying the exact frame returns an equivalent duplicate ack and adds no row", async () => {
    const deps = makeDeps();
    const [msfs] = ENGINE_FIXTURES;
    const first = await ingestTelemetry(msfs.request(1), "token", deps);
    expect(first.ok).toBe(true);
    expect(deps.repository.size()).toBe(1);

    const replay = await ingestTelemetry(msfs.request(1), "token", deps);
    expect(replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      expect(replay.ack.disposition).toBe("duplicate");
      // Ack equivalent to the original persisted frame.
      expect(replay.ack.frame_id).toBe(first.ack.frame_id);
      expect(replay.ack.pilot_id).toBe(first.ack.pilot_id);
      expect(replay.ack.session_id).toBe(first.ack.session_id);
      expect(replay.ack.sequence_number).toBe(first.ack.sequence_number);
      expect(replay.ack.received_at).toBe(first.ack.received_at);
      expect(replay.ack.source_observed_at).toBe(first.ack.source_observed_at);
    }
    // No duplicate persisted record (req 2.7).
    expect(deps.repository.size()).toBe(1);
  });

  it("dedupes a replay that carries a different frame_id but the same idempotency key", async () => {
    // A bridge replay after a lost ack may re-send the same (session, sequence)
    // with a freshly minted frame_id. The idempotency key is
    // (pilot_id, session_id, sequence_number), not frame_id, so it must dedupe
    // to the original and never create a second row.
    const deps = makeDeps();
    const [msfs] = ENGINE_FIXTURES;
    const original = await ingestTelemetry(msfs.request(4), "token", deps);
    expect(original.ok).toBe(true);

    const replayRequest = {
      ...msfs.request(4),
      frame_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    };
    const replay = await ingestTelemetry(replayRequest, "token", deps);
    expect(replay.ok).toBe(true);
    if (original.ok && replay.ok) {
      expect(replay.ack.disposition).toBe("duplicate");
      // Equivalent to the ORIGINAL frame, not the replay's new frame_id.
      expect(replay.ack.frame_id).toBe(original.ack.frame_id);
      expect(replay.ack.frame_id).not.toBe(replayRequest.frame_id);
    }
    expect(deps.repository.size()).toBe(1);
  });

  it("replaying an earlier sequence after later frames landed is idempotent, not a regression", async () => {
    // Ingest an ordered run, then replay an EARLIER sequence. Because that exact
    // (pilot, session, sequence) is already persisted, idempotency (req 2.7)
    // takes precedence over the strictly-increasing rule — it returns a
    // duplicate ack rather than being rejected as an out-of-order regression,
    // and no duplicate row is created.
    const deps = makeDeps();
    const [msfs] = ENGINE_FIXTURES;
    const acks: string[] = [];
    for (const seq of [1, 2, 3]) {
      const r = await ingestTelemetry(msfs.request(seq), "token", deps);
      expect(r.ok).toBe(true);
      if (r.ok) acks.push(r.ack.received_at);
    }
    expect(deps.repository.size()).toBe(3);

    const earlierReplay = await ingestTelemetry(msfs.request(1), "token", deps);
    expect(earlierReplay.ok).toBe(true);
    if (earlierReplay.ok) {
      expect(earlierReplay.ack.disposition).toBe("duplicate");
      expect(earlierReplay.ack.sequence_number).toBe(1);
      expect(earlierReplay.ack.frame_id).toBe(frameId("MSFS2020", 1));
    }
    // Still exactly three rows; latest accepted sequence unchanged.
    expect(deps.repository.size()).toBe(3);
    const latest = await deps.repository.latestAcceptedSequence(PILOT_ID, SESSION_ID);
    expect(latest).toBe(3);
  });

  it("replays the full ordered stream losslessly and idempotently (lossless replay)", async () => {
    // Simulate a bridge that, after the uplink recovers, replays every frame it
    // previously sent. Every replayed frame dedupes to a duplicate ack and the
    // store size is exactly the number of distinct sequences — the invariant a
    // durable, idempotent replay must uphold (req 2.7).
    const deps = makeDeps();
    const [msfs] = ENGINE_FIXTURES;
    const sequences = [1, 2, 3, 4, 5];

    for (const seq of sequences) {
      const r = await ingestTelemetry(msfs.request(seq), "token", deps);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ack.disposition).toBe("accepted");
    }
    expect(deps.repository.size()).toBe(sequences.length);

    // Full replay of the same stream — every frame is a duplicate, no new rows.
    for (const seq of sequences) {
      const r = await ingestTelemetry(msfs.request(seq), "token", deps);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ack.disposition).toBe("duplicate");
    }
    expect(deps.repository.size()).toBe(sequences.length);
  });

  it("scopes idempotency per session — the same sequence in a new session is accepted", async () => {
    // The idempotency key includes session_id, so replaying the same sequence
    // number under a different session must NOT dedupe.
    const deps = makeDeps();
    const [msfs] = ENGINE_FIXTURES;
    const first = await ingestTelemetry(msfs.request(1), "token", deps);
    expect(first.ok).toBe(true);

    const otherSession: TelemetryIngestRequest = {
      ...msfs.request(1),
      session_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      frame_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    };
    const second = await ingestTelemetry(otherSession, "token", deps);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.ack.disposition).toBe("accepted");

    // Two distinct rows across two sessions.
    expect(deps.repository.size()).toBe(2);
  });
});
