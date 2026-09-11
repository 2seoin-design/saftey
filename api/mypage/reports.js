// GET /api/mypage/reports -> { reports: [{ id, reportedAt, photoUrl, status, statusLabel }] }
// Authorization: Bearer <supabase access_token> 필요
import { requireUser } from '../../backend/services/authHelper.js';
import { getMyReports } from '../../backend/services/myPageService.js';

const STATUS_LABEL = { PENDING: '미처리', DONE: '처리 완료' };

function toReportDto(row) {
  return {
    id: row.id,
    reportedAt: row.created_at,
    photoUrl: row.photo_url,
    status: row.process_status,
    statusLabel: STATUS_LABEL[row.process_status] ?? row.process_status,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET만 지원합니다.' });
  }

  try {
    const { client, user } = await requireUser(req);
    const rows = await getMyReports(client, user.id);
    return res.status(200).json({ reports: rows.map(toReportDto) });
  } catch (err) {
    return res.status(err.statusCode ?? 500).json({ error: err.message });
  }
}
