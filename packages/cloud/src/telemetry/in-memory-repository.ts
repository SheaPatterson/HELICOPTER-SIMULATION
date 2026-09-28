/**
 * In-memory {@link TelemetryRepository} (test/reference implementation).
 *
 * This is not a production persistence layer — the production repository backs
 * `flight_telemetry` via the Supabase service role. This implementation exists
 * so the pure ingestion core can be exercised end-to-end without a live
 * database, and it faithfully reproduces the one behavior the core depends on:
 * a `(pilot_id, session_id, sequence_number)` collision raises
 * {@link DuplicateFrameError}, mirroring the DB unique constraint (task 2.2).
 */

import {
  DuplicateFrameError,
  type PersistedTelemetryFrame,
  type PersistTelemetryInput,
  type TelemetryRepository,
} from "./ingestion.js";
import type { Uuid } from "@virtualhems/contracts";

function key(pilot_id: Uuid, session_id: Uuid, sequence_number: number): string {
  return `${pilot_id}::${session_id}::${sequence_number}`;
}

export class InMemoryTelemetryRepository implements TelemetryRepository {
  private readonly byKey = new Map<string, PersistedTelemetryFrame>();
  private readonly latestBySession = new Map<string, number>();

  private sessionKey(pilot_id: Uuid, session_id: Uuid): string {
    return `${pilot_id}::${session_id}`;
  }

  async latestAcceptedSequence(
    pilot_id: Uuid,
    session_id: Uuid,
  ): Promise<number | null> {
    const value = this.latestBySession.get(this.sessionKey(pilot_id, session_id));
    return value ?? null;
  }

  async persist(input: PersistTelemetryInput): Promise<PersistedTelemetryFrame> {
    const k = key(input.pilot_id, input.session_id, input.sequence_number);
    if (this.byKey.has(k)) {
      throw new DuplicateFrameError();
    }

    const persisted: PersistedTelemetryFrame = {
      frame_id: input.frame_id,
      pilot_id: input.pilot_id,
      session_id: input.session_id,
      sequence_number: input.sequence_number,
      source_engine: input.source_engine,
      source_observed_at: input.source_observed_at,
      received_at: input.received_at,
      schema_version: input.schema_version,
    };
    this.byKey.set(k, persisted);

    const sk = this.sessionKey(input.pilot_id, input.session_id);
    const current = this.latestBySession.get(sk);
    if (current === undefined || input.sequence_number > current) {
      this.latestBySession.set(sk, input.sequence_number);
    }
    return persisted;
  }

  async findByIdempotencyKey(
    pilot_id: Uuid,
    session_id: Uuid,
    sequence_number: number,
  ): Promise<PersistedTelemetryFrame | null> {
    return this.byKey.get(key(pilot_id, session_id, sequence_number)) ?? null;
  }

  /** Number of persisted frames — test helper for asserting no duplicate row. */
  size(): number {
    return this.byKey.size;
  }
}
