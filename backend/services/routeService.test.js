import { test } from 'node:test';
import assert from 'node:assert/strict';

// import 문은 ESM에서 호이스팅되므로, 자격증명 없이도 로드되도록 동적 import 전에 설정
process.env.REACT_APP_SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.REACT_APP_SUPABASE_ANON_KEY ??= 'placeholder';
const { buildPassList } = await import('./routeService.js');

test('buildPassList prioritizes BELL > CCTV > LIGHT and caps at limit', () => {
  const facilities = [
    { facility_type: 'LIGHT', lat: 1, lng: 1 },
    { facility_type: 'BELL', lat: 2, lng: 2 },
    { facility_type: 'CCTV', lat: 3, lng: 3 },
    { facility_type: 'BELL', lat: 4, lng: 4 },
    { facility_type: 'LIGHT', lat: 5, lng: 5 },
  ];
  assert.equal(buildPassList(facilities, 3), '2,2_4,4_3,3');
});

test('buildPassList returns empty string for no facilities', () => {
  assert.equal(buildPassList([]), '');
});
