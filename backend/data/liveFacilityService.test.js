import { test } from 'node:test';
import assert from 'node:assert/strict';

// haversineMeters는 export 안 되어 있으므로, 알려진 두 좌표 간 거리로 fetchNearbySafetyFacilitiesLive를
// 통해 간접 검증 - fetch를 스텁으로 교체해 네트워크 없이 로직만 확인
const originalFetch = global.fetch;

test('fetchNearbySafetyFacilitiesLive filters by radius using haversine distance', async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify([
        { facility_type: 'CCTV', lat: 37.5665, lng: 126.978 }, // 서울시청 (기준점)
        { facility_type: 'BELL', lat: 37.5651, lng: 126.9895 }, // 약 1.1km 떨어짐
      ]),
      { status: 200 }
    );

  const { fetchNearbySafetyFacilitiesLive } = await import('./liveFacilityService.js');
  const near = await fetchNearbySafetyFacilitiesLive(37.5665, 126.978, 100);
  const far = await fetchNearbySafetyFacilitiesLive(37.5665, 126.978, 2000);

  assert.equal(near.length, 1);
  assert.equal(near[0].facility_type, 'CCTV');
  assert.equal(far.length, 2);

  global.fetch = originalFetch;
});
