-- 로그인/회원가입/로그아웃용 SQL
-- 실행: Supabase 대시보드 SQL Editor
-- profiles 테이블과 handle_new_user 트리거는 이미 saftey 프로젝트에 적용되어 있음(문서화 목적, 재실행해도 안전)

-- ============================================================
-- 1. profiles: auth.users 확장 정보 (이름 등)
-- ============================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- 회원가입(auth.users insert) 시 profiles 행 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, new.raw_user_meta_data->>'name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. RPC: 회원가입 전 이메일 중복 확인
--    auth.users는 anon/authenticated 권한으로 직접 조회 불가하므로
--    SECURITY DEFINER 함수로 존재 여부만 노출 (비밀번호 등은 노출 안 함)
-- ============================================================
create or replace function public.email_exists(check_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(check_email)
  );
$$;

grant execute on function public.email_exists(text) to anon, authenticated;
