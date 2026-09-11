import { callTmapPedestrian, extractRouteCoords, scoreRoute } from './routeService.js';
import { fetchNearbySafetyFacilitiesLive } from './liveFacilityService.js';
import { haversineMeters, offsetLatLng } from './geoUtils.js';

// 도형별 소요시간/목표거리/최대탐색반경 (요구사항 표 그대로)
export const SHAPE_CONFIG = {
  rhombus: { label: '마름모', durationMin: 10, targetDistanceKm: 0.67, maxRadiusKm: 0.2 },
  heart: { label: '하트', durationMin: 20, targetDistanceKm: 1.33, maxRadiusKm: 0.4 },
  star: { label: '별', durationMin: 30, targetDistanceKm: 2.0, maxRadiusKm: 0.6 },
  fish: { label: '물고기', durationMin: 60, targetDistanceKm: 4.0, maxRadiusKm: 1.2 },
  crown: { label: '왕관', durationMin: 90, targetDistanceKm: 6.0, maxRadiusKm: 1.8 },
};

// 실제 도로망을 따라가므로 완벽한 도형이 아니라 "그 도형의 특징이 드러나는" 꺾임점 정도의
// 근사치임. fish/crown은 표준 수학 곡선이 없어 형태를 흉내낸 좌표를 직접 정의함.
// ponytail: 이 anchor 좌표는 미관용 근사치, 도로망에 정밀히 맞춘 진짜 도형 매칭이 필요해지면
// OSM 도로 그래프 기반 형태 최적화 알고리즘으로 교체할 것.
// 원점에서 가장 먼 꼭짓점 기준으로 스케일을 맞춰 모든 꼭짓점이 반경 1 이내에 들어오게 함
// (최대 탐색 반경 제약을 절대 넘지 않도록 보장)
function normalizeToUnitRadius(vertices) {
  const maxMag = Math.max(...vertices.map((p) => Math.hypot(p.x, p.y)));
  return vertices.map((p) => ({ x: p.x / maxMag, y: p.y / maxMag }));
}

function buildHeartVertices(count) {
  const raw = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * 2 * Math.PI;
    raw.push({
      x: 16 * Math.sin(t) ** 3,
      y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
    });
  }
  return normalizeToUnitRadius(raw);
}

function buildStarVertices(points, innerRatio) {
  const vertices = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const angle = -Math.PI / 2 + i * step; // 꼭짓점이 위를 향하도록
    vertices.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  return vertices;
}

export const SHAPE_VERTICES = {
  rhombus: normalizeToUnitRadius([
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: -1, y: 0 },
  ]),
  heart: buildHeartVertices(12),
  star: buildStarVertices(5, 0.42),
  fish: normalizeToUnitRadius([
    { x: -1, y: 0.15 },
    { x: -0.7, y: 0.55 },
    { x: -0.2, y: 0.65 },
    { x: 0.3, y: 0.4 },
    { x: 0.55, y: 0 },
    { x: 0.3, y: -0.4 },
    { x: -0.2, y: -0.65 },
    { x: -0.7, y: -0.55 },
    { x: 0.55, y: 0.35 }, // 꼬리지느러미 위
    { x: 0.9, y: 0 },
    { x: 0.55, y: -0.35 }, // 꼬리지느러미 아래
  ]),
  crown: normalizeToUnitRadius([
    { x: -1, y: -0.5 },
    { x: -1, y: 0.1 },
    { x: -0.6, y: -0.3 },
    { x: -0.3, y: 0.6 },
    { x: 0, y: -0.2 },
    { x: 0.3, y: 0.6 },
    { x: 0.6, y: -0.3 },
    { x: 1, y: 0.1 },
    { x: 1, y: -0.5 },
  ]),
};

// 정규화된(-1~1) 도형 꼭짓점을 실제 위경도 anchor로 변환
export function toAnchors(centerLat, centerLng, vertices, radiusMeters) {
  return vertices.map((v) => offsetLatLng(centerLat, centerLng, v.x * radiusMeters, v.y * radiusMeters));
}

// anchor 근처(안심 스냅 반경 내)에 안심시설이 있으면 그 시설 좌표로 살짝 당겨서
// 경로가 실제 CCTV/비상벨 옆을 지나가도록 유도
const SAFETY_SNAP_RADIUS_M = 60;

async function snapToSafety(anchor) {
  const nearby = await fetchNearbySafetyFacilitiesLive(anchor.lat, anchor.lng, SAFETY_SNAP_RADIUS_M);
  if (nearby.length === 0) return anchor;
  return { lat: nearby[0].lat, lng: nearby[0].lng };
}

// 인접 anchor 쌍을 순서대로 TMAP 보행자 경로로 이어 붙여 폐곡선(순환) 경로를 만듦
async function buildLoopRoute(anchors) {
  const coords = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const from = anchors[i];
    const to = anchors[(i + 1) % anchors.length];
    const tmap = await callTmapPedestrian({
      startLat: from.lat,
      startLng: from.lng,
      endLat: to.lat,
      endLng: to.lng,
    });
    const segment = extractRouteCoords(tmap);
    // 구간 경계 좌표가 중복되므로(이전 구간의 끝 = 다음 구간의 시작) 첫 좌표는 건너뜀
    coords.push(...(coords.length ? segment.slice(1) : segment));
  }
  return coords;
}

function computeRouteDistanceKm(coords) {
  let meters = 0;
  for (let i = 1; i < coords.length; i += 1) {
    meters += haversineMeters(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
  }
  return meters / 1000;
}

/**
 * 사용자 위치를 중심으로 지정된 도형 모양의 안심 산책로를 생성
 * @param {{lat:number, lng:number, shape: keyof typeof SHAPE_CONFIG}} params
 * @returns {Promise<{shape:string, waypoints:Array<{lat:number,lng:number}>, distanceKm:number,
 *   targetDistanceKm:number, estimatedMinutes:number, maxRadiusKm:number, score:number, blocked:boolean}>}
 */
export async function generateShapeRoute({ lat, lng, shape }) {
  const config = SHAPE_CONFIG[shape];
  if (!config) throw new Error(`알 수 없는 도형: ${shape}`);

  const vertices = SHAPE_VERTICES[shape];
  const rawAnchors = toAnchors(lat, lng, vertices, config.maxRadiusKm * 1000);
  const anchors = await Promise.all(rawAnchors.map(snapToSafety));

  const waypoints = await buildLoopRoute(anchors);
  const { score, blocked } = await scoreRoute(waypoints);

  return {
    shape,
    waypoints,
    distanceKm: computeRouteDistanceKm(waypoints),
    targetDistanceKm: config.targetDistanceKm,
    estimatedMinutes: config.durationMin,
    maxRadiusKm: config.maxRadiusKm,
    score,
    blocked,
  };
}
