-- Virtual HEMS — PostGIS spatial index integration test  (task 2.4)
-- ===========================================================================
-- Requirement under test:
--   5.6 — Regional base/hospital/helipad geometry is GEOGRAPHY(POINT, 4326) with
--         GIST indexes, so the Recommendation_Service can run indexed PostGIS
--         proximity / radial / elevation queries. Verified against the seeded
--         fixtures (PS78 = UPMC Presbyterian, KAXQ = Clarion County Airport).
--
-- These queries are spatial-correctness checks, not RLS checks, so they run as
-- the bootstrap superuser against the seeded reference tables. Assertions use the
-- same fail-fast RAISE EXCEPTION style; reaching the final NOTICE means all passed.
-- ===========================================================================

\set ON_ERROR_STOP on
\timing off
begin;

-- =========================================================================
-- Sanity: the named fixtures were seeded.
-- =========================================================================
do $$
declare ps78 integer; kaxq integer;
begin
  select count(*) into ps78 from hospitals  where faa_id = 'PS78';
  select count(*) into kaxq from hems_bases where faa_id = 'KAXQ';
  if ps78 < 1 then
    raise exception 'SPATIAL SETUP FAILED: PS78 (UPMC Presbyterian) not seeded';
  end if;
  if kaxq < 1 then
    raise exception 'SPATIAL SETUP FAILED: KAXQ (Clarion County Airport) not seeded';
  end if;
end;
$$;

-- =========================================================================
-- PROXIMITY (5.6): nearest hospital to the PS78 coordinates.
--   Anchor on the PS78 point and order every OTHER hospital by geography
--   distance. UPMC Presbyterian STEMI Cath Hub (PS79) is seeded at essentially
--   the same rooftop (~-79.9602, 40.4420) and must be the nearest neighbor.
--   ST_Distance on geography returns meters.
-- =========================================================================
do $$
declare nearest_faa text; nearest_m double precision; anchor geography;
begin
  select coordinates into anchor from hospitals where faa_id = 'PS78' limit 1;

  select h.faa_id, st_distance(h.coordinates, anchor)
    into nearest_faa, nearest_m
    from hospitals h
   where h.faa_id <> 'PS78'
   order by h.coordinates <-> anchor   -- KNN operator, GIST-accelerated
   limit 1;

  raise notice 'PROXIMITY: nearest hospital to PS78 = % at % m', nearest_faa, round(nearest_m::numeric, 1);

  if nearest_faa <> 'PS79' then
    raise exception 'PROXIMITY FAILED (5.6): nearest to PS78 = %, expected PS79 (co-located cath hub)', nearest_faa;
  end if;
  -- PS79 sits within a few hundred meters of PS78.
  if nearest_m > 500 then
    raise exception 'PROXIMITY FAILED (5.6): nearest distance % m unexpectedly large (> 500 m)', nearest_m;
  end if;
end;
$$;

-- =========================================================================
-- PROXIMITY cross-table (5.6): nearest HEMS base to the PS78 rooftop.
--   Of the seeded bases, KAGC (Allegheny County Airport HQ, ~-79.9302/40.3544)
--   is the closest to downtown Pittsburgh's PS78 and must rank first.
-- =========================================================================
do $$
declare nearest_base text; anchor geography;
begin
  select coordinates into anchor from hospitals where faa_id = 'PS78' limit 1;

  select b.faa_id
    into nearest_base
    from hems_bases b
   order by b.coordinates <-> anchor
   limit 1;

  raise notice 'PROXIMITY: nearest HEMS base to PS78 = %', nearest_base;

  if nearest_base <> 'KAGC' then
    raise exception 'PROXIMITY FAILED (5.6): nearest base to PS78 = %, expected KAGC', nearest_base;
  end if;
end;
$$;

-- =========================================================================
-- RADIAL (5.6): ST_DWithin — HEMS bases within a radius of KAXQ.
--   KAXQ (Clarion County Airport, ~-79.4422/41.2261) and AHN's Clarion
--   Hospital base 91PA (~-79.3208/41.1925) are close neighbors (~11 km apart).
--   Within a 20 km radius we expect at least KAXQ itself and 91PA; the distant
--   Pittsburgh-area bases (e.g. KAGC ~100 km away) must be EXCLUDED.
-- =========================================================================
do $$
declare within_count integer; has_kaxq integer; has_91pa integer; has_kagc integer;
        anchor geography;
begin
  select coordinates into anchor from hems_bases where faa_id = 'KAXQ' limit 1;

  select count(*) into within_count
    from hems_bases b
   where st_dwithin(b.coordinates, anchor, 20000);  -- 20 km, meters

  select count(*) into has_kaxq from hems_bases b
   where b.faa_id = 'KAXQ' and st_dwithin(b.coordinates, anchor, 20000);
  select count(*) into has_91pa from hems_bases b
   where b.faa_id = '91PA' and st_dwithin(b.coordinates, anchor, 20000);
  select count(*) into has_kagc from hems_bases b
   where b.faa_id = 'KAGC' and st_dwithin(b.coordinates, anchor, 20000);

  raise notice 'RADIAL: % bases within 20 km of KAXQ (kaxq=% 91pa=% kagc=%)',
    within_count, has_kaxq, has_91pa, has_kagc;

  if has_kaxq <> 1 then
    raise exception 'RADIAL FAILED (5.6): KAXQ not within its own 20 km radius';
  end if;
  if has_91pa <> 1 then
    raise exception 'RADIAL FAILED (5.6): expected Clarion base 91PA within 20 km of KAXQ';
  end if;
  if has_kagc <> 0 then
    raise exception 'RADIAL FAILED (5.6): distant base KAGC unexpectedly within 20 km of KAXQ';
  end if;
end;
$$;

-- =========================================================================
-- RADIAL bounding (5.6): a tight 100 m radius around KAXQ matches only KAXQ.
-- =========================================================================
do $$
declare c integer; anchor geography;
begin
  select coordinates into anchor from hems_bases where faa_id = 'KAXQ' limit 1;
  select count(*) into c from hems_bases b
   where st_dwithin(b.coordinates, anchor, 100);   -- 100 m
  if c <> 1 then
    raise exception 'RADIAL FAILED (5.6): 100 m radius around KAXQ matched % bases, expected exactly 1', c;
  end if;
end;
$$;

-- =========================================================================
-- ELEVATION (5.6): elevation ordering over the base network.
--   KAXQ (1457 ft) must rank above the low-lying Allegheny County / river-valley
--   bases such as KVVS (1264 ft) and KFWQ (1228 ft). Assert KAXQ is strictly
--   higher than KFWQ and that descending elevation ordering is monotonic.
-- =========================================================================
do $$
declare kaxq_elev numeric; kfwq_elev numeric; prev numeric; cur numeric; r record;
begin
  select elevation_ft into kaxq_elev from hems_bases where faa_id = 'KAXQ';
  select elevation_ft into kfwq_elev from hems_bases where faa_id = 'KFWQ';

  if kaxq_elev <= kfwq_elev then
    raise exception 'ELEVATION FAILED (5.6): KAXQ (% ft) not above KFWQ (% ft)', kaxq_elev, kfwq_elev;
  end if;

  -- Descending elevation order must be monotonic non-increasing.
  prev := null;
  for r in select faa_id, elevation_ft from hems_bases order by elevation_ft desc loop
    cur := r.elevation_ft;
    if prev is not null and cur > prev then
      raise exception 'ELEVATION FAILED (5.6): ordering not monotonic (% ft after % ft at %)',
        cur, prev, r.faa_id;
    end if;
    prev := cur;
  end loop;

  raise notice 'ELEVATION: KAXQ=% ft, KFWQ=% ft, descending order monotonic', kaxq_elev, kfwq_elev;
end;
$$;

-- =========================================================================
-- ELEVATION combined with distance (5.6): among hospitals within 60 km of PS78,
-- return them ordered by helipad elevation descending — a representative
-- "radial + elevation" query the Recommendation_Service performs.
-- =========================================================================
do $$
declare top_faa text; anchor geography;
begin
  select coordinates into anchor from hospitals where faa_id = 'PS78' limit 1;
  select h.faa_id into top_faa
    from hospitals h
   where st_dwithin(h.coordinates, anchor, 60000)
     and h.helipad_elevation_ft is not null
   order by h.helipad_elevation_ft desc, h.faa_id asc
   limit 1;

  if top_faa is null then
    raise exception 'ELEVATION+RADIAL FAILED (5.6): no hospital with helipad elevation within 60 km of PS78';
  end if;
  raise notice 'ELEVATION+RADIAL: highest helipad within 60 km of PS78 = %', top_faa;
end;
$$;

-- =========================================================================
-- INDEX PRESENCE (5.6): the GIST spatial indexes the design mandates exist.
-- =========================================================================
do $$
declare missing text;
begin
  select string_agg(needed, ', ') into missing
  from (values
    ('hems_bases_coordinates_gist'),
    ('hospitals_coordinates_gist'),
    ('flight_telemetry_position_gist'),
    ('missions_scene_coordinates_gist')
  ) as v(needed)
  where not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = v.needed
  );
  if missing is not null then
    raise exception 'INDEX FAILED (5.6): missing GIST spatial indexes: %', missing;
  end if;
end;
$$;

do $$
begin
  raise notice '================================================';
  raise notice 'SPATIAL INTEGRATION TESTS PASSED (req 5.6)';
  raise notice '================================================';
end;
$$;

rollback;
