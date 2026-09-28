/**
 * Auth pure core (task 17.2). Framework-free post-authentication redirect
 * resolution (Requirement 10.6) plus the injectable authentication seam the
 * `/register` and `/login` routes wire to. Credential verification (Supabase
 * Auth) is deferred to the auth tasks (16.x); this module owns only the
 * destination logic and the port contract.
 */

export {
  OPERATIONS_DASHBOARD_SEGMENT,
  OPERATIONS_DASHBOARD_PATH,
  resolvePostAuthRedirect,
} from "./redirect";

export {
  buildWebAuthenticator,
  type AuthenticatedPilotIdentity,
  type AuthSuccess,
  type AuthFailure,
  type AuthResult,
  type Credentials,
  type WebAuthenticator,
} from "./seam";
