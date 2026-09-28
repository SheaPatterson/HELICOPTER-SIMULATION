/**
 * Post-authentication redirect resolution (design Section 3.5; task 17.2;
 * Requirement 10.6).
 *
 * PURE, framework-free derivation of the ONE canonical destination an
 * authenticated pilot is sent to after a successful registration or login. The
 * route wiring (`/register`, `/login`) calls {@link resolvePostAuthRedirect} on
 * success and issues a server redirect / `router.replace` to the returned
 * location, so the 3-second bound in Requirement 10.6 is met by a single fast
 * navigation rather than an interstitial.
 *
 * The destination is the operations dashboard — the command terminal — expressed
 * in the canonical `/dashboard/*` form adopted by task 17.1
 * (`CANONICAL_AUTH_PREFIX` in `../routes/canonicalize`). Keeping this pure means
 * the destination is unit-testable without a browser or a live auth session; the
 * concrete credential verification stays behind the injectable auth seam wired
 * in the auth tasks (16.x / Supabase Auth).
 *
 * Requirement mapping:
 *  - 10.6: after registration/authentication, redirect the authenticated pilot
 *          to the operations dashboard within 3 seconds. This module returns the
 *          canonical operations-dashboard destination; the route performs the
 *          redirect immediately on the success path.
 */

import { CANONICAL_AUTH_PREFIX } from "../routes/canonicalize";

/**
 * The operations-dashboard segment a newly-authenticated pilot lands on. The
 * command terminal is the operations dashboard (design Section 3.5).
 */
export const OPERATIONS_DASHBOARD_SEGMENT = "command" as const;

/**
 * The single canonical post-auth destination: the command operations dashboard
 * in canonical `/dashboard/*` form. Built from the shared
 * {@link CANONICAL_AUTH_PREFIX} so it can never drift from task 17.1's canonical
 * route form (the middleware would otherwise redirect a non-canonical target).
 */
export const OPERATIONS_DASHBOARD_PATH =
  `${CANONICAL_AUTH_PREFIX}/${OPERATIONS_DASHBOARD_SEGMENT}` as const;

/**
 * Resolve where an authenticated pilot should be sent after a successful
 * registration or login (10.6).
 *
 * The destination is always the canonical operations-dashboard path. This is a
 * total function of no external state so the redirect target is deterministic
 * and testable; the caller (the auth route/flow) invokes it on the success path
 * only, after the injectable auth seam has verified the credential.
 *
 * @returns the canonical operations-dashboard path (`/dashboard/command`).
 */
export function resolvePostAuthRedirect(): string {
  return OPERATIONS_DASHBOARD_PATH;
}
