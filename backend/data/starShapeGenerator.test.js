import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStarVertices } from './starShapeGenerator.js';
import { haversineMeters } from './geoUtils.js';

const CENTER = { lat: 37.5665, lng: 126.978 };

test('generateStarVertices returns exactly 10 vertices', () => {
  const vertices = generateStarVertices(CENTER.lat, CENTER.lng, 0.5);
  assert.equal(vertices.length, 10);
});

test('first vertex points due north of the center', () => {
  const [first] = generateStarVertices(CENTER.lat, CENTER.lng, 0.5);
  assert.ok(first.lat > CENTER.lat, 'first vertex should be north (higher lat)');
  assert.ok(Math.abs(first.lng - CENTER.lng) < 1e-6, 'first vertex should share the center longitude');
});

test('outer vertices sit at ~radiusKm, inner vertices at ~radiusKm*innerRatio', () => {
  const radiusKm = 0.5;
  const innerRatio = 0.42;
  const vertices = generateStarVertices(CENTER.lat, CENTER.lng, radiusKm, innerRatio);

  vertices.forEach((v, i) => {
    const distM = haversineMeters(CENTER.lat, CENTER.lng, v.lat, v.lng);
    const expectedM = (i % 2 === 0 ? radiusKm : radiusKm * innerRatio) * 1000;
    assert.ok(Math.abs(distM - expectedM) < 1, `vertex ${i} distance ${distM} should be ~${expectedM}`);
  });
});

test('no vertex exceeds the outer radius', () => {
  const radiusKm = 0.3;
  const vertices = generateStarVertices(CENTER.lat, CENTER.lng, radiusKm);
  for (const v of vertices) {
    const distM = haversineMeters(CENTER.lat, CENTER.lng, v.lat, v.lng);
    assert.ok(distM <= radiusKm * 1000 + 1);
  }
});
