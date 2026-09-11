-- 제보 완료 리워드: Supabase SQL Editor에서 한 번 실행하세요.
alter table public.profiles
  add column if not exists points integer not null default 0;

create table if not exists public.report_reward_claims (
  claim_id bigint generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid references public.reports(id) on delete cascade,
  claim_date date not null default current_date,
  reward_amount integer not null default 500,
  created_at timestamptz not null default now(),
  primary key (claim_id)
);

alter table public.report_reward_claims
  add column if not exists claim_id bigint generated always as identity;
alter table public.report_reward_claims
  add column if not exists report_id uuid references public.reports(id) on delete cascade;
alter table public.report_reward_claims
  drop constraint if exists report_reward_claims_pkey;
alter table public.report_reward_claims
  add primary key (claim_id);
create unique index if not exists report_reward_claims_report_id_key
  on public.report_reward_claims(report_id)
  where report_id is not null;

alter table public.report_reward_claims enable row level security;

drop policy if exists "Users can view own report reward claims"
  on public.report_reward_claims;
create policy "Users can view own report reward claims"
  on public.report_reward_claims for select
  using (auth.uid() = user_id);

create or replace function public.claim_report_reward(p_report_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reward integer := 500;
  v_total integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1
    from public.reports
    where id = p_report_id
      and user_id = v_user_id
  ) then
    raise exception 'report not found or not owned by user';
  end if;

  insert into public.report_reward_claims (user_id, report_id, claim_date, reward_amount)
  values (v_user_id, p_report_id, current_date, v_reward)
  on conflict (report_id) where report_id is not null do nothing;

  if not found then
    select points into v_total from public.profiles where id = v_user_id;
    return json_build_object('reward_granted', false, 'total_points', coalesce(v_total, 0));
  end if;

  update public.profiles
  set points = points + v_reward
  where id = v_user_id
  returning points into v_total;

  return json_build_object('reward_granted', true, 'total_points', coalesce(v_total, v_reward));
end;
$$;

grant execute on function public.claim_report_reward() to authenticated;
