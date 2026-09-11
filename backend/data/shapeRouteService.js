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

// 도형 모양을 유지하는 게 최우선이므로 항상 최대 허용 반경을 꽉 채워서 최대한 뚜렷하게 그림
// (목표 거리는 참고용으로만 보여주고, 도형 크기를 줄여서 맞추지 않음)
function computeRadiusMeters(config) {
  return config.maxRadiusKm * 1000;
}

// 두 꼭짓점 사이가 너무 멀면 TMAP이 그 사이 아무 도로나 골라 크게 우회/곡선을 타서
// 도형이 뭉개짐 - 직선 변을 따라 촘촘히 경유점을 추가해 실제 도로가 그 직선에서
// 크게 벗어날 여지를 줄임(짧은 구간일수록 우회 폭이 작아짐).
// 도형이 클수록 구간을 길게 잡아 TMAP 요청 수가 과도해지는 것을 막음(80m~200m).
function hopMetersFor(maxRadiusKm) {
  return Math.min(200, Math.max(60, (maxRadiusKm * 1000) / 8));
}

function subdivideEdge(from, to, hopMeters) {
  const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  const segments = Math.max(1, Math.ceil(dist / hopMeters));
  const points = [from];
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    points.push({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
  }
  return points; // to 자체는 포함하지 않음 (다음 변의 시작점으로 이어짐)
}

function densifyVertices(anchors, hopMeters) {
  const dense = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const from = anchors[i];
    const to = anchors[(i + 1) % anchors.length];
    dense.push(...subdivideEdge(from, to, hopMeters));
  }
  return dense;
}

// anchor 근처(안심 스냅 반경 내)에 안심시설이 있으면 그 시설 좌표로 살짝 당겨서
// 경로가 실제 CCTV/비상벨 옆을 지나가도록 유도
const SAFETY_SNAP_RADIUS_M = 60;

async function snapToSafety(anchor) {
  const nearby = await fetchNearbySafetyFacilitiesLive(anchor.lat, anchor.lng, SAFETY_SNAP_RADIUS_M);
  if (nearby.length === 0) return anchor;
  return { lat: nearby[0].lat, lng: nearby[0].lng };
}

// 동시에 너무 많이 보내면 TMAP이 429(요청 과다)로 막으므로, 정해진 개수만큼만 동시에
// 실행하는 간단한 워커 풀 - 구간 수가 많은 큰 도형에서도 안전하게 동작
const TMAP_CONCURRENCY = 3;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// snapToSafety가 인접한 두 anchor를 같은(또는 거의 같은) 안심시설 좌표로 당기면 구간
// 거리가 0에 가까워짐 - TMAP은 이런 좌표쌍에 "waypoints are too near"로 400을 반환함
const MIN_TMAP_SEGMENT_METERS = 15;

// 위 근접 케이스 외에도, snapToSafety가 당긴 안심시설 좌표가 실제로는 보행 경로가
// 없는 지점(건물 안, 부정확한 공공데이터 좌표 등)일 수 있어 TMAP이 "요청 데이터 오류"
// 등으로 400을 반환하는 경우가 있음. 한 구간이 실패했다고 산책로 전체(Promise.all)가
// 실패하면 안 되므로, 그 구간만 직선으로 건너뛰고 계속 진행함
// (softWeightRouteService.js의 도로 끊김 폴백과 동일한 방식)
async function fetchSegmentOrFallback(from, to) {
  if (haversineMeters(from.lat, from.lng, to.lat, to.lng) < MIN_TMAP_SEGMENT_METERS) {
    return [from, to];
  }
  try {
    const tmap = await callTmapPedestrian({ startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng });
    return extractRouteCoords(tmap);
  } catch (err) {
    return [from, to];
  }
}

// 인접 anchor 쌍을 TMAP 보행자 경로로 이어 붙여 폐곡선(순환) 경로를 만듦.
// 구간끼리 서로 의존관계가 없으므로 (동시요청 수를 제한해가며) 병렬로 요청하고 순서대로 이어붙임
export async function buildLoopRoute(anchors) {
  const segments = await mapWithConcurrency(anchors, TMAP_CONCURRENCY, (from, i) =>
    fetchSegmentOrFallback(from, anchors[(i + 1) % anchors.length])
  );

  const coords = [];
  for (const segment of segments) {
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

async function buildShapeWaypoints(lat, lng, vertices, radiusMeters, hopMeters) {
  const rawAnchors = toAnchors(lat, lng, vertices, radiusMeters);
  const denseAnchors = densifyVertices(rawAnchors, hopMeters);
  const anchors = await Promise.all(denseAnchors.map(snapToSafety));
  return buildLoopRoute(anchors);
}

// 도형/최대반경 유지가 우선이라 거리는 통제하지 않지만, 큰 도형(물고기/왕관)은 촘촘한
// 경유점과 맞물려 목표거리의 몇 배씩 나올 수 있어 "몇 시간짜리 산책"이 되는 극단적인
// 경우만 막음 - 이때만 반경을 줄여 딱 한 번 다시 생성 (모양 비율은 그대로, 크기만 축소)
const EXTREME_OVERSHOOT_RATIO = 2.5;

/**
 * 사용자 위치를 중심으로 지정된 도형 모양의 안심 산책로를 생성.
 * 도형 모양 유지가 최우선 - 기본적으로 최대 반경으로 그리고, 변마다 촘촘한 경유점으로
 * 한붓그리기처럼 순서대로만 이어서 실제 도로가 직선 변에서 크게 벗어나지 않게 함.
 * @param {{lat:number, lng:number, shape: keyof typeof SHAPE_CONFIG}} params
 * @returns {Promise<{shape:string, waypoints:Array<{lat:number,lng:number}>, distanceKm:number,
 *   targetDistanceKm:number, estimatedMinutes:number, maxRadiusKm:number, score:number, blocked:boolean}>}
 */
export async function generateShapeRoute({ lat, lng, shape }) {
  const config = SHAPE_CONFIG[shape];
  if (!config) throw new Error(`알 수 없는 도형: ${shape}`);

  const vertices = SHAPE_VERTICES[shape];
  const hopMeters = hopMetersFor(config.maxRadiusKm);
  let radiusMeters = computeRadiusMeters(config);
  let waypoints = await buildShapeWaypoints(lat, lng, vertices, radiusMeters, hopMeters);
  let distanceKm = computeRouteDistanceKm(waypoints);

  const targetMeters = config.targetDistanceKm * 1000;
  if (distanceKm * 1000 > targetMeters * EXTREME_OVERSHOOT_RATIO) {
    const scale = (targetMeters * EXTREME_OVERSHOOT_RATIO) / (distanceKm * 1000);
    radiusMeters *= scale;
    waypoints = await buildShapeWaypoints(lat, lng, vertices, radiusMeters, hopMeters);
    distanceKm = computeRouteDistanceKm(waypoints);
  }

  const { score, blocked } = await scoreRoute(waypoints);

  return {
    shape,
    waypoints,
    distanceKm,
    targetDistanceKm: config.targetDistanceKm,
    estimatedMinutes: config.durationMin,
    maxRadiusKm: config.maxRadiusKm,
    score,
    blocked,
  };
}
