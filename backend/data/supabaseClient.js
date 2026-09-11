// 로그인/회원가입/로그아웃 페이지에서 공용으로 쓰는 Supabase 클라이언트 (saftey 프로젝트)
// anon(publishable) 키는 RLS로 보호되는 공개 키라 브라우저에 노출해도 안전함
window.sb = supabase.createClient(
  "https://gaicuiithjllwillleyo.supabase.co",
  "sb_publishable_N5Cb72wbtKj-HhjIoZ20Aw_XBDlvTsy"
);
