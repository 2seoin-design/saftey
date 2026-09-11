-- 커뮤니티 게시판 SQL
-- 실행: Supabase 대시보드 SQL Editor

create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  content text not null,
  image_url text
);

-- 최신글이 위로 오는 목록 조회(ORDER BY created_at DESC)를 빠르게 하기 위한 정렬 인덱스
create index if not exists community_posts_created_at_idx
  on community_posts (created_at desc);

alter table community_posts enable row level security;

drop policy if exists "Anyone can read posts" on community_posts;
create policy "Anyone can read posts"
  on community_posts for select
  using (true);

drop policy if exists "Authenticated users can create own posts" on community_posts;
create policy "Authenticated users can create own posts"
  on community_posts for insert
  with check (auth.uid() = author_id);

-- 작성자 본인만 수정 가능 (DB 레벨에서 강제 - 클라이언트 체크는 우회 가능하므로 여기가 실제 경계)
drop policy if exists "Authors can update own posts" on community_posts;
create policy "Authors can update own posts"
  on community_posts for update
  using (auth.uid() = author_id);

-- 작성자 본인만 삭제 가능
drop policy if exists "Authors can delete own posts" on community_posts;
create policy "Authors can delete own posts"
  on community_posts for delete
  using (auth.uid() = author_id);

-- ============================================================
-- 현장 사진 저장용 Storage 버킷
-- 경로 규칙: <author_id>/<timestamp>-<random>.<ext> - 소유자 판별에 사용
-- ============================================================
insert into storage.buckets (id, name, public)
values ('community-images', 'community-images', true)
on conflict (id) do nothing;

drop policy if exists "Community images public read" on storage.objects;
create policy "Community images public read"
  on storage.objects for select
  using (bucket_id = 'community-images');

drop policy if exists "Community images owner upload" on storage.objects;
create policy "Community images owner upload"
  on storage.objects for insert
  with check (
    bucket_id = 'community-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Community images owner delete" on storage.objects;
create policy "Community images owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'community-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
