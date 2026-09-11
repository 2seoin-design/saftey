import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphFromOverpass } from './osmRoadNetwork.js';

// 실제 Overpass 응답과 동일한 모양의 축소판 - 네트워크 호출 없이 파싱 로직만 검증
const sampleElements = [
  { type: 'node', id: 1, lat: 37.5, lon: 127.0 },
  { type: 'node', id: 2, lat: 37.5001, lon: 127.0 }, // node 1과 매우 가까움 -> 가로등 반경 내
  { type: 'node', id: 3, lat: 37.51, lon: 127.01 }, // 멀리 떨어짐 -> 가로등 없음
  { type: 'node', id: 100, lat: 37.50005, lon: 127.0, tags: { highway: 'street_lamp' } },
  { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
  { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'residential' } },
];

test('buildGraphFromOverpass parses nodes and edges', () => {
  const { nodes, edges } = buildGraphFromOverpass(sampleElements);
  assert.equal(nodes.size, 4); // 가로등 노드(100)도 좌표를 가지므로 nodes에 포함됨
  assert.equal(edges.length, 2);
});

test('buildGraphFromOverpass marks edges near a streetlight as hasStreetlight', () => {
  const { edges } = buildGraphFromOverpass(sampleElements);
  const nearLamp = edges.find((e) => e.id === '10-0'); // node1-node2, 가로등(100) 바로 근처
  const farFromLamp = edges.find((e) => e.id === '11-0'); // node2-node3, 멀리 떨어짐
  assert.equal(nearLamp.hasStreetlight, true);
  assert.equal(farFromLamp.hasStreetlight, false);
});

test('buildGraphFromOverpass defaults footTrafficScore to 0 (no real data source yet)', () => {
  const { edges } = buildGraphFromOverpass(sampleElements);
  assert.ok(edges.every((e) => e.footTrafficScore === 0));
});

test('buildGraphFromOverpass skips edges referencing nodes outside the fetched set', () => {
  const withDanglingRef = [
    ...sampleElements,
    { type: 'way', id: 12, nodes: [3, 9999], tags: { highway: 'residential' } },
  ];
  const { edges } = buildGraphFromOverpass(withDanglingRef);
  assert.equal(edges.length, 2); // 12번 way는 9999 노드 좌표가 없어 건너뜀
});
