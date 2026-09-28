/**
 * Next.js middleware — canonical authenticated-route redirects (task 17.1;
 * Requirements 10.8, 10.8a).
 *
 * All decision logic lives in the pure `canonicalizeAuthenticatedRoute` core;
 * this thin adapter maps its result onto a Next.js response. A DISTINCT
 * alternate authenticated form (e.g. `/command`) is redirected to the canonical
 * `/dashboard/*` form (10.8); an IDENTICAL/canonical path (already under
 * `/dashboard`) is passed through with no redirect (10.8a).
 *
 * The matcher scopes middleware to the bare authenticated segments so public
 * routes, auth routes, API routes, and static assets are never touched.
 */
import { NextResponse, type NextRequest } from "next/server";
import { canonicalizeAuthenticatedRoute } from "@/lib/routes";

export function middleware(request: NextRequest): NextResponse {
  const result = canonicalizeAuthenticatedRoute(request.nextUrl.pathname);

  if (result.redirect) {
    const url = request.nextUrl.clone();
    url.pathname = result.location;
    // 308: preserve method/body and signal a permanent canonical move.
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/command",
    "/dispatcher",
    "/efb",
    "/hospitals",
    "/logbook",
    "/archive",
    "/sms-report",
  ],
};
