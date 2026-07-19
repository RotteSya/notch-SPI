import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { Provider, Usage, CaptureRequest } from '../src/providers/types.ts';

// The product promise is "失败不扣题": a capture that produces no answer must never cost a
// question. We inject a scripted provider (a test-only buildApp seam) to exercise the three
// outcomes — vendor throw, empty HTTP-200 stream, and a normal answer — and assert the balance.
process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_PROVIDER = 'mock'; // ignored: we inject a provider below
process.env.TRIAL_QUESTIONS = '3';
process.env.TRIAL_MIN_QUESTIONS = '3'; // pin min===max so the trial grant is deterministic (3)
process.env.TRIAL_MAX_QUESTIONS = '3';
process.env.CURRENCY = 'CNY';
process.env.LOG_LEVEL = 'silent';
process.env.DEVICE_REG_PER_HOUR = '1000'; // don't let the abuse limits interfere with this suite
process.env.CAPTURE_CONCURRENCY_PER_TOKEN = '1000';

const { buildApp } = await import('../src/index.ts');

// Scripted provider whose behavior is flipped per test via `mode`.
let mode: 'throw' | 'empty' | 'ok' = 'ok';
const provider: Provider = {
  name: 'scripted',
  async stream(_req: CaptureRequest, onDelta: (t: string) => void): Promise<Usage> {
    if (mode === 'throw') throw new Error('vendor exploded');
    if (mode === 'ok') onDelta('hello');
    // 'empty' resolves with usage but never emits a delta (e.g. a content-filter block).
    return { inputTokens: 5, outputTokens: 7 };
  },
};

let app: FastifyInstance;
let base: string;

before(async () => {
  app = await buildApp({ provider });
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
    body: JSON.stringify({ platform: 'macos', app_version: 'test' }),
  });
  const body = (await res.json()) as { device_token: string };
  return body.device_token;
}

async function capture(token: string): Promise<string> {
  const res = await fetch(`${base}/v1/captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ system: 's', task: 't', image_base64: 'QUJD', image_media_type: 'image/jpeg' }),
  });
  return res.text();
}

async function balance(token: string): Promise<{ balance_questions: number; total_questions: number }> {
  const res = await fetch(`${base}/v1/account`, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()) as { balance_questions: number; total_questions: number };
}

test('a vendor error mid-stream is reported and does NOT charge a question', async () => {
  const token = await register();
  mode = 'throw';
  const text = await capture(token);
  assert.match(text, /"type":"error"/);
  assert.doesNotMatch(text, /"questions_charged"/);
  assert.doesNotMatch(text, /\[DONE\]/);
  const acct = await balance(token);
  assert.equal(acct.balance_questions, 3, 'balance unchanged after a failed answer');
  assert.equal(acct.total_questions, 0);
});

test('an empty (no-delta) stream is treated as a failure and does NOT charge', async () => {
  const token = await register();
  mode = 'empty';
  const text = await capture(token);
  assert.match(text, /"type":"error"/);
  assert.doesNotMatch(text, /"questions_charged"/);
  const acct = await balance(token);
  assert.equal(acct.balance_questions, 3, 'an empty answer must be free');
  assert.equal(acct.total_questions, 0);
});

test('a normal answer charges exactly one question', async () => {
  const token = await register();
  mode = 'ok';
  const text = await capture(token);
  assert.match(text, /"type":"delta"/);
  assert.match(text, /"questions_charged":1/);
  assert.match(text, /\[DONE\]/);
  const acct = await balance(token);
  assert.equal(acct.balance_questions, 2);
  assert.equal(acct.total_questions, 1);
});
