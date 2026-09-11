// POST /api/soft-weight-route  body: { shape, centerLat, centerLng, radiusKm }
// shape: 'rhombus' | 'star' | 'heart' | 'crown' | 'fish' (기본값 'star')
// -> { waypoints: [{lat,lng}], geojson, segments }
//
// 유동인구/가로등 소프트 가중치 기반 도형 산책로 생성. 안심귀갓길(routeService.js,
// TMAP 기반)과는 완전히 분리된 별도 알고리즘 - shapeTemplates.js로 만든 도형 꼭짓점을
// OSM 도로망(Nodes/Edges) 위에서 직접 Dijkstra로 정렬해, 가로등/유동인구가 있는 구간을 우대함.
// 조회성 작업이라 로그인 없이도 코스 미리보기가 가능하도록 인증은 요구하지 않음.
import { generateSoftWeightShapeRoute } from '../backend/data/softWeightRouteService.js';
import { SHAPE_NAMES } from '../backend/data/shapeTemplates.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST만 지원합니다.' });
  }

  const { shape = 'star', centerLat, centerLng, radiusKm } = req.body || {};
  if (typeof centerLat !== 'number' || typeof centerLng !== 'number' || typeof radiusKm !== 'number') {
    return res.status(400).json({ error: 'centerLat, centerLng, radiusKm(숫자)가 필요합니다.' });
  }
  if (!SHAPE_NAMES.includes(shape)) {
    return res.status(400).json({ error: `shape는 다음 중 하나여야 합니다: ${SHAPE_NAMES.join(', ')}` });
  }

  try {
    const result = await generateSoftWeightShapeRoute({ shapeName: shape, centerLat, centerLng, radiusKm });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[soft-weight-route] 실패:', err);
    return res.status(502).json({ error: '산책로 생성 실패', detail: err.message });
  }
}
