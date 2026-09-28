/**
 * Platform-wide audit logging with atomic-with-action semantics (design Section
 * 5.1 `audit_log`, Section 5.3 "Service-role operations are ... audited";
 * requirements 8.10, 8.11).
 *
 * This is the BROAD platform audit log (the `audit_log` table: actor, action,
 * target, timestamp, correlation ID, before/after metadata) — distinct from the
 * mission-scoped `mission_events` history owned by the mission service (task
 * 8.3). Req 8.10 enumerates six actions that MUST each append exactly one
 * audit-log record within 5 seconds of the action completing; req 8.11 requires
 * that, IF appending that record FAILS, the associated action is REJECTED and an
 * error indicating the action could not be recorded is returned.
 *
 * The atomic-with-action guarantee is provided by {@link withAudit}: it appends
 * the audit record around the action such that a failed append leaves the action
 * NOT performed (or rolled back), never a performed-but-unrecorded action. See
 * {@link withAudit} for the exact ordering and rollback contract.
 *
 * The 5-second bound of req 8.10 is a documented deadline
 * ({@link AUDIT_APPEND_DEADLINE_MS}); an append that cannot complete in time is
 * treated as a failed append (fail-closed), which rejects the action per 8.11.
 */

import type { Timestamp, Uuid } from "@virtualhems/contracts";

/**
 * The req-8.10 auditable actions. Each occurrence of one of these MUST append
 * exactly one audit-log record within the deadline.
 */
export const AUDITABLE_ACTIONS = [
  "AUTHORIZATION",
  "MISSION_STATE_CHANGE",
  "TELEMETRY_REPLAY",
  "CLINICAL_POLICY_CHANGE",
  "AI_OVERRIDE",
  "REPORT_PUBLICATION",
] as const;

export type AuditableAction = (typeof AUDITABLE_ACTIONS)[number];

/**
 * The req-8.10 bound: the audit record must be appended within 5 seconds of the
 * action completing. Modeled as an explicit deadline so a caller wiring an async
 * sink can race the append against it and treat a breach as a failed append
 * (which rejects the action, req 8.11).
 */
export const AUDIT_APPEND_DEADLINE_MS = 5_000;

/**
 * One audit-log record (design `audit_log`). The four fields req 8.10 mandates
 * are `actor`, `action`, `target`, and `timestamp`; the remaining fields mirror
 * the schema (correlation ID, before/after metadata) and are optional.
 */
export interface AuditRecord {
  /** The actor who performed the action (req 8.10). */
  actor: string;
  /** The action performed (req 8.10). */
  action: AuditableAction;
  /** The target of the action — its type and identity (req 8.10). */
  target: AuditTarget;
  /** ISO-8601 timestamp of when the action completed (req 8.10). */
  timestamp: Timestamp;
  /** Correlation identifier tying related records together (design `audit_log`). */
  correlationId?: Uuid;
  /** State before the action, where permitted (design `audit_log`). */
  before?: Readonly<Record<string, unknown>>;
  /** State after the action, where permitted (design `audit_log`). */
  after?: Readonly<Record<string, unknown>>;
}

/** The target of an audited action: what kind of thing and which one. */
export interface AuditTarget {
  type: string;
  id: string;
}

/**
 * Append-only sink for {@link AuditRecord}s, backed server-side by the
 * `audit_log` table (design 5.1; RLS from task 2.2 makes it ADMIN-readable and
 * server-written). Injectable so this module is testable in isolation and so the
 * production Supabase-backed sink can be dropped in without changing callers.
 *
 * The append MUST be atomic-with-action from the caller's perspective: an
 * implementation signals failure by THROWING (sync) or rejecting (async). Any
 * thrown/rejected append is treated by {@link withAudit} as a failed append and
 * rejects the associated action (req 8.11).
 */
export interface AuditLogSinkPort {
  /** Append one audit record. Throws/rejects to signal the append FAILED. */
  append(record: AuditRecord): void | Promise<void>;
}

/** Error thrown when an audited action is rejected because its audit append failed (req 8.11). */
export class AuditAppendFailedError extends Error {
  readonly action: AuditableAction;
  /** The underlying sink error that caused the append to fail, if any. */
  readonly appendCause?: unknown;

  constructor(action: AuditableAction, appendCause?: unknown) {
    super(
      `action ${action} was rejected because it could not be recorded to the audit log`,
    );
    this.name = "AuditAppendFailedError";
    this.action = action;
    this.appendCause = appendCause;
  }
}

/** The record fields a caller supplies to {@link withAudit}; the timestamp is stamped by the injected clock. */
export type AuditRecordInput = Omit<AuditRecord, "timestamp"> & {
  /** Optional explicit timestamp; when omitted the injected clock is used. */
  timestamp?: Timestamp;
};

/** Injectable dependencies for {@link withAudit}. */
export interface WithAuditDependencies {
  /** The append-only audit-log sink (design `audit_log`). */
  sink: AuditLogSinkPort;
  /** Returns "now" for the record timestamp. Injectable for deterministic tests. */
  now?: () => Date;
}

/**
 * Run an auditable action with atomic-with-action audit semantics (req 8.10,
 * 8.11).
 *
 * Ordering / rollback contract:
 *
 *   1. APPEND the audit record FIRST. If the append fails (the sink throws /
 *      rejects), the action `perform` is NEVER invoked and an
 *      {@link AuditAppendFailedError} is thrown — the action is rejected and the
 *      caller learns it could not be recorded (req 8.11). Because `perform` was
 *      never run, there is nothing to roll back and no unrecorded side effect
 *      can exist.
 *   2. If the append SUCCEEDS, invoke `perform` and return its result. The audit
 *      record now provably precedes the action's completion, satisfying "append
 *      one record ... within 5 seconds of the action completing" (req 8.10).
 *   3. If `perform` itself throws AFTER a successful append, an OPTIONAL
 *      `compensate` callback is invoked so the caller can undo the recorded-but-
 *      not-completed action; the original error is re-thrown. (For the six
 *      req-8.10 actions the natural pattern is append-then-perform, so a failed
 *      append cleanly prevents the action.)
 *
 * Rationale for append-first: req 8.11 demands that a failed append REJECT the
 * action. Appending first makes that trivially sound — no action side effect is
 * ever produced without a durable audit record — and avoids the harder problem
 * of unwinding a completed action.
 *
 * The append is treated as failed on ANY thrown/rejected error, including a
 * deadline breach the caller surfaces as an error (req 8.10 5-second bound,
 * fail-closed).
 */
export async function withAudit<T>(
  action: AuditableAction,
  record: AuditRecordInput,
  perform: () => T | Promise<T>,
  deps: WithAuditDependencies,
  compensate?: () => void | Promise<void>,
): Promise<T> {
  const now = (deps.now ?? (() => new Date()))();
  const fullRecord: AuditRecord = {
    ...record,
    action,
    timestamp: record.timestamp ?? now.toISOString(),
  };

  // 1. Append FIRST. A failed append rejects the action (req 8.11): perform is
  //    never called, so no unrecorded side effect can exist.
  try {
    await deps.sink.append(fullRecord);
  } catch (cause) {
    throw new AuditAppendFailedError(action, cause);
  }

  // 2. The record is durable; now perform the action (req 8.10).
  try {
    return await perform();
  } catch (performError) {
    // 3. The action failed after being recorded. Let the caller compensate so a
    //    recorded-but-incomplete action can be undone, then propagate.
    if (compensate !== undefined) {
      await compensate();
    }
    throw performError;
  }
}

// --- In-memory reference sinks (tests / local wiring) -----------------------

/** An in-memory append-only {@link AuditLogSinkPort} that records every append. */
export class InMemoryAuditLogSink implements AuditLogSinkPort {
  private readonly records: AuditRecord[] = [];

  append(record: AuditRecord): void {
    this.records.push(record);
  }

  /** All appended records in append order (a defensive copy). */
  all(): AuditRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  /** The number of appended records. */
  get size(): number {
    return this.records.length;
  }
}

/**
 * An {@link AuditLogSinkPort} that ALWAYS fails the append, for testing the
 * req-8.11 rejection path. Every {@link append} throws.
 */
export class FailingAuditLogSink implements AuditLogSinkPort {
  constructor(private readonly reason = "audit sink unavailable") {}

  append(): never {
    throw new Error(this.reason);
  }
}
