import { describe, expect, it } from "vitest";
import {
  AUTHENTICATED_SEGMENTS,
  CANONICAL_AUTH_PREFIX,
  canonicalizeAuthenticatedRoute,
} from "./canonicalize";

/**
 * Smoke tests for canonical authenticated-route mapping (task 17.1;
 * Requirements 10.8, 10.8a). The dedicated suite is task 17.3.
 */
describe("canonicalizeAuthenticatedRoute", () => {
  it("redirects a distinct alternate form to the canonical form (10.8)", () => {
    const result = canonicalizeAuthenticatedRoute("/command");
    expect(result).toEqual({
      redirect: true,
      location: "/dashboard/command",
    });
  });

  it("does not redirect an identical/canonical path (10.8a)", () => {
    expect(canonicalizeAuthenticatedRoute("/dashboard/command")).toEqual({
      redirect: false,
    });
    expect(canonicalizeAuthenticatedRoute("/dashboard")).toEqual({
      redirect: false,
    });
  });

  it("redirects every documented alternate segment to its canonical form", () => {
    for (const segment of AUTHENTICATED_SEGMENTS) {
      expect(canonicalizeAuthenticatedRoute(`/${segment}`)).toEqual({
        redirect: true,
        location: `${CANONICAL_AUTH_PREFIX}/${segment}`,
      });
    }
  });

  it("leaves public and unknown routes untouched", () => {
    for (const path of ["/", "/about", "/downloads", "/login", "/nope"]) {
      expect(canonicalizeAuthenticatedRoute(path)).toEqual({ redirect: false });
    }
  });

  it("treats a trailing slash on the alternate form as the same route", () => {
    expect(canonicalizeAuthenticatedRoute("/command/")).toEqual({
      redirect: true,
      location: "/dashboard/command",
    });
  });
});
