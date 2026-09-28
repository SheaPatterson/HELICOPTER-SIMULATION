/**
 * Route pure core (task 17.1). Framework-free canonical authenticated-route
 * mapping used by the Next.js middleware (Requirements 10.8, 10.8a).
 */

export {
  CANONICAL_AUTH_PREFIX,
  AUTHENTICATED_SEGMENTS,
  canonicalizeAuthenticatedRoute,
  type AuthenticatedSegment,
  type CanonicalizeResult,
} from "./canonicalize";
