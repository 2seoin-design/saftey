-- 마이페이지(포인트/제보내역/모양달성내역) 기능을 위한 스키마 확장
-- 실행: Supabase 대시보드 SQL Editor
-- 전제: backend/data/auth.sql(profiles), backend/data/schema.sql(reports),
--       backend/data/walk_rewards.sql(profiles.points, walk_challenge_claims)가 이미 적용되어 있어야 함

-- ============================================================
-- 1. reports 테이블 확장: 처리 상태 + 사진 URL
--    (기존 status/expires_at은 지도 표시용 TTL이므로 건드리지 않고,
--     "관리자 처리 여부"를 나타내는 별도 컬럼을 추가함)
-- ============================================================
alter table reports add column if not exists photo_url text;

alter table reports add column if not exists process_status text
  not null default 'PENDING' check (process_status in ('PENDING', 'DONE'));

-- 기존 "Anyone can view active reports" 정책(익명 지도 조회용)은 그대로 두고,
-- 로그인한 본인은 상태/만료 여부와 무관하게 자신의 제보 전체를 볼 수 있도록 정책 추가.
-- (permissive 정책은 OR로 합쳐지므로 기존 정책과 충돌하지 않음)
drop policy if exists "Users can view own reports" on reports;
create policy "Users can view own reports"
  on reports for select
  using (auth.uid() = user_id);

-- ============================================================
-- 2. course_completions: 산책로(모양) 완주 내역
-- ============================================================
create table if not exists course_completions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_name text not null check (course_name in ('하트', '별', '마름모', '왕관', '기하학적 물고기')),
  completed_at timestamptz not null default now(),
  reward_granted boolean not null default false
);

create index if not exists course_completions_user_completed_idx
  on course_completions (user_id, completed_at desc);

alter table course_completions enable row level security;

drop policy if exists "Users can view own course completions" on course_completions;
create policy "Users can view own course completions"
  on course_completions for select
  using (auth.uid() = user_id);
-- insert 정책은 없음: 아래 complete_course_walk RPC(SECURITY DEFINER)를 통해서만 기록 가능

-- ============================================================
-- 3. RPC: 코스 완주 처리 (하루 1회 200P 지급 + 완주 내역 기록, 원자적)
--
--    "오늘 최초 완주" 판별과 포인트 지급은 새로 만들지 않고 기존
--    claim_walk_reward RPC(backend/data/walk_rewards.sql)를 그대로 재사용함.
--    그 함수는 이미 walk_challenge_claims(user_id, claim_date) UNIQUE 제약을 이용해
--    INSERT ... ON CONFLICT DO NOTHING + ROW_COUNT 확인으로 원자적으로 판별하고 있고,
--    backend/data/patternMatchService.js의 GPS 궤적 일치도 판정 플로우에서 실제로
--    쓰이는 중이므로 같은 로직을 여기 다시 구현하면 두 군데서 따로 수정해야 하는
--    불일치 위험이 생김. 한 함수 안에서 claim_walk_reward를 호출하고 이어서
--    course_completions에 기록하는 두 단계는 같은 트랜잭션(호출자 트랜잭션) 안에서
--    실행되므로 원자성이 유지됨.
--
--    p_user_id를 파라미터로 받지 않고 claim_walk_reward()와 동일하게 auth.uid()로
--    직접 확인함 - 그렇지 않으면 클라이언트가 임의의 user_id를 넘겨 남의 계정에
--    리워드/완주 기록을 남길 수 있음(walk_rewards.sql의 claim_walk_reward 보안 수정과 동일한 이유).
--
--    이전 버전(complete_course_walk(uuid, text))을 이미 실행해둔 환경이 있다면 아래
--    drop이 그 오버로드를 정리함 - 남겨두면 p_user_id를 조작할 수 있는 취약한
--    버전이 계속 호출 가능한 상태로 남기 때문에 반드시 같이 제거해야 함.
-- ============================================================
drop function if exists public.complete_course_walk(uuid, text);

create or replace function public.complete_course_walk(p_course_name text)
returns table (
  completion_id bigint,
  course_name text,
  completed_at timestamptz,
  reward_granted boolean,
  total_points integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reward_granted boolean;
  v_completion_id bigint;
  v_completed_at timestamptz;
  v_total_points integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_course_name not in ('하트', '별', '마름모', '왕관', '기하학적 물고기') then
    raise exception '알 수 없는 코스명입니다: %', p_course_name using errcode = '22023';
  end if;

  -- 날짜 기준은 claim_walk_reward 내부의 current_date(DB 서버 타임존, Supabase 기본 UTC)를
  -- 그대로 따름. 사용자 로컬 자정과 어긋날 수 있는 점은 walk_rewards.sql과 동일한 전제.
  v_reward_granted := public.claim_walk_reward();

  insert into course_completions (user_id, course_name, reward_granted)
  values (v_user_id, p_course_name, v_reward_granted)
  returning id, completed_at into v_completion_id, v_completed_at;

  select points into v_total_points from profiles where id = v_user_id;

  return query select v_completion_id, p_course_name, v_completed_at, v_reward_granted, v_total_points;
end;
$$;

grant execute on function public.complete_course_walk(text) to authenticated;
