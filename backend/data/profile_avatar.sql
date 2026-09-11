-- 프로필 사진 지원: profiles.avatar_url 추가 + 가입 시 자동 동기화
-- 실행: Supabase 대시보드 SQL Editor

alter table profiles add column if not exists avatar_url text;

-- 가입 시 auth.users 메타데이터의 avatar_url까지 profiles로 복사하도록 트리거 갱신
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$;

-- 이 기능이 생기기 전에 이미 가입된 계정 중 메타데이터에 사진이 있는 경우 1회 백필
update profiles p
set avatar_url = u.raw_user_meta_data->>'avatar_url'
from auth.users u
where p.id = u.id
  and p.avatar_url is null
  and u.raw_user_meta_data->>'avatar_url' is not null;

-- 게시글 작성자 이름/사진을 다른 사용자도 볼 수 있어야 커뮤니티에 표시 가능 -
-- 기존 "본인만 조회" 정책은 그대로 두고 공개 조회 정책을 추가함(둘 중 하나만 만족해도 조회 허용됨)
drop policy if exists "Anyone can view basic profile info" on profiles;
create policy "Anyone can view basic profile info"
  on profiles for select
  using (true);
