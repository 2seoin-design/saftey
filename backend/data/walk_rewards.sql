-- 안심 산책로 완주 리워드 SQL
-- 실행: Supabase 대시보드 SQL Editor

alter table profiles add column if not exists points integer not null default 0;

-- 하루 1회만 리워드를 받을 수 있도록 (user_id, claim_date) 유니크 제약으로 강제
create table if not exists walk_challenge_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_date date not null default current_date,
  reward_amount integer not null default 200,
  created_at timestamptz not null default now(),
  primary key (user_id, claim_date)
);

alter table walk_challenge_claims enable row level security;

drop policy if exists "Users can view own claims" on walk_challenge_claims;
create policy "Users can view own claims"
  on walk_challenge_claims for select
  using (auth.uid() = user_id);
-- insert 정책은 없음: claim_walk_reward RPC(SECURITY DEFINER)를 통해서만 기록 가능

-- ============================================================
-- RPC: 일치도 검증 통과 시 리워드 지급 시도 (원자적 - 동시 요청에도 하루 1회만 성공)
-- 반환값 true = 오늘 처음 지급됨 / false = 오늘 이미 지급받음
-- user_id를 파라미터로 받지 않고 auth.uid()로 직접 확인함 - 그렇지 않으면 클라이언트가
-- 임의의 user_id/금액을 넘겨 남의 계정에 리워드를 지급시키거나 금액을 조작할 수 있음
--
-- 이 파일의 예전 버전(claim_walk_reward(uuid, integer))을 이미 실행해둔 환경이 있다면
-- 아래 drop이 그 오버로드를 정리함 - 남겨두면 p_user_id/p_reward_amount를 조작할 수 있는
-- 취약한 버전이 계속 호출 가능한 상태로 남으므로 반드시 같이 제거해야 함.
-- ============================================================
drop function if exists public.claim_walk_reward(uuid, integer);

create or replace function public.claim_walk_reward()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  insert into walk_challenge_claims (user_id, claim_date, reward_amount)
  values (v_user_id, current_date, 200)
  on conflict (user_id, claim_date) do nothing;

  get diagnostics affected = row_count;

  if affected = 0 then
    return false;
  end if;

  update profiles set points = points + 200 where id = v_user_id;
  return true;
end;
$$;

grant execute on function public.claim_walk_reward() to authenticated;
