import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// Verify the SAFE DEFAULT: with ALLOW_STUB_TOPUP unset, the dev-only credit endpoint is off.
// node --test isolates each test file in its own process, so this env is independent of the
// api.test.ts process (which enables the stub explicitly).
process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_PROVIDER = 'mock';
delete process.env.ALLOW_STUB_TOPUP; // rely on the built-in default ('0' → disabled)
process.env.LOG_LEVEL = 'silent';

const { buildApp } = await import('../src/index.ts');

let app: FastifyInstance;
let base: string;

before(async () => {
  app = await buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
});

test('stub top-up endpoint is 404 when ALLOW_STUB_TOPUP is not set', async () => {
  const reg = await (
    await fetch(`${base}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'macos', app_version: '1.7' }),
    })
  ).json() as { device_token: string };

  const res = await fetch(`${base}/topup/stub-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_token: reg.device_token, pack_id: 'pack100' }),
  });
  assert.equal(res.status, 404);
});

test('the top-up page still renders with buy buttons disabled (only the credit endpoint is gated)', async () => {
  const res = await fetch(`${base}/topup?device=dev_abc123`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /充值/);
  // The stub is off, so no live buy button may reach the credit endpoint.
  assert.ok(!html.includes('data-pack='), 'no active pack buttons when the stub is disabled');
  assert.match(html, /disabled/);
});
