#!/usr/bin/env bash
# Virtual HEMS — DB integration test runner  (task 2.4)
# ===========================================================================
# Boots a SINGLE short-lived postgis/postgis:15-3.4 container, applies the four
# project migrations plus the Supabase compatibility shim ONCE, loads fixtures,
# runs the RLS and spatial assertion scripts ONCE, then tears the container down.
#
# Designed for CI and local use. Bounded and idempotent:
#   * one container, explicit readiness wait with a hard cap (no infinite loops),
#   * no image pull loop (relies on the CI/base image cache; a single pull at most),
#   * always cleans up via an EXIT trap.
#
# Requirements exercised: 8.3, 8.4, 8.5, 8.6 (RLS) and 5.6 (spatial).
#
# Usage:  supabase/tests/run_db_integration_tests.sh
# Exit 0 iff every assertion in every script passed.
set -euo pipefail

# Default to the postgis image mandated by the design (PostgreSQL 15+ / PostGIS).
# Overridable via VHEMS_TEST_IMAGE so an arm64 host can use a native image
# (e.g. postgis/postgis:16-3.4-alpine) instead of emulating linux/amd64, which is
# markedly faster. Postgres 16 is a compatible superset for these migrations.
IMAGE="${VHEMS_TEST_IMAGE:-postgis/postgis:15-3.4}"
CONTAINER="vhems-db-itest-$$"
PGPASSWORD="postgres"
# Migrate into a FRESH database rather than the image's default `postgres` DB.
# The postgis image auto-installs the postgis extension into its default DB during
# initdb; running `create extension postgis` again there trips a duplicate-name
# error. A freshly created DB has no extensions, so the project migration's
# `create extension` runs cleanly — exactly as it does on a real Supabase project.
DB="vhems_test"
HOST_PORT="${VHEMS_TEST_PORT:-55433}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../migrations" && pwd)"

READY_TIMEOUT_SECS="${VHEMS_READY_TIMEOUT:-90}"   # hard cap on Postgres readiness wait

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Starting $IMAGE as $CONTAINER on port $HOST_PORT"
docker run -d --rm \
  --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD" \
  -e POSTGRES_DB="$DB" \
  -p "$HOST_PORT:5432" \
  "$IMAGE" >/dev/null

# psql runs INSIDE the container so no host psql client is required.
run_sql_file() {  # <container-path>
  docker exec -i -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f "$1"
}
run_sql() {       # <sql string>
  docker exec -i -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "$1"
}

echo "==> Waiting for Postgres init to fully complete (cap ${READY_TIMEOUT_SECS}s)"
# The postgis/postgres entrypoint starts Postgres TWICE: once bound only to a local
# socket to run initdb + extension setup, then it restarts for real network use.
# pg_isready returns true during the FIRST (bootstrap) phase, so acting then races
# the image's own `CREATE EXTENSION postgis`. We instead wait for the entrypoint's
# terminal marker ("PostgreSQL init process complete; ready for start up.") AND a
# subsequent live-connection check, so all image-side init has quiesced first.
deadline=$(( $(date +%s) + READY_TIMEOUT_SECS ))
until docker logs "$CONTAINER" 2>&1 | grep -q "PostgreSQL init process complete"; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "ERROR: Postgres init did not complete within ${READY_TIMEOUT_SECS}s" >&2
    docker logs "$CONTAINER" 2>&1 | tail -30 >&2 || true
    exit 1
  fi
  sleep 1
done
# Now wait for the real (post-restart) listener to accept connections.
until docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "ERROR: Postgres did not accept connections within ${READY_TIMEOUT_SECS}s" >&2
    docker logs "$CONTAINER" 2>&1 | tail -30 >&2 || true
    exit 1
  fi
  sleep 1
done
echo "==> Postgres ready (init complete)"

# Create the fresh migration target DB (no pre-installed extensions).
echo "==> Creating fresh database $DB"
# Each -c is its own transaction; DROP/CREATE DATABASE cannot run in a tx block.
# Clone from template0: the postgis image installs the postgis extension into
# template1, which every ordinary new DB would inherit — then the migration's
# `create extension postgis` trips a duplicate-name error. template0 is pristine,
# so the migration installs postgis itself, exactly as on a real Supabase project.
docker exec -i -e PGPASSWORD="$PGPASSWORD" "$CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "drop database if exists $DB" \
  -c "create database $DB template template0"

# Copy the shim, migrations, and tests into the container.
docker cp "$SCRIPT_DIR/." "$CONTAINER:/tests/"
docker cp "$MIGRATIONS_DIR/." "$CONTAINER:/migrations/"

# The postgis image asynchronously installs the postgis extension into the
# template/default databases during initdb; that install can race into our fresh
# DB. Drop any pre-seeded extensions so the PROJECT migration is the thing that
# installs them (mirroring a real Supabase project, where the migration owns this).
echo "==> Ensuring clean extension slate in $DB"
run_sql "drop extension if exists postgis cascade;"
run_sql "drop extension if exists pgcrypto cascade;"

echo "==> Applying Supabase compatibility shim"
run_sql_file /tests/00_supabase_shim.sql

echo "==> Applying project migrations (in order)"
for f in \
  20240101000000_extensions_and_enums.sql \
  20240101000100_core_schema.sql \
  20240101000200_rls_and_role_scoping.sql \
  20240101000300_seed_conditions_and_infrastructure.sql; do
  echo "    - $f"
  run_sql_file "/migrations/$f"
done

# Ensure API roles hold the privileges Supabase grants them by default:
#   * DML on public tables (RLS then narrows which rows are visible), and
#   * USAGE + EXECUTE on the `hems` helper schema, whose SECURITY DEFINER
#     functions are called from the RLS predicates. The `hems` schema is created
#     by migration 200 (after the shim runs), so the grant belongs here. Without
#     it, an RLS predicate raises "permission denied for schema hems" — matching
#     Supabase, where custom-schema policy helpers must be executable by anon/auth.
echo "==> Granting API-role privileges (RLS remains the gate)"
run_sql "grant select, insert, update, delete on all tables in schema public to anon, authenticated;"
run_sql "grant usage on schema hems to anon, authenticated; grant execute on all functions in schema hems to anon, authenticated;"

echo "==> Loading test fixtures"
run_sql_file /tests/01_test_fixtures.sql

echo "==> Running RLS integration tests"
run_sql_file /tests/02_rls_integration_test.sql

echo "==> Running spatial integration tests"
run_sql_file /tests/03_spatial_integration_test.sql

echo "==> ALL DB INTEGRATION TESTS PASSED"
