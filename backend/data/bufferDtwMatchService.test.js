import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dtwDistance,
  computeContainmentRatio,
  computeMatchPercent,
  isRewardEligible,
} from './bufferDtwMatchService.js';

const TARGET = [
  { lat: 37.5665, lng: 126.978 },
  { lat: 37.5666, lng: 126.9781 },
  { lat: 37.5667, lng: 126.9782 },
  { lat: 37.5668, lng: 126.9783 },
];

test('dtwDistance is 0 for identical paths', () => {
  assert.equal(dtwDistance(TARGET, TARGET), 0);
});

test('computeContainmentRatio is 1.0 when the user walked exactly the target path', () => {
  assert.equal(computeContainmentRatio(TARGET, TARGET), 1);
});

test('computeContainmentRatio is 0 when the user path is far outside the 15m buffer', () => {
  const farAway = TARGET.map((p) => ({ lat: p.lat + 0.01, lng: p.lng })); // ~1.1km 이동
  assert.equal(computeContainmentRatio(TARGET, farAway), 0);
});

test('computeMatchPercent is 100 for an exact match and eligible for reward', () => {
  const { matchPercent } = computeMatchPercent(TARGET, TARGET);
  assert.equal(matchPercent, 100);
  assert.equal(isRewardEligible(matchPercent), true);
});

test('computeMatchPercent is low for a far-away path and not eligible', () => {
  const farAway = TARGET.map((p) => ({ lat: p.lat + 0.01, lng: p.lng }));
  const { matchPercent } = computeMatchPercent(TARGET, farAway);
  assert.ok(matchPercent < 85);
  assert.equal(isRewardEligible(matchPercent), false);
});

test('computeMatchPercent tolerates small GPS jitter (~5m) and still qualifies', () => {
  const jittered = TARGET.map((p) => ({ lat: p.lat + 0.00003, lng: p.lng + 0.00003 })); // ~4m
  const { matchPercent } = computeMatchPercent(TARGET, jittered);
  assert.ok(matchPercent >= 85, `expected >=85, got ${matchPercent}`);
});

test('isRewardEligible threshold is exactly 85', () => {
  assert.equal(isRewardEligible(85), true);
  assert.equal(isRewardEligible(84), false);
});
