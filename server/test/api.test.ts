import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// Configure for an isolated in-memory DB + key-free mock provider BEFORE the app (and its
// config module) is imported. Env is read once at config import, so this must precede it.
process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_PROVIDER = 'mock';
process.env.CURRENCY = 'CNY';
process.env.TRIAL_CREDIT_CENTS = '3';
process.env.ALLOW_STUB_TOPUP = '1';
process.env.LOG_LEVEL = 'silent';

const { buildApp } = await import('../src/index.ts');

let app: FastifyInstance;
let base: string;

before(async () => {
  app = buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
});

async function register(): Promise<string> {
  const res = await fetch(`${base}/v1/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'macos', app_version: '1.7' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { device_token: string; balance_cents: number; currency: string };
  assert.match(body.device_token, /^dev_/);
  assert.equal(body.balance_cents, 3);
  assert.equal(body.currency, 'CNY');
  return body.device_token;
}

async function capture(token: string, image = 'QUJDREVG'): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}/v1/captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ system: '你是老师', task: '讲解', image_base64: image, image_media_type: 'image/jpeg' }),
  });
  return { status: res.status, text: await res.text() };
}

test('missing / invalid token is 401 JSON', async () => {
  const noAuth = await fetch(`${base}/v1/account`);
  assert.equal(noAuth.status, 401);
  const bad = await fetch(`${base}/v1/account`, { headers: { authorization: 'Bearer dev_nope' } });
  assert.equal(bad.status, 401);
  const body = (await bad.json()) as { error: { message: string } };
  assert.ok(body.error.message.length > 0);
});

test('capture streams deltas then exactly one usage event then [DONE]', async () => {
  const token = await register();
  const { status, text } = await capture(token);
  assert.equal(status, 200);
  const deltas = [...text.matchAll(/"type":"delta"/g)].length;
  assert.ok(deltas >= 1, `expected delta events, got ${deltas}`);
  const usages = [...text.matchAll(/"type":"usage"/g)].length;
  assert.equal(usages, 1, 'exactly one usage event');
  assert.match(text, /data: \[DONE\]/);
  // Account reflects the charge.
  const acct = (await (await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
    balance_cents: number;
    total_output_tokens: number;
  };
  assert.ok(acct.balance_cents < 3);
  assert.ok(acct.total_output_tokens > 0);
});

test('missing image is 400 before streaming', async () => {
  const token = await register();
  const res = await fetch(`${base}/v1/captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ system: 's', task: 't', image_base64: '', image_media_type: 'image/jpeg' }),
  });
  assert.equal(res.status, 400);
});

test('missing system or task is 400 (contract-required fields)', async () => {
  const token = await register();
  const missingSystem = await fetch(`${base}/v1/captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ task: 't', image_base64: 'QUJD', image_media_type: 'image/jpeg' }),
  });
  assert.equal(missingSystem.status, 400);
  const missingTask = await fetch(`${base}/v1/captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ system: 's', image_base64: 'QUJD', image_media_type: 'image/jpeg' }),
  });
  assert.equal(missingTask.status, 400);
});

test('balance drains to <=0 then the gate returns HTTP 402', async () => {
  const token = await register();
  let last402 = false;
  for (let i = 0; i < 10; i++) {
    const acct = (await (await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
      balance_cents: number;
    };
    if (acct.balance_cents <= 0) {
      const { status, text } = await capture(token);
      assert.equal(status, 402);
      const body = JSON.parse(text) as { error: { message: string } };
      assert.ok(body.error.message.includes('余额'));
      last402 = true;
      break;
    }
    await capture(token);
  }
  assert.ok(last402, 'expected a 402 once balance hit zero');
});

test('stub top-up credits the account and restores capture', async () => {
  const token = await register();
  // Drain to zero.
  for (let i = 0; i < 10; i++) {
    const acct = (await (await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
      balance_cents: number;
    };
    if (acct.balance_cents <= 0) break;
    await capture(token);
  }
  assert.equal((await capture(token)).status, 402);
  // Top up.
  const topup = await fetch(`${base}/topup/stub-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_token: token, amount_cents: 500 }),
  });
  assert.equal(topup.status, 200);
  const tb = (await topup.json()) as { balance_cents: number };
  assert.ok(tb.balance_cents >= 400);
  // Capture works again.
  assert.equal((await capture(token)).status, 200);
});

test('stub top-up rejects an invalid amount and an unknown token', async () => {
  const token = await register();
  const bad = await fetch(`${base}/topup/stub-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_token: token, amount_cents: -1 }),
  });
  assert.equal(bad.status, 400);
  const unknown = await fetch(`${base}/topup/stub-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_token: 'dev_nope', amount_cents: 500 }),
  });
  assert.equal(unknown.status, 401);
});

test('top-up page renders HTML for a device', async () => {
  const token = await register();
  const res = await fetch(`${base}/topup?device=${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /充值/);
});
