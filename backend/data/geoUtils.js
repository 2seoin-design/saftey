// 좌표 계산 공용 유틸 (haversine 거리, 미터 오프셋 <-> 위경도 변환)
// 여러 서비스(liveFacilityService, shapeRouteService, patternMatchService)가 공유

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// 중심 좌표 기준 (dxMeters, dyMeters) 만큼 동/북쪽으로 떨어진 위경도 계산
// 작은 반경(<2km)에서는 지구를 평면으로 근사해도 오차가 무시할 수준
export function offsetLatLng(centerLat, centerLng, dxMeters, dyMeters) {
  const dLat = dyMeters / 111320;
  const dLng = dxMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return { lat: centerLat + dLat, lng: centerLng + dLng };
}
