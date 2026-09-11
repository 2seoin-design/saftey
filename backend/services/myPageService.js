// 마이페이지(포인트 / 제보내역 / 모양 달성내역) 비즈니스 로직.
// 컨트롤러(api/mypage/*, api/walk/complete.js)는 이 모듈을 호출하고 응답 형태(DTO)만 조립함.

export const COURSE_NAMES = ['하트', '별', '마름모', '왕관', '기하학적 물고기'];

/** 내 적립 포인트(총 누적) 조회 */
export async function getTotalPoints(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('points')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data?.points ?? 0;
}

/** 내 제보 내역 조회 (최신순) */
export async function getMyReports(client, userId) {
  const { data, error } = await client
    .from('reports')
    .select('id, created_at, photo_url, process_status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** 내 모양(코스) 달성 내역 조회 (최신순 - 완주한 날짜 기준 내림차순) */
export async function getMyCourseCompletions(client, userId) {
  const { data, error } = await client
    .from('course_completions')
    .select('id, course_name, completed_at, reward_granted')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * 산책로 완주 처리: 오늘 최초 완주라면 200P 지급 + 완주 내역 기록,
 * 이미 오늘 완주한 적이 있다면 포인트 지급 없이 완주 내역만 기록.
 *
 * 실제 "오늘 최초 완주" 판별과 포인트 지급은 DB의 complete_course_walk RPC
 * (SECURITY DEFINER + walk_challenge_claims UNIQUE 제약) 안에서 원자적으로 처리됨.
 * 여기서 애플리케이션 레벨로 "조회 후 지급" 하지 않는 이유: 같은 유저가 짧은 시간 안에
 * 두 번 요청을 보내면(중복 클릭, 네트워크 재시도 등) 두 요청이 모두 "아직 지급 안 됨"을
 * 보고 이중 지급할 수 있기 때문 (전형적인 check-then-act race condition).
 */
export async function completeCourseWalk(client, userId, courseName) {
  if (!COURSE_NAMES.includes(courseName)) {
    const err = new Error(`알 수 없는 코스명입니다: ${courseName}`);
    err.statusCode = 400;
    throw err;
  }

  const { data, error } = await client.rpc('complete_course_walk', {
    p_user_id: userId,
    p_course_name: courseName,
  });

  if (error) throw error;

  const row = data?.[0];
  if (!row) {
    const err = new Error('완주 처리 결과를 받지 못했습니다.');
    err.statusCode = 502;
    throw err;
  }
  return row;
}
