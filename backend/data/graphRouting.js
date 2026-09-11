import { haversineMeters } from './geoUtils.js';

/**
 * 소프트 가중치 비용 공식 - 가로등/유동인구가 없어도 기본 거리로 통과 가능(하드 제약 없음),
 * 있으면 비용을 할인해줌.
 * Road Cost = 거리(m) * (1 - (가로등 존재 시 0.25) - (유동인구 점수 0.0~1.0 * 0.20))
 */
const STREETLIGHT_DISCOUNT = 0.25;
const FOOT_TRAFFIC_WEIGHT = 0.2;

export function computeEdgeCost(distanceMeters, { hasStreetlight = false, footTrafficScore = 0 } = {}) {
  const clampedFootTraffic = Math.max(0, Math.min(1, footTrafficScore));
  const discount = (hasStreetlight ? STREETLIGHT_DISCOUNT : 0) + clampedFootTraffic * FOOT_TRAFFIC_WEIGHT;
  // 할인이 100%를 넘는 극단적인 경우(둘 다 최대)에도 비용이 음수/0이 되지 않게 최소 10%는 남김
  const multiplier = Math.max(0.1, 1 - discount);
  return distanceMeters * multiplier;
}

/**
 * 범용 다익스트라 최단(최소 비용) 경로 탐색.
 * @param {Map<string, {lat:number, lng:number}>} nodes - nodeId -> 좌표
 * @param {Array<{id:string, fromId:string, toId:string, distanceMeters:number, hasStreetlight?:boolean, footTrafficScore?:number}>} edges
 *   양방향 도로로 취급 (fromId<->toId 둘 다 통행 가능)
 * @param {string} startNodeId
 * @param {string} endNodeId
 * @returns {{ nodeIds: string[], totalCost: number } | null} 경로 없으면 null
 */
export function dijkstra(nodes, edges, startNodeId, endNodeId) {
  if (!nodes.has(startNodeId) || !nodes.has(endNodeId)) return null;

  const adjacency = new Map(); // nodeId -> [{ to, cost }]
  for (const edge of edges) {
    const cost = computeEdgeCost(edge.distanceMeters, edge);
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, []);
    if (!adjacency.has(edge.toId)) adjacency.set(edge.toId, []);
    adjacency.get(edge.fromId).push({ to: edge.toId, cost });
    adjacency.get(edge.toId).push({ to: edge.fromId, cost });
  }

  const dist = new Map([[startNodeId, 0]]);
  const prev = new Map();
  const visited = new Set();
  // ponytail: 우선순위 큐 없이 매번 선형 탐색 - 노드 수가 많아지면(수천+) 느려짐.
  // 실사용 규모가 커지면 min-heap 기반으로 교체할 것.
  const queue = new Set([startNodeId]);

  while (queue.size > 0) {
    let current = null;
    let currentDist = Infinity;
    for (const id of queue) {
      const d = dist.get(id) ?? Infinity;
      if (d < currentDist) {
        currentDist = d;
        current = id;
      }
    }
    if (current === null) break;
    queue.delete(current);
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === endNodeId) break;

    for (const { to, cost } of adjacency.get(current) ?? []) {
      if (visited.has(to)) continue;
      const candidate = currentDist + cost;
      if (candidate < (dist.get(to) ?? Infinity)) {
        dist.set(to, candidate);
        prev.set(to, current);
        queue.add(to);
      }
    }
  }

  if (!dist.has(endNodeId)) return null;

  const nodeIds = [endNodeId];
  let cursor = endNodeId;
  while (cursor !== startNodeId) {
    cursor = prev.get(cursor);
    if (cursor === undefined) return null;
    nodeIds.unshift(cursor);
  }

  return { nodeIds, totalCost: dist.get(endNodeId) };
}

/** 그래프에서 주어진 좌표와 가장 가까운 노드를 찾음 */
export function findNearestNode(nodes, lat, lng) {
  let bestId = null;
  let bestDist = Infinity;
  for (const [id, pos] of nodes) {
    const d = haversineMeters(lat, lng, pos.lat, pos.lng);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return bestId === null ? null : { id: bestId, distanceMeters: bestDist };
}
