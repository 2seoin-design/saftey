import { fetchNearbyReports } from './supabaseService.js';
import { fetchNearbySafetyFacilitiesLive as fetchNearbySafetyFacilities } from './liveFacilityService.js';

// TMAP 앱키는 클라이언트에 노출되는 것이 정상 (Google/Kakao 지도 키와 동일한 방식) -
// TMAP 개발자센터에서 이 페이지를 서비스할 도메인으로 접근 제한을 걸어둘 것
const TMAP_APP_KEY = 'B2uq1pQLs8QSi84bVbgC8GHn8IzS6gQ2HbeYEkmc';
const TMAP_PEDESTRIAN_URL = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1';

const FACILITY_SCORE = { BELL: 5, CCTV: 3, LIGHT: 1 };
const HAZARD_PENALTY = -5;
const BLOCKING_REPORT_TYPES = ['CONSTR']; // 공사/장애물: 완전 회피 대상

export async function callTmapPedestrian({ startLat, startLng, endLat, endLng, passList, searchOption = 30 }) {
  const res = await fetch(TMAP_PEDESTRIAN_URL, {
    method: 'POST',
    headers: { appKey: TMAP_APP_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startX: String(startLng),
      startY: String(startLat),
      endX: String(endLng),
      endY: String(endLat),
      startName: '출발지',
      endName: '도착지',
      reqCoordType: 'WGS84GEO',
      resCoordType: 'WGS84GEO',
      searchOption: String(searchOption), // 30: 계단 제외
      ...(passList ? { passList } : {}),
    }),
  });
  if (!res.ok) throw new Error(`TMAP 경로 요청 실패 (${res.status})`);
  return res.json();
}

export function extractRouteCoords(tmapResponse) {
  const coords = [];
  for (const feature of tmapResponse?.features ?? []) {
    if (feature.geometry?.type === 'LineString') {
      for (const [lng, lat] of feature.geometry.coordinates) coords.push({ lat, lng });
    }
  }
  return coords;
}

// 경로의 모든 좌표를 조회하면 요청이 과도해지므로 N개마다 하나씩만 샘플링
function sampleEvery(coords, step = 5) {
  return coords.filter((_, i) => i % step === 0);
}

export async function scoreRoute(coords, radiusMeters = 30) {
  const samples = sampleEvery(coords);
  const seenFacilities = new Map();
  const seenReports = new Map();
  let score = 0;
  let blocked = false;

  for (const { lat, lng } of samples) {
    const [facilities, reports] = await Promise.all([
      fetchNearbySafetyFacilities(lat, lng, radiusMeters),
      fetchNearbyReports(lat, lng, radiusMeters),
    ]);

    for (const f of facilities) {
      if (seenFacilities.has(f.id)) continue;
      seenFacilities.set(f.id, f);
      score += FACILITY_SCORE[f.facility_type] ?? 0;
    }

    for (const r of reports) {
      if (seenReports.has(r.id)) continue;
      seenReports.set(r.id, r);
      if (BLOCKING_REPORT_TYPES.includes(r.report_type)) blocked = true;
      else score += HAZARD_PENALTY;
    }
  }

  return {
    score,
    blocked,
    facilities: [...seenFacilities.values()],
    reports: [...seenReports.values()],
  };
}

// 경로 주변 안심 시설 중 우선순위 높은 상위 N개를 TMAP passList 포맷("lng,lat_lng,lat_...")으로 변환
export function buildPassList(facilities, limit = 4) {
  const priority = { BELL: 3, CCTV: 2, LIGHT: 1 };
  return facilities
    .slice()
    .sort((a, b) => (priority[b.facility_type] ?? 0) - (priority[a.facility_type] ?? 0))
    .slice(0, limit)
    .map((f) => `${f.lng},${f.lat}`)
    .join('_');
}

/**
 * 일반 최단 경로와 CCTV/비상벨 경유 안심 경로를 함께 반환
 * @param {{startLat:number, startLng:number, endLat:number, endLng:number}} params
 * @returns {Promise<{normalRoute: object, safeRoute: object}>}
 *   각 route는 { tmap, score, blocked, facilities, reports } 형태 (tmap: 지도에 그릴 GeoJSON 원본 응답)
 */
export async function findSafeRoute({ startLat, startLng, endLat, endLng }) {
  const baseRoute = await callTmapPedestrian({ startLat, startLng, endLat, endLng });
  const baseCoords = extractRouteCoords(baseRoute);
  const baseAnalysis = await scoreRoute(baseCoords);

  const passList = buildPassList(baseAnalysis.facilities);
  const safeRoute = passList
    ? await callTmapPedestrian({ startLat, startLng, endLat, endLng, passList })
    : baseRoute;
  const safeCoords = passList ? extractRouteCoords(safeRoute) : baseCoords;
  const safeAnalysis = passList ? await scoreRoute(safeCoords) : baseAnalysis;

  return {
    normalRoute: { tmap: baseRoute, coords: baseCoords, ...baseAnalysis },
    safeRoute: { tmap: safeRoute, coords: safeCoords, ...safeAnalysis },
  };
}
// ponytail: 공사/장애물 제보가 감지되면 safeRoute.blocked=true 로만 표시함 (실제 회피 경로
// 재탐색은 없음). 정확한 회피가 필요해지면 hazard 좌표 반대편으로 passList를 밀어내는
// 로직을 추가할 것.
