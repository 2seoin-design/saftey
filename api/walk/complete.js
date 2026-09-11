// POST /api/walk/complete  body: { courseName: '하트' | '별' | '마름모' | '왕관' | '기하학적 물고기' }
// -> { completionId, courseName, completedAt, rewardGranted, rewardLabel, totalPoints }
// Authorization: Bearer <supabase access_token> 필요
//
// 하루 1회(모양 무관) 최초 완주 시 200P를 즉시 지급함. 판별/지급은
// backend/data/mypage_rewards.sql의 complete_course_walk RPC 안에서 원자적으로 처리되므로
// 이 컨트롤러/서비스 레벨에서는 동시성 문제를 신경 쓸 필요 없음(트랜잭션 경계는 DB 함수 내부).
import { requireUser } from '../../backend/services/authHelper.js';
import { completeCourseWalk } from '../../backend/services/myPageService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST만 지원합니다.' });
  }

  try {
    const { client } = await requireUser(req);
    const courseName = req.body?.courseName;
    if (!courseName) {
      return res.status(400).json({ error: 'courseName이 필요합니다.' });
    }

    const row = await completeCourseWalk(client, courseName);
    return res.status(200).json({
      completionId: row.completion_id,
      courseName: row.course_name,
      completedAt: row.completed_at,
      rewardGranted: row.reward_granted,
      rewardLabel: row.reward_granted ? '+200 포인트' : null,
      totalPoints: row.total_points,
    });
  } catch (err) {
    return res.status(err.statusCode ?? 500).json({ error: err.message });
  }
}
