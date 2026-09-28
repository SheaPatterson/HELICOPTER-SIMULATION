import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CREDENTIAL_VALIDATION_DEADLINE_MS,
  InMemoryCredentialVerifier,
  authorize,
  validateCredential,
  type CredentialVerification,
  type ValidateCredentialDependencies,
} from "./credentials.js";

const NOW = new Date("2024-06-01T12:00:00.000Z");
const fixedNow = () => NOW;

function depsFor(verification: CredentialVerification): ValidateCredentialDependencies {
  return { verify: () => verification, now: fixedNow };
}

describe("validateCredential — grant path (req 8.1)", () => {
  it("grants access for a valid, unexpired credential", () => {
    const decision = validateCredential("tok", {
      verify: () => ({
        valid: true,
        subjectId: "pilot-1",
        expiresAt: "2024-06-01T13:00:00.000Z",
      }),
      now: fixedNow,
    });
    expect(decision.granted).toBe(true);
    if (decision.granted) {
      expect(decision.subjectId).toBe("pilot-1");
    }
  });

  it("grants access for a valid credential with no expiry", () => {
    const decision = validateCredential("tok", depsFor({ valid: true, subjectId: "p" }));
    expect(decision.granted).toBe(true);
  });

  it("authorize is an alias with identical semantics", () => {
    const decision = authorize("tok", depsFor({ valid: true }));
    expect(decision.granted).toBe(true);
  });
});

describe("validateCredential — deny path (req 8.2)", () => {
  it("denies a missing credential with authentication-required message", () => {
    for (const missing of [undefined, null, ""] as const) {
      const decision = validateCredential(missing, depsFor({ valid: true }));
      expect(decision.granted).toBe(false);
      if (!decision.granted) {
        expect(decision.reason).toBe("MISSING_CREDENTIAL");
        expect(decision.message).toMatch(/authentication required/i);
      }
    }
  });

  it("denies an invalid credential", () => {
    const decision = validateCredential("tok", depsFor({ valid: false }));
    expect(decision.granted).toBe(false);
    if (!decision.granted) expect(decision.reason).toBe("INVALID_CREDENTIAL");
  });

  it("denies an expired credential (expiry at or before now)", () => {
    const expired = validateCredential(
      "tok",
      depsFor({ valid: true, expiresAt: "2024-06-01T11:59:59.000Z" }),
    );
    expect(expired.granted).toBe(false);
    if (!expired.granted) expect(expired.reason).toBe("EXPIRED_CREDENTIAL");

    const exactlyNow = validateCredential(
      "tok",
      depsFor({ valid: true, expiresAt: NOW.toISOString() }),
    );
    expect(exactlyNow.granted).toBe(false);
  });

  it("denies a malformed expiry (fail-closed)", () => {
    const decision = validateCredential(
      "tok",
      depsFor({ valid: true, expiresAt: "not-a-date" }),
    );
    expect(decision.granted).toBe(false);
    if (!decision.granted) expect(decision.reason).toBe("EXPIRED_CREDENTIAL");
  });

  it("denies (fail-closed) when validation times out past the deadline (req 8.1)", () => {
    expect(CREDENTIAL_VALIDATION_DEADLINE_MS).toBe(5000);
    const decision = validateCredential("tok", depsFor({ valid: true, timedOut: true }));
    expect(decision.granted).toBe(false);
    if (!decision.granted) expect(decision.reason).toBe("VALIDATION_TIMEOUT");
  });
});

describe("InMemoryCredentialVerifier", () => {
  it("reports seeded credentials and rejects unseeded ones", () => {
    const verifier = new InMemoryCredentialVerifier().set("good", {
      valid: true,
      subjectId: "p",
    });
    expect(validateCredential("good", { verify: verifier.verify, now: fixedNow }).granted).toBe(
      true,
    );
    expect(validateCredential("unknown", { verify: verifier.verify, now: fixedNow }).granted).toBe(
      false,
    );
  });
});

describe("property: only valid AND unexpired credentials are ever granted (req 8.1/8.2)", () => {
  it("never grants on invalid, expired, timed-out, or missing credentials", () => {
    fc.assert(
      fc.property(
        fc.record({
          valid: fc.boolean(),
          offsetMs: fc.integer({ min: -100_000, max: 100_000 }),
          hasExpiry: fc.boolean(),
          timedOut: fc.boolean(),
          present: fc.boolean(),
        }),
        (s) => {
          const verification: CredentialVerification = {
            valid: s.valid,
            timedOut: s.timedOut,
            ...(s.hasExpiry
              ? { expiresAt: new Date(NOW.getTime() + s.offsetMs).toISOString() }
              : {}),
          };
          const credential = s.present ? "tok" : undefined;
          const decision = validateCredential(credential, depsFor(verification));

          const unexpired = !s.hasExpiry || s.offsetMs > 0;
          const shouldGrant = s.present && s.valid && !s.timedOut && unexpired;
          return decision.granted === shouldGrant;
        },
      ),
    );
  });
});
