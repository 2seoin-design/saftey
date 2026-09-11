import { haversineMeters } from './geoUtils.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// 자동차 전용/보행 불가 도로는 제외 (보행자 산책로용 그래프이므로)
const EXCLUDED_HIGHWAY_TYPES = ['motorway', 'motorway_link', 'trunk', 'trunk_link'];

// 도로 구간(edge) 중간점 기준 이 거리(m) 이내에 가로등 노드가 있으면 "가로등 있음"으로 판정
const STREETLIGHT_MATCH_RADIUS_M = 30;

function bboxFromCenter(centerLat, centerLng, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  return {
    south: centerLat - latDelta,
    west: centerLng - lngDelta,
    north: centerLat + latDelta,
    east: centerLng + lngDelta,
  };
}

async function queryOverpass(query) {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass 서버(Apache)가 Node의 기본 fetch Accept/User-Agent 조합을 406으로 거부해서 명시함
      Accept: '*/*',
      'User-Agent': 'saftey-app/1.0',
    },
  });
  if (!res.ok) throw new Error(`Overpass 요청 실패 (${res.status})`);
  return res.json();
}

/**
 * 중심좌표 반경 내의 보행 가능 도로망(Nodes/Edges)과 가로등 위치를 OSM에서 가져와
 * graphRouting.js가 바로 쓸 수 있는 그래프로 변환.
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusKm
 * @returns {Promise<{ nodes: Map<string,{lat:number,lng:number}>, edges: Array }>}
 */
export async function fetchRoadNetwork(centerLat, centerLng, radiusKm) {
  const bbox = bboxFromCenter(centerLat, centerLng, radiusKm);
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  const highwayFilter = EXCLUDED_HIGHWAY_TYPES.map((t) => `["highway"!="${t}"]`).join('');
  const query = `
    [out:json][timeout:25];
    (
      way["highway"]${highwayFilter}(${bboxStr});
      node["highway"="street_lamp"](${bboxStr});
    );
    out body;
    >;
    out skel qt;
  `;

  const json = await queryOverpass(query);
  return buildGraphFromOverpass(json.elements ?? []);
}

export function buildGraphFromOverpass(elements) {
  const nodes = new Map();
  const streetlights = [];
  const ways = [];

  for (const el of elements) {
    if (el.type === 'node') {
      nodes.set(String(el.id), { lat: el.lat, lng: el.lon });
      if (el.tags?.highway === 'street_lamp') {
        streetlights.push({ lat: el.lat, lng: el.lon });
      }
    } else if (el.type === 'way' && Array.isArray(el.nodes)) {
      ways.push(el);
    }
  }

  function hasNearbyStreetlight(lat, lng) {
    return streetlights.some((lamp) => haversineMeters(lat, lng, lamp.lat, lamp.lng) <= STREETLIGHT_MATCH_RADIUS_M);
  }

  const edges = [];
  for (const way of ways) {
    for (let i = 0; i < way.nodes.length - 1; i += 1) {
      const fromId = String(way.nodes[i]);
      const toId = String(way.nodes[i + 1]);
      const from = nodes.get(fromId);
      const to = nodes.get(toId);
      if (!from || !to) continue; // bbox 경계에서 잘린 way의 바깥쪽 노드는 좌표가 없을 수 있음

      const distanceMeters = haversineMeters(from.lat, from.lng, to.lat, to.lng);
      const midLat = (from.lat + to.lat) / 2;
      const midLng = (from.lng + to.lng) / 2;

      edges.push({
        id: `${way.id}-${i}`,
        fromId,
        toId,
        distanceMeters,
        hasStreetlight: hasNearbyStreetlight(midLat, midLng),
        // 유동인구 실데이터 소스가 아직 없어 0으로 둠 (soft weight 공식은 0이면 영향 없음) -
        // ponytail: 실제 유동인구 데이터를 구하면 이 값을 채우기만 하면 나머지 로직은 그대로 동작
        footTrafficScore: 0,
      });
    }
  }

  return { nodes, edges };
}
