/**
 * Canonical authenticated-route resolution (design Section 3.5; Section 13
 * open decision #1; task 17.1; Requirements 10.8, 10.8a).
 *
 * PURE, framework-free mapping from any requested path to the ONE canonical
 * authenticated route form. The design left the canonical form as a requirements
 * decision between `/command` and `/dashboard/command`; this module adopts
 * `/dashboard/*` as canonical (matching design Section 3.5, which already lists
 * the authenticated operations under `/dashboard/*`).
 *
 * The middleware calls {@link canonicalizeAuthenticatedRoute} and issues a
 * redirect only when the result says one is needed, so all mapping logic is here
 * and unit-testable (task 17.3 is the dedicated suite; this file carries a few
 * smoke tests).
 *
 * Requirement mapping:
 *  - 10.8: adopt one canonical form and, WHERE the alternate documented path
 *          form is DISTINCT from the canonical form, redirect the alternate to
 *          the canonical form (e.g. `/command` → `/dashboard/command`).
 *  - 10.8a: WHERE the alternate form is IDENTICAL to the canonical form (already
 *           under `/dashboard/*`), treat the request as already canonical and
 *           issue NO redirect.
 */

/** The canonical authenticated route prefix. */
export const CANONICAL_AUTH_PREFIX = "/dashboard" as const;

/**
 * The authenticated operation segments under the canonical prefix
 * (design Section 3.5). A bare alternate form `/{segment}` is a DISTINCT
 * documented path that redirects to `/dashboard/{segment}`.
 */
export const AUTHENTICATED_SEGMENTS = [
  "command",
  "dispatcher",
  "efb",
  "hospitals",
  "logbook",
  "archive",
  "sms-report",
] as const;

/** One of the authenticated operation segments. */
export type AuthenticatedSegment = (typeof AUTHENTICATED_SEGMENTS)[number];

/**
 * Result of canonicalizing a path.
 *  - `redirect: false` — the path is already canonical (or not an authenticated
 *    route at all); no redirect is issued (10.8a).
 *  - `redirect: true` — the path is a distinct alternate form; `location` is the
 *    canonical path to redirect to (10.8).
 */
export type CanonicalizeResult =
  | { readonly redirect: false }
  | { readonly redirect: true; readonly location: string };

const NO_REDIRECT: CanonicalizeResult = { redirect: false };

/**
 * Normalize a path for comparison: strip a trailing slash (except root) so
 * `/command/` and `/command` are treated alike. Query/hash are handled by the
 * caller (middleware operates on `pathname`).
 */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.replace(/\/+$/, "");
  }
  return path;
}

/**
 * Map a requested path to the canonical authenticated route form.
 *
 * A bare `/{segment}` for a known authenticated segment is the DISTINCT
 * alternate documented form and redirects to `/dashboard/{segment}` (10.8). Any
 * path already under `/dashboard` — including `/dashboard/{segment}` itself — is
 * IDENTICAL to the canonical form and yields no redirect (10.8a). All other
 * paths (public routes, auth routes, unknown paths) are left untouched.
 */
export function canonicalizeAuthenticatedRoute(
  path: string,
): CanonicalizeResult {
  const normalized = normalizePath(path);

  // Already under the canonical prefix → already canonical, no redirect (10.8a).
  if (
    normalized === CANONICAL_AUTH_PREFIX ||
    normalized.startsWith(`${CANONICAL_AUTH_PREFIX}/`)
  ) {
    return NO_REDIRECT;
  }

  // Bare `/{segment}` distinct alternate form → redirect to canonical (10.8).
  const match = /^\/([^/]+)$/.exec(normalized);
  if (match) {
    const segment = match[1];
    if ((AUTHENTICATED_SEGMENTS as readonly string[]).includes(segment)) {
      return { redirect: true, location: `${CANONICAL_AUTH_PREFIX}/${segment}` };
    }
  }

  // Public/auth/unknown route — not an authenticated alternate form.
  return NO_REDIRECT;
}
