/**
 * Security boundary: credential validation/authorization, the simulation-only
 * data policy, and platform-wide audit logging (design Section 5.3; task 16.1).
 *
 * Maps to requirements:
 *   - 8.1 / 8.2 — {@link validateCredential} / {@link authorize}: grant only on
 *     a valid, unexpired credential within the documented 5-second deadline;
 *     otherwise deny with an "authentication required" error and no access.
 *   - 8.9 — {@link rejectIfContainsRealIdentifiers}: reject simulated clinical
 *     text that contains a detectable real-world patient identifier under the
 *     simulation-only policy; the caller must persist nothing on a violation.
 *   - 8.10 / 8.11 — {@link withAudit} + {@link AuditLogSinkPort}: append one
 *     audit record for each of the six auditable actions within the documented
 *     5-second deadline, and reject the action (with an error that it could not
 *     be recorded) when the append fails.
 */

export {
  CREDENTIAL_VALIDATION_DEADLINE_MS,
  validateCredential,
  authorize,
  InMemoryCredentialVerifier,
  type CredentialDenialReason,
  type CredentialVerification,
  type CredentialVerifierPort,
  type AuthorizationGrant,
  type AuthorizationDenial,
  type AuthorizationDecision,
  type ValidateCredentialDependencies,
  type SeededCredential,
} from "./credentials.js";

export {
  PII_IDENTIFIER_KINDS,
  SIMULATION_ONLY_POLICY,
  scanForIdentifiers,
  containsRealIdentifiers,
  rejectIfContainsRealIdentifiers,
  type PiiIdentifierKind,
  type PiiMatch,
  type SimulationOnlyViolation,
  type SimulationOnlyAccepted,
  type SimulationOnlyResult,
} from "./pii.js";

export {
  AUDITABLE_ACTIONS,
  AUDIT_APPEND_DEADLINE_MS,
  AuditAppendFailedError,
  withAudit,
  InMemoryAuditLogSink,
  FailingAuditLogSink,
  type AuditableAction,
  type AuditRecord,
  type AuditTarget,
  type AuditLogSinkPort,
  type AuditRecordInput,
  type WithAuditDependencies,
} from "./audit.js";
