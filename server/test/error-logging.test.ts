import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {config} from '../src/config.ts';
import {registerRoutes} from '../src/routes.ts';
import {MockProvider} from '../src/providers/mock.ts';
import {StubPaymentProvider} from '../src/payments.ts';
import {MemoryStore} from '../src/db-memory.ts';

const SECRET = 'r'.repeat(40);

test('an unexpected 500 logs a classified failure, never the message, and keeps the generic body', async () => {
  const records: Record<string, any>[] = [];
  const app = Fastify({logger: {stream: {write(line: string) { records.push(JSON.parse(line)); }}}});
  const store = new MemoryStore(), provider = new MockProvider();
  registerRoutes(app, {config: {...config, stripeSecretKey: '', adminToken: '', cronSecret: SECRET}, store,
    storeKind: 'memory', provider, objectiveProvider: provider, providerDegraded: null, objectiveProviderDegraded: null,
    payment: new StubPaymentProvider()});
  // The shape pg-pool produces when a scale-to-zero wake outlasts connectionTimeoutMillis.
  store.billing.reap = async () => {
    throw new Error('Connection terminated due to connection timeout', {cause: new Error('Connection terminated')});
  };
  try {
    const response = await app.inject({url: '/api/internal/reap', headers: {authorization: `Bearer ${SECRET}`}});
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {error: {message: '服务器内部错误', code: 'internal'}});
    const failed = records.filter(record => record.event === 'request_failed');
    assert.equal(failed.length, 1);
    const [entry] = failed as [Record<string, any>];
    assert.equal(entry.level, 50);
    assert.equal(entry.route, '/api/internal/reap');
    assert.equal(entry.failure.kind, 'db_connect_timeout');
    assert.ok(entry.failure.frames.length > 0);
    const logged = JSON.stringify(records);
    assert.equal(logged.includes('Connection terminated'), false);
    assert.equal(logged.includes(SECRET), false);

    // Expected API errors stay quiet: they are part of the contract, not failures.
    records.length = 0;
    assert.equal((await app.inject({url: '/api/internal/reap'})).statusCode, 401);
    assert.equal(records.some(record => record.event === 'request_failed'), false);
  } finally { await app.close(); await store.close(); }
});
