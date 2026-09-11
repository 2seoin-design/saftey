// POST /api/walk-match  body: { targetPath: [{lat,lng}], userPath: [{lat,lng}] }
// Authorization: Bearer <supabase access_token> 필요
// -> { matchPercent, containmentRatio, rewardEligible, pointsAwarded, walkLogId }
//
// 15m 버퍼 포함비율 + DTW를 종합해 일치율을 서버에서 직접 계산함(클라이언트가 임의로
// match_percent를 조작해서 보내는 것을 방지) - 85% 이상이면 record_walk_result RPC가
// 원자적으로 +200P를 지급하고 산책 기록을 저장함.
import { requireUser } from '../backend/services/authHelper.js';
import { computeMatchPercent, isRewardEligible } from '../backend/data/bufferDtwMatchService.js';

function isValidPath(path) {
  return Array.isArray(path) && path.length >= 2 && path.every((p) => typeof p?.lat === 'number' && typeof p?.lng === 'number');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST만 지원합니다.' });
  }

  const { targetPath, userPath } = req.body || {};
  if (!isValidPath(targetPath) || !isValidPath(userPath)) {
    return res.status(400).json({ error: 'targetPath, userPath는 {lat,lng} 배열(2개 이상)이어야 합니다.' });
  }

  try {
    const { client } = await requireUser(req);

    const { matchPercent, containmentRatio } = computeMatchPercent(targetPath, userPath);
    const rewardEligible = isRewardEligible(matchPercent);

    const { data, error } = await client.rpc('record_walk_result', {
      p_target_path: targetPath,
      p_gps_path: userPath,
      p_match_percent: matchPercent,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return res.status(200).json({
      matchPercent,
      containmentRatio,
      rewardEligible,
      pointsAwarded: row?.points_awarded ?? false,
      walkLogId: row?.walk_log_id ?? null,
    });
  } catch (err) {
    const statusCode = err.statusCode ?? 502;
    console.error('[walk-match] 실패:', err);
    return res.status(statusCode).json({ error: '일치도 판정 실패', detail: err.message });
  }
}
