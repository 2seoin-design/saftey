import { supabase } from './supabaseService.js';

const PAGE_SIZE = 20;
const IMAGE_BUCKET = 'community-images';

export function computeTotalPages(totalCount, pageSize = PAGE_SIZE) {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

/**
 * 현장 사진을 Storage에 업로드하고 공개 URL을 반환
 * @param {File} file
 * @param {string} userId - 소유자 판별용 경로 접두사(Storage RLS와 일치해야 함)
 */
export async function uploadPostImage(file, userId) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file);
  if (error) throw error;

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * 게시글 작성 (작성자 ID/작성일시는 서버가 채움)
 * @param {{title:string, content:string, imageUrl?:string|null}} params
 */
export async function createPost({ title, content, imageUrl = null }) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase
    .from('community_posts')
    .insert([{ author_id: user.id, title, content, image_url: imageUrl }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * 게시글 목록 조회 - 작성일시 내림차순, 페이지당 20개
 * @param {number} page - 1부터 시작
 */
export async function fetchPosts(page = 1) {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await supabase
    .from('community_posts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  return { posts: data ?? [], page, totalPages: computeTotalPages(count ?? 0) };
}

export async function fetchPost(id) {
  const { data, error } = await supabase.from('community_posts').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/**
 * 게시글 수정 - RLS(author_id = auth.uid())가 실제 권한 경계.
 * 작성자가 아니면 0행이 매칭되어 아래에서 에러로 드러남.
 */
export async function updatePost(id, { title, content, imageUrl }) {
  const patch = { title, content, updated_at: new Date().toISOString() };
  if (imageUrl !== undefined) patch.image_url = imageUrl;

  const { data, error } = await supabase.from('community_posts').update(patch).eq('id', id).select().single();
  if (error) throw new Error('수정 권한이 없거나 게시글을 찾을 수 없습니다.');
  return data;
}

/**
 * 게시글 삭제 - RLS가 작성자만 허용.
 * 권한이 없으면 0행이 매칭되어 에러 없이 "성공"처럼 보일 수 있어, 실제로 지워졌는지 확인함
 */
export async function deletePost(id) {
  const { data, error } = await supabase.from('community_posts').delete().eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('삭제 권한이 없거나 게시글을 찾을 수 없습니다.');
}
