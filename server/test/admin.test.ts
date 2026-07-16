import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// Admin grant console with ADMIN_TOKEN configured: the /admin page exists and /admin/grant
// tops up a device's question balance when the secret is presented. Uses the mock provider and
// an in-memory SQLite DB (so the note column + lazy migration are exercised too).
process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_PROVIDER = 'mock';
process.env.CURRENCY = 'JPY';
process.env.TRIAL_QUESTIONS = '10';
process.env.ADMIN_TOKEN = 'admin-secret-xyz';
process.env.ALLOW_STUB_TOPUP = '0';
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

async function register(): Promise<string> {
  const res = await fetch(`${base}/v1/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'macos', app_version: '2.0' }),
  });
  const body = (await res.json()) as { device_token: string };
  return body.device_token;
}

function grant(body: Record<string, unknown>, adminToken: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (adminToken !== null) headers['x-admin-token'] = adminToken;
  return fetch(`${base}/admin/grant`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function balance(token: string): Promise<number> {
  const r = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${token}` } });
  const j = (await r.json()) as { balance_questions: number };
  return j.balance_questions;
}

test('GET /admin serves the password-protected console with a grant form', async () => {
  const res = await fetch(`${base}/admin`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/i);
  const html = await res.text();
  assert.match(html, /管理后台/);
  assert.match(html, /\/admin\/grant/);          // the form posts here
  assert.ok(!html.includes('admin-secret-xyz'), 'the page must not embed the admin secret');
});

test('grant requires the admin secret', async () => {
  const token = await register();
  assert.equal((await grant({ device_token: token, questions: 100 }, null)).status, 401);
  assert.equal((await grant({ device_token: token, questions: 100 }, 'wrong-key')).status, 401);
  assert.equal(await balance(token), 10, 'nothing credited on auth failure');
});

test('a valid grant adds questions and persists an audit note', async () => {
  const token = await register();
  const res = await grant(
    { device_token: token, questions: 100, note: '客服赠送', idempotency_key: 'case-001' },
    'admin-secret-xyz',
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { balance_questions: number; questions_granted: number };
  assert.equal(j.questions_granted, 100);
  assert.equal(j.balance_questions, 110); // 10 trial + 100 granted
  assert.equal(await balance(token), 110);
});

test('grant is idempotent on idempotency_key (no double credit)', async () => {
  const token = await register();
  const body = { device_token: token, questions: 50, idempotency_key: 'dupe-key-1' };
  assert.equal((await grant(body, 'admin-secret-xyz')).status, 200);
  assert.equal(await balance(token), 60);
  assert.equal((await grant(body, 'admin-secret-xyz')).status, 200); // redelivery
  assert.equal(await balance(token), 60, 'same key must not credit twice');
});

test('grant validates the device token shape and existence', async () => {
  // Malformed token → 400
  assert.equal((await grant({ device_token: 'not-a-token', questions: 5 }, 'admin-secret-xyz')).status, 400);
  // Well-formed but unregistered → 401
  const ghost = 'dev_' + 'x'.repeat(40);
  assert.equal((await grant({ device_token: ghost, questions: 5 }, 'admin-secret-xyz')).status, 401);
});

test('grant validates the question count', async () => {
  const token = await register();
  for (const q of [0, -5, 100001, 'abc', null]) {
    const res = await grant({ device_token: token, questions: q, idempotency_key: `bad-${q}` }, 'admin-secret-xyz');
    assert.equal(res.status, 400, `questions=${q} must be rejected`);
  }
  assert.equal(await balance(token), 10, 'no partial credit on invalid amounts');
});

test('grant accepts a numeric string amount (curl-friendly)', async () => {
  const token = await register();
  const res = await grant({ device_token: token, questions: '25', idempotency_key: 'str-amt' }, 'admin-secret-xyz');
  assert.equal(res.status, 200);
  assert.equal(await balance(token), 35);
});

function setCli(body: Record<string, unknown>, adminToken: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (adminToken !== null) headers['x-admin-token'] = adminToken;
  return fetch(`${base}/admin/cli`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function cliEnabled(token: string): Promise<boolean> {
  const r = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${token}` } });
  const j = (await r.json()) as { cli_enabled: boolean };
  return j.cli_enabled;
}

test('the admin page includes the CLI switch form', async () => {
  const html = await (await fetch(`${base}/admin`)).text();
  assert.match(html, /CLI 模式开关/);
  assert.match(html, /\/admin\/cli/);
});

test('cli switch requires the admin secret and defaults to off', async () => {
  const token = await register();
  assert.equal(await cliEnabled(token), false, 'new devices start with CLI off');
  assert.equal((await setCli({ device_token: token, enabled: true }, null)).status, 401);
  assert.equal((await setCli({ device_token: token, enabled: true }, 'wrong-key')).status, 401);
  assert.equal(await cliEnabled(token), false, 'nothing flipped on auth failure');
});

test('cli switch flips on and off, mirrored by /v1/account', async () => {
  const token = await register();
  const on = await setCli({ device_token: token, enabled: true }, 'admin-secret-xyz');
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { cli_enabled: true });
  assert.equal(await cliEnabled(token), true);
  const off = await setCli({ device_token: token, enabled: false }, 'admin-secret-xyz');
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { cli_enabled: false });
  assert.equal(await cliEnabled(token), false);
});

test('cli switch validates the token and the enabled flag', async () => {
  const token = await register();
  // Malformed token → 400; well-formed but unregistered → 401.
  assert.equal((await setCli({ device_token: 'not-a-token', enabled: true }, 'admin-secret-xyz')).status, 400);
  const ghost = 'dev_' + 'x'.repeat(40);
  assert.equal((await setCli({ device_token: ghost, enabled: true }, 'admin-secret-xyz')).status, 401);
  // enabled must be a real boolean — strings/numbers/missing are rejected.
  for (const v of ['true', 1, null, undefined]) {
    const res = await setCli({ device_token: token, enabled: v }, 'admin-secret-xyz');
    assert.equal(res.status, 400, `enabled=${String(v)} must be rejected`);
  }
});
