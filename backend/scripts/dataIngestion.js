import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// 수집 스크립트는 RLS를 우회해야 하므로 service role 키 사용 (anon 키 아님, 절대 프런트엔드에 넣지 말 것)
// 지연 생성: 순수 헬퍼(pick/extractRows/toFacilityRecord)만 쓰는 테스트에서 자격증명 없이도 import 가능하게 함
function getSupabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const DATA_GO_KR_KEY = process.env.DATA_GO_KR_API_KEY;

// 행정안전부 표준데이터(전국 CCTV/비상벨/보안등 설치현황) API 3종
const SOURCES = [
  { type: 'CCTV', url: process.env.CCTV_API_URL },
  { type: 'BELL', url: process.env.BELL_API_URL },
  { type: 'LIGHT', url: process.env.LIGHT_API_URL },
];

// 데이터셋마다 필드명이 제각각(위도/latitude/la 등)이라 후보 목록 중 첫 매치를 사용
export function pick(row, candidates) {
  for (const key of candidates) {
    const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== '') return row[found];
  }
  return undefined;
}

// 행안부 표준데이터 API는 [{head:[...]},{row:[...]}] 형태, 신형 API는 response.body.items 형태로 혼재
export function extractRows(json) {
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

async function fetchAllRows(url) {
  const rows = [];
  const numOfRows = 1000;
  for (let pageNo = 1; ; pageNo += 1) {
    const { data } = await axios.get(url, {
      // axios가 params를 URL 인코딩하므로, data.go.kr이 발급한 (이미 인코딩된) 키를 그대로 넣으면
      // 이중 인코딩(%3D%3D -> %253D%253D)되어 인증이 깨짐. 디코딩해서 넘겨 한 번만 인코딩되게 함.
      params: { serviceKey: decodeURIComponent(DATA_GO_KR_KEY), pageNo, numOfRows, type: 'json' },
    });
    const page = extractRows(data);
    rows.push(...page);
    if (page.length < numOfRows) break;
  }
  return rows;
}

export function toFacilityRecord(row, facilityType) {
  const lat = Number(pick(row, ['위도', 'latitude', 'lat', 'la', 'refine_wgs84_lat']));
  const lng = Number(pick(row, ['경도', 'longitude', 'lng', 'lo', 'refine_wgs84_logt']));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    facility_type: facilityType,
    lat,
    lng,
    location: `POINT(${lng} ${lat})`,
    address: pick(row, ['소재지지번주소', '소재지도로명주소', 'address']) ?? null,
    install_agency: pick(row, ['관리기관명', 'installAgency']) ?? null,
  };
}

async function ingestSource({ type, url }) {
  if (!url) {
    console.warn(`[dataIngestion] ${type} API URL 미설정 - 건너뜀`);
    return;
  }

  const rawRows = await fetchAllRows(url);
  const records = rawRows.map((row) => toFacilityRecord(row, type)).filter(Boolean);

  const BATCH_SIZE = 500;
  const supabaseAdmin = getSupabaseAdmin();
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from('safety_facilities')
      .upsert(batch, { onConflict: 'facility_type,lat,lng' });
    if (error) console.error(`[dataIngestion] ${type} upsert 실패:`, error.message);
  }

  console.log(`[dataIngestion] ${type}: ${records.length}건 저장 완료`);
}

async function main() {
  for (const source of SOURCES) {
    await ingestSource(source);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[dataIngestion] 실패:', err.response?.data ?? err.message);
    process.exit(1);
  });
}
