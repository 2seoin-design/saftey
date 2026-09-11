// 산책로 도형 5종의 "정규화 좌표"(중심 0,0 기준 -1~1 범위) 고정 템플릿.
// 외부 .geojson/.gpx 파일을 읽지 않고, 이 파일 안의 상수만으로 즉시 사용 가능.
// 실제 위경도로 쓰려면 toShapeWaypoints()로 사용자 중심좌표+반경(km)에 맞춰 변환한다.
import { offsetLatLng } from './geoUtils.js';

// 별 모양(10개 꼭짓점, 위쪽부터 시계방향) - starShapeGenerator.js와 동일한 정오각별 수식으로 생성
function buildStarTemplate(innerRatio = 0.42) {
  const points = 5;
  const step = Math.PI / points;
  const coords = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const angle = Math.PI / 2 - i * step;
    coords.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  coords.push(coords[0]);
  return coords;
}

// 하트 모양 - 고전 하트 곡선(x=16sin^3t, y=13cos t - 5cos2t - 2cos3t - cos4t)을
// 24구간 샘플링 후 [-1,1] 범위로 정규화
function buildHeartTemplate(steps = 24) {
  const raw = [];
  let maxAbs = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push([x, y]);
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
  }
  return raw.map(([x, y]) => [x / maxAbs, y / maxAbs]);
}

// 마름모(다이아몬드) - 상/우/하/좌 4꼭짓점
const RHOMBUS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];

// 왕관 - 밑변 + 3개의 뾰족한 봉우리(가운데가 가장 높음)
const CROWN = [
  [-1, -0.5],
  [-1, 0.2],
  [-0.6, -0.2],
  [-0.3, 0.6],
  [0, -0.1],
  [0.3, 0.6],
  [0.6, -0.2],
  [1, 0.2],
  [1, -0.5],
  [-1, -0.5],
];

// 기하학적 물고기 - 마름모 몸통 + 삼각형 꼬리
const FISH = [
  [-1, 0],
  [-0.4, 0.55],
  [0.5, 0.3],
  [0.5, -0.3],
  [-0.4, -0.55],
  [-1, 0],
  [0.5, 0.3],
  [1, 0.6],
  [1, -0.6],
  [0.5, -0.3],
];

export const SHAPE_TEMPLATES = {
  rhombus: RHOMBUS,
  star: buildStarTemplate(),
  heart: buildHeartTemplate(),
  crown: CROWN,
  fish: FISH,
};

export const SHAPE_NAMES = Object.keys(SHAPE_TEMPLATES);

/**
 * 정규화 도형 템플릿을 사용자 중심좌표 기준으로 이동+스케일 변환.
 * @param {'rhombus'|'star'|'heart'|'crown'|'fish'} shapeName
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusKm - 도형의 최대 반경(정규화 좌표 1.0에 대응)
 * @returns {[number, number][]} [[lon, lat], ...] - OSRM/Kakao 등 경유지 API 입력 포맷
 */
export function toShapeWaypoints(shapeName, centerLat, centerLng, radiusKm) {
  const template = SHAPE_TEMPLATES[shapeName];
  if (!template) {
    throw new Error(`알 수 없는 도형: ${shapeName} (사용 가능: ${SHAPE_NAMES.join(', ')})`);
  }
  const radiusMeters = radiusKm * 1000;
  return template.map(([x, y]) => {
    const { lat, lng } = offsetLatLng(centerLat, centerLng, x * radiusMeters, y * radiusMeters);
    return [lng, lat];
  });
}

/** toShapeWaypoints 결과를 GeoJSON LineString Feature로 감싸서 반환 */
export function toShapeGeoJSON(shapeName, centerLat, centerLng, radiusKm) {
  const coordinates = toShapeWaypoints(shapeName, centerLat, centerLng, radiusKm);
  return {
    type: 'Feature',
    properties: { shape: shapeName, centerLat, centerLng, radiusKm },
    geometry: { type: 'LineString', coordinates },
  };
}
