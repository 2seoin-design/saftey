// API 라우트 공용 인증 헬퍼.
// service role 키를 서버에 두는 대신, 요청자의 JWT를 그대로 PostgREST에 실어 보내는
// 클라이언트를 만들어 RLS(auth.uid())가 "그 유저 본인" 기준으로 평가되게 함.
import { createClient } from '@supabase/supabase-js';

// backend/data/supabaseService.js와 동일한 fallback: anon(publishable) 키는 RLS로 보호되는
// 공개 키라 하드코딩해도 안전함 - Vercel에 REACT_APP_SUPABASE_* 환경변수를 깜빡 설정하지 않아도
// API가 즉시 동작하도록 함.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://gaicuiithjllwillleyo.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'sb_publishable_N5Cb72wbtKj-HhjIoZ20Aw_XBDlvTsy';

export function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export function createUserScopedClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

/**
 * Authorization: Bearer <access_token> 헤더를 검증하고,
 * 해당 유저 권한으로 동작하는 supabase 클라이언트와 유저 정보를 반환.
 * 실패 시 statusCode가 달린 Error를 throw함(컨트롤러에서 그대로 res.status(err.statusCode)에 사용).
 */
export async function requireUser(req) {
  const token = extractBearerToken(req);
  if (!token) {
    const err = new Error('Authorization 헤더(Bearer 토큰)가 필요합니다.');
    err.statusCode = 401;
    throw err;
  }

  const client = createUserScopedClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error('유효하지 않거나 만료된 인증 토큰입니다.');
    err.statusCode = 401;
    throw err;
  }

  return { client, user: data.user };
}
