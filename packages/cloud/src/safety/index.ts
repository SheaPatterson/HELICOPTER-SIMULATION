/**
 * Non-punitive safety reporting boundary — Voluntary Incident Reporting System
 * (VIRS) (design Section 5.1 `virs_reports`, Section 5.3; task 18.1).
 *
 * Task 18.1 establishes the deterministic core:
 *   - {@link validateVirsSubmission} — field-specific validation that retains
 *     the entered narrative on failure (req 11.2).
 *   - {@link submitVirsReport} — the submission flow over an injectable store
 *     that persists a valid report with a confirmation (req 11.1) and, on a
 *     service/network failure, preserves a >= 24h local draft with a not-saved
 *     status (req 11.4).
 *   - {@link canRetrieveNarrative} / {@link retrieveVirsNarrative} — safety-
 *     reviewer-only narrative retrieval, and {@link toPublicProjection} — a
 *     public-safe projection that never includes the narrative (req 11.3).
 *
 * Persistence and the client-side draft store are injected as ports so the
 * production Supabase-backed `virs_reports` store (with its RLS from task 2.2)
 * and browser-local draft store drop in without changing callers. Task 18.2 is
 * the dedicated test task for the fuller validation/access/draft suite.
 */

export {
  NARRATIVE_MIN_LENGTH,
  NARRATIVE_MAX_LENGTH,
  VIRS_PERSIST_DEADLINE_MS,
  DRAFT_MIN_RETENTION_MS,
  DEFAULT_ACCESS_CONTROL,
  SAFETY_REVIEWER_ROLE,
  VIRS_INCIDENT_CATEGORIES,
  validateVirsSubmission,
  submitVirsReport,
  buildLocalDraft,
  canRetrieveNarrative,
  retrieveVirsNarrative,
  toPublicProjection,
  InMemoryVirsStore,
  FailingVirsStore,
  InMemoryVirsDraftStore,
  type SafetyReviewerRole,
  type VirsIncidentCategory,
  type VirsFieldErrorField,
  type VirsValidationErrorCode,
  type VirsFieldError,
  type VirsSubmissionInput,
  type ValidVirsSubmission,
  type VirsValidationSuccess,
  type VirsValidationFailure,
  type VirsValidationResult,
  type PersistVirsInput,
  type PersistedVirsReport,
  type VirsStorePort,
  type VirsLocalDraft,
  type VirsDraftStorePort,
  type VirsSubmissionStatus,
  type VirsSubmissionConfirmation,
  type VirsSubmissionValidationError,
  type VirsSubmissionNotSaved,
  type VirsSubmissionResult,
  type SubmitVirsDependencies,
  type VirsViewerContext,
  type NarrativeAccessDenialReason,
  type NarrativeRetrievalGranted,
  type NarrativeRetrievalDenied,
  type NarrativeRetrievalResult,
  type VirsPublicProjection,
} from "./virs.js";
