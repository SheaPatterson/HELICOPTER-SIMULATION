import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SIMULATOR_ENGINES } from "@virtualhems/contracts";
import {
  ingestTelemetry,
  type AuthenticatedPilot,
  type IngestDependencies,
  type TelemetryAuthenticator,
  type TelemetryIngestRequest,
} from "./ingestion.js";
import { InMemoryTelemetryRepository } from "./in-memory-repository.js";

const PILOT_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_ID = "22222222-2222-2222-2222-222222222222";
const FIXED_NOW = new Date("2024-01-01T00:00:00.000Z");

/** Authenticator that always resolves the given pilot. */
function authAs(pilot_id: string): TelemetryAuthenticator {
  return {
    async authenticate(): Promise<AuthenticatedPilot | null> {
      return { pilot_id };
    },
  };
}

/** Authenticator that always rejects. */
const rejectingAuth: TelemetryAuthenticator = {
  async authenticate(): Promise<AuthenticatedPilot | null> {
    return null;
  },
};

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

/** A valid request whose observed_at sits inside the [-60s, +5s] window. */
function validRequest(
  overrides: Partial<TelemetryIngestRequest> = {},
): TelemetryIngestRequest {
  return {
    frame_id: "33333333-3333-3333-3333-333333333333",
    session_id: SESSION_ID,
    source_engine: "XPLANE12",
    source_sequence: 0,
    sequence_number: 1,
    observed_at: FIXED_NOW.toISOString(),
    position: {
      latitude_deg: 40.5,
      longitude_deg: -80.2,
      altitude_msl_ft: 1200,
      altitude_agl_ft: 800,
    },
    flight: {
      ground_speed_kts: 120,
      heading_deg: 270,
      vertical_speed_fpm: -300,
      pitch_deg: 2,
      roll_deg: -5,
    },
    systems: {
      fuel_remaining_lbs: 900,
      engine_torque_pct: 65,
    },
    is_delta: false,
    schema_version: "0.1.0",
    ...overrides,
  };
}

describe("ingestTelemetry — authentication boundary", () => {
  it("rejects a frame when the credential is invalid and persists nothing", async () => {
    const deps = makeDeps({ authenticator: rejectingAuth });
    const result = await ingestTelemetry(validRequest(), undefined, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
    expect(deps.repository.size()).toBe(0);
  });

  it("persists under the authenticated principal, ignoring any client-supplied owner", async () => {
    const deps = makeDeps({ authenticator: authAs(PILOT_ID) });
    const result = await ingestTelemetry(validRequest(), "token", deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ack.pilot_id).toBe(PILOT_ID);
    }
  });
});

describe("ingestTelemetry — req 1.2 unsupported engine", () => {
  it("rejects an unsupported engine with a named compatibility error and no persistence", async () => {
    const deps = makeDeps();
    const result = await ingestTelemetry(
      validRequest({ source_engine: "FSX" }),
      "token",
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_ENGINE");
      expect(result.error.engine).toBe("FSX");
      expect(result.error.message).toContain("FSX");
    }
    expect(deps.repository.size()).toBe(0);
  });

  it("leaves prior accepted session state unchanged after an unsupported-engine frame", async () => {
    const deps = makeDeps();
    // Accept a valid frame first.
    await ingestTelemetry(validRequest({ sequence_number: 5 }), "token", deps);
    const before = await deps.repository.latestAcceptedSequence(PILOT_ID, SESSION_ID);

    // Now submit an unsupported engine with a higher sequence.
    await ingestTelemetry(
      validRequest({ source_engine: "PREPAR3D", sequence_number: 6 }),
      "token",
      deps,
    );

    const after = await deps.repository.latestAcceptedSequence(PILOT_ID, SESSION_ID);
    expect(after).toBe(before);
    expect(after).toBe(5);
    expect(deps.repository.size()).toBe(1);
  });

  it("accepts every supported engine value", async () => {
    for (const engine of SIMULATOR_ENGINES) {
      const deps = makeDeps();
      const result = await ingestTelemetry(
        validRequest({ source_engine: engine, sequence_number: 1 }),
        "token",
        deps,
      );
      expect(result.ok).toBe(true);
    }
  });
});

describe("ingestTelemetry — req 1.1 validation", () => {
  it("rejects an empty schema_version", async () => {
    const deps = makeDeps();
    const result = await ingestTelemetry(
      validRequest({ schema_version: "" }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.field).toBe("schema_version");
    }
    expect(deps.repository.size()).toBe(0);
  });

  it("rejects a schema_version longer than 32 characters", async () => {
    const deps = makeDeps();
    const result = await ingestTelemetry(
      validRequest({ schema_version: "x".repeat(33) }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("schema_version");
  });

  it("accepts a schema_version of exactly 32 characters", async () => {
    const deps = makeDeps();
    const result = await ingestTelemetry(
      validRequest({ schema_version: "x".repeat(32) }),
      "token",
      deps,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a non-finite numeric value and names the field", async () => {
    const deps = makeDeps();
    const result = await ingestTelemetry(
      validRequest({
        flight: {
          ground_speed_kts: Number.POSITIVE_INFINITY,
          heading_deg: 10,
          vertical_speed_fpm: 0,
          pitch_deg: 0,
          roll_deg: 0,
        },
      }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("flight.ground_speed_kts");
    expect(deps.repository.size()).toBe(0);
  });

  it("rejects a heading of exactly 360 (upper bound exclusive)", async () => {
    const deps = makeDeps();
    const result = await ingestTelemetry(
      validRequest({
        flight: {
          ground_speed_kts: 100,
          heading_deg: 360,
          vertical_speed_fpm: 0,
          pitch_deg: 0,
          roll_deg: 0,
        },
      }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("flight.heading_deg");
  });

  it("rejects latitude outside [-90, 90]", async () => {
    const deps = makeDeps();
    const result = await ingestTelemetry(
      validRequest({
        position: {
          latitude_deg: 90.5,
          longitude_deg: 0,
          altitude_msl_ft: 0,
          altitude_agl_ft: 0,
        },
      }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("position.latitude_deg");
  });

  it("rejects an observed_at older than 60 seconds before receive", async () => {
    const deps = makeDeps();
    const observed = new Date(FIXED_NOW.getTime() - 61_000).toISOString();
    const result = await ingestTelemetry(
      validRequest({ observed_at: observed }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("observed_at");
  });

  it("rejects an observed_at more than 5 seconds in the future", async () => {
    const deps = makeDeps();
    const observed = new Date(FIXED_NOW.getTime() + 6_000).toISOString();
    const result = await ingestTelemetry(
      validRequest({ observed_at: observed }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("observed_at");
  });

  it("accepts an observed_at within the [-60s, +5s] window", async () => {
    const deps = makeDeps();
    const observed = new Date(FIXED_NOW.getTime() - 30_000).toISOString();
    const result = await ingestTelemetry(
      validRequest({ observed_at: observed }),
      "token",
      deps,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a negative or non-integer sequence_number", async () => {
    const deps = makeDeps();
    for (const seq of [-1, 1.5]) {
      const result = await ingestTelemetry(
        validRequest({ sequence_number: seq }),
        "token",
        deps,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe("sequence_number");
    }
  });

  it("rejects a sequence_number not strictly greater than the previously accepted one", async () => {
    const deps = makeDeps();
    await ingestTelemetry(validRequest({ sequence_number: 10 }), "token", deps);
    const result = await ingestTelemetry(
      validRequest({
        sequence_number: 4,
        frame_id: "44444444-4444-4444-4444-444444444444",
      }),
      "token",
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("sequence_number");
    // Only the first frame persisted.
    expect(deps.repository.size()).toBe(1);
  });
});

describe("ingestTelemetry — req 1.7 timestamp separation", () => {
  it("persists source and cloud-receive timestamps as separate values", async () => {
    const deps = makeDeps();
    const observed = new Date(FIXED_NOW.getTime() - 2_000).toISOString();
    const result = await ingestTelemetry(
      validRequest({ observed_at: observed }),
      "token",
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ack.source_observed_at).toBe(observed);
      expect(result.ack.received_at).toBe(FIXED_NOW.toISOString());
      expect(result.ack.source_observed_at).not.toBe(result.ack.received_at);
    }
  });
});

describe("ingestTelemetry — req 2.7 idempotency", () => {
  it("returns an equivalent ack for a duplicate (pilot, session, sequence) without a duplicate row", async () => {
    const deps = makeDeps();
    const first = await ingestTelemetry(validRequest({ sequence_number: 7 }), "token", deps);
    expect(first.ok).toBe(true);

    // Replay the same sequence (a different frame_id, as a bridge replay might send).
    const replay = await ingestTelemetry(
      validRequest({
        sequence_number: 7,
        frame_id: "55555555-5555-5555-5555-555555555555",
      }),
      "token",
      deps,
    );

    expect(replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      expect(replay.ack.disposition).toBe("duplicate");
      // Ack equivalent to the original persisted frame.
      expect(replay.ack.frame_id).toBe(first.ack.frame_id);
      expect(replay.ack.sequence_number).toBe(first.ack.sequence_number);
      expect(replay.ack.received_at).toBe(first.ack.received_at);
      expect(replay.ack.source_observed_at).toBe(first.ack.source_observed_at);
    }
    // No duplicate row created.
    expect(deps.repository.size()).toBe(1);
  });

  it("is idempotent across repeated replays of the same frame", async () => {
    const deps = makeDeps();
    await ingestTelemetry(validRequest({ sequence_number: 3 }), "token", deps);
    for (let i = 0; i < 5; i++) {
      const replay = await ingestTelemetry(
        validRequest({ sequence_number: 3 }),
        "token",
        deps,
      );
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.ack.disposition).toBe("duplicate");
    }
    expect(deps.repository.size()).toBe(1);
  });
});

describe("ingestTelemetry — property: replay never duplicates and stays ordered", () => {
  it("accepts a strictly increasing sequence and dedupes any replayed sequence", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A strictly increasing set of sequence numbers.
        fc.uniqueArray(fc.integer({ min: 0, max: 100_000 }), {
          minLength: 1,
          maxLength: 25,
        }),
        // Indices (into the accepted list) to replay afterwards.
        fc.array(fc.nat({ max: 24 }), { maxLength: 25 }),
        async (rawSeqs, replayIdx) => {
          const seqs = [...rawSeqs].sort((a, b) => a - b);
          const deps = makeDeps();

          for (const seq of seqs) {
            const result = await ingestTelemetry(
              validRequest({
                sequence_number: seq,
                // Unique frame id per accepted sequence.
                frame_id: `f-${seq}-0000-0000-0000-000000000000`,
              }),
              "token",
              deps,
            );
            expect(result.ok).toBe(true);
          }
          expect(deps.repository.size()).toBe(seqs.length);

          // Replay some already-accepted sequences: each is idempotent, no new rows.
          for (const idx of replayIdx) {
            if (idx >= seqs.length) continue;
            const seq = seqs[idx]!;
            const replay = await ingestTelemetry(
              validRequest({
                sequence_number: seq,
                frame_id: `r-${seq}-0000-0000-0000-000000000000`,
              }),
              "token",
              deps,
            );
            expect(replay.ok).toBe(true);
            if (replay.ok) expect(replay.ack.disposition).toBe("duplicate");
          }

          // Count never exceeds the distinct accepted sequences.
          expect(deps.repository.size()).toBe(seqs.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});
