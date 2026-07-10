import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePacks, findPack, DEFAULT_PACKS_JSON } from '../src/pricing.ts';

test('default catalog parses to three ascending packs', () => {
  const packs = parsePacks(DEFAULT_PACKS_JSON);
  assert.equal(packs.length, 3);
  assert.deepEqual(packs.map((p) => p.questions), [100, 300, 1000]);
  assert.ok(packs.every((p) => p.amountCents > 0));
  // Bigger packs are better value (cents per question strictly decreasing).
  const per = packs.map((p) => p.amountCents / p.questions);
  assert.ok(per[0]! > per[1]! && per[1]! > per[2]!);
});

test('a valid custom catalog is honored', () => {
  const packs = parsePacks(JSON.stringify([{ id: 'mini', questions: 10, amount_cents: 100 }]));
  assert.deepEqual(packs, [{ id: 'mini', questions: 10, amountCents: 100 }]);
});

test('malformed JSON falls back to the default catalog', () => {
  assert.equal(parsePacks('not json').length, 3);
  assert.equal(parsePacks('{}').length, 3);
  assert.equal(parsePacks('[]').length, 3);
});

test('invalid packs (bad id / non-positive numbers / duplicates) fall back wholesale', () => {
  const bad = [
    [{ id: '', questions: 10, amount_cents: 100 }],
    [{ id: 'a b', questions: 10, amount_cents: 100 }],
    [{ id: 'x', questions: 0, amount_cents: 100 }],
    [{ id: 'x', questions: 10, amount_cents: 0 }],
    [{ id: 'x', questions: -5, amount_cents: 100 }],
    [
      { id: 'dup', questions: 10, amount_cents: 100 },
      { id: 'dup', questions: 20, amount_cents: 200 },
    ],
  ];
  for (const catalog of bad) {
    assert.equal(parsePacks(JSON.stringify(catalog)).length, 3, JSON.stringify(catalog));
  }
});

test('findPack resolves by id and rejects unknown ids', () => {
  const packs = parsePacks(DEFAULT_PACKS_JSON);
  assert.equal(findPack(packs, 'pack100')?.questions, 100);
  assert.equal(findPack(packs, 'nope'), null);
  assert.equal(findPack(packs, ''), null);
});
