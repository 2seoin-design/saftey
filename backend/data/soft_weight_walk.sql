-- 유동인구/가로등 소프트 가중치 산책로용 산책 기록 SQL
-- 실행: Supabase 대시보드 SQL Editor

create table if not exists soft_weight_walk_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  walked_at timestamptz not null default now(),
  target_path jsonb not null,   -- 정답 산책로(도형) 좌표 배열
  gps_path jsonb not null,      -- 사용자가 실제 걸은 GPS 좌표 배열
  match_percent numeric not null,
  points_awarded boolean not null default false
);

create index if not exists soft_weight_walk_logs_user_idx on soft_weight_walk_logs (user_id, walked_at desc);

alter table soft_weight_walk_logs enable row level security;

-- 본인 기록만 조회 가능
drop policy if exists "Users can view own walk logs" on soft_weight_walk_logs;
create policy "Users can view own walk logs"
  on soft_weight_walk_logs for select
  using (auth.uid() = user_id);

-- 본인 기록만 삭제 가능
drop policy if exists "Users can delete own walk logs" on soft_weight_walk_logs;
create policy "Users can delete own walk logs"
  on soft_weight_walk_logs for delete
  using (auth.uid() = user_id);
-- insert/update 정책은 없음: record_walk_result RPC(SECURITY DEFINER)를 통해서만 기록됨

-- ============================================================
-- RPC: 산책 결과 저장 + 85% 이상이면 +200P 원자적 지급
-- user_id는 클라이언트가 넘기지 않고 auth.uid()로 서버에서 직접 확인함
-- (클라이언트가 남의 계정에 기록을 남기거나 포인트를 조작하지 못하도록)
-- ============================================================
create or replace function public.record_walk_result(
  p_target_path jsonb,
  p_gps_path jsonb,
  p_match_percent numeric
)
-- 출력 컬럼명을 "id"로 하면 아래 update profiles ... where id = ... 의 id와 이름이
-- 겹쳐 "column reference id is ambiguous" 에러가 남 - walk_log_id로 분리함
returns table (walk_log_id uuid, points_awarded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_awarded boolean;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  v_awarded := p_match_percent >= 85;

  insert into soft_weight_walk_logs (user_id, target_path, gps_path, match_percent, points_awarded)
  values (v_user_id, p_target_path, p_gps_path, p_match_percent, v_awarded)
  returning soft_weight_walk_logs.id into v_id;

  if v_awarded then
    update profiles set points = points + 200 where id = v_user_id;
  end if;

  walk_log_id := v_id;
  points_awarded := v_awarded;
  return next;
end;
$$;

grant execute on function public.record_walk_result(jsonb, jsonb, numeric) to authenticated;
