// 브라우저용: /api/facilities(서버 프록시, data.go.kr 키 은닉)에서 CCTV/비상벨 전체 목록을
// 한 번만 받아와 캐시해두고, 이후 좌표별 "반경 내 조회"는 로컬에서 거리 계산으로 처리.
// (경로 탐색 시 지점마다 매번 API를 다시 부르면 느리고 서버 부담도 커짐)

import { haversineMeters } from './geoUtils.js';

let facilitiesPromise = null;

async function loadFacilities() {
  if (!facilitiesPromise) {
    facilitiesPromise = fetch('/api/facilities')
      .then((res) => {
        if (!res.ok) throw new Error(`시설 목록 조회 실패 (${res.status})`);
        return res.json();
      })
      .catch((err) => {
        facilitiesPromise = null; // 실패 시 다음 호출에서 재시도 가능하게
        throw err;
      });
  }
  return facilitiesPromise;
}

/**
 * 반경 N미터 내 안심 시설(CCTV/비상벨) 조회 - 실시간 공공데이터 API 기반
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Promise<Array<{facility_type:string, lat:number, lng:number, distance_m:number}>>}
 */
export async function fetchNearbySafetyFacilitiesLive(lat, lng, radiusMeters = 500) {
  let facilities;
  try {
    facilities = await loadFacilities();
  } catch (err) {
    console.error('안심시설 실시간 조회 오류:', err.message);
    return [];
  }

  return facilities
    .map((f) => ({ ...f, distance_m: haversineMeters(lat, lng, f.lat, f.lng) }))
    .filter((f) => f.distance_m <= radiusMeters)
    .sort((a, b) => a.distance_m - b.distance_m);
}
