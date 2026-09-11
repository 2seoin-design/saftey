import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapStarToRoadNetwork } from './softWeightRouteService.js';

// 정사각형 4꼭짓점 - vertex 0,1 근처에만 도로망 노드가 있고 나머지는 도로망이 전혀 없음
const vertices = [
  { lat: 37.5, lng: 127.0 }, // v0
  { lat: 37.5, lng: 127.001 }, // v1 (v0와 아주 가까움, 실제 도로로 연결됨)
  { lat: 37.6, lng: 127.1 }, // v2 (도로망 전혀 없는 먼 지역)
  { lat: 37.7, lng: 127.2 }, // v3 (도로망 전혀 없는 먼 지역)
];

const graph = {
  nodes: new Map([
    ['n0', { lat: 37.5, lng: 127.0 }],
    ['n1', { lat: 37.5, lng: 127.001 }],
  ]),
  edges: [{ id: 'e0', fromId: 'n0', toId: 'n1', distanceMeters: 88 }],
};

test('mapStarToRoadNetwork uses the road network when a nearby path exists', () => {
  const { segments } = mapStarToRoadNetwork(vertices, graph);
  assert.equal(segments[0].usedRoadNetwork, true);
  assert.ok(segments[0].cost > 0);
});

test('mapStarToRoadNetwork falls back to a straight line when no road network is nearby', () => {
  const { segments } = mapStarToRoadNetwork(vertices, graph);
  // v1->v2, v2->v3, v3->v0 모두 그래프에 노드가 없으므로 직선 폴백이어야 함
  assert.equal(segments[1].usedRoadNetwork, false);
  assert.equal(segments[2].usedRoadNetwork, false);
  assert.equal(segments[3].usedRoadNetwork, false);
});

test('mapStarToRoadNetwork still produces a continuous coordinate path covering all vertices', () => {
  const { coords } = mapStarToRoadNetwork(vertices, graph);
  assert.ok(coords.length >= vertices.length);
  // 시작점이 v0와 일치해야 함(첫 좌표)
  assert.equal(coords[0].lat, vertices[0].lat);
  assert.equal(coords[0].lng, vertices[0].lng);
});
