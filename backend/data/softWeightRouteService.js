import { toShapeWaypoints, SHAPE_NAMES } from './shapeTemplates.js';
import { fetchRoadNetwork } from './osmRoadNetwork.js';
import { dijkstra, findNearestNode } from './graphRouting.js';
import { haversineMeters } from './geoUtils.js';

// 별 꼭짓점을 도로 노드에 스냅할 때 이보다 멀면 "그래프에 근처 도로 없음"으로 보고
// 직선 연결로 폴백함 (엉뚱하게 먼 도로에 억지로 붙는 것을 방지)
const MAX_SNAP_DISTANCE_M = 150;

// 인접 꼭짓점 간 도로망 경로를 못 찾거나(끊김) 스냅 실패 시, 직선으로 보간해
// 최소한 도형 형태는 유지함 (요구사항: "길이 끊길 경우 최단 연결로 도형 형태 유지")
function straightLineSegment(from, to, stepMeters = 20) {
  const distanceM = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  const steps = Math.max(1, Math.ceil(distanceM / stepMeters));
  const coords = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    coords.push({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
  }
  return coords;
}

function nodeIdsToCoords(nodes, nodeIds) {
  return nodeIds.map((id) => nodes.get(id));
}

/**
 * 별 모양 꼭짓점들을 순서대로 소프트 가중치 최소 비용 경로로 이어 폐곡선 산책로를 만듦.
 * 가로등 없는 도로도 기본 거리로 통과 가능(하드 제약 없음), 있으면 비용만 할인됨.
 * @param {{lat:number, lng:number}[]} vertices - generateStarVertices 결과
 * @param {{ nodes: Map, edges: Array }} graph - fetchRoadNetwork 결과
 * @returns {{ coords: {lat:number,lng:number}[], segments: Array<{fromVertex:number,toVertex:number,usedRoadNetwork:boolean,cost:number|null}> }}
 */
export function mapStarToRoadNetwork(vertices, graph) {
  const coords = [];
  const segments = [];

  for (let i = 0; i < vertices.length; i += 1) {
    const from = vertices[i];
    const to = vertices[(i + 1) % vertices.length];

    const fromNear = findNearestNode(graph.nodes, from.lat, from.lng);
    const toNear = findNearestNode(graph.nodes, to.lat, to.lng);

    let segmentCoords = null;
    let cost = null;
    let usedRoadNetwork = false;

    if (fromNear && toNear && fromNear.distanceMeters <= MAX_SNAP_DISTANCE_M && toNear.distanceMeters <= MAX_SNAP_DISTANCE_M) {
      const result = dijkstra(graph.nodes, graph.edges, fromNear.id, toNear.id);
      if (result) {
        segmentCoords = nodeIdsToCoords(graph.nodes, result.nodeIds);
        cost = result.totalCost;
        usedRoadNetwork = true;
      }
    }

    if (!segmentCoords) {
      segmentCoords = straightLineSegment(from, to);
    }

    coords.push(...(coords.length ? segmentCoords.slice(1) : segmentCoords));
    segments.push({ fromVertex: i, toVertex: (i + 1) % vertices.length, usedRoadNetwork, cost });
  }

  return { coords, segments };
}

/**
 * 도형 템플릿(shapeTemplates.js: rhombus/star/heart/crown/fish)을 사용자 위치+반경 기준으로
 * 배치한 뒤, 도로망에 소프트 가중치로 정렬한 산책로를 생성 (안심귀갓길과 완전 분리된 독립 로직)
 * @param {{shapeName:'rhombus'|'star'|'heart'|'crown'|'fish', centerLat:number, centerLng:number, radiusKm:number}} params
 * @returns {Promise<{ waypoints: {lat:number,lng:number}[], geojson: object, segments: Array }>}
 */
export async function generateSoftWeightShapeRoute({ shapeName, centerLat, centerLng, radiusKm }) {
  if (!SHAPE_NAMES.includes(shapeName)) {
    throw new Error(`알 수 없는 도형: ${shapeName} (사용 가능: ${SHAPE_NAMES.join(', ')})`);
  }
  const vertices = toShapeWaypoints(shapeName, centerLat, centerLng, radiusKm).map(([lng, lat]) => ({ lat, lng }));
  // 그래프는 도형의 외곽 반경보다 여유 있게 가져와야 스냅/경로탐색이 경계에서 끊기지 않음
  const graph = await fetchRoadNetwork(centerLat, centerLng, radiusKm * 1.3);
  const { coords, segments } = mapStarToRoadNetwork(vertices, graph);

  return {
    waypoints: coords,
    segments,
    geojson: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coords.map((c) => [c.lng, c.lat]),
      },
      properties: { shape: shapeName, centerLat, centerLng, radiusKm },
    },
  };
}

/** 하위호환: 기존 star 전용 호출부(api/soft-weight-route.js 등)를 위한 얇은 래퍼 */
export async function generateSoftWeightStarRoute(params) {
  return generateSoftWeightShapeRoute({ ...params, shapeName: 'star' });
}
