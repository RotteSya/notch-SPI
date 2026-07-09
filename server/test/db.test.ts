import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/db.ts';

function freshStore(): SqliteStore {
  return new SqliteStore(':memory:');
}

test('registerDevice grants the trial questions and returns a token', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'macos', appVersion: '2.0', trialQuestions: 180 });
  assert.match(dev.token, /^dev_/);
  assert.equal(dev.balanceQuestions, 180);
  store.close();
});

test('getAccount reflects registration; unknown token is null', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialQuestions: 180 });
  const acct = store.getAccount(dev.token);
  assert.deepEqual(acct, {
    balanceQuestions: 180,
    totalQuestions: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  });
  assert.equal(store.getAccount('dev_nope'), null);
  store.close();
});

test('chargeForUsage deducts questions and accumulates totals atomically', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialQuestions: 180 });
  const b1 = store.chargeForUsage({ token: dev.token, questions: 1, inputTokens: 1200, outputTokens: 480, model: 'mock' });
  assert.equal(b1, 179);
  const b2 = store.chargeForUsage({ token: dev.token, questions: 1, inputTokens: 100, outputTokens: 50, model: 'mock' });
  assert.equal(b2, 178);
  const acct = store.getAccount(dev.token);
  assert.equal(acct?.totalQuestions, 2);
  assert.equal(acct?.totalInputTokens, 1300);
  assert.equal(acct?.totalOutputTokens, 530);
  store.close();
});

test('balance may go negative when a capture was in flight at zero', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialQuestions: 0 });
  const b = store.chargeForUsage({ token: dev.token, questions: 1, inputTokens: 0, outputTokens: 1000, model: 'mock' });
  assert.equal(b, -1); // honest accounting; the pre-request gate blocks the NEXT capture
  store.close();
});

test('chargeForUsage / credit on an unknown token return null', () => {
  const store = freshStore();
  assert.equal(
    store.chargeForUsage({ token: 'dev_x', questions: 1, inputTokens: 1, outputTokens: 1, model: 'm' }),
    null,
  );
  assert.equal(
    store.credit({ token: 'dev_x', questions: 100, amountCents: 900, currency: 'CNY', provider: 'stub', reference: 'r' }),
    null,
  );
  store.close();
});

test('credit adds purchased questions to the balance', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialQuestions: 0 });
  assert.equal(
    store.credit({ token: dev.token, questions: 100, amountCents: 900, currency: 'CNY', provider: 'stub', reference: 'r1' }),
    100,
  );
  assert.equal(
    store.credit({ token: dev.token, questions: 300, amountCents: 2400, currency: 'CNY', provider: 'stub', reference: 'r2' }),
    400,
  );
  store.close();
});

test('two devices have independent balances', () => {
  const store = freshStore();
  const a = store.registerDevice({ platform: 'm', appVersion: '1', trialQuestions: 180 });
  const b = store.registerDevice({ platform: 'm', appVersion: '1', trialQuestions: 180 });
  store.chargeForUsage({ token: a.token, questions: 1, inputTokens: 0, outputTokens: 0, model: 'm' });
  assert.equal(store.getAccount(a.token)?.balanceQuestions, 179);
  assert.equal(store.getAccount(b.token)?.balanceQuestions, 180);
  store.close();
});
