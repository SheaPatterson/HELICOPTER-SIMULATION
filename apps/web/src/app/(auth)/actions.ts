"use server";

/**
 * Server actions for the auth surface (`/register`, `/login`) — task 17.2;
 * Requirement 10.6.
 *
 * On a SUCCESSFUL registration or login these actions perform the fast
 * post-auth navigation: they resolve the single canonical operations-dashboard
 * destination via the pure {@link resolvePostAuthRedirect} and issue a server
 * `redirect(...)` to it. A server redirect on the success path is the fast
 * (well under 3s) navigation Requirement 10.6 calls for — there is no
 * interstitial.
 *
 * Credential verification is delegated to the injectable authentication seam
 * ({@link buildWebAuthenticator}). Until Supabase Auth is wired (tasks 16.x)
 * that factory throws, so these actions surface a "not configured" message and
 * NEVER redirect an unauthenticated visitor into the operations dashboard —
 * they fail closed. All redirect-DESTINATION logic lives in the pure
 * `resolvePostAuthRedirect`, so this file only wires it.
 */

import { redirect } from "next/navigation";
import {
  buildWebAuthenticator,
  resolvePostAuthRedirect,
  type AuthResult,
  type Credentials,
  type WebAuthenticator,
} from "@/lib/auth";

/** The state returned to the client form when auth does not succeed. */
export interface AuthActionState {
  readonly error: string;
}

const NOT_CONFIGURED_MESSAGE =
  "Registration and sign-in are not available yet. Please try again later.";

function readCredentials(formData: FormData): Credentials {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

/**
 * Run an auth attempt against the seam and, on success, redirect to the
 * canonical operations dashboard (10.6). `select` picks register vs login on
 * the same authenticator so the success path — and thus the redirect
 * destination — is identical for both flows.
 *
 * NOTE: `redirect()` throws a control-flow signal Next.js handles; it is called
 * OUTSIDE the try/catch so it is never swallowed as an auth error, and the seam
 * verification result is captured first.
 */
async function attempt(
  select: (auth: WebAuthenticator) => Promise<AuthResult>,
  formData: FormData,
): Promise<AuthActionState> {
  let result: AuthResult;
  try {
    const authenticator = buildWebAuthenticator();
    result = await select(authenticator);
  } catch {
    // Seam not configured (Supabase Auth not wired) or unexpected failure:
    // fail closed, do not redirect.
    return { error: NOT_CONFIGURED_MESSAGE };
  }

  if (!result.ok) {
    return { error: result.message };
  }

  // Success: fast canonical navigation to the operations dashboard (10.6).
  redirect(resolvePostAuthRedirect());
}

/** Register server action: create the pilot account, then redirect (10.6). */
export async function registerAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return attempt((auth) => auth.register(readCredentials(formData)), formData);
}

/** Login server action: authenticate the pilot, then redirect (10.6). */
export async function loginAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return attempt((auth) => auth.login(readCredentials(formData)), formData);
}
