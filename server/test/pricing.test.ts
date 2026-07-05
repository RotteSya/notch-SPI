import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costCents } from '../src/pricing.ts';

test('cost rounds up so we never undercharge', () => {
  // 1200 in @1500/M + 480 out @7500/M = 1.8 + 3.6 = 5.4 cents → 6
  assert.equal(costCents(1200, 480, 1500, 7500), 6);
});

test('any non-zero usage costs at least 1 cent', () => {
  assert.equal(costCents(1, 0, 1500, 7500), 1);
  assert.equal(costCents(0, 1, 1500, 7500), 1);
});

test('zero usage is free', () => {
  assert.equal(costCents(0, 0, 1500, 7500), 0);
});

test('negative token counts are clamped to zero', () => {
  assert.equal(costCents(-100, -100, 1500, 7500), 0);
});

test('large usage scales linearly', () => {
  // 1,000,000 out @7500/M = 7500 cents exactly
  assert.equal(costCents(0, 1_000_000, 1500, 7500), 7500);
});
