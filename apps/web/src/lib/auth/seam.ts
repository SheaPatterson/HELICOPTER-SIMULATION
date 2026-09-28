/**
 * Injectable authentication seam for the web auth routes (design Section 3.5;
 * task 17.2; Requirement 10.6).
 *
 * The `/register` and `/login` routes must verify a credential and, on success,
 * redirect the authenticated pilot to the operations dashboard within 3 seconds
 * (10.6). The CREDENTIAL VERIFICATION itself is deferred to the auth tasks
 * (16.x / Supabase Auth). To keep the redirect logic testable and the route
 * failing-closed until that lands, verification is expressed as an injectable
 * port ({@link WebAuthenticator}) rather than an inline Supabase call.
 *
 * The route wiring builds the concrete authenticator via
 * {@link buildWebAuthenticator}; until Supabase Auth is wired, that factory
 * throws a clear "not configured" error so the route never silently accepts an
 * unauthenticated session. This mirrors the telemetry route's `buildDependencies`
 * fail-closed pattern.
 */

/** The authenticated pilot identity a successful verification yields. */
export interface AuthenticatedPilotIdentity {
  /** Stable pilot identifier from the auth provider. */
  readonly pilotId: string;
}

/** A successful authentication/registration. */
export interface AuthSuccess {
  readonly ok: true;
  readonly pilot: AuthenticatedPilotIdentity;
}

/** A failed authentication/registration (bad credentials, taken email, etc.). */
export interface AuthFailure {
  readonly ok: false;
  /** Machine-readable failure reason. */
  readonly code: "INVALID_CREDENTIALS" | "REGISTRATION_REJECTED";
  /** Human-readable message safe to surface to the user. */
  readonly message: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

/** Credentials submitted to the register/login flow. */
export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Transport-agnostic authentication port. Production backs this with Supabase
 * Auth (registration + password sign-in); the pure redirect logic and the
 * routes depend only on this interface, so the destination can be unit-tested
 * without a live auth session and the provider stays swappable.
 */
export interface WebAuthenticator {
  /** Register a new pilot, returning their identity on success. */
  register(credentials: Credentials): Promise<AuthResult>;
  /** Authenticate an existing pilot, returning their identity on success. */
  login(credentials: Credentials): Promise<AuthResult>;
}

/**
 * Build the concrete web authenticator.
 *
 * Wiring Supabase Auth is the responsibility of the auth tasks (16.x). Until
 * then this throws so the auth routes fail closed instead of accepting traffic
 * against a stub. The routes catch this and surface a "not configured" state.
 */
export function buildWebAuthenticator(): WebAuthenticator {
  throw new Error(
    "web authentication is not configured yet: wire Supabase Auth " +
      "registration and password sign-in (tasks 16.x)",
  );
}
