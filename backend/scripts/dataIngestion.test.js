import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick, extractRows, toFacilityRecord } from './dataIngestion.js';

test('pick finds first matching field case-insensitively', () => {
  assert.equal(pick({ 위도: '37.5' }, ['위도', 'latitude']), '37.5');
  assert.equal(pick({ Latitude: '37.5' }, ['위도', 'latitude']), '37.5');
  assert.equal(pick({}, ['위도', 'latitude']), undefined);
});

test('extractRows handles [{head},{row}] shape', () => {
  const json = [{ head: [{ totalCount: 1 }] }, { row: [{ a: 1 }, { a: 2 }] }];
  assert.deepEqual(extractRows(json), [{ a: 1 }, { a: 2 }]);
});

test('extractRows handles response.body.items shape', () => {
  const json = { response: { body: { items: [{ a: 1 }] } } };
  assert.deepEqual(extractRows(json), [{ a: 1 }]);
});

test('extractRows returns [] for unknown shape', () => {
  assert.deepEqual(extractRows({ foo: 'bar' }), []);
});

test('toFacilityRecord maps known lat/lng fields', () => {
  const record = toFacilityRecord({ 위도: '37.1', 경도: '127.2', 관리기관명: '서울시' }, 'CCTV');
  assert.deepEqual(record, {
    facility_type: 'CCTV',
    lat: 37.1,
    lng: 127.2,
    location: 'POINT(127.2 37.1)',
    address: null,
    install_agency: '서울시',
  });
});

test('toFacilityRecord returns null when lat/lng missing', () => {
  assert.equal(toFacilityRecord({ foo: 'bar' }, 'CCTV'), null);
});
