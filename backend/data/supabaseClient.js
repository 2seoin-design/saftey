// 로그인/회원가입/로그아웃 페이지에서 공용으로 쓰는 Supabase 클라이언트 (saftey 프로젝트)
// anon(publishable) 키는 RLS로 보호되는 공개 키라 브라우저에 노출해도 안전함
window.sb = supabase.createClient(
  "https://gaicuiithjllwillleyo.supabase.co",
  "sb_publishable_N5Cb72wbtKj-HhjIoZ20Aw_XBDlvTsy"
);

// sb.auth.getSession()은 로컬에 저장된 세션을 만료 여부와 상관없이 그대로 반환할 수 있음
// (access_token은 보통 1시간 후 만료) - 페이지를 오래 띄워두거나 로그인 직후가 아니면
// 만료된 토큰으로 데이터 조회를 시도해서 한꺼번에 실패하는 원인이 됨.
// 만료됐거나 임박했으면 refreshSession()으로 먼저 갱신한 뒤 세션을 돌려줌.
window.getFreshSession = async function getFreshSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  const isExpiredOrSoon = expiresAtMs < Date.now() + 30000; // 30초 이내 만료 포함
  if (!isExpiredOrSoon) return session;

  const { data: refreshed, error } = await sb.auth.refreshSession();
  if (error || !refreshed?.session) {
    console.warn('세션 갱신 실패, 기존 세션으로 진행:', error);
    return session;
  }
  return refreshed.session;
};
