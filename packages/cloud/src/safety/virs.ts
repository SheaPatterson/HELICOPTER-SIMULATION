/**
 * Non-punitive safety reporting — Voluntary Incident Reporting System (VIRS)
 * (design Section 5.1 `virs_reports`, Section 5.3; task 18.1; requirements
 * 11.1, 11.2, 11.3, 11.4).
 *
 * This module is the pure, injectable core of the VIRS Safety Service. It never
 * talks to Supabase directly: persistence and the client-side draft store are
 * injected as ports so production can back them with the `virs_reports` table
 * (with its RLS from task 2.2) and browser-local storage, while tests use
 * deterministic in-memory ports.
 *
 * Field names mirror the `virs_reports` schema (design 5.1): `incident_category`,
 * `narrative`, `access_control`, `submitted_at`, `schema_version`. Bounds match
 * the schema CHECK: a narrative is 1..10,000 characters.
 *
 * Requirement mapping:
 *   - 11.1 — {@link submitVirsReport} persists a VALID report (category,
 *     1..10,000 char narrative, timestamp, access-control attributes defaulting
 *     to {@link DEFAULT_ACCESS_CONTROL}) and returns a confirmation. The
 *     3-second bound is modeled as the documented {@link VIRS_PERSIST_DEADLINE_MS}.
 *   - 11.2 — {@link validateVirsSubmission} rejects a missing category, an empty
 *     narrative, or an over-length (>10,000 char) narrative with a FIELD-SPECIFIC
 *     validation error, and ECHOES BACK the entered narrative so the reporter
 *     never loses their text.
 *   - 11.3 — {@link canRetrieveNarrative} / {@link retrieveVirsNarrative} return
 *     the narrative ONLY to the safety-reviewer role; {@link toPublicProjection}
 *     produces a public-safe projection that NEVER includes the narrative, so it
 *     is never exposed on public/aggregate routes.
 *   - 11.4 — on a persistence/service failure {@link submitVirsReport} preserves
 *     a LOCAL DRAFT (retained >= {@link DRAFT_MIN_RETENTION_MS}, i.e. 24 hours,
 *     never publicly exposed) and returns a NOT_SAVED status so the reporter can
 *     retry without losing the narrative.
 */

import type { Timestamp, Uuid } from "@virtualhems/contracts";

// --- Bounds and constants (schema-aligned) ----------------------------------

/** Minimum narrative length (schema CHECK char_length(narrative) >= 1). */
export const NARRATIVE_MIN_LENGTH = 1;

/** Maximum narrative length (schema CHECK char_length(narrative) <= 10000). */
export const NARRATIVE_MAX_LENGTH = 10_000;

/**
 * The req-11.1 bound: a valid report must be persisted within 3 seconds and a
 * confirmation returned. Modeled as an explicit deadline so a caller wiring an
 * async store can race the persistence against it and, on a breach, fall through
 * to the req-11.4 local-draft path (fail-safe: the reporter's text is preserved).
 */
export const VIRS_PERSIST_DEADLINE_MS = 3_000;

/**
 * The req-11.4 bound: a local draft must be preserved for at least 24 hours on a
 * service/network failure so the reporter can retry without losing their text.
 */
export const DRAFT_MIN_RETENTION_MS = 24 * 60 * 60 * 1_000;

/**
 * Default access-control attribute for a persisted report, matching the schema
 * default `access_control 'SAFETY_REVIEWER'`. Retrieval of the narrative is
 * restricted to this scope (req 11.3).
 */
export const DEFAULT_ACCESS_CONTROL = "SAFETY_REVIEWER" as const;

/**
 * The role/scope permitted to retrieve a VIRS narrative (req 11.3), matching the
 * `has_safety_scope()` RLS predicate (task 2.2). This is the ONLY role that may
 * read the narrative through {@link retrieveVirsNarrative}.
 */
export const SAFETY_REVIEWER_ROLE = "SAFETY_REVIEWER" as const;

export type SafetyReviewerRole = typeof SAFETY_REVIEWER_ROLE;

/** The categories a VIRS report may be filed under (design 5.1 `incident_category`). */
export const VIRS_INCIDENT_CATEGORIES = [
  "NEAR_MISS",
  "HAZARD",
  "PROCEDURE",
  "EQUIPMENT",
  "CREW_RESOURCE",
  "OTHER",
] as const;

export type VirsIncidentCategory = (typeof VIRS_INCIDENT_CATEGORIES)[number];

// --- Validation (req 11.2) --------------------------------------------------

/** Which field failed validation (req 11.2 — field-specific errors). */
export type VirsFieldErrorField = "incident_category" | "narrative";

/** Machine-readable validation error codes (req 11.2). */
export type VirsValidationErrorCode =
  /** No incident category was provided. */
  | "CATEGORY_REQUIRED"
  /** The provided category is not one of {@link VIRS_INCIDENT_CATEGORIES}. */
  | "CATEGORY_UNKNOWN"
  /** The narrative was empty (after trimming) — below the 1-char minimum. */
  | "NARRATIVE_EMPTY"
  /** The narrative exceeded {@link NARRATIVE_MAX_LENGTH}. */
  | "NARRATIVE_TOO_LONG";

/** A single field-specific validation error (req 11.2). */
export interface VirsFieldError {
  field: VirsFieldErrorField;
  code: VirsValidationErrorCode;
  message: string;
}

/** The raw submission input a reporter provides. */
export interface VirsSubmissionInput {
  /** The incident category (design 5.1 `incident_category`). Required (req 11.2). */
  incident_category?: string | null;
  /** The free-text narrative (design 5.1 `narrative`), 1..10,000 chars (req 11.2). */
  narrative?: string | null;
  /** Optional mission association (design 5.1 `mission_id`). */
  mission_id?: Uuid | null;
}

/** A validated, normalized submission ready to persist. */
export interface ValidVirsSubmission {
  incident_category: string;
  narrative: string;
  mission_id?: Uuid | null;
}

/** Successful validation (req 11.2). */
export interface VirsValidationSuccess {
  valid: true;
  submission: ValidVirsSubmission;
}

/**
 * Failed validation (req 11.2). Carries the field-specific errors AND echoes
 * back the narrative the reporter entered so the UI can re-display it and the
 * reporter never loses their text.
 */
export interface VirsValidationFailure {
  valid: false;
  errors: VirsFieldError[];
  /** The narrative exactly as entered, retained for re-display (req 11.2). */
  retainedNarrative: string;
}

export type VirsValidationResult = VirsValidationSuccess | VirsValidationFailure;

function fieldError(
  field: VirsFieldErrorField,
  code: VirsValidationErrorCode,
  message: string,
): VirsFieldError {
  return { field, code, message };
}

/**
 * Pure validation of a VIRS submission (req 11.2).
 *
 * Checks, in order per field:
 *   - `incident_category` must be present (non-empty after trimming) and one of
 *     {@link VIRS_INCIDENT_CATEGORIES}.
 *   - `narrative` must be non-empty (>= 1 char after trimming) and at most
 *     {@link NARRATIVE_MAX_LENGTH} characters.
 *
 * On ANY failure the result is a {@link VirsValidationFailure} that names every
 * failed field AND echoes back the entered narrative (`retainedNarrative`) so
 * the reporter does not lose their text. The retained narrative is the raw input
 * (never trimmed/truncated) so re-display is faithful.
 */
export function validateVirsSubmission(
  input: VirsSubmissionInput,
): VirsValidationResult {
  const errors: VirsFieldError[] = [];

  const rawNarrative = typeof input.narrative === "string" ? input.narrative : "";
  const rawCategory = typeof input.incident_category === "string" ? input.incident_category : "";
  const category = rawCategory.trim();

  // Category (req 11.2): present + known.
  if (category === "") {
    errors.push(
      fieldError("incident_category", "CATEGORY_REQUIRED", "an incident category is required"),
    );
  } else if (!(VIRS_INCIDENT_CATEGORIES as readonly string[]).includes(category)) {
    errors.push(
      fieldError(
        "incident_category",
        "CATEGORY_UNKNOWN",
        `incident category "${category}" is not a recognized VIRS category`,
      ),
    );
  }

  // Narrative (req 11.2): non-empty + within the 10,000-char bound.
  const trimmedNarrative = rawNarrative.trim();
  if (trimmedNarrative.length < NARRATIVE_MIN_LENGTH) {
    errors.push(
      fieldError("narrative", "NARRATIVE_EMPTY", "the narrative must not be empty"),
    );
  } else if (rawNarrative.length > NARRATIVE_MAX_LENGTH) {
    errors.push(
      fieldError(
        "narrative",
        "NARRATIVE_TOO_LONG",
        `the narrative must be at most ${NARRATIVE_MAX_LENGTH} characters (was ${rawNarrative.length})`,
      ),
    );
  }

  if (errors.length > 0) {
    // Echo the entered narrative back verbatim so the reporter never loses it.
    return { valid: false, errors, retainedNarrative: rawNarrative };
  }

  return {
    valid: true,
    submission: {
      incident_category: category,
      narrative: rawNarrative,
      mission_id: input.mission_id ?? null,
    },
  };
}

// --- Persistence port + submission flow (req 11.1, 11.4) --------------------

/** The record fields persisted for a VIRS report (design 5.1 `virs_reports`). */
export interface PersistVirsInput {
  reporter_id?: Uuid | null;
  incident_category: string;
  narrative: string;
  mission_id?: Uuid | null;
  /** Access-control attribute; defaults to {@link DEFAULT_ACCESS_CONTROL} (req 11.1). */
  access_control: string;
  /** When the reporter submitted (design 5.1 `submitted_at`, req 11.1). */
  submitted_at: Timestamp;
  /** Contract schema version (design 5.1 `schema_version`). */
  schema_version: string;
}

/** A persisted report as returned by the store (design 5.1 `virs_reports`). */
export interface PersistedVirsReport extends PersistVirsInput {
  id: Uuid;
  is_redacted: boolean;
  /** When the cloud received/stored it (design 5.1 `received_at`). */
  received_at: Timestamp;
}

/**
 * Injectable persistence port for VIRS reports (backed server-side by the
 * `virs_reports` table with its RLS from task 2.2). Signals a service/network
 * failure by THROWING/REJECTING, which triggers the req-11.4 local-draft path.
 */
export interface VirsStorePort {
  persist(input: PersistVirsInput): PersistedVirsReport | Promise<PersistedVirsReport>;
}

/** A local (client-side) draft record preserved on a service failure (req 11.4). */
export interface VirsLocalDraft {
  incident_category: string;
  narrative: string;
  mission_id?: Uuid | null;
  /** When the draft was created. */
  createdAt: Timestamp;
  /**
   * Earliest instant the draft may be purged. Guaranteed to be at least
   * {@link DRAFT_MIN_RETENTION_MS} (24h) after {@link createdAt} (req 11.4).
   */
  expiresAt: Timestamp;
}

/**
 * Injectable local-draft store (req 11.4). In production this is a client-side
 * local store (e.g. browser localStorage/IndexedDB) that is NEVER a public
 * route; in tests it is in-memory. It must not expose drafts publicly.
 */
export interface VirsDraftStorePort {
  save(draft: VirsLocalDraft): void | Promise<void>;
}

/** The submission outcome status (req 11.1 / 11.4). */
export type VirsSubmissionStatus =
  /** The report was validated and persisted; a confirmation is returned (req 11.1). */
  | "SAVED"
  /** Validation failed; nothing was persisted (req 11.2). */
  | "VALIDATION_ERROR"
  /** Persistence failed; a local draft was preserved instead (req 11.4). */
  | "NOT_SAVED";

/** Confirmation returned on a successful persist (req 11.1). */
export interface VirsSubmissionConfirmation {
  status: "SAVED";
  report: PersistedVirsReport;
  /** Human-readable confirmation of receipt (req 11.1). */
  message: string;
}

/** Result when validation failed (req 11.2). */
export interface VirsSubmissionValidationError {
  status: "VALIDATION_ERROR";
  errors: VirsFieldError[];
  retainedNarrative: string;
}

/** Result when persistence failed and a local draft was preserved (req 11.4). */
export interface VirsSubmissionNotSaved {
  status: "NOT_SAVED";
  /** The local draft that was preserved so the reporter can retry (req 11.4). */
  draft: VirsLocalDraft;
  /** Human-readable not-saved status (req 11.4). */
  message: string;
  /** The underlying store failure, for diagnostics (never publicly exposed). */
  cause?: unknown;
}

export type VirsSubmissionResult =
  | VirsSubmissionConfirmation
  | VirsSubmissionValidationError
  | VirsSubmissionNotSaved;

/** Injectable dependencies for {@link submitVirsReport}. */
export interface SubmitVirsDependencies {
  /** The persistence port (backed by `virs_reports` in production). */
  store: VirsStorePort;
  /** The client-side local-draft store used on a persistence failure (req 11.4). */
  draftStore: VirsDraftStorePort;
  /** Returns "now" for timestamps. Injectable for deterministic tests. */
  now?: () => Date;
  /** The contract schema version to stamp (design 5.1 `schema_version`). */
  schemaVersion: string;
  /** The authenticated reporter's identifier, attributed to the report. */
  reporterId?: Uuid | null;
  /** The access-control attribute; defaults to {@link DEFAULT_ACCESS_CONTROL}. */
  accessControl?: string;
}

/**
 * Submit a VIRS report (req 11.1, 11.2, 11.4).
 *
 * Flow:
 *   1. VALIDATE (req 11.2). On failure, return VALIDATION_ERROR carrying the
 *      field-specific errors and the retained narrative; persist NOTHING.
 *   2. On a valid submission, PERSIST (category, narrative, timestamp,
 *      access-control attributes defaulting to {@link DEFAULT_ACCESS_CONTROL})
 *      and return a SAVED confirmation (req 11.1). The 3-second bound is the
 *      documented {@link VIRS_PERSIST_DEADLINE_MS}; a caller may race the store
 *      against it and surface a breach as a store failure.
 *   3. If persistence FAILS (the store throws/rejects — a service/network
 *      failure or a deadline breach), preserve a LOCAL DRAFT retained for at
 *      least {@link DRAFT_MIN_RETENTION_MS} (24h) that is NOT publicly exposed,
 *      and return NOT_SAVED so the reporter can retry without losing their text
 *      (req 11.4).
 */
export async function submitVirsReport(
  input: VirsSubmissionInput,
  deps: SubmitVirsDependencies,
): Promise<VirsSubmissionResult> {
  const validation = validateVirsSubmission(input);
  if (!validation.valid) {
    return {
      status: "VALIDATION_ERROR",
      errors: validation.errors,
      retainedNarrative: validation.retainedNarrative,
    };
  }

  const now = (deps.now ?? (() => new Date()))();
  const submittedAt = now.toISOString();
  const accessControl = deps.accessControl ?? DEFAULT_ACCESS_CONTROL;
  const { submission } = validation;

  try {
    const report = await deps.store.persist({
      reporter_id: deps.reporterId ?? null,
      incident_category: submission.incident_category,
      narrative: submission.narrative,
      mission_id: submission.mission_id ?? null,
      access_control: accessControl,
      submitted_at: submittedAt,
      schema_version: deps.schemaVersion,
    });
    return {
      status: "SAVED",
      report,
      message: "your safety report was received",
    };
  } catch (cause) {
    // req 11.4: preserve a local draft (>= 24h retention, never public) and
    // report a not-saved status so the reporter can retry.
    const draft = buildLocalDraft(submission, now);
    await deps.draftStore.save(draft);
    return {
      status: "NOT_SAVED",
      draft,
      message:
        "your report could not be saved right now and was kept as a local draft — please retry",
      cause,
    };
  }
}

/**
 * Build a local draft record retained for at least {@link DRAFT_MIN_RETENTION_MS}
 * (24h) from `now` (req 11.4). The draft retains the narrative verbatim so the
 * reporter can retry; it is never included in any public projection.
 */
export function buildLocalDraft(
  submission: ValidVirsSubmission,
  now: Date,
): VirsLocalDraft {
  return {
    incident_category: submission.incident_category,
    narrative: submission.narrative,
    mission_id: submission.mission_id ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_MIN_RETENTION_MS).toISOString(),
  };
}

// --- Access control + public projection (req 11.3) --------------------------

/** The role context of a viewer requesting narrative retrieval (req 11.3). */
export interface VirsViewerContext {
  /** The viewer's authenticated role/scope. */
  role?: string | null;
  /** Whether the request arrives on a public (unauthenticated) route (req 11.3). */
  isPublicRoute?: boolean;
}

/**
 * Whether `viewer` may retrieve a VIRS narrative (req 11.3). Only the
 * safety-reviewer role may, and NEVER on a public route. This mirrors the
 * `has_safety_scope()` RLS predicate (task 2.2) at the application layer.
 */
export function canRetrieveNarrative(viewer: VirsViewerContext): boolean {
  if (viewer.isPublicRoute === true) {
    return false;
  }
  return viewer.role === SAFETY_REVIEWER_ROLE;
}

/** Denial reason when narrative retrieval is refused (req 11.3). */
export type NarrativeAccessDenialReason =
  /** The request was on a public/unauthenticated route. */
  | "PUBLIC_ROUTE"
  /** The viewer is not a safety reviewer. */
  | "NOT_SAFETY_REVIEWER";

/** Successful narrative retrieval (req 11.3). */
export interface NarrativeRetrievalGranted {
  granted: true;
  narrative: string;
}

/** Denied narrative retrieval — the narrative is withheld (req 11.3). */
export interface NarrativeRetrievalDenied {
  granted: false;
  reason: NarrativeAccessDenialReason;
  message: string;
}

export type NarrativeRetrievalResult =
  | NarrativeRetrievalGranted
  | NarrativeRetrievalDenied;

/**
 * Retrieve a report's narrative, gated by the safety-reviewer role (req 11.3).
 *
 * Returns the narrative ONLY when {@link canRetrieveNarrative} allows it (a
 * safety reviewer on a non-public route). Otherwise the narrative is withheld
 * and a typed denial is returned — the caller cannot accidentally leak it.
 */
export function retrieveVirsNarrative(
  report: Pick<PersistedVirsReport, "narrative">,
  viewer: VirsViewerContext,
): NarrativeRetrievalResult {
  if (viewer.isPublicRoute === true) {
    return {
      granted: false,
      reason: "PUBLIC_ROUTE",
      message: "VIRS narratives are never exposed on public routes",
    };
  }
  if (viewer.role !== SAFETY_REVIEWER_ROLE) {
    return {
      granted: false,
      reason: "NOT_SAFETY_REVIEWER",
      message: "only the safety-reviewer role may retrieve a VIRS narrative",
    };
  }
  return { granted: true, narrative: report.narrative };
}

/**
 * A public-safe / de-identified projection of a VIRS report (req 11.3). It
 * carries only non-sensitive metadata and DELIBERATELY omits the narrative and
 * the reporter identity, so it can never expose the narrative on a public or
 * aggregate route. The `hasNarrative` marker signals a narrative exists without
 * revealing it.
 */
export interface VirsPublicProjection {
  id: Uuid;
  incident_category: string;
  is_redacted: boolean;
  submitted_at: Timestamp;
  /** True iff a narrative exists — its content is never included (req 11.3). */
  hasNarrative: boolean;
}

/**
 * Project a persisted report to its public-safe form (req 11.3). The narrative
 * and reporter identity are NEVER included — only aggregate/de-identified
 * metadata — so public routes can surface report existence/category without
 * leaking the narrative.
 */
export function toPublicProjection(report: PersistedVirsReport): VirsPublicProjection {
  return {
    id: report.id,
    incident_category: report.incident_category,
    is_redacted: report.is_redacted,
    submitted_at: report.submitted_at,
    hasNarrative: report.narrative.length > 0,
  };
}

// --- In-memory reference ports (tests / local wiring) -----------------------

/** An in-memory {@link VirsStorePort} that records every persisted report. */
export class InMemoryVirsStore implements VirsStorePort {
  private readonly reports: PersistedVirsReport[] = [];
  private counter = 0;

  persist(input: PersistVirsInput): PersistedVirsReport {
    this.counter += 1;
    // Deterministic synthetic UUIDs for tests, derived from insertion order.
    const id = `00000000-0000-0000-0000-${String(this.counter).padStart(12, "0")}` as Uuid;
    const report: PersistedVirsReport = {
      ...input,
      id,
      is_redacted: false,
      received_at: input.submitted_at,
    };
    this.reports.push(report);
    return report;
  }

  /** All persisted reports in insertion order (a defensive copy). */
  all(): PersistedVirsReport[] {
    return this.reports.map((r) => ({ ...r }));
  }

  get size(): number {
    return this.reports.length;
  }
}

/**
 * A {@link VirsStorePort} that ALWAYS fails, for exercising the req-11.4
 * local-draft path. Every {@link persist} throws.
 */
export class FailingVirsStore implements VirsStorePort {
  constructor(private readonly reason = "virs store unavailable") {}

  persist(): never {
    throw new Error(this.reason);
  }
}

/**
 * An in-memory {@link VirsDraftStorePort} modeling the client-side local-draft
 * store (req 11.4). Drafts are held in memory only and never exposed publicly.
 */
export class InMemoryVirsDraftStore implements VirsDraftStorePort {
  private readonly drafts: VirsLocalDraft[] = [];

  save(draft: VirsLocalDraft): void {
    this.drafts.push({ ...draft });
  }

  /** All saved drafts (a defensive copy). */
  all(): VirsLocalDraft[] {
    return this.drafts.map((d) => ({ ...d }));
  }

  get size(): number {
    return this.drafts.length;
  }
}
