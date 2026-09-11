import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_CONFIG, SHAPE_VERTICES, toAnchors } from './shapeRouteService.js';
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
