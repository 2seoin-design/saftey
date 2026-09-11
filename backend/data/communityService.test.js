import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotalPages } from './communityService.js';

test('computeTotalPages', () => {
  assert.equal(computeTotalPages(0), 1);
  assert.equal(computeTotalPages(1), 1);
  assert.equal(computeTotalPages(20), 1);
  assert.equal(computeTotalPages(21), 2);
  assert.equal(computeTotalPages(40), 2);
  assert.equal(computeTotalPages(41), 3);
});
