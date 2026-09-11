import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frechetDistance,
  hausdorffDistance,
  computeSimilarityScore,
  analyzeGpsSimilarity,
} from './patternMatchService.js';
import { supabase } from './supabaseService.js';

const A = [
  { lat: 37.5665, lng: 126.978 },
  { lat: 37.5666, lng: 126.9781 },
  { lat: 37.5667, lng: 126.9782 },
];

test('frechetDistance is 0 for identical paths', () => {
  assert.equal(frechetDistance(A, A), 0);
});

test('hausdorffDistance is 0 for identical paths', () => {
  assert.equal(hausdorffDistance(A, A), 0);
});

test('frechetDistance grows with a shifted path', () => {
  const shifted = A.map((p) => ({ lat: p.lat + 0.01, lng: p.lng })); // ~1.1km 북쪽으로 이동
  const d = frechetDistance(A, shifted);
  assert.ok(d > 1000, `expected >1000m shift, got ${d}`);
});

test('computeSimilarityScore is 100 for identical paths and near 0 for far paths', () => {
  const identical = computeSimilarityScore(A, A);
  assert.equal(identical.similarityScore, 100);

  const far = A.map((p) => ({ lat: p.lat + 0.01, lng: p.lng }));
  const farScore = computeSimilarityScore(A, far);
  assert.equal(farScore.similarityScore, 0);
});

test('analyzeGpsSimilarity rejects sparse GPS logs without querying the DB', async () => {
  const result = await analyzeGpsSimilarity(A, [{ lat: 1, lng: 1 }], 'user-1');
  assert.equal(result.rewardEligible, false);
  assert.match(result.message, /부족/);
});

test('analyzeGpsSimilarity denies reward when similarity is below threshold', async () => {
  const far = A.map((p) => ({ lat: p.lat + 0.01, lng: p.lng }));
  const result = await analyzeGpsSimilarity(A, far, 'user-1');
  assert.equal(result.rewardEligible, false);
  assert.match(result.message, /기준/);
});

test('analyzeGpsSimilarity grants reward when similar enough and RPC confirms first claim', async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = async (fnName, args) => {
    assert.equal(fnName, 'complete_course_walk');
    assert.equal(args.p_course_name, '하트');
    return { data: [{ reward_granted: true }], error: null };
  };
  try {
    const result = await analyzeGpsSimilarity(A, A, 'user-1', 'heart');
    assert.equal(result.rewardEligible, true);
    assert.equal(result.similarityScore, 100);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test('analyzeGpsSimilarity denies reward when RPC says already claimed today', async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = async () => ({ data: [{ reward_granted: false }], error: null });
  try {
    const result = await analyzeGpsSimilarity(A, A, 'user-1', 'heart');
    assert.equal(result.rewardEligible, false);
    assert.match(result.message, /이미/);
  } finally {
    supabase.rpc = originalRpc;
  }
});
