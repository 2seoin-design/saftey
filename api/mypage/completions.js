// GET /api/mypage/completions -> { completions: [{ id, courseName, completedAt, rewardGranted, rewardLabel }] }
// 완주한 날짜 기준 최신순(내림차순)으로 반환됨.
// Authorization: Bearer <supabase access_token> 필요
import { requireUser } from '../../backend/services/authHelper.js';
import { getMyCourseCompletions } from '../../backend/services/myPageService.js';

function toCompletionDto(row) {
  return {
    id: row.id,
    courseName: row.course_name,
    completedAt: row.completed_at,
    rewardGranted: row.reward_granted,
    rewardLabel: row.reward_granted ? '+200 포인트' : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET만 지원합니다.' });
  }

  try {
    const { client, user } = await requireUser(req);
    const rows = await getMyCourseCompletions(client, user.id);
    return res.status(200).json({ completions: rows.map(toCompletionDto) });
  } catch (err) {
    return res.status(err.statusCode ?? 500).json({ error: err.message });
  }
}
