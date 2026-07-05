import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/db.ts';

function freshStore(): SqliteStore {
  return new SqliteStore(':memory:');
}

test('registerDevice grants trial credit and returns a token', () => {
  const store = freshStore();
  const dev = store.registerDevice({
    platform: 'macos',
    appVersion: '1.7',
    trialCreditCents: 500,
    currency: 'CNY',
  });
  assert.match(dev.token, /^dev_/);
  assert.equal(dev.balanceCents, 500);
  assert.equal(dev.currency, 'CNY');
  store.close();
});

test('getAccount reflects registration; unknown token is null', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialCreditCents: 500, currency: 'CNY' });
  const acct = store.getAccount(dev.token);
  assert.deepEqual(acct, {
    balanceCents: 500,
    currency: 'CNY',
    totalInputTokens: 0,
    totalOutputTokens: 0,
  });
  assert.equal(store.getAccount('dev_nope'), null);
  store.close();
});

test('chargeForUsage deducts balance and accumulates token totals atomically', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialCreditCents: 500, currency: 'CNY' });
  const b1 = store.chargeForUsage({ token: dev.token, inputTokens: 1200, outputTokens: 480, costCents: 6, model: 'mock' });
  assert.equal(b1, 494);
  const b2 = store.chargeForUsage({ token: dev.token, inputTokens: 100, outputTokens: 50, costCents: 2, model: 'mock' });
  assert.equal(b2, 492);
  const acct = store.getAccount(dev.token);
  assert.equal(acct?.totalInputTokens, 1300);
  assert.equal(acct?.totalOutputTokens, 530);
  store.close();
});

test('balance may go negative when one capture exceeds remaining credit', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialCreditCents: 1, currency: 'CNY' });
  const b = store.chargeForUsage({ token: dev.token, inputTokens: 0, outputTokens: 1000, costCents: 8, model: 'mock' });
  assert.equal(b, -7); // honest accounting; the pre-request gate blocks the NEXT capture
  store.close();
});

test('chargeForUsage / credit on an unknown token return null', () => {
  const store = freshStore();
  assert.equal(store.chargeForUsage({ token: 'dev_x', inputTokens: 1, outputTokens: 1, costCents: 1, model: 'm' }), null);
  assert.equal(store.credit({ token: 'dev_x', amountCents: 500, provider: 'stub', reference: 'r' }), null);
  store.close();
});

test('credit adds to balance', () => {
  const store = freshStore();
  const dev = store.registerDevice({ platform: 'm', appVersion: '1', trialCreditCents: 0, currency: 'CNY' });
  assert.equal(store.credit({ token: dev.token, amountCents: 500, provider: 'stub', reference: 'r1' }), 500);
  assert.equal(store.credit({ token: dev.token, amountCents: 250, provider: 'stub', reference: 'r2' }), 750);
  store.close();
});

test('two devices have independent balances', () => {
  const store = freshStore();
  const a = store.registerDevice({ platform: 'm', appVersion: '1', trialCreditCents: 500, currency: 'CNY' });
  const b = store.registerDevice({ platform: 'm', appVersion: '1', trialCreditCents: 500, currency: 'CNY' });
  store.chargeForUsage({ token: a.token, inputTokens: 0, outputTokens: 0, costCents: 100, model: 'm' });
  assert.equal(store.getAccount(a.token)?.balanceCents, 400);
  assert.equal(store.getAccount(b.token)?.balanceCents, 500);
  store.close();
});
