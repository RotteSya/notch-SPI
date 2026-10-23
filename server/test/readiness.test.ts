import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
process.env.VERCEL = '1';
process.env.POSTGRES_URL = '';
process.env.DATABASE_URL = '';
process.env.OFFICIAL_PROVIDER = 'mock';
process.env.PAYMENT_PROVIDER = 'stub';
process.env.CRON_SECRET = 'test-readiness-secret-'.padEnd(40, 'x');
process.env.LOG_LEVEL = 'silent';
const {buildApp} = await import('../src/index.ts');
const {MemoryStore} = await import('../src/db-memory.ts');
const {PostgresStore} = await import('../src/db-postgres.ts');
const auth = {authorization: 'Bearer ' + process.env.CRON_SECRET};

test('serverless boot creates no maintenance timer; public health never probes DB', async () => {
  const timer = mock.method(globalThis, 'setInterval');
  const probe = mock.method(MemoryStore.prototype, 'checkHealth', async () => { throw new Error('private db details'); });
  const app = await buildApp();
  try {
    assert.equal(timer.mock.callCount(), 0);
    const health = await app.inject('/healthz');
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().database, 'not_checked');
    assert.equal(probe.mock.callCount(), 0);
    assert.equal((await app.inject('/readyz')).statusCode, 401);
    assert.equal(probe.mock.callCount(), 0);
    const failed = await app.inject({url:'/readyz',headers:auth});
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), {ok:false,database:'unavailable'});
    assert.equal(failed.headers['cache-control'], 'no-store');
    probe.mock.mockImplementation(async () => {});
    const healthy = await app.inject({url:'/readyz',headers:auth});
    assert.equal(healthy.statusCode, 200);
    assert.equal(healthy.json().database,'available');
  } finally { await app.close(); mock.restoreAll(); }
});

test('readiness connection timeout terminates a stalled connection without schema initialization', async () => {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address() as net.AddressInfo;
  const store = new PostgresStore(`postgres://test:test@127.0.0.1:${address.port}/test`, false);
  const started = Date.now();
  try {
    await assert.rejects(store.checkHealth());
    assert.ok(Date.now()-started<6000);
  } finally { await store.close(); for (const s of sockets) s.destroy(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
