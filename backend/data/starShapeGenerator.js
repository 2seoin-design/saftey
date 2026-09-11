import { offsetLatLng } from './geoUtils.js';

/**
 * 중심좌표와 반지름을 받아 정교한 별 모양의 10개 꼭짓점(외곽 5 + 내곽 5) 위경도 좌표를 생성.
 * 안심귀갓길 알고리즘(routeService.js)과는 완전히 분리된 독립 구현.
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusKm - 별의 외곽 꼭짓점까지의 반지름
 * @param {number} innerRatio - 내곽 꼭짓점 반지름 비율(0~1), 기본 0.42는 정오각별 비율에 가까움
 * @returns {Array<{lat:number, lng:number}>} 10개 꼭짓점, 위쪽 꼭짓점부터 시계방향
 */
export function generateStarVertices(centerLat, centerLng, radiusKm, innerRatio = 0.42) {
  const radiusMeters = radiusKm * 1000;
  const points = 5;
  const step = Math.PI / points;
  const vertices = [];

  for (let i = 0; i < points * 2; i += 1) {
    const r = (i % 2 === 0 ? 1 : innerRatio) * radiusMeters;
    // angle=π/2가 정북(dx=0, dy=+r); i가 커질수록 각을 줄여 시계방향으로 회전
    const angle = Math.PI / 2 - i * step;
    const dx = r * Math.cos(angle); // 동서 방향 오프셋
    const dy = r * Math.sin(angle); // 남북 방향 오프셋 (양수 = 북쪽)
    vertices.push(offsetLatLng(centerLat, centerLng, dx, dy));
  }

  return vertices;
}
