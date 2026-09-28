import { describe, expect, it } from "vitest";
import {
  AUTHENTICATED_SEGMENTS,
  CANONICAL_AUTH_PREFIX,
  canonicalizeAuthenticatedRoute,
  type CanonicalizeResult,
} from "./canonicalize";

/**
 * Task 17.3 — dedicated unit suite for route canonicalization
 * (Requirements 10.8, 10.8a).
 *
 * Covers the two behaviors task 17.3 calls out for the pure canonicalization
 * core:
 *  - distinct-alternate redirect: a bare `/{segment}` alternate form is
 *    redirected (308 in the middleware) to the canonical `/dashboard/{segment}`
 *    form (10.8);
 *  - identical-alternate no-redirect: a path already in the canonical
 *    `/dashboard/*` form is treated as already canonical and gets no redirect
 *    (10.8a).
 *
 * The 17.1 smoke suite (`canonicalize.test.ts`) covers the happy path; this
 * suite pins the mapping contract and the edge cases (trailing slash, nested
 * canonical paths, unknown segments, casing, empty/odd input) so a regression
 * in the redirect rule surfaces here.
 */

const CANONICAL_PATHS = AUTHENTICATED_SEGMENTS.map(
  (s) => `${CANONICAL_AUTH_PREFIX}/${s}`,
);

function expectRedirect(path: string, location: string): void {
  const result: CanonicalizeResult = canonicalizeAuthenticatedRoute(path);
  expect(result).toEqual({ redirect: true, location });
}

function expectNoRedirect(path: string): void {
  expect(canonicalizeAuthenticatedRoute(path)).toEqual({ redirect: false });
}

describe("task 17.3: canonical route mapping (10.8)", () => {
  it("redirects every documented bare alternate segment to its canonical form", () => {
    for (const segment of AUTHENTICATED_SEGMENTS) {
      expectRedirect(`/${segment}`, `${CANONICAL_AUTH_PREFIX}/${segment}`);
    }
  });

  it("maps the canonical location under the single canonical prefix", () => {
    for (const segment of AUTHENTICATED_SEGMENTS) {
      const result = canonicalizeAuthenticatedRoute(`/${segment}`);
      expect(result.redirect).toBe(true);
      if (result.redirect) {
        expect(result.location.startsWith(`${CANONICAL_AUTH_PREFIX}/`)).toBe(
          true,
        );
      }
    }
  });

  it("treats a trailing slash on a distinct alternate form as the same route", () => {
    for (const segment of AUTHENTICATED_SEGMENTS) {
      expectRedirect(`/${segment}/`, `${CANONICAL_AUTH_PREFIX}/${segment}`);
    }
  });
});

describe("task 17.3: identical/canonical paths get no redirect (10.8a)", () => {
  it("does not redirect any canonical `/dashboard/{segment}` path", () => {
    for (const canonical of CANONICAL_PATHS) {
      expectNoRedirect(canonical);
    }
  });

  it("does not redirect the bare canonical prefix or nested canonical paths", () => {
    expectNoRedirect(CANONICAL_AUTH_PREFIX);
    expectNoRedirect(`${CANONICAL_AUTH_PREFIX}/`);
    expectNoRedirect(`${CANONICAL_AUTH_PREFIX}/command/lz-brief`);
    expectNoRedirect(`${CANONICAL_AUTH_PREFIX}/hospitals/PS78`);
  });

  it("is idempotent: canonicalizing a canonical target never redirects again", () => {
    for (const segment of AUTHENTICATED_SEGMENTS) {
      const first = canonicalizeAuthenticatedRoute(`/${segment}`);
      expect(first.redirect).toBe(true);
      if (first.redirect) {
        // Feeding the redirect target back in must not redirect a second time.
        expectNoRedirect(first.location);
      }
    }
  });
});

describe("task 17.3: non-authenticated and unknown routes are untouched", () => {
  it("leaves public, auth, and unknown top-level routes untouched", () => {
    for (const path of [
      "/",
      "/about",
      "/safety",
      "/fleet",
      "/network",
      "/downloads",
      "/contact",
      "/login",
      "/register",
      "/api/public/operations",
      "/unknown-page",
    ]) {
      expectNoRedirect(path);
    }
  });

  it("does not redirect a deeper alternate path (only bare `/{segment}` maps)", () => {
    // `/command/extra` is not the documented distinct alternate form; only the
    // bare segment redirects. Deeper unknown paths are left alone.
    expectNoRedirect("/command/extra");
    expectNoRedirect("/efb/mission/42");
  });

  it("does not treat a segment substring as an authenticated segment", () => {
    expectNoRedirect("/commander");
    expectNoRedirect("/dispatchers");
    expectNoRedirect("/efbx");
  });

  it("is case-sensitive: an uppercased alternate is not the documented form", () => {
    // The documented segments are lowercase; a differently-cased path is not
    // the distinct alternate form and is left untouched.
    expectNoRedirect("/COMMAND");
    expectNoRedirect("/Efb");
  });

  it("handles empty and root-only input without redirecting", () => {
    expectNoRedirect("/");
    expectNoRedirect("");
  });
});
