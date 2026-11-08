import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { CaptureService } from '../src/capture-service.ts';
import { config } from '../src/config.ts';
import { MemoryStore } from '../src/db-memory.ts';
import { StubPaymentProvider } from '../src/payments.ts';
import { ASTRA_FAST_PRICE_KEY, ASTRA_MODEL, ASTRA_STANDARD_PRICE_KEY } from '../src/providers/astra.ts';
import { makeObjectiveProvider, makeProvider } from '../src/providers/index.ts';

function answer(state: 'ready' | 'review' | 'retake', value: string | null) {
  const reason = state === 'ready' ? 'none' : state === 'review' ? 'ambiguous_options' : 'missing_context';
  return `${value === null ? '' : `FINAL: ${value}\n`}NSPI_RESULT_V1: ${JSON.stringify({
    v: 1, kind: 'single_choice', state, answer: value, reason,
  })}`;
}

function upstream(raw: string, tier: string, options: { finish?: string; done?: boolean; meter?: boolean } = {}) {
  const id = { model: ASTRA_MODEL, service_tier: tier };
  const frames: unknown[] = [{ ...id, choices: [{ delta: { content: raw }, finish_reason: null }] },
    { ...id, choices: [{ delta: {}, finish_reason: options.finish ?? 'stop' }] }];
  if (options.meter !== false) frames.push({ ...id, choices: [], usage: { prompt_tokens: 200, completion_tokens: 20 } });
  return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')
    + (options.done === false ? '' : 'data: [DONE]\n\n'), { headers: { 'content-type': 'text/event-stream' } });
}

const settings = {
  ...config, openaiKey: 'test-key', openaiBaseURL: 'https://vendor.invalid',
  provider: 'mock' as const, providerConfigurationError: null, model: 'mock',
  objectiveProvider: 'openai' as const, objectiveProviderConfigurationError: null, objectiveModel: ASTRA_MODEL,
  objectiveMaxTokens: 8192, objectiveAstraFastReview: true, attemptBudgetUpperMicros: 20_000, modelDailyBudgetMicros: 40_000,
  modelCostCurrency: 'USD', modelPricingJSON: JSON.stringify([
    { model: ASTRA_STANDARD_PRICE_KEY, input_micros_per_million_tokens: 10_000_000, output_micros_per_million_tokens: 50_000_000 },
    { model: ASTRA_FAST_PRICE_KEY, input_micros_per_million_tokens: 20_000_000, output_micros_per_million_tokens: 100_000_000 },
  ]),
};
const request = { system: 'full system prompt', task: 'full user prompt', images: [
  { mediaType: 'image/png', base64: 'QUJD' }, { mediaType: 'image/jpeg', base64: 'REVG' },
], purpose: 'answer' as const, reasoningEffort: 'high' as const };
const review = answer('review', 'B or D');
const retake = answer('retake', null);

test('Astra keeps the full input and calls Fast once only for the frozen review case', async t => {
  const bodies: Record<string, unknown>[] = [];
  const bodiesMock = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://vendor.invalid/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    return body.service_tier === 'default' ? upstream(review, 'default') : upstream(answer('ready', 'D'), 'fast');
  });
  const { provider, degraded } = makeObjectiveProvider(settings, assert.fail);
  assert.equal(degraded, null);
  let raw = '';
  const usage = await provider.stream(request, text => { raw += text; }, new AbortController().signal);
  assert.equal(raw, answer('ready', 'D'));
  assert.equal(bodiesMock.mock.callCount(), 2);
  assert.deepEqual(bodies[0], {
    model: ASTRA_MODEL, reasoning_effort: 'low', service_tier: 'default', max_completion_tokens: 8192,
    store: false, stream: true, stream_options: { include_usage: true }, messages: [
      { role: 'developer', content: request.system },
      { role: 'user', content: [{ type: 'text', text: request.task }, ...request.images.map(image => ({
        type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}`, detail: 'high' },
      }))] },
    ],
  });
  assert.deepEqual(bodies[1], { ...bodies[0], service_tier: 'fast' });
  assert.deepEqual(usage, { inputTokens: 400, outputTokens: 40, finishReason: 'stop', attempts: [
    { pricingModel: ASTRA_STANDARD_PRICE_KEY, inputTokens: 200, outputTokens: 20 },
    { pricingModel: ASTRA_FAST_PRICE_KEY, inputTokens: 200, outputTokens: 20 },
  ] });
});

test('ready, retake, malformed review, auxiliary and disabled review never dispatch Fast', async t => {
  let raw = '';
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(JSON.parse(String(init.body)).service_tier, 'default');
    return upstream(raw, 'default');
  });
  for (const [text, purpose, enabled] of [
    [answer('ready', 'D'), 'answer', true], [retake, 'answer', true],
    [answer('review', 'B or B'), 'answer', true], [review.replace('"v":1', '"v":1,"v":1'), 'answer', true],
    [review, 'explain', true], [review, 'recover', true], [review, 'answer', false],
  ] as const) {
    raw = text;
    const { provider } = makeObjectiveProvider({ ...settings, objectiveAstraFastReview: enabled }, assert.fail);
    let output = '';
    await provider.stream({ ...request, purpose }, value => { output += value; }, new AbortController().signal);
    assert.equal(output, text);
  }
  assert.equal(fetchMock.mock.callCount(), 7);
});

test('ordinary tutor keeps the ambiguous answer from one upstream call even with Fast review enabled', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(JSON.parse(String(init.body)).service_tier, 'default');
    return upstream(review, 'default');
  });
  const { provider } = makeObjectiveProvider(settings, assert.fail);
  let raw = '';
  const usage = await provider.stream({...request, tutorResultV1: true}, text => { raw += text; }, new AbortController().signal);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(raw, review);
  assert.equal(usage.attempts, undefined);
});

test('Astra accepts a valid retake but retains the review when Fast selects a third option', async t => {
  let fast = '';
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
    JSON.parse(String(init.body)).service_tier === 'default' ? upstream(review, 'default') : upstream(fast, 'fast'));
  const { provider } = makeObjectiveProvider(settings, assert.fail);
  for (const [reply, selected] of [[retake, retake], [answer('ready', 'A'), review]]) {
    fast = reply!;
    let raw = '';
    await provider.stream(request, text => { raw += text; }, new AbortController().signal);
    assert.equal(raw, selected);
  }
  fast = 'FINAL: D';
  const usage = await provider.stream(request, () => assert.fail('unexpected delta'), new AbortController().signal);
  assert.equal(usage.finishReason, 'protocol_invalid');
  assert.equal(usage.attempts?.length, 2);
});

test('unconfirmed, incomplete and truncated Astra calls cannot leak a tentative answer', async t => {
  let makeResponse: () => Response;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => makeResponse());
  const { provider } = makeObjectiveProvider(settings, assert.fail);
  for (const response of [
    () => upstream(review, 'fast'), () => upstream(review, 'default', { done: false }),
    () => upstream(review, 'default', { meter: false }),
  ]) {
    makeResponse = response;
    await assert.rejects(provider.stream(request, () => assert.fail('unexpected delta'), new AbortController().signal));
  }
  makeResponse = () => upstream(review, 'default', { finish: 'length' });
  assert.equal((await provider.stream(request, () => assert.fail('unexpected delta'), new AbortController().signal)).finishReason, 'length');
  assert.equal(fetchMock.mock.callCount(), 4);
});

test('objective capture charges one question and settles both tiers, with failed review spending reserved', async t => {
  let failFast = false;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const tier = JSON.parse(String(init.body)).service_tier;
    if (tier === 'default') return upstream(review, tier);
    return failFast ? upstream('', tier, { meter: false }) : upstream(answer('ready', 'D'), tier);
  });
  const store = new MemoryStore();
  const { token } = await store.registerDevice({ platform: 'macos', appVersion: 'test', trialQuestions: 3 });
  const { provider } = makeProvider(settings, assert.fail);
  const { provider: objectiveProvider } = makeObjectiveProvider(settings, assert.fail);
  const service = new CaptureService({ config: settings, store, storeKind: 'memory', provider, objectiveProvider,
    providerDegraded: null, objectiveProviderDegraded: null, payment: new StubPaymentProvider() });
  const app = Fastify();
  t.after(() => app.close());
  app.post('/v1/captures', (req, reply) => service.solve(req, reply));
  const capture = (capture_id: string) => app.inject({ method: 'POST', url: '/v1/captures',
    headers: { authorization: `Bearer ${token}` }, payload: {
      capture_id, result_protocol: 'objective_v1', image_base64: 'QUJD', system: request.system, task: request.task,
    } });
  const firstId = '3e7979c6-20cb-4c12-a23e-ece6eb3aa52d';
  const first = await capture(firstId);
  assert.match(first.body, /FINAL: D/);
  assert.doesNotMatch(first.body, /B or D/);
  assert.match(first.body, /"questions_charged":1/);
  assert.equal((await store.billing.attempts(token)).find(a => a.captureId === firstId)?.costMicros, '9000');

  failFast = true;
  const failedId = '3e7979c6-20cb-4c12-a23e-ece6eb3aa52e';
  const failed = await capture(failedId);
  assert.doesNotMatch(failed.body, /FINAL: /);
  assert.match(failed.body, /"questions_charged":0/);
  const attempt = (await store.billing.attempts(token)).find(a => a.captureId === failedId);
  assert.equal(attempt?.status, 'failed');
  assert.equal(attempt?.costMicros, null);
  const blocked = await capture('3e7979c6-20cb-4c12-a23e-ece6eb3aa52f');
  assert.equal(blocked.statusCode, 503);
  assert.match(blocked.body, /budget_exceeded/);
});
