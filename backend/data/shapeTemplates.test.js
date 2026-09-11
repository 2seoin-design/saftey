import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_TEMPLATES, SHAPE_NAMES, toShapeWaypoints, toShapeGeoJSON } from './shapeTemplates.js';

const CENTER = { lat: 37.5665, lng: 126.978 };

test('5 shapes are defined and each has at least 4 vertices', () => {
  assert.equal(SHAPE_NAMES.length, 5);
  for (const name of SHAPE_NAMES) {
    assert.ok(SHAPE_TEMPLATES[name].length >= 4, `${name} too few vertices`);
  }
});

test('toShapeWaypoints returns [lon, lat] pairs centered near the given center', () => {
  const waypoints = toShapeWaypoints('star', CENTER.lat, CENTER.lng, 0.5);
  assert.equal(waypoints.length, SHAPE_TEMPLATES.star.length);
  for (const [lon, lat] of waypoints) {
    assert.ok(Math.abs(lon - CENTER.lng) < 0.02);
    assert.ok(Math.abs(lat - CENTER.lat) < 0.02);
  }
});

test('larger radiusKm produces vertices farther from the center', () => {
  const small = toShapeWaypoints('rhombus', CENTER.lat, CENTER.lng, 0.3);
  const large = toShapeWaypoints('rhombus', CENTER.lat, CENTER.lng, 1.0);
  const dist = ([lon, lat]) => Math.hypot(lon - CENTER.lng, lat - CENTER.lat);
  assert.ok(dist(large[0]) > dist(small[0]));
});

test('toShapeWaypoints throws on unknown shape name', () => {
  assert.throws(() => toShapeWaypoints('hexagon', CENTER.lat, CENTER.lng, 0.5));
});

test('toShapeGeoJSON wraps waypoints in a LineString Feature', () => {
  const geojson = toShapeGeoJSON('heart', CENTER.lat, CENTER.lng, 0.5);
  assert.equal(geojson.type, 'Feature');
  assert.equal(geojson.geometry.type, 'LineString');
  assert.deepEqual(geojson.geometry.coordinates, toShapeWaypoints('heart', CENTER.lat, CENTER.lng, 0.5));
});
