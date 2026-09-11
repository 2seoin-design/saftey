-- Supabase SQL 초기화 스크립트
-- 실행: Supabase 대시보드 SQL Editor 또는 `supabase db execute -f backend/data/schema.sql`

create extension if not exists postgis;

-- ============================================================
-- 1. safety_facilities: 공공데이터(CCTV/비상벨/보안등) 통합 저장
-- ============================================================
create table if not exists safety_facilities (
  id bigint generated always as identity primary key,
  facility_type text not null check (facility_type in ('CCTV', 'BELL', 'LIGHT')),
  lat double precision not null,
  lng double precision not null,
  location geography(Point, 4326) not null,
  address text,
  install_agency text,
  created_at timestamptz not null default now(),
  unique (facility_type, lat, lng)
);

create index if not exists safety_facilities_location_gist
  on safety_facilities using gist (location);

alter table safety_facilities enable row level security;

create policy "safety_facilities_public_read"
  on safety_facilities for select
  using (true);
-- 쓰기(insert/update)는 정책을 두지 않음: dataIngestion.js는 service role 키로 RLS를 우회함

-- ============================================================
-- 2. reports: 실시간 사용자 제보 (status/expires_at 기반 소멸)
--    실제 운영 중인 구조를 그대로 문서화함 (id는 uuid, upvotes/status 포함)
-- ============================================================
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  user_id uuid references auth.users(id) on delete cascade,
  report_type varchar not null,
  description text,
  upvotes integer default 1,
  status varchar default 'ACTIVE',
  location geography(Point, 4326) not null,
  expires_at timestamptz default (now() + interval '3 hours')
);

create index if not exists reports_location_gist on reports using gist (location);
create index if not exists reports_expires_at_idx on reports (expires_at);

alter table reports enable row level security;

drop policy if exists "Anyone can view active reports" on reports;
create policy "Anyone can view active reports"
  on reports for select
  using (status = 'ACTIVE' and expires_at > now());

drop policy if exists "Anyone can create reports" on reports;
create policy "Anyone can create reports"
  on reports for insert
  with check (true);

-- 지도 위 실시간 마커 갱신(subscribeToRealtimeReports)을 위해 Realtime publication에 추가
alter publication supabase_realtime add table reports;

-- TTL(3시간): pg_cron 확장이 활성화되어 있으면 5분마다 만료 제보를 정리.
-- (Supabase 대시보드 > Database > Extensions에서 pg_cron 활성화 필요)
create extension if not exists pg_cron;

create or replace function delete_expired_reports()
returns void
language sql
as $$
  delete from reports where created_at < now() - interval '3 hours';
$$;

select cron.schedule(
  'delete-expired-reports',
  '*/5 * * * *',
  'select delete_expired_reports();'
)
where not exists (
  select 1 from cron.job where jobname = 'delete-expired-reports'
);

-- ============================================================
-- 3. RPC: 반경 N미터 내 안심 시설 조회
-- ============================================================
create or replace function get_nearby_safety_facilities(
  user_lat double precision,
  user_lng double precision,
  radius_meters double precision default 500
)
returns table (
  id bigint,
  facility_type text,
  lat double precision,
  lng double precision,
  distance_m double precision
)
language sql
stable
as $$
  select
    f.id,
    f.facility_type,
    f.lat,
    f.lng,
    ST_Distance(f.location, ST_MakePoint(user_lng, user_lat)::geography) as distance_m
  from safety_facilities f
  where ST_DWithin(f.location, ST_MakePoint(user_lng, user_lat)::geography, radius_meters)
  order by distance_m;
$$;

-- ============================================================
-- 4. RPC: 반경 N미터 내 실시간 제보 조회 (status=ACTIVE, 만료 전 건만)
-- ============================================================
create or replace function get_nearby_reports(
  user_lat double precision,
  user_lng double precision,
  radius_meters double precision default 500
)
returns table (
  id uuid,
  report_type varchar,
  description text,
  lat double precision,
  lng double precision,
  upvotes integer,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    r.id,
    r.report_type,
    r.description,
    ST_Y(r.location::geometry) as lat,
    ST_X(r.location::geometry) as lng,
    r.upvotes,
    r.created_at
  from public.reports r
  where ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_meters)
    and r.status = 'ACTIVE'
    and r.expires_at > now();
end;
$$;
