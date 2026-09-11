// GET /api/mypage/points -> { points: number }
// Authorization: Bearer <supabase access_token> 필요
import { requireUser } from '../../backend/services/authHelper.js';
import { getTotalPoints } from '../../backend/services/myPageService.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET만 지원합니다.' });
  }

  try {
    const { client, user } = await requireUser(req);
    const points = await getTotalPoints(client, user.id);
    return res.status(200).json({ points });
  } catch (err) {
    return res.status(err.statusCode ?? 500).json({ error: err.message });
  }
}
