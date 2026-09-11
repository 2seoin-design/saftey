// Vercel 서버리스 함수: CCTV/비상벨 공공데이터를 실시간으로 받아와 중계.
// data.go.kr 서비스키는 여기(서버)에만 존재 - 브라우저에는 절대 노출되지 않음.
// GET /api/facilities -> [{ facility_type, lat, lng, address, install_agency }, ...]

const SOURCES = {
  CCTV: process.env.CCTV_API_URL,
  BELL: process.env.BELL_API_URL,
};

// 데이터셋마다 필드명이 제각각(위도/latitude/la 등)이라 후보 목록 중 첫 매치를 사용
function pick(row, candidates) {
  for (const key of candidates) {
    const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== '') return row[found];
  }
  return undefined;
}

// 행안부 표준데이터 API는 [{head:[...]},{row:[...]}] 형태, 신형 API는 response.body.items 형태로 혼재
function extractRows(json) {
  if (Array.isArray(json)) {
    const rowBlock = json.find((b) => Array.isArray(b?.row));
    if (rowBlock) return rowBlock.row;
  }
  if (json?.response?.body?.items) {
    const items = json.response.body.items;
    return Array.isArray(items) ? items : (items.item ?? []);
  }
  for (const value of Object.values(json ?? {})) {
    if (Array.isArray(value)) {
      const rowBlock = value.find((b) => Array.isArray(b?.row));
      if (rowBlock) return rowBlock.row;
    }
  }
  return [];
}

async function fetchAllRows(url, key) {
  const rows = [];
  const numOfRows = 1000;
  for (let pageNo = 1; ; pageNo += 1) {
    const qs = new URLSearchParams({ serviceKey: key, pageNo, numOfRows, type: 'json' });
    const res = await fetch(`${url}?${qs}`);
    const json = await res.json();
    const page = extractRows(json);
    rows.push(...page);
    if (page.length < numOfRows) break;
  }
  return rows;
}

function toFacilityRecord(row, facilityType) {
  const lat = Number(pick(row, ['위도', 'latitude', 'lat', 'la', 'refine_wgs84_lat']));
  const lng = Number(pick(row, ['경도', 'longitude', 'lng', 'lo', 'refine_wgs84_logt']));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    facility_type: facilityType,
    lat,
    lng,
    address: pick(row, ['소재지지번주소', '소재지도로명주소', 'address']) ?? null,
    install_agency: pick(row, ['관리기관명', 'installAgency']) ?? null,
  };
}

// data.go.kr을 매 요청마다 다시 부르면 느리고 쿼터도 낭비되므로, 서버리스 인스턴스가
// 살아있는 동안(warm)은 메모리에 캐시해서 재사용 - ponytail: 콜드스타트 시 캐시 초기화됨,
// 트래픽이 커지면 Vercel KV/Edge Config 같은 영속 캐시로 교체할 것
let cache = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function loadFacilities() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

  const key = process.env.DATA_GO_KR_API_KEY;
  const results = [];
  for (const [type, url] of Object.entries(SOURCES)) {
    if (!url) continue;
    const rows = await fetchAllRows(url, key);
    for (const row of rows) {
      const facility = toFacilityRecord(row, type);
      if (facility) results.push(facility);
    }
  }
  cache = results;
  cachedAt = Date.now();
  return cache;
}

export default async function handler(req, res) {
  try {
    const facilities = await loadFacilities();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json(facilities);
  } catch (err) {
    res.status(502).json({ error: '공공데이터 조회 실패', detail: err.message });
  }
}
