import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_CONFIG, SHAPE_VERTICES, toAnchors, buildLoopRoute } from './shapeRouteService.js';
import { haversineMeters } from './geoUtils.js';

test('every shape vertex stays within unit radius (normalization holds)', () => {
  for (const [name, vertices] of Object.entries(SHAPE_VERTICES)) {
    for (const v of vertices) {
      const mag = Math.hypot(v.x, v.y);
      assert.ok(mag <= 1 + 1e-9, `${name} vertex magnitude ${mag} exceeds 1`);
    }
  }
});

test('every shape has at least one vertex reaching the outer edge', () => {
  for (const [name, vertices] of Object.entries(SHAPE_VERTICES)) {
    const maxMag = Math.max(...vertices.map((v) => Math.hypot(v.x, v.y)));
    assert.ok(maxMag > 0.9, `${name} does not use its allotted radius (max ${maxMag})`);
  }
});

test('buildLoopRoute skips the TMAP call and connects directly when anchors collapse together (snapToSafety near-duplicate)', async () => {
  // 실제로 발생하는 상황: snapToSafety가 인접한 두 anchor를 같은 안심시설 좌표로 당겨
  // 거리가 0에 가까워짐 - 이때 TMAP을 호출하면 "waypoints are too near" 400을 반환하므로
  // 호출 자체를 건너뛰고 직선으로 이어야 함(네트워크 호출 없이 통과해야 하는 테스트)
  const anchors = [
    { lat: 37.5665, lng: 126.978 },
    { lat: 37.5665, lng: 126.978 }, // 완전히 동일한 좌표로 스냅된 경우
  ];
  const coords = await buildLoopRoute(anchors);
  assert.ok(coords.length >= anchors.length, 'should produce a coordinate path without throwing');
});

test('toAnchors keeps every anchor within the configured max radius', () => {
  const center = { lat: 37.5665, lng: 126.978 };
  for (const [name, config] of Object.entries(SHAPE_CONFIG)) {
    const radiusMeters = config.maxRadiusKm * 1000;
    const anchors = toAnchors(center.lat, center.lng, SHAPE_VERTICES[name], radiusMeters);
    for (const a of anchors) {
      const dist = haversineMeters(center.lat, center.lng, a.lat, a.lng);
      assert.ok(dist <= radiusMeters * 1.01, `${name} anchor at ${dist}m exceeds max radius ${radiusMeters}m`);
    }
  }
});
