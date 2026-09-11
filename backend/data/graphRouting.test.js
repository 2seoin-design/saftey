import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEdgeCost, dijkstra, findNearestNode } from './graphRouting.js';

test('computeEdgeCost: no streetlight/traffic = plain distance', () => {
  assert.equal(computeEdgeCost(100), 100);
});

test('computeEdgeCost: streetlight discounts 25%', () => {
  assert.equal(computeEdgeCost(100, { hasStreetlight: true }), 75);
});

test('computeEdgeCost: foot traffic discounts up to 20%', () => {
  assert.equal(computeEdgeCost(100, { footTrafficScore: 1 }), 80);
  assert.equal(computeEdgeCost(100, { footTrafficScore: 0.5 }), 90);
});

test('computeEdgeCost: streetlight + max foot traffic combine to 45% discount', () => {
  assert.ok(Math.abs(computeEdgeCost(100, { hasStreetlight: true, footTrafficScore: 1 }) - 55) < 1e-9);
});

test('computeEdgeCost: footTrafficScore outside [0,1] is clamped, not extrapolated', () => {
  // 5를 넣어도 1로 클램프되어 결과는 footTrafficScore:1과 동일해야 함 (5배 할인되면 안 됨)
  const withExtreme = computeEdgeCost(100, { hasStreetlight: true, footTrafficScore: 5 });
  const withMax = computeEdgeCost(100, { hasStreetlight: true, footTrafficScore: 1 });
  assert.equal(withExtreme, withMax);
});

test('dijkstra picks the shorter unlit path when nothing is lit', () => {
  const nodes = new Map([
    ['A', { lat: 0, lng: 0 }],
    ['B', { lat: 0, lng: 0.001 }],
    ['C', { lat: 0.0005, lng: 0.0005 }],
  ]);
  const edges = [
    { id: 'AB', fromId: 'A', toId: 'B', distanceMeters: 100 },
    { id: 'AC', fromId: 'A', toId: 'C', distanceMeters: 90 },
    { id: 'CB', fromId: 'C', toId: 'B', distanceMeters: 20 },
  ];
  const result = dijkstra(nodes, edges, 'A', 'B');
  assert.deepEqual(result.nodeIds, ['A', 'B']);
  assert.equal(result.totalCost, 100);
});

test('dijkstra prefers the longer lit detour once the discount makes it cheaper', () => {
  const nodes = new Map([
    ['A', { lat: 0, lng: 0 }],
    ['B', { lat: 0, lng: 0.001 }],
    ['C', { lat: 0.0005, lng: 0.0005 }],
  ]);
  const edges = [
    { id: 'AB', fromId: 'A', toId: 'B', distanceMeters: 100, hasStreetlight: false },
    { id: 'AC', fromId: 'A', toId: 'C', distanceMeters: 90, hasStreetlight: true },
    { id: 'CB', fromId: 'C', toId: 'B', distanceMeters: 20, hasStreetlight: true },
  ];
  // A-C-B 실제 비용: 90*0.75 + 20*0.75 = 82.5 < A-B 직행 100
  const result = dijkstra(nodes, edges, 'A', 'B');
  assert.deepEqual(result.nodeIds, ['A', 'C', 'B']);
  assert.equal(result.totalCost, 82.5);
});

test('dijkstra returns null when start/end are disconnected', () => {
  const nodes = new Map([
    ['A', { lat: 0, lng: 0 }],
    ['B', { lat: 1, lng: 1 }],
  ]);
  const result = dijkstra(nodes, [], 'A', 'B');
  assert.equal(result, null);
});

test('findNearestNode returns the closest node id', () => {
  const nodes = new Map([
    ['A', { lat: 37.5, lng: 127.0 }],
    ['B', { lat: 37.6, lng: 127.1 }],
  ]);
  const nearest = findNearestNode(nodes, 37.501, 127.001);
  assert.equal(nearest.id, 'A');
});
