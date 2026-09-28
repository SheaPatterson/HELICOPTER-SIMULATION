import { describe, expect, it, vi } from "vitest";
import {
  AUDITABLE_ACTIONS,
  AUDIT_APPEND_DEADLINE_MS,
  AuditAppendFailedError,
  FailingAuditLogSink,
  InMemoryAuditLogSink,
  withAudit,
  type AuditRecordInput,
  type WithAuditDependencies,
} from "./audit.js";

const NOW = new Date("2024-06-01T12:00:00.000Z");
const fixedNow = () => NOW;

const recordInput: AuditRecordInput = {
  actor: "pilot-1",
  action: "AUTHORIZATION",
  target: { type: "mission", id: "m-1" },
};

describe("withAudit — success path (req 8.10)", () => {
  it("appends exactly one record then performs the action, stamping the timestamp", async () => {
    const sink = new InMemoryAuditLogSink();
    const perform = vi.fn(() => "performed");
    const deps: WithAuditDependencies = { sink, now: fixedNow };

    const result = await withAudit("AUTHORIZATION", recordInput, perform, deps);

    expect(result).toBe("performed");
    expect(perform).toHaveBeenCalledOnce();
    expect(sink.size).toBe(1);
    const [rec] = sink.all();
    expect(rec.actor).toBe("pilot-1");
    expect(rec.action).toBe("AUTHORIZATION");
    expect(rec.target).toEqual({ type: "mission", id: "m-1" });
    expect(rec.timestamp).toBe(NOW.toISOString());
  });

  it("records one record for each auditable action type", async () => {
    for (const action of AUDITABLE_ACTIONS) {
      const sink = new InMemoryAuditLogSink();
      await withAudit(action, { ...recordInput, action }, () => 1, { sink, now: fixedNow });
      expect(sink.all()[0]?.action).toBe(action);
    }
  });

  it("documents the 5-second deadline (req 8.10)", () => {
    expect(AUDIT_APPEND_DEADLINE_MS).toBe(5000);
  });
});

describe("withAudit — append failure rejects the action (req 8.11)", () => {
  it("throws AuditAppendFailedError and NEVER performs the action", async () => {
    const perform = vi.fn(() => "performed");
    const deps: WithAuditDependencies = { sink: new FailingAuditLogSink(), now: fixedNow };

    await expect(
      withAudit("MISSION_STATE_CHANGE", recordInput, perform, deps),
    ).rejects.toBeInstanceOf(AuditAppendFailedError);

    expect(perform).not.toHaveBeenCalled();
  });

  it("carries the action and a message that it could not be recorded", async () => {
    const deps: WithAuditDependencies = { sink: new FailingAuditLogSink(), now: fixedNow };
    try {
      await withAudit("REPORT_PUBLICATION", recordInput, () => 1, deps);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuditAppendFailedError);
      const e = err as AuditAppendFailedError;
      expect(e.action).toBe("REPORT_PUBLICATION");
      expect(e.message).toMatch(/could not be recorded/i);
    }
  });

  it("does not leave a partial side effect when the append fails", async () => {
    let sideEffectApplied = false;
    const deps: WithAuditDependencies = { sink: new FailingAuditLogSink(), now: fixedNow };

    await expect(
      withAudit(
        "TELEMETRY_REPLAY",
        recordInput,
        () => {
          sideEffectApplied = true;
          return "done";
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(AuditAppendFailedError);

    expect(sideEffectApplied).toBe(false);
  });
});

describe("withAudit — action failure after a successful append", () => {
  it("compensates and re-throws when perform fails after the record is written", async () => {
    const sink = new InMemoryAuditLogSink();
    const compensate = vi.fn();
    const boom = new Error("action failed");

    await expect(
      withAudit(
        "CLINICAL_POLICY_CHANGE",
        recordInput,
        () => {
          throw boom;
        },
        { sink, now: fixedNow },
        compensate,
      ),
    ).rejects.toBe(boom);

    expect(sink.size).toBe(1);
    expect(compensate).toHaveBeenCalledOnce();
  });
});
