import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotalPages } from './communityService.js';

test('computeTotalPages', () => {
  assert.equal(computeTotalPages(0), 1);
  assert.equal(computeTotalPages(1), 1);
  assert.equal(computeTotalPages(10), 1);
  assert.equal(computeTotalPages(11), 2);
  assert.equal(computeTotalPages(20), 2);
  assert.equal(computeTotalPages(21), 3);
});
