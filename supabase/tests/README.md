# Database integration tests (task 2.4)

SQL-based integration tests that apply the four project migrations under
`supabase/migrations/` to a real Postgres + PostGIS instance and assert the RLS
authorization model and the PostGIS spatial queries against the seeded fixtures
(PS78 = UPMC Presbyterian, KAXQ = Clarion County Airport).

## Files

| File | Purpose |
| --- | --- |
| `00_supabase_shim.sql` | Test-harness only. Recreates the Supabase surface the migrations depend on (`anon`/`authenticated`/`service_role` roles, `auth.users`, `auth.uid()` reading `request.jwt.claims`). Never applied to a real Supabase DB. |
| `01_test_fixtures.sql` | Deterministic fixtures: two pilots + an admin (auth users + profiles), one mission owned by pilot A, one clinical snapshot, one VIRS report. |
| `02_rls_integration_test.sql` | RLS / role-scoping assertions (req 8.3, 8.4, 8.5, 8.6). |
| `03_spatial_integration_test.sql` | PostGIS proximity / radial / elevation assertions (req 5.6). |
| `run_db_integration_tests.sh` | Single-container runner: boots one PostGIS container, applies shim + migrations + fixtures once, runs both test scripts once, tears down. |

## Running

```bash
supabase/tests/run_db_integration_tests.sh
```

Exit code is `0` iff every assertion in every script passed. Each assertion
script uses `ON_ERROR_STOP` + `RAISE EXCEPTION`, so the first failure aborts with
a descriptive message and a non-zero exit.

Environment overrides:

- `VHEMS_TEST_IMAGE` — PostGIS image (default `postgis/postgis:15-3.4`, the
  design-mandated PostgreSQL 15+ / PostGIS). On an arm64 host, set
  `postgis/postgis:16-3.4-alpine` to avoid slow linux/amd64 emulation; Postgres 16
  is a compatible superset for these migrations.
- `VHEMS_TEST_PORT` — host port (default `55433`).
- `VHEMS_READY_TIMEOUT` — hard cap in seconds for the DB init/readiness wait
  (default `90`).

## How the auth context is set (matches Supabase RLS evaluation)

Each RLS case runs inside one transaction and switches identity the same way
Supabase does for a PostgREST request:

```sql
set local role authenticated;                       -- selects the policy set
set local request.jwt.claims = '{"sub":"<uuid>"}';  -- auth.uid() reads this
```

`anon` cases set the role to `anon` with no claims. `auth.uid()` (shim) and
`hems.current_user_id()` / `hems.current_role_name()` (project migration) resolve
identity from these, so the policies are exercised exactly as in production.

## Requirement traceability

| Requirement | Assertion(s) |
| --- | --- |
| **8.3** owner may mutate own rows | `02` Case 1: pilot A updates own mission → 1 row + data verified. |
| **8.5** cross-owner mutation rejected, target unchanged | `02` Case 2 (update → 0 rows + unchanged), 2b (delete → 0 rows), 2c (spoofed insert rejected by WITH CHECK). |
| **8.4** authorized role has broader scope | `02` Case 3: ADMIN updates another pilot's mission → 1 row (confirms deny is authority-based). |
| **8.6** private records never on public (anon) routes | `02` Case 4: anon sees 0 rows in `missions`/`clinical_snapshots`/`virs_reports`; 4b anon reads `hems_bases`/`hospitals`; 4c anon cannot write reference data; Case 5 non-safety pilot cannot read a VIRS narrative, `SAFETY_REVIEWER` can. |
| **5.6** indexed PostGIS proximity/radial/elevation | `03`: nearest hospital to PS78 = PS79 (~37 m); nearest base to PS78 = KAGC; `ST_DWithin` 20 km around KAXQ includes KAXQ + 91PA, excludes KAGC; 100 m radius isolates KAXQ; elevation ordering monotonic (KAXQ 1457 ft > KFWQ 1228 ft); radial+elevation combined query; GIST spatial indexes present. |

## Notes

- The migrations are authored for the Supabase managed image; `00_supabase_shim.sql`
  supplies the Supabase-specific roles/`auth` surface so the *unmodified* project
  migrations run on a stock PostGIS container.
- The runner creates a fresh database from `template0` and clears any pre-seeded
  extensions before applying migrations, so the project migration's
  `create extension postgis` runs on a clean slate — as it would on Supabase.
- The runner waits for the image's init to fully complete before acting, avoiding
  a race with the base image's own extension setup.
