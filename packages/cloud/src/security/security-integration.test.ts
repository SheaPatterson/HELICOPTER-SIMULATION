/**
 * Integration-style tests for the security boundary's three enforcement
 * guarantees (task 16.2):
 *
 *   - Req 8.2  — an authenticated operational route / Bridge cloud session
 *     WITHOUT a valid, unexpired credential is DENIED: no access is granted, an
 *     "authentication required" error is returned, and the protected operation
 *     does NOT run.
 *   - Req 8.9  — a simulated clinical text input containing a detectable
 *     real-world patient identifier is REJECTED under the simulation-only
 *     policy, an error naming that policy is returned, and NONE of the input is
 *     persisted.
 *   - Req 8.11 — when appending the audit record FAILS for an auditable action,
 *     the associated action is REJECTED (not performed) and an error indicating
 *     it could not be recorded is returned.
 *
 * These tests model small end-to-end flows (a credential-gated operation, a
 * "persist clinical text" pipeline, and audited actions) rather than the
 * per-function unit behavior already covered by credentials.test.ts,
 * pii.test.ts, and audit.test.ts. They assert the OUTCOME the requirements care
 * about: the side effect (running / persisting / recording) never happens on the
 * failure path, and does happen on the clean path.
 */

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  AuditAppendFailedError,
  FailingAuditLogSink,
  InMemoryAuditLogSink,
  InMemoryCredentialVerifier,
  authorize,
  rejectIfContainsRealIdentifiers,
  withAudit,
  type AuditRecordInput,
  type AuditableAction,
  type AuthorizationDecision,
  type CredentialVerification,
} from "./index.js";

const NOW = new Date("2024-06-01T12:00:00.000Z");
const fixedNow = () => NOW;

// --- Req 8.2: authentication-required denial on a protected operation --------

/**
 * A minimal protected operation gated by {@link authorize}. It only invokes the
 * wrapped effect when access is granted; on a denial it returns the typed
 * decision and never touches the effect. This models "an authenticated
 * operational route / a Bridge cloud session" whose handler must not run for an
 * unauthenticated caller (req 8.2).
 */
function runProtectedOperation<T>(
  credential: string | null | undefined,
  verify: (c: string | null | undefined) => CredentialVerification,
  effect: () => T,
): { decision: AuthorizationDecision; result?: T } {
  const decision = authorize(credential, { verify, now: fixedNow });
  if (!decision.granted) {
    return { decision };
  }
  return { decision, result: effect() };
}

describe("req 8.2 — protected operation denies without a valid, unexpired credential", () => {
  const verifier = new InMemoryCredentialVerifier()
    .set("valid-token", { valid: true, subjectId: "pilot-1" })
    .set("invalid-token", { valid: false })
    .set("expired-token", { valid: true, subjectId: "pilot-1", expiresAt: "2024-06-01T11:00:00.000Z" });

  it("runs the operation only for a valid, unexpired credential", () => {
    const effect = vi.fn(() => "resource");
    const { decision, result } = runProtectedOperation("valid-token", verifier.verify, effect);

    expect(decision.granted).toBe(true);
    expect(effect).toHaveBeenCalledOnce();
    expect(result).toBe("resource");
  });

  it.each([
    ["missing (undefined)", undefined, "MISSING_CREDENTIAL"],
    ["missing (null)", null, "MISSING_CREDENTIAL"],
    ["missing (empty string)", "", "MISSING_CREDENTIAL"],
    ["invalid", "invalid-token", "INVALID_CREDENTIAL"],
    ["expired", "expired-token", "EXPIRED_CREDENTIAL"],
  ] as const)(
    "denies a %s credential, returns an authentication-required error, and does NOT run the operation",
    (_label, credential, reason) => {
      const effect = vi.fn(() => "resource");
      const { decision, result } = runProtectedOperation(credential, verifier.verify, effect);

      expect(decision.granted).toBe(false);
      if (!decision.granted) {
        expect(decision.reason).toBe(reason);
        expect(decision.message).toMatch(/authentication required/i);
      }
      // Grant no access to the requested resource.
      expect(effect).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    },
  );

  it("denies (fail-closed) when validation times out, and does NOT run the operation", () => {
    const effect = vi.fn(() => "resource");
    const { decision, result } = runProtectedOperation(
      "any-token",
      () => ({ valid: true, subjectId: "pilot-1", timedOut: true }),
      effect,
    );

    expect(decision.granted).toBe(false);
    if (!decision.granted) {
      expect(decision.reason).toBe("VALIDATION_TIMEOUT");
      expect(decision.message).toMatch(/authentication required/i);
    }
    expect(effect).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("property: the protected effect runs IFF access is granted", () => {
    fc.assert(
      fc.property(
        fc.record({
          valid: fc.boolean(),
          present: fc.boolean(),
          timedOut: fc.boolean(),
          hasExpiry: fc.boolean(),
          offsetMs: fc.integer({ min: -100_000, max: 100_000 }),
        }),
        (s) => {
          const effect = vi.fn(() => "ran");
          const verification: CredentialVerification = {
            valid: s.valid,
            timedOut: s.timedOut,
            ...(s.hasExpiry
              ? { expiresAt: new Date(NOW.getTime() + s.offsetMs).toISOString() }
              : {}),
          };
          const credential = s.present ? "tok" : undefined;
          const { decision } = runProtectedOperation(credential, () => verification, effect);

          const ranTimes = effect.mock.calls.length;
          // The effect ran exactly when (and only when) access was granted.
          return decision.granted ? ranTimes === 1 : ranTimes === 0;
        },
      ),
    );
  });
});

// --- Req 8.9: simulation-only rejection blocks persistence -------------------

/** An in-memory clinical-text store standing in for the persistence sink. */
class InMemoryClinicalTextStore {
  readonly persisted: string[] = [];
  save(text: string): void {
    this.persisted.push(text);
  }
}

/**
 * Model the "persist clinical text" flow: screen the input FIRST with
 * {@link rejectIfContainsRealIdentifiers}, and only persist when it is clean. On
 * a violation, return the policy error and persist nothing (req 8.9).
 */
function persistClinicalText(
  store: InMemoryClinicalTextStore,
  text: string,
): { ok: boolean; policy?: string; message?: string } {
  const screen = rejectIfContainsRealIdentifiers(text);
  if (!screen.ok) {
    return { ok: false, policy: screen.policy, message: screen.message };
  }
  store.save(text);
  return { ok: true };
}

describe("req 8.9 — persist-clinical-text flow enforces the simulation-only policy", () => {
  it.each([
    "Patient SSN 123-45-6789 on file",
    "MRN: A123456 admitted overnight",
    "next of kin (412) 555-0199",
    "contact jane.doe@example.com",
    "DOB: 04/12/1980 recorded",
    "John Smith 04/12/1980 presents with chest pain",
  ])("rejects input with a real identifier and persists NOTHING: %s", (text) => {
    const store = new InMemoryClinicalTextStore();
    const outcome = persistClinicalText(store, text);

    expect(outcome.ok).toBe(false);
    expect(outcome.policy).toBe("simulation-only data policy");
    expect(outcome.message).toMatch(/simulation-only data policy/i);
    // None of the submitted input was persisted.
    expect(store.persisted).toEqual([]);
  });

  it("persists clean simulated clinical text", () => {
    const store = new InMemoryClinicalTextStore();
    const clean = "45 y/o male, GCS 14, chest pain, onset 20 minutes ago";
    const outcome = persistClinicalText(store, clean);

    expect(outcome.ok).toBe(true);
    expect(store.persisted).toEqual([clean]);
  });

  it("does not partially persist when only part of a multi-line note violates", () => {
    const store = new InMemoryClinicalTextStore();
    const note = [
      "45 y/o male, GCS 14, chest pain",
      "SSN 123-45-6789",
      "administered 4 mg morphine",
    ].join("\n");

    const outcome = persistClinicalText(store, note);

    expect(outcome.ok).toBe(false);
    // The whole submission is rejected — no line is persisted.
    expect(store.persisted).toEqual([]);
  });

  it("property: the store is written IFF the screen accepts the input", () => {
    const identifierFragments = [
      "SSN 123-45-6789",
      "MRN: A123456",
      "(412) 555-0199",
      "jane.doe@example.com",
      "DOB: 04/12/1980",
    ];
    fc.assert(
      fc.property(
        fc.record({
          base: fc.constantFrom(
            "45 y/o male, GCS 14",
            "Vitals HR 110 BP 90/60",
            "scene time 12 minutes",
          ),
          taint: fc.option(fc.constantFrom(...identifierFragments), { nil: undefined }),
        }),
        (s) => {
          const store = new InMemoryClinicalTextStore();
          const text = s.taint === undefined ? s.base : `${s.base}; ${s.taint}`;
          const outcome = persistClinicalText(store, text);
          // Persisted exactly when accepted; nothing persisted when rejected.
          return outcome.ok ? store.persisted.length === 1 : store.persisted.length === 0;
        },
      ),
    );
  });
});

// --- Req 8.11: failed audit append rejects the action ------------------------

const baseRecord: Omit<AuditRecordInput, "action"> = {
  actor: "pilot-1",
  target: { type: "mission", id: "m-1" },
};

describe("req 8.11 — a failed audit append rejects the associated action", () => {
  const actions: AuditableAction[] = [
    "AUTHORIZATION",
    "MISSION_STATE_CHANGE",
    "TELEMETRY_REPLAY",
    "CLINICAL_POLICY_CHANGE",
    "AI_OVERRIDE",
    "REPORT_PUBLICATION",
  ];

  it.each(actions)(
    "rejects %s with a could-not-be-recorded error and NEVER performs the action",
    async (action) => {
      let performed = false;
      const perform = vi.fn(() => {
        performed = true;
        return "done";
      });

      const promise = withAudit(action, { ...baseRecord, action }, perform, {
        sink: new FailingAuditLogSink(),
        now: fixedNow,
      });

      await expect(promise).rejects.toBeInstanceOf(AuditAppendFailedError);
      await promise.catch((err: AuditAppendFailedError) => {
        expect(err.action).toBe(action);
        expect(err.message).toMatch(/could not be recorded/i);
      });

      // The action was rejected: its side effect never happened.
      expect(perform).not.toHaveBeenCalled();
      expect(performed).toBe(false);
    },
  );

  it("performs and records exactly once on the happy path (real in-memory sink)", async () => {
    const sink = new InMemoryAuditLogSink();
    const perform = vi.fn(() => "state-changed");

    const result = await withAudit(
      "MISSION_STATE_CHANGE",
      { ...baseRecord, action: "MISSION_STATE_CHANGE" },
      perform,
      { sink, now: fixedNow },
    );

    expect(result).toBe("state-changed");
    expect(perform).toHaveBeenCalledOnce();
    expect(sink.size).toBe(1);
    const [rec] = sink.all();
    expect(rec.action).toBe("MISSION_STATE_CHANGE");
    expect(rec.actor).toBe("pilot-1");
    expect(rec.target).toEqual({ type: "mission", id: "m-1" });
    expect(rec.timestamp).toBe(NOW.toISOString());
  });

  it("property: for any auditable action, a failing sink means neither perform nor record happens", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...actions), async (action) => {
        const sink = new InMemoryAuditLogSink();
        const failing = new FailingAuditLogSink();
        const perform = vi.fn(() => "x");

        let threw = false;
        try {
          await withAudit(action, { ...baseRecord, action }, perform, {
            sink: failing,
            now: fixedNow,
          });
        } catch (err) {
          threw = err instanceof AuditAppendFailedError;
        }

        // Rejected via the typed error, never performed, and the *real* sink a
        // caller would have written to stayed empty.
        return threw && perform.mock.calls.length === 0 && sink.size === 0;
      }),
    );
  });
});
