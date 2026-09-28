/**
 * `POST /api/telemetry` — cloud telemetry ingestion boundary (design Section 6.1).
 *
 * This route is a thin transport adapter: it extracts the bearer credential and
 * JSON body, delegates all authentication, validation, persistence, and
 * idempotency to the pure {@link ingestTelemetry} core in `@virtualhems/cloud`,
 * and maps the discriminated result onto HTTP status codes. All ingestion logic
 * lives in the cloud package so it can be unit-tested without a live request or
 * database (tests: packages/cloud); this file only wires dependencies.
 *
 * The concrete authenticator and repository (Supabase Auth + the service-role
 * `flight_telemetry` table) are constructed here. They are intentionally
 * deferred to the auth/persistence tasks (16.x and the Supabase client wiring);
 * until then the factory throws a clear "not configured" error rather than
 * silently accepting unauthenticated traffic.
 */

import {
  ingestTelemetry,
  type IngestDependencies,
  type IngestError,
  type TelemetryIngestRequest,
} from "@virtualhems/cloud";

// Telemetry ingestion must run per-request on the server, never statically
// cached or prerendered.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Build the server-side ingestion dependencies (authenticator + repository).
 *
 * Wiring the Supabase service-role client and Supabase Auth verification is the
 * responsibility of the auth/persistence tasks. Until that lands, this throws so
 * the route fails closed instead of accepting traffic with a stub.
 */
function buildDependencies(): IngestDependencies {
  throw new Error(
    "telemetry ingestion dependencies are not configured yet: wire the " +
      "Supabase service-role repository and auth verifier (tasks 16.x / persistence)",
  );
}

/** Map a structured ingestion error to an HTTP status code. */
function statusForError(error: IngestError): number {
  switch (error.code) {
    case "UNAUTHENTICATED":
      return 401;
    case "UNSUPPORTED_ENGINE":
      return 422;
    case "VALIDATION_FAILED":
      return 400;
    default:
      return 400;
  }
}

/** Extract a bearer credential from the Authorization header, if present. */
function extractCredential(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : header;
}

export async function POST(request: Request): Promise<Response> {
  let body: TelemetryIngestRequest;
  try {
    body = (await request.json()) as TelemetryIngestRequest;
  } catch {
    return Response.json(
      { code: "VALIDATION_FAILED", message: "request body is not valid JSON" },
      { status: 400 },
    );
  }

  const credential = extractCredential(request);

  let deps: IngestDependencies;
  try {
    deps = buildDependencies();
  } catch (err) {
    return Response.json(
      {
        code: "NOT_CONFIGURED",
        message: err instanceof Error ? err.message : "ingestion not configured",
      },
      { status: 503 },
    );
  }

  const result = await ingestTelemetry(body, credential, deps);
  if (!result.ok) {
    return Response.json(result.error, { status: statusForError(result.error) });
  }

  // A duplicate is idempotent (req 2.7): acknowledge with 200 and the ack that
  // is equivalent to the original persisted frame. A newly accepted frame is 201.
  const status = result.ack.disposition === "duplicate" ? 200 : 201;
  return Response.json(result.ack, { status });
}
