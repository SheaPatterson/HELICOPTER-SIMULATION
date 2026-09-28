/**
 * Credential validation for authenticated operational routes and Bridge cloud
 * sessions (design Section 5.3 Authorization model; requirements 8.1, 8.2).
 *
 * This module is the pure, injectable authorization gate. It does NOT talk to
 * Supabase Auth directly — the actual credential verification is injected as a
 * {@link CredentialVerifierPort} so production can back it with Supabase Auth
 * while tests use a deterministic in-memory verifier. The module owns the
 * grant/deny decision and the "authentication required" contract:
 *
 *   - {@link validateCredential} / {@link authorize} grant access ONLY when the
 *     verifier reports a credential that is both valid AND unexpired at the
 *     evaluation instant (req 8.1). Anything else — a missing credential, an
 *     invalid one, or an expired one — denies access and returns a typed
 *     "authentication required" error, granting NO access (req 8.2).
 *
 *   - The 5-second bound of req 8.1 is modeled as a documented deadline/timeout
 *     contract ({@link CREDENTIAL_VALIDATION_DEADLINE_MS}). A verifier that does
 *     not resolve within the deadline is treated as a denial (fail-closed): a
 *     credential that cannot be validated in time grants no access. Callers that
 *     use an async verifier should race it against this deadline; the
 *     synchronous core here classifies an explicit timeout signal as a denial.
 *
 * The result is a typed allow/deny union so callers cannot accidentally treat a
 * denial as a grant.
 */

import type { Timestamp } from "@virtualhems/contracts";

/**
 * The req-8.1 bound: the platform must validate the presented credential within
 * 5 seconds of the request. Modeled as an explicit deadline so callers wiring an
 * async verifier (Supabase Auth in production) can race the verification against
 * it and treat a deadline breach as a denial (fail-closed).
 */
export const CREDENTIAL_VALIDATION_DEADLINE_MS = 5_000;

/** Machine-readable denial reasons (req 8.2). */
export type CredentialDenialReason =
  /** No credential was presented at all. */
  | "MISSING_CREDENTIAL"
  /** A credential was presented but the verifier rejected it as invalid. */
  | "INVALID_CREDENTIAL"
  /** The credential is well-formed and valid but has expired. */
  | "EXPIRED_CREDENTIAL"
  /**
   * Validation did not complete within {@link CREDENTIAL_VALIDATION_DEADLINE_MS}
   * (req 8.1). Fail-closed: a credential that cannot be validated in time grants
   * no access.
   */
  | "VALIDATION_TIMEOUT";

/**
 * The verifier's verdict for a presented credential. This is what a
 * {@link CredentialVerifierPort} returns — the raw facts about the credential —
 * before this module applies the grant/deny policy.
 */
export interface CredentialVerification {
  /** Whether the credential is authentic / recognized by the identity provider. */
  valid: boolean;
  /**
   * ISO-8601 expiry instant of the credential, if known. When present it is
   * compared against the evaluation instant to enforce "unexpired" (req 8.1).
   * When absent, the credential is treated as having no expiry (never-expiring),
   * which only grants access if it is also `valid`.
   */
  expiresAt?: Timestamp;
  /** The authenticated subject/actor identifier, when the credential is valid. */
  subjectId?: string;
  /**
   * Set by an async caller when verification exceeded the deadline. When true,
   * the decision is a fail-closed denial regardless of the other fields.
   */
  timedOut?: boolean;
}

/**
 * The injectable credential verifier (req 8.1). Production backs this with
 * Supabase Auth; tests use a deterministic stub. The port is intentionally
 * agnostic about transport and only reports facts about the credential — the
 * grant/deny policy lives in {@link validateCredential}.
 *
 * The presented credential is opaque (an access token, session, etc.); `null`
 * / `undefined` means no credential was presented.
 */
export type CredentialVerifierPort = (
  credential: string | null | undefined,
) => CredentialVerification;

/** A successful authorization: access is granted (req 8.1). */
export interface AuthorizationGrant {
  granted: true;
  /** The authenticated actor's identifier, for downstream audit records. */
  subjectId?: string;
}

/** A denial: no access is granted, and authentication is required (req 8.2). */
export interface AuthorizationDenial {
  granted: false;
  reason: CredentialDenialReason;
  /** Human-readable message indicating authentication is required (req 8.2). */
  message: string;
}

/** Typed allow/deny result. Callers cannot treat a denial as a grant. */
export type AuthorizationDecision = AuthorizationGrant | AuthorizationDenial;

/** Injectable dependencies for {@link validateCredential}. */
export interface ValidateCredentialDependencies {
  /** Verifies the presented credential (Supabase Auth in production). */
  verify: CredentialVerifierPort;
  /** Returns "now" for the unexpired check. Injectable for deterministic tests. */
  now?: () => Date;
}

const DENY_MESSAGE = "authentication required: a valid, unexpired credential must be presented";

function deny(reason: CredentialDenialReason): AuthorizationDenial {
  return { granted: false, reason, message: DENY_MESSAGE };
}

/**
 * Validate a presented credential and decide grant/deny (req 8.1, 8.2).
 *
 * Grants access ONLY when the verifier reports the credential valid AND it is
 * unexpired at the evaluation instant. Denies — with a typed
 * "authentication required" error and no access — when the credential is
 * missing, invalid, expired, or could not be validated within the deadline
 * (fail-closed).
 */
export function validateCredential(
  credential: string | null | undefined,
  deps: ValidateCredentialDependencies,
): AuthorizationDecision {
  if (credential === null || credential === undefined || credential === "") {
    return deny("MISSING_CREDENTIAL");
  }

  const verification = deps.verify(credential);

  // Fail-closed on a deadline breach (req 8.1): a credential that cannot be
  // validated in time grants no access.
  if (verification.timedOut === true) {
    return deny("VALIDATION_TIMEOUT");
  }

  if (!verification.valid) {
    return deny("INVALID_CREDENTIAL");
  }

  // "unexpired" check (req 8.1). A credential with a known expiry that is at or
  // before now is expired and grants no access.
  if (verification.expiresAt !== undefined) {
    const now = (deps.now ?? (() => new Date()))();
    const expiry = Date.parse(verification.expiresAt);
    // A malformed/unparseable expiry is treated as expired (fail-closed).
    if (Number.isNaN(expiry) || expiry <= now.getTime()) {
      return deny("EXPIRED_CREDENTIAL");
    }
  }

  return { granted: true, subjectId: verification.subjectId };
}

/**
 * Convenience alias for {@link validateCredential} expressed as an authorization
 * gate. Identical semantics; named for call sites that read as "authorize this
 * request" (req 8.1, 8.2).
 */
export const authorize = validateCredential;

// --- In-memory reference verifiers (tests / local wiring) -------------------

/** A single seeded credential for {@link InMemoryCredentialVerifier}. */
export interface SeededCredential {
  valid: boolean;
  expiresAt?: Timestamp;
  subjectId?: string;
}

/**
 * An in-memory {@link CredentialVerifierPort} for tests and local wiring. Any
 * credential not seeded is reported invalid.
 */
export class InMemoryCredentialVerifier {
  private readonly seeded = new Map<string, SeededCredential>();

  /** Seed a credential string with its verification facts. */
  set(credential: string, verification: SeededCredential): this {
    this.seeded.set(credential, verification);
    return this;
  }

  /** The {@link CredentialVerifierPort} bound to this store. */
  readonly verify: CredentialVerifierPort = (credential) => {
    if (credential === null || credential === undefined) {
      return { valid: false };
    }
    const seeded = this.seeded.get(credential);
    if (seeded === undefined) {
      return { valid: false };
    }
    return { ...seeded };
  };
}
