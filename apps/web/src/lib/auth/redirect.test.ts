import { describe, expect, it } from "vitest";
import {
  OPERATIONS_DASHBOARD_PATH,
  OPERATIONS_DASHBOARD_SEGMENT,
  resolvePostAuthRedirect,
} from "./redirect";
import {
  CANONICAL_AUTH_PREFIX,
  canonicalizeAuthenticatedRoute,
} from "../routes/canonicalize";

/**
 * Unit tests for the post-auth redirect destination (task 17.2;
 * Requirement 10.6). The dedicated fuller suite is task 17.3; these assert the
 * canonical destination and that it is stable and already canonical.
 */
describe("resolvePostAuthRedirect", () => {
  it("resolves to the canonical operations dashboard (/dashboard/command)", () => {
    expect(resolvePostAuthRedirect()).toBe("/dashboard/command");
    expect(resolvePostAuthRedirect()).toBe(OPERATIONS_DASHBOARD_PATH);
  });

  it("targets the command operations dashboard segment", () => {
    expect(OPERATIONS_DASHBOARD_SEGMENT).toBe("command");
    expect(OPERATIONS_DASHBOARD_PATH).toBe(
      `${CANONICAL_AUTH_PREFIX}/${OPERATIONS_DASHBOARD_SEGMENT}`,
    );
  });

  it("is a single, deterministic canonical destination", () => {
    // Called repeatedly it returns the same single destination.
    expect(resolvePostAuthRedirect()).toBe(resolvePostAuthRedirect());
  });

  it("returns a destination that is already canonical (no further redirect)", () => {
    // The middleware/canonicalizer must NOT redirect the post-auth target,
    // otherwise the pilot would take an extra hop and could miss the 3s bound.
    expect(
      canonicalizeAuthenticatedRoute(resolvePostAuthRedirect()),
    ).toEqual({ redirect: false });
  });
});
