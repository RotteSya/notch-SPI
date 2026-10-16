import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import type {Store} from '../src/db.ts';
import type {RunTransaction, Transaction, Row} from '../src/billing-sql.ts';

const implementations: Array<[string, () => Store | Promise<Store>]> = [
  ['memory', () => new MemoryStore()], ['sqlite', () => new SqliteStore(':memory:')],
];
if (process.env.TEST_POSTGRES_URL) {
  const url = new URL(process.env.TEST_POSTGRES_URL);
  if (!/test/i.test(url.pathname)) throw new Error('Free trial tests require an isolated database named test');
  const {PostgresStore, resolvePostgresSSL} = await import('../src/db-postgres.ts');
  const pg = (await import('pg')).default;
  const admin = new pg.Pool({connectionString: url.toString(), ssl: resolvePostgresSSL({connectionString: url.toString()})});
  const schema = 'trial_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', '-c search_path=' + schema);
  after(async () => { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  implementations.push(['postgres', () => new PostgresStore(url.toString(), resolvePostgresSSL({connectionString: url.toString()}))]);
}
const start = Date.parse('2026-10-16T15:59:59.000Z'), day = 86_400_000;
const register = (s: Store, eligible = true) => s.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30, freeTrialEligible: eligible});
const input = (token: string) => ({token, captureId: randomUUID(), requestHmac: randomUUID()});

for (const [name, make] of implementations) {
  test(`${name}: new-user eligibility, simultaneous claim and retry preserve the original 72-hour receipt`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: start});
    const store = await make();
    try {
      const old = await register(store, false), fresh = await register(store);
      assert.equal((await store.billing.claimFreeTrial(old.token))?.freeTrial, undefined);
      assert.equal((await store.billing.quota(old.token))?.balanceQuestions, 30);
      const receipts = await Promise.all(Array.from({length: 20}, () => store.billing.claimFreeTrial(fresh.token)));
      for (const r of receipts) {
        assert.equal(r?.balanceQuestions, 400); assert.equal(r?.freeTrial?.daily_remaining, 400);
        assert.equal(r?.freeTrial?.activated_at, new Date(start).toISOString());
        assert.equal(r?.freeTrial?.expires_at, new Date(start + 3 * day).toISOString());
      }
      t.mock.timers.setTime(start + day);
      const retried = await store.billing.claimFreeTrial(fresh.token);
      assert.equal(retried?.freeTrial?.expires_at, receipts[0]?.freeTrial?.expires_at);
      assert.equal(retried?.balanceQuestions, 400);
      assert.equal(await store.billing.claimFreeTrial('missing'), null);
    } finally { await store.close(); }
  });

  test(`${name}: 400 concurrent holds cap admission and failures release only their own slots`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: start});
    const store = await make();
    try {
      const {token} = await register(store); await store.billing.claimFreeTrial(token);
      const requests = Array.from({length: 401}, () => input(token));
      const results = await Promise.all(requests.map(r => store.billing.begin(r)));
      assert.equal(results.filter(r => r.ok).length, 400);
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 0);
      assert.equal((await store.billing.quota(token))?.freeTrial?.daily_held, 400);
      const won = requests.filter((_, i) => results[i]!.ok);
      await Promise.all(won.map((r, i) => store.billing.finish({...r, charge: i > 0, terminalState: i > 0 ? 'usable' : 'failed'})));
      const q = await store.billing.quota(token);
      assert.equal(q?.freeTrial?.daily_used, 399); assert.equal(q?.freeTrial?.daily_held, 0);
      assert.equal(q?.balanceQuestions, 1);
      await store.billing.finish({...won[0]!, charge: true, terminalState: 'usable'});
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 1);
      const last = input(token); assert.equal((await store.billing.begin(last)).ok, true);
      await store.billing.finish({...last, charge: true, terminalState: 'usable', answerHmac: 'answer'});
      assert.equal((await store.billing.begin(input(token))).ok, false);
      const explain = {...input(token), operation: 'explain' as const, parentCaptureId: last.captureId};
      assert.equal((await store.billing.begin(explain)).ok, true);
      await store.billing.finish({...explain, charge: false, terminalState: 'usable'});
      assert.equal((await store.billing.quota(token))?.freeTrial?.daily_used, 400);
    } finally { await store.close(); }
  });

  test(`${name}: midnight and 72-hour expiry do not carry unused quota or credit late failed holds into the next day`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: start});
    const store = await make();
    try {
      const {token} = await register(store); await store.billing.claimFreeTrial(token);
      const oldHold = input(token); await store.billing.begin(oldHold);
      t.mock.timers.setTime(start + 1_000);
      const fresh = await store.billing.quota(token);
      assert.equal(fresh?.balanceQuestions, 400); assert.equal(fresh?.freeTrial?.daily_used, 0);
      await store.billing.finish({...oldHold, charge: false, terminalState: 'failed'});
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 400);
      t.mock.timers.setTime(start + 3 * day - 1);
      const finalHold = input(token); assert.equal((await store.billing.begin(finalHold)).ok, true);
      t.mock.timers.setTime(start + 3 * day);
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 0);
      assert.equal((await store.billing.quota(token))?.freeTrial?.status, 'expired');
      await store.billing.finish({...finalHold, charge: false, terminalState: 'failed'});
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 0);
      assert.equal((await store.billing.claimFreeTrial(token))?.freeTrial?.status, 'expired');
      assert.equal((await store.billing.begin(input(token))).ok, false);
    } finally { await store.close(); }
  });

  test(`${name}: trial expiry preserves purchased balance and pending trial success charges once`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: start});
    const store = await make();
    try {
      const {token, id} = await register(store);
      await store.billing.creditDevice(id, {questions: 12, amountCents: 100, currency: 'CNY', provider: 'test', reference: randomUUID()});
      await store.billing.claimFreeTrial(token);
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 412);
      t.mock.timers.setTime(start + 3 * day - 500);
      const held = input(token); await store.billing.begin(held);
      t.mock.timers.setTime(start + 3 * day + 500);
      await store.billing.finish({...held, charge: true, terminalState: 'usable'});
      const q = await store.billing.quota(token);
      assert.equal(q?.balanceQuestions, 12); assert.equal(q?.quotaBreakdown.paid, 12);
      assert.equal(q?.quotaBreakdown.trial, 0);
      await store.billing.finish({...held, charge: true, terminalState: 'usable'});
      assert.equal((await store.billing.accountSnapshot(token))?.totalQuestions, 1);
      const paid = input(token); assert.equal((await store.billing.begin(paid)).ok, true);
      await store.billing.finish({...paid, charge: true, terminalState: 'usable'});
      assert.equal((await store.billing.quota(token))?.quotaBreakdown.paid, 11);
    } finally { await store.close(); }
  });

  if (name !== 'memory') test(`${name}: an interrupted trial claim rolls back entitlement and balance together`, async () => {
    const store = await make(), billing = store.billing as typeof store.billing & {run: RunTransaction};
    const run = billing.run;
    try {
      const {token} = await register(store);
      billing.run = <T>(transaction: Transaction<T>) => run((function* (): Transaction<T> {
        let rows: Row[] = [];
        while (true) {
          const step = transaction.next(rows); if (step.done) return step.value;
          if (step.value.sql.startsWith('UPDATE quota_lots SET trial_expires_at=')) throw new Error('injected trial failure');
          rows = yield step.value;
        }
      })());
      await assert.rejects(() => billing.claimFreeTrial(token), /injected trial failure/);
      billing.run = run;
      const q = await billing.quota(token);
      assert.equal(q?.freeTrial?.status, 'eligible'); assert.equal(q?.balanceQuestions, 30);
      assert.equal((await billing.claimFreeTrial(token))?.balanceQuestions, 400);
    } finally { billing.run = run; await store.close(); }
  });
}

test('sqlite: claimed entitlement and daily expiration survive process restart', async t => {
  t.mock.timers.enable({apis: ['Date'], now: start});
  const dir = mkdtempSync(join(tmpdir(), 'free-trial-')), path = join(dir, 'test.sqlite');
  let store = new SqliteStore(path);
  try {
    const {token} = await register(store); const first = await store.billing.claimFreeTrial(token);
    await store.close(); t.mock.timers.setTime(start + day); store = new SqliteStore(path);
    const next = await store.billing.claimFreeTrial(token);
    assert.equal(next?.freeTrial?.expires_at, first?.freeTrial?.expires_at);
    assert.equal(next?.balanceQuestions, 400);
  } finally { await store.close(); rmSync(dir, {recursive: true, force: true}); }
});
