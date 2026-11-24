import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import pg from 'pg';
import { config, type Config } from '../src/config.ts';
import { registerRoutes } from '../src/routes.ts';
import { MemoryStore } from '../src/db-memory.ts';
import { SqliteStore } from '../src/db-sqlite.ts';
import { PostgresStore, resolvePostgresSSL } from '../src/db-postgres.ts';
import { StubPaymentProvider } from '../src/payments.ts';
import type { CaptureRequest, Provider } from '../src/providers/types.ts';
import type { Store } from '../src/db.ts';
import { aggregateEconomics, type ReportQuery } from '../src/reporting.ts';
import type { QuestionBankTranscript } from '../src/question-bank.ts';
import { questionBankSchema } from '../src/question-bank-sql.ts';
import { QUESTION_BANK_ROUND, questionBankReviewHoldId, runQuestionBankRound } from '../src/question-bank-worker.ts';
import { ASTRA_MODEL, AstraProvider } from '../src/providers/astra.ts';
import { makeReviewProvider } from '../src/providers/index.ts';
import { settledRequestWork } from '../src/request-lifecycle.ts';
import { corruptPixels, pngBase64 as png } from './helpers/images.ts';
import { openEphemeralPostgres } from './helpers/ephemeral-postgres.ts';

const KEY = 'k'.repeat(40);
const CRON = 'c'.repeat(40);
// One micro per input token and two per output token: a transcription costs 1100, a review 2200.
const PRICING = JSON.stringify([
  { model: 'mock:bank-test', input_micros_per_million_tokens: 1_000_000, output_micros_per_million_tokens: 2_000_000 },
  { model: 'mock:review-model', input_micros_per_million_tokens: 1_000_000, output_micros_per_million_tokens: 2_000_000 },
]);
const SPEED = 'A car travels 120 km in 2 hours. What is its average speed?';
const TRAIN = 'A train travels 300 km in 3 hours. What is its average speed?';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const postgres = await openEphemeralPostgres();
const admin = postgres ? new pg.Pool({ connectionString: postgres.url, ssl: resolvePostgresSSL({ connectionString: postgres.url }) }) : null;
after(async () => { await admin?.end(); await postgres?.close(); });

/** An objective result as the answer path and a reviewer write it. */
function result(answer: string | null, state: 'ready' | 'review' | 'retake' = 'ready'): string {
  const reason = state === 'ready' ? 'none' : state === 'review' ? 'ambiguous_options' : 'missing_context';
  return `${answer === null ? '' : `FINAL: ${answer}\n`}NSPI_RESULT_V1: ${JSON.stringify({ v: 1, kind: 'single_choice', state, answer, reason })}`;
}

function transcript(stem: string): string {
  const value: QuestionBankTranscript = { status: 'ok', language: 'en', stem, options: [{ label: 'A', text: '40 km/h' }, { label: 'B', text: '60 km/h' }], has_figure: false };
  return JSON.stringify(value);
}

type Reply = string | { text: string; finishReason: string };

async function bank(kind: 'memory' | 'sqlite' | 'postgres', overrides: Partial<Config> = {}, options: { reviewer?: boolean } = {}) {
  let schema: string | null = null;
  let store: Store;
  if (kind === 'postgres') {
    if (!postgres || !admin) throw new Error('PostgreSQL fixture requires a server');
    schema = 'qbr_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(postgres.url);
    url.searchParams.set('options', '-c search_path=' + schema);
    store = new PostgresStore(url.toString(), resolvePostgresSSL({ connectionString: url.toString() }));
  } else store = kind === 'memory' ? new MemoryStore() : new SqliteStore(':memory:');
  const answers: string[] = [], transcripts: string[] = [];
  const provider: Provider = {
    name: 'mock',
    async stream(req, delta) {
      if (req.purpose === 'review') throw new Error('the answer provider never reviews');
      if (req.purpose === 'transcribe') {
        delta(transcripts.shift() ?? transcript('Default question'));
        return { inputTokens: 1000, outputTokens: 50, finishReason: 'stop' };
      }
      delta(answers.shift() ?? result('B'));
      return { inputTokens: 11, outputTokens: 7, finishReason: 'stop' };
    },
  };
  // The reviewer answers by the reviewed solve's system prompt, so each card can get its own reply.
  const reviews = new Map<string, Reply>();
  const reviewRequests: CaptureRequest[] = [];
  let reviewInFlight = 0, reviewMost = 0;
  const reviewer: Provider = {
    name: 'mock',
    async stream(req, delta) {
      reviewRequests.push(req);
      reviewInFlight += 1; reviewMost = Math.max(reviewMost, reviewInFlight);
      try {
        await delay(5);
        const reply = reviews.get(req.system) ?? result('B');
        delta(typeof reply === 'string' ? reply : reply.text);
        return { inputTokens: 2000, outputTokens: 100, finishReason: typeof reply === 'string' ? 'stop' : reply.finishReason };
      } finally { reviewInFlight -= 1; }
    },
  };
  const withReviewer = options.reviewer !== false;
  const settings: Config = {
    ...config,
    provider: 'mock', objectiveProvider: 'mock', model: 'bank-test', objectiveModel: 'bank-test',
    requireDurableStorage: false, isServerless: false, requestBudgetMode: 'fixed', capturePerMinute: 0,
    modelDailyBudgetMicros: 1_000_000, attemptBudgetUpperMicros: 10_000, questionBankDailyBudgetMicros: 100_000,
    questionBankReviewProvider: withReviewer ? 'mock' : '', questionBankReviewModel: withReviewer ? 'review-model' : '',
    questionBankReviewDailyBudgetMicros: 100_000,
    modelPricingJSON: PRICING, modelPricingVersion: 'qb-test', modelCostCurrency: 'USD', cronSecret: CRON,
    questionBankEnabled: true, questionBankImageRetentionDays: 90, adminToken: KEY,
    requestHmacKeysJSON: JSON.stringify({ test: randomBytes(32).toString('base64') }), requestHmacKeyVersion: 'test',
    ...overrides,
  };
  const app = Fastify({ logger: false });
  registerRoutes(app, {
    config: settings, store, storeKind: kind, provider, objectiveProvider: provider,
    providerDegraded: null, objectiveProviderDegraded: null, payment: new StubPaymentProvider(),
    reviewProvider: withReviewer ? reviewer : null, reviewProviderDegraded: null,
  });
  const account = async (platform = 'macos') => store.registerDevice({ platform, appVersion: '4.0', trialQuestions: 30 });
  const solve = async (token: string, system = 'SYS-PROMPT') => {
    const captureId = randomUUID();
    const response = await app.inject({
      method: 'POST', url: '/v1/captures', headers: { authorization: `Bearer ${token}` },
      payload: {
        capture_id: captureId, result_protocol: 'objective_v1', operation: 'solve', system, task: 'TASK-PROMPT',
        images_base64: [png, corruptPixels().toString('base64')], image_media_type: 'image/png', reasoning_effort: 'high', question_bank_v1: true,
      },
    });
    await settledRequestWork();
    assert.equal(response.statusCode, 200);
    return captureId;
  };
  const round = (at?: number, extra: Partial<Config> = {}) => runQuestionBankRound({
    config: { ...settings, ...extra }, store, provider, providerDegraded: null,
    reviewProvider: withReviewer ? reviewer : null, reviewProviderDegraded: null, ...(at === undefined ? {} : { now: () => at }),
  });
  /** Solve with the answer path giving `answer`, then transcribe that solve alone as `stem`. */
  const solved = async (token: string, stem: string, extra: { answer?: string; system?: string } = {}) => {
    answers.push(extra.answer ?? result('B'));
    const captureId = await solve(token, extra.system);
    transcripts.push(transcript(stem));
    await round();
    return (await store.questionBank.findByCapture(captureId))!;
  };
  const call = async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, key: string | null = KEY) => {
    const response = await app.inject({ method, url, ...(key === null ? {} : { headers: { 'x-admin-token': key } }), ...(payload ? { payload } : {}) });
    return { status: response.statusCode, json: () => response.json() as Record<string, any> };
  };
  const confirm = (cardIds: Array<string | null>, extra: Record<string, unknown> = {}) => call('POST', '/admin/question-bank/review/confirm', {
    card_ids: cardIds, operation_id: randomUUID(), actor: 'tester', reason: 'repeated questions', ...extra,
  });
  return {
    store, app, settings, schema, account, solve, solved, round, call, confirm, reviews, reviewRequests,
    reviewerCalls: () => reviewRequests.length,
    reviewMostInFlight: () => reviewMost,
    close: async () => {
      await settledRequestWork();
      await app.close();
      await store.close();
      if (schema && admin) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    },
  };
}

async function answerCosts(store: Store) {
  const overview = await store.admin.overview({ from: iso(Date.now() - DAY), to: iso(Date.now() + DAY) });
  return { costs: overview.costs, models: overview.models };
}

async function inference(store: Store, from: string) {
  const query: ReportQuery = { cohortFrom: from, cohortTo: iso(Date.now() + DAY), asOf: iso(Date.now()) };
  return aggregateEconomics(await store.reporting.snapshot(query), query).currencies.find(row => row.currency === 'USD')!.inference_micros;
}

test('a review job can only be inserted by the confirmation: in the code and in the schema', async () => {
  // Code: exactly one insertion of a review job per store, inside confirmReview.
  for (const [file, pattern] of [
    ['../src/question-bank-sql.ts', /VALUES \(\?,'review','pending'/g],
    ['../src/question-bank-memory.ts', /kind: 'review', status: 'pending'/g],
  ] as const) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const hits = [...source.matchAll(pattern)];
    assert.equal(hits.length, 1, file);
    const confirm = source.indexOf('confirmReview(input');
    const next = source.indexOf('claimReview(input', confirm);
    assert.ok(confirm > 0 && hits[0]!.index! > confirm && hits[0]!.index! < next, `${file}: the insertion is inside confirmReview`);
  }
  for (const file of ['../src/question-bank-worker.ts', '../src/question-bank-admin.ts', '../src/routes.ts', '../src/capture-service.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /INSERT INTO question_bank_jobs/, file);
  }
  // Schema: a review job without its confirming operation is rejected.
  const db = new DatabaseSync(':memory:');
  db.exec(questionBankSchema('BLOB'));
  const insert = (kind: string, operation: string | null) => db.prepare(
    `INSERT INTO question_bank_jobs (job_id, kind, status, attempt_count, card_id, operation_id, created_at, updated_at, next_attempt_at)
     VALUES (?,?,'pending',0,?,?,'t','t','t')`).run(randomUUID(), kind, randomUUID(), operation);
  assert.throws(() => insert('review', null), /CHECK constraint failed/);
  assert.throws(() => insert('transcribe', 'some-operation'), /CHECK constraint failed/);
  db.close();
  if (admin) {
    const schema = 'qbr_check_' + randomUUID().replaceAll('-', '');
    const client = await admin.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
      await client.query(questionBankSchema('BYTEA'));
      await assert.rejects(client.query(
        `INSERT INTO question_bank_jobs (job_id, kind, status, attempt_count, card_id, created_at, updated_at, next_attempt_at)
         VALUES ($1,'review','pending',0,$2,'t','t','t')`, [randomUUID(), randomUUID()]), /check constraint/);
    } finally {
      await client.query(`SET search_path TO public; DROP SCHEMA ${schema} CASCADE`);
      client.release();
    }
  }
});

test('Astra makes one call for purpose review even with Fast review on; the review provider never has Fast review', async t => {
  const upstream = (raw: string, tier: string) => {
    const id = { model: ASTRA_MODEL, service_tier: tier };
    const frames = [{ ...id, choices: [{ delta: { content: raw }, finish_reason: null }] }, { ...id, choices: [{ delta: {}, finish_reason: 'stop' }] },
      { ...id, choices: [], usage: { prompt_tokens: 200, completion_tokens: 20 } }];
    return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  // The ambiguous answer is exactly the case that makes Astra call Fast a second time for an answer.
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
    JSON.parse(String(init.body)).service_tier === 'fast' ? upstream(result('D'), 'fast') : upstream(result('B or D', 'review'), 'default'));
  const request = { system: 'S', task: 'T', images: [{ mediaType: 'image/png', base64: 'QUJD' }] };
  const fast = new AstraProvider('synthetic', 'https://vendor.invalid', 8192, true);
  await fast.stream({ ...request, purpose: 'answer' }, () => {}, new AbortController().signal);
  assert.equal(fetchMock.mock.callCount(), 2, 'control: an answer call does make the second call');
  await fast.stream({ ...request, purpose: 'review' }, () => {}, new AbortController().signal);
  assert.equal(fetchMock.mock.callCount(), 3, 'a review call makes one');

  assert.equal(makeReviewProvider(config, assert.fail), null, 'no reviewer unless both settings are set');
  assert.equal(makeReviewProvider({ ...config, questionBankReviewProvider: 'openai', questionBankReviewModel: '' }, assert.fail), null);
  const built = makeReviewProvider({
    ...config, questionBankReviewProvider: 'openai', questionBankReviewModel: ASTRA_MODEL, openaiKey: 'synthetic',
    openaiBaseURL: 'https://vendor.invalid', objectiveAstraFastReview: true,
  }, assert.fail);
  assert.ok(built && built.degraded === null && built.provider instanceof AstraProvider);
  await built.provider.stream({ ...request, purpose: 'answer' }, () => {}, new AbortController().signal);
  assert.equal(fetchMock.mock.callCount(), 4, 'the review provider has no Fast leg at all');
  const unknown = makeReviewProvider({ ...config, questionBankReviewProvider: 'nonsense', questionBankReviewModel: 'x' }, () => {});
  assert.ok(unknown?.degraded, 'an unknown provider name is a configuration error, not a silent mock');
});

const kinds = ['memory', 'sqlite', ...(postgres ? ['postgres' as const] : [])] as const;
if (!postgres) test('postgres question-bank review', { skip: 'no TEST_POSTGRES_URL and no local PostgreSQL binary' }, () => {});

for (const kind of kinds) {
  test(`${kind}: nothing calls the reviewer until an admin confirms, and one operation id makes one job per card`, async () => {
    const b = await bank(kind);
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED);
      await b.solved(c.token, SPEED);
      const y1 = await b.solved(a.token, TRAIN);
      await b.solved(c.token, TRAIN);
      const single = await b.solved(a.token, 'What is 2 + 2?');
      for (let i = 0; i < 3; i += 1) await b.round();
      // Every other admin action leaves the reviewer alone too.
      assert.equal((await b.call('GET', '/admin/question-bank/stats')).status, 200);
      assert.equal((await b.call('GET', '/admin/question-bank/samples/matches?count=5')).status, 200);
      assert.equal((await b.call('GET', '/admin/question-bank/review/disputed')).status, 200);
      const list = (await b.call('GET', '/admin/question-bank/review/cards')).json();
      assert.deepEqual(list.reviewer, { provider: 'mock', model: 'review-model', available: true });
      assert.deepEqual(list.items.map((item: Record<string, unknown>) => [item.card_id, item.occurrences, item.blocked]).sort(),
        [[x1.cardId, 2, null], [y1.cardId, 2, null]].sort(), 'only repeated cards are listed');
      const preview = (await b.call('POST', '/admin/question-bank/review/preview', { card_ids: [x1.cardId, y1.cardId] })).json();
      assert.deepEqual([preview.cards, preview.calls, preview.without_call, preview.blocked, preview.estimated_micros], [2, 2, 0, 0, 20_000],
        'without its own estimate a call reserves ATTEMPT_BUDGET_UPPER_MICROS');
      assert.equal((await b.call('POST', '/admin/question-bank/review/preview', { card_ids: [single.cardId] })).json().items[0].blocked, 'not_repeated');
      assert.equal(b.reviewerCalls(), 0, 'no call before a confirmation');
      assert.deepEqual((await b.store.questionBank.reviewData()).jobs, []);

      const body = { card_ids: [y1.cardId, x1.cardId], operation_id: randomUUID(), actor: 'tester', reason: 'repeated questions' };
      const first = await b.call('POST', '/admin/question-bank/review/confirm', body);
      assert.equal(first.status, 200);
      assert.deepEqual(first.json(), { operation_id: body.operation_id, cards: [x1.cardId, y1.cardId].sort(), replayed: false });
      assert.equal((await b.call('POST', '/admin/question-bank/review/confirm', body)).json().replayed, true);
      assert.equal((await b.call('POST', '/admin/question-bank/review/confirm', { ...body, reason: 'another reason' })).status, 409);
      const twice = await b.call('POST', '/admin/question-bank/review/confirm', { ...body, operation_id: randomUUID() });
      assert.equal(twice.status, 409);
      assert.deepEqual(twice.json().blocked.map((item: { reason: string }) => item.reason), ['review_open', 'review_open']);
      const jobs = (await b.store.questionBank.reviewData()).jobs;
      assert.equal(jobs.length, 2, 'a repeated confirmation makes no second job');
      assert.ok(jobs.every(job => job.operationId === body.operation_id && job.status === 'pending'));
      const [audit] = await b.store.questionBank.operations(5);
      assert.deepEqual([audit?.kind, audit?.actor, audit?.reason, audit?.after], ['review', 'tester', 'repeated questions', { cards: [x1.cardId, y1.cardId].sort() }]);
      assert.equal((await b.confirm([single.cardId])).json().blocked[0].reason, 'not_repeated');
      assert.equal((await b.confirm([randomUUID()])).json().blocked[0].reason, 'missing');
      assert.equal(b.reviewerCalls(), 0, 'confirming only queues jobs');

      const round = await b.round();
      assert.deepEqual([round.reviews.calls, round.reviews.verified, round.reviews.stop], [2, 2, 'drained']);
      assert.equal(b.reviewerCalls(), 2);
      for (const card of [x1, y1]) assert.equal((await b.store.questionBank.findCard(card.cardId!))?.state, 'verified_model');
      await b.round();
      assert.equal(b.reviewerCalls(), 2, 'a finished job is not run again');
      const again = await b.confirm([x1.cardId]);
      assert.equal(again.json().blocked[0].reason, 'reviewed', 'a reviewed card is not reviewed again');
      assert.equal((await b.call('POST', '/admin/question-bank/review/confirm', { ...body, card_ids: [] })).status, 400);
      assert.equal((await b.call('POST', '/admin/question-bank/review/confirm', { ...body, operation_id: randomUUID(), reason: 'no' })).status, 400);
    } finally { await b.close(); }
  });

  test(`${kind}: without a configured reviewer nothing can be confirmed or called`, async () => {
    const b = await bank(kind, {}, { reviewer: false });
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED);
      await b.solved(c.token, SPEED);
      assert.equal((await b.call('GET', '/admin/question-bank/review/cards')).json().reviewer, null);
      for (const url of ['/admin/question-bank/review/preview', '/admin/question-bank/review/confirm']) {
        const reply = await b.call('POST', url, { card_ids: [x1.cardId], operation_id: randomUUID(), actor: 'tester', reason: 'repeated questions' });
        assert.deepEqual([reply.status, reply.json().error.code], [409, 'feature_disabled'], url);
      }
      assert.deepEqual((await b.store.questionBank.reviewData()).jobs, []);
      assert.equal((await b.round()).reviews.stop, 'disabled');
    } finally { await b.close(); }
  });

  test(`${kind}: the review re-sends the reviewed solve's own request with purpose review, and its cost stays out of answer costs`, async () => {
    const b = await bank(kind);
    try {
      const from = iso(Date.now() - 60_000);
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED, { system: 'SYS-X' });
      const x2 = await b.solved(c.token, SPEED, { system: 'SYS-X' });
      assert.equal((await b.confirm([x1.cardId])).status, 200);
      const before = {
        a: await b.store.billing.accountSnapshot(a.token), c: await b.store.billing.accountSnapshot(c.token),
        costs: await answerCosts(b.store), inference: await inference(b.store, from),
        transcription: (await b.store.billing.inspectBudget()).windows.find(w => w.scope === 'question_bank'),
      };
      assert.equal((await b.round()).reviews.verified, 1);

      const [request] = b.reviewRequests;
      assert.deepEqual(Object.keys(request!).sort(), ['images', 'purpose', 'reasoningEffort', 'system', 'task'], 'nothing else rides along');
      assert.deepEqual([request?.system, request?.task, request?.purpose, request?.reasoningEffort], ['SYS-X', 'TASK-PROMPT', 'review', 'high']);
      assert.deepEqual(request?.images.map(image => image.base64), x2.images.map(image => image.bytes?.toString('base64')), 'the latest counted solve');
      const sent = JSON.stringify(request);
      // The answer is the letter B, which base64 image data contains anyway; these cannot occur in base64.
      assert.equal(x1.finalAnswer, 'B');
      for (const text of [x2.modelOutput, '60 km/h', 'FINAL:', '_RESULT_V1']) assert.ok(!sent.includes(text), `no answer text: ${text}`);

      assert.deepEqual(await b.store.billing.accountSnapshot(a.token), before.a, 'no balance change');
      assert.deepEqual(await b.store.billing.accountSnapshot(c.token), before.c, 'no balance change for the reviewed account');
      assert.deepEqual(await answerCosts(b.store), before.costs, 'admin cost and model tables leave the review out');
      const after = await inference(b.store, from);
      assert.equal(after.by_purpose.review, 1, 'listed under its purpose');
      for (const field of ['attempts', 'known_subtotal', 'total', 'conservative_upper', 'cost_per_client_usable_solve'] as const) {
        assert.deepEqual(after[field], before.inference[field], field);
      }
      const review = (await b.store.billing.attempts(c.token)).filter(attempt => attempt.purpose === 'review');
      assert.deepEqual(review.map(attempt => [attempt.status, attempt.costMicros, attempt.captureId, attempt.model]), [['succeeded', '2200', x2.captureId, 'review-model']]);
      const windows = (await b.store.billing.inspectBudget()).windows;
      assert.deepEqual(windows.filter(w => w.scope === 'question_bank_review').map(w => [w.spent, w.held]), [[2200, 0]]);
      assert.deepEqual(windows.find(w => w.scope === 'question_bank'), before.transcription, 'the transcription budget is not used');
      const costs = (await b.call('GET', '/admin/question-bank/stats')).json().costs;
      assert.deepEqual(costs.find((row: { purpose: string }) => row.purpose === 'review'), { purpose: 'review', currency: 'USD', calls: 1, known_micros: '2200', unknown: 0 });
    } finally { await b.close(); }
  });

  test(`${kind}: outcomes: agreement verifies; a different, unsure, malformed or cut-short answer disputes; differing answers dispute without a call`, async () => {
    const b = await bank(kind);
    try {
      const [a, c, staff] = [await b.account(), await b.account(), await b.account()];
      assert.equal(await b.store.reporting.setInternal(staff.id, true, 'qbr-' + randomUUID()), true);
      const cards: Record<string, string> = {};
      for (const name of ['AGREE', 'DISAGREE', 'UNSURE', 'GARBAGE', 'CUT', 'DIFFER']) {
        const stem = `Question ${name}: how fast is the car?`, system = 'SYS-' + name;
        const first = await b.solved(a.token, stem, { system });
        await b.solved(c.token, stem, { system, answer: name === 'DIFFER' ? result('A') : result('B') });
        cards[name] = first.cardId!;
      }
      // An internal account's different answer does not count: AGREE still has one production answer.
      await b.solved(staff.token, 'Question AGREE: how fast is the car?', { system: 'SYS-AGREE', answer: result('A') });
      b.reviews.set('SYS-AGREE', result('B'));
      b.reviews.set('SYS-DISAGREE', result('A'));
      b.reviews.set('SYS-UNSURE', result('B or A', 'review'));
      b.reviews.set('SYS-GARBAGE', 'The answer is B.');
      b.reviews.set('SYS-CUT', { text: result('B'), finishReason: 'length' });
      const listed = (await b.call('GET', '/admin/question-bank/review/cards')).json().items as Array<Record<string, any>>;
      const byCard = new Map(listed.map(item => [item.card_id, item]));
      assert.equal(byCard.get(cards.AGREE)?.occurrences, 2, 'the internal solve is not counted');
      assert.deepEqual(byCard.get(cards.DIFFER)?.answers.map((row: { count: number }) => row.count), [1, 1]);
      assert.equal(byCard.get(cards.DIFFER)?.answers_differ, true);
      assert.equal((await b.call('GET', '/admin/question-bank/stats')).json().answers_differ, 1);
      const preview = (await b.call('POST', '/admin/question-bank/review/preview', { card_ids: Object.values(cards) })).json();
      assert.deepEqual([preview.calls, preview.without_call, preview.estimated_micros], [5, 1, 50_000]);

      assert.equal((await b.confirm(Object.values(cards))).status, 200);
      // Thirteen answers and transcriptions just filled this minute's supplier window; reviews queue behind it.
      // DIFFER needs no call, so it may already be settled here if its job comes first.
      const busy = await b.round();
      assert.equal(busy.reviews.stop, 'busy');
      assert.equal(b.reviewerCalls(), 0);
      const round = await b.round(Date.now() + 2 * 60_000);
      assert.deepEqual([round.reviews.calls, round.reviews.verified, busy.reviews.disputed + round.reviews.disputed], [5, 1, 5]);
      assert.equal(b.reviewerCalls(), 5, 'DIFFER was not sent to the reviewer');
      assert.ok(!b.reviewRequests.some(request => request.system === 'SYS-DIFFER'));
      const expected: Record<string, [string, string, string | null]> = {
        AGREE: ['verified_model', 'agrees', 'B'], DISAGREE: ['disputed', 'disagrees', 'A'], UNSURE: ['disputed', 'not_ready', 'B or A'],
        GARBAGE: ['disputed', 'not_ready', null], CUT: ['disputed', 'not_ready', null], DIFFER: ['disputed', 'answers_differ', null],
      };
      const jobs = new Map((await b.store.questionBank.reviewData()).jobs.map(job => [job.cardId, job]));
      for (const [name, [state, basis, answer]] of Object.entries(expected)) {
        assert.equal((await b.store.questionBank.findCard(cards[name]!))?.state, state, name);
        const events = await b.store.questionBank.cardEvents(cards[name]!);
        assert.deepEqual(events.map(event => [event.actor, event.fromState, event.toState, event.basis, event.answer]),
          [['review_job', 'unverified', state, basis, answer]], name);
        assert.equal(events[0]?.jobId, jobs.get(cards[name]!)?.jobId, name);
        assert.equal(jobs.get(cards[name]!)?.result?.outcome, basis, name);
      }
      const attempts = [...await b.store.billing.attempts(a.token), ...await b.store.billing.attempts(c.token)].filter(attempt => attempt.purpose === 'review');
      assert.deepEqual(attempts.map(attempt => attempt.status).sort(), ['failed', 'succeeded', 'succeeded', 'succeeded', 'succeeded'], 'only the cut-short call failed');
    } finally { await b.close(); }
  });

  test(`${kind}: a card whose images expired is listed as such and cannot be confirmed; images that expire after confirmation skip the job`, async () => {
    const b = await bank(kind);
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED);
      await b.solved(c.token, SPEED);
      const y1 = await b.solved(a.token, TRAIN);
      await b.solved(c.token, TRAIN);
      assert.equal((await b.confirm([y1.cardId])).status, 200);
      const later = Date.now() + 91 * DAY;
      const round = await b.round(later);
      assert.equal(round.imagesCleared, 8);
      assert.deepEqual([round.reviews.calls, round.reviews.skipped], [0, 1], 'retention runs first; the job finds no images');
      assert.equal(b.reviewerCalls(), 0);
      const yJob = (await b.store.questionBank.reviewData([y1.cardId!])).jobs[0];
      assert.deepEqual([yJob?.status, yJob?.errorCode], ['skipped', 'image_deleted']);
      assert.equal((await b.store.questionBank.findCard(y1.cardId!))?.state, 'unverified');

      const listed = (await b.call('GET', '/admin/question-bank/review/cards')).json().items as Array<Record<string, any>>;
      assert.deepEqual(listed.map(item => [item.card_id, item.blocked]).sort(), [[x1.cardId, 'images_expired'], [y1.cardId, 'images_expired']].sort());
      const preview = (await b.call('POST', '/admin/question-bank/review/preview', { card_ids: [x1.cardId] })).json();
      assert.deepEqual([preview.calls, preview.blocked, preview.items[0].blocked], [0, 1, 'images_expired']);
      const refused = await b.confirm([x1.cardId]);
      assert.deepEqual([refused.status, refused.json().blocked], [409, [{ card_id: x1.cardId, reason: 'images_expired' }]]);
      assert.equal((await b.store.questionBank.reviewData([x1.cardId!])).jobs.length, 0);
    } finally { await b.close(); }
  });

  test(`${kind}: a disputed card shows images and every answer, and an admin's ruling makes it verified_human with an audit`, async () => {
    const b = await bank(kind);
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED, { system: 'SYS-X' });
      const x2 = await b.solved(c.token, SPEED, { system: 'SYS-X' });
      const y1 = await b.solved(a.token, TRAIN, { system: 'SYS-Y' });
      await b.solved(c.token, TRAIN, { system: 'SYS-Y' });
      b.reviews.set('SYS-X', result('A'));
      assert.equal((await b.confirm([x1.cardId, y1.cardId])).status, 200);
      await b.round();

      const disputed = (await b.call('GET', '/admin/question-bank/review/disputed')).json().items as Array<Record<string, any>>;
      assert.equal(disputed.length, 1);
      const [item] = disputed;
      assert.equal(item?.card_id, x1.cardId);
      assert.deepEqual(item?.answers, [{ content: '["60 km/h"]', example: 'B', count: 2 }]);
      assert.deepEqual([item?.latest_review.outcome, item?.latest_review.answer, item?.latest_review.provider], ['disagrees', 'A', 'mock']);
      assert.equal(item?.images.attempt_id, x2.attemptId);
      assert.deepEqual(item?.images.images.map((image: { stored: boolean }) => image.stored), [true, true]);

      const body = { card_id: x1.cardId, operation_id: randomUUID(), answer: 'B: 60 km/h', basis: 'distance over time is 60 km/h', actor: 'tester' };
      const ruled = await b.call('POST', '/admin/question-bank/review/adjudicate', body);
      assert.deepEqual([ruled.status, ruled.json()], [200, { operation_id: body.operation_id, card_id: x1.cardId, state: 'verified_human', replayed: false }]);
      assert.equal((await b.call('POST', '/admin/question-bank/review/adjudicate', body)).json().replayed, true);
      assert.equal((await b.call('POST', '/admin/question-bank/review/adjudicate', { ...body, answer: 'A' })).status, 409);
      const notDisputed = await b.call('POST', '/admin/question-bank/review/adjudicate', { ...body, card_id: y1.cardId, operation_id: randomUUID() });
      assert.deepEqual([notDisputed.status, notDisputed.json().error.code], [409, 'card_not_disputed']);
      assert.equal((await b.call('POST', '/admin/question-bank/review/adjudicate', { ...body, card_id: randomUUID(), operation_id: randomUUID() })).status, 404);
      assert.equal((await b.call('POST', '/admin/question-bank/review/adjudicate', { ...body, operation_id: randomUUID(), basis: 'no' })).status, 400);

      assert.equal((await b.store.questionBank.findCard(x1.cardId!))?.state, 'verified_human');
      const events = await b.store.questionBank.cardEvents(x1.cardId!);
      assert.deepEqual(events.map(event => [event.actor, event.fromState, event.toState, event.basis, event.answer, event.operationId]), [
        ['review_job', 'unverified', 'disputed', 'disagrees', 'A', events[0]!.operationId],
        ['tester', 'disputed', 'verified_human', 'distance over time is 60 km/h', 'B: 60 km/h', body.operation_id],
      ]);
      const [audit] = await b.store.questionBank.operations(5);
      assert.deepEqual([audit?.kind, audit?.actor, audit?.reason, audit?.after], ['adjudicate', 'tester', 'distance over time is 60 km/h', { state: 'verified_human' }]);
      assert.deepEqual((await b.call('GET', '/admin/question-bank/review/disputed')).json().items, []);
    } finally { await b.close(); }
  });

  test(`${kind}: review spends its own daily budget: used up it waits, and transcription neither uses nor blocks it`, async () => {
    const b = await bank(kind, { questionBankReviewDailyBudgetMicros: 5_000 });
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED);
      await b.solved(c.token, SPEED);
      const preview = (await b.call('POST', '/admin/question-bank/review/preview', { card_ids: [x1.cardId] })).json();
      assert.deepEqual(preview.review_budget, { limit_micros: 5_000, spent_micros: 0, held_micros: 0, remaining_micros: 5_000, enough: false });
      assert.equal(preview.official_budget.enough, true);
      assert.equal((await b.confirm([x1.cardId])).status, 200);
      const waiting = await b.solve(a.token);
      const starved = await b.round();
      assert.deepEqual([starved.reviews.calls, starved.reviews.stop, starved.completed], [0, 'budget', 1], 'transcription goes on');
      assert.equal(b.reviewerCalls(), 0);
      assert.equal((await b.store.questionBank.reviewData([x1.cardId!])).jobs[0]?.status, 'pending', 'the job waits');
      assert.equal((await b.store.questionBank.findByCapture(waiting))?.jobStatus, 'done');

      // A day's review budget, while transcription has none: the review runs on its own budget.
      const ran = await b.round(undefined, { questionBankReviewDailyBudgetMicros: 100_000, questionBankDailyBudgetMicros: 0 });
      assert.deepEqual([ran.reviews.verified, ran.stop], [1, 'budget']);
      const windows = (await b.store.billing.inspectBudget()).windows;
      assert.deepEqual(windows.filter(w => w.scope === 'question_bank_review').map(w => [w.limit, w.spent, w.held]), [[100_000, 2200, 0]],
        'the starved round left nothing behind: a hold that does not fit rolls back');
      assert.deepEqual(windows.filter(w => w.scope === 'question_bank').map(w => w.spent), [3 * 1100], 'only the three transcriptions');
    } finally { await b.close(); }
  });

  test(`${kind}: a review lease left by a crashed round counts its call and settles the review hold`, async () => {
    const b = await bank(kind);
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED);
      await b.solved(c.token, SPEED);
      assert.equal((await b.confirm([x1.cardId])).status, 200);
      const t0 = Date.now(), modelAttemptId = randomUUID();
      const job = await b.store.questionBank.claimReview({ now: iso(t0), leaseUntil: iso(t0 + 1000), modelAttemptId });
      assert.ok(job?.solve);
      assert.equal(await b.store.billing.beginBankAttempt({
        deviceId: job.solve.deviceId, requestId: job.solve.requestId, reservedMicros: 10_000, currency: 'USD', now: t0, utcOffsetMinutes: 0,
        attempt: { attemptId: modelAttemptId, captureId: job.solve.captureId, purpose: 'review', provider: 'mock', model: 'review-model', policyVersion: 'test', currency: 'USD', pricingVersion: 'qb-test' },
        holds: [
          { holdId: modelAttemptId, scope: 'official', limitMicros: 1_000_000, channel: 'test', share: 1 },
          { holdId: questionBankReviewHoldId(modelAttemptId), scope: 'question_bank_review', limitMicros: 100_000, channel: 'test', share: 1 },
        ],
        capacityTokens: 1000, capacityShare: 1,
      }), 'started');
      const round = await b.round(t0 + 2000);
      assert.equal(round.recovered, 1);
      assert.equal(round.reviews.verified, 1, 'the retry ran at once');
      const [after] = (await b.store.questionBank.reviewData([x1.cardId!])).jobs;
      assert.equal(after?.status, 'done');
      const statuses = [...await b.store.billing.attempts(a.token), ...await b.store.billing.attempts(c.token)]
        .filter(attempt => attempt.purpose === 'review').map(attempt => attempt.status).sort();
      assert.deepEqual(statuses, ['succeeded', 'unknown']);
      const reviewWindow = (await b.store.billing.inspectBudget()).windows.find(w => w.scope === 'question_bank_review');
      assert.deepEqual([reviewWindow?.held, reviewWindow?.spent], [0, 10_000 + 2200], 'the unknown call is booked at its reservation');
    } finally { await b.close(); }
  });

  test(`${kind}: deleting the reviewed account removes its review job, while the shared card keeps its state and history`, async () => {
    const b = await bank(kind);
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, SPEED);
      await b.solved(c.token, SPEED);
      assert.equal((await b.confirm([x1.cardId])).status, 200);
      await b.round();
      assert.equal((await b.store.questionBank.findCard(x1.cardId!))?.state, 'verified_model');
      // The reviewed solve is c's, the latest one: its review job goes with it.
      const preview = (await b.call('POST', '/admin/question-bank/accounts/preview', { device_id: c.id })).json();
      assert.deepEqual([preview.jobs, preview.cards_kept], [2, 1], 'its transcription job and the review job');
      const deleted = await b.call('POST', '/admin/question-bank/accounts/delete', { device_id: c.id, operation_id: randomUUID(), actor: 'tester', reason: 'the user asked by email' });
      assert.equal(deleted.status, 200);
      assert.deepEqual((await b.store.questionBank.reviewData([x1.cardId!])).jobs, []);
      assert.equal((await b.store.questionBank.findCard(x1.cardId!))?.state, 'verified_model');
      assert.equal((await b.store.questionBank.cardEvents(x1.cardId!)).length, 1);
      // Deleting the last account removes the card with its history.
      await b.call('POST', '/admin/question-bank/accounts/delete', { device_id: a.id, operation_id: randomUUID(), actor: 'tester', reason: 'the user asked by email' });
      assert.equal(await b.store.questionBank.findCard(x1.cardId!), null);
      assert.deepEqual(await b.store.questionBank.cardEvents(x1.cardId!), []);
    } finally { await b.close(); }
  });

  test(`${kind}: only one review call runs at a time, and transcription keeps the other workers`, async () => {
    const b = await bank(kind);
    try {
      const accounts = [await b.account(), await b.account()];
      const cards: string[] = [];
      for (const stem of ['Q1 speed?', 'Q2 speed?', 'Q3 speed?']) {
        const first = await b.solved(accounts[0]!.token, stem, { system: 'SYS-' + stem });
        await b.solved(accounts[1]!.token, stem, { system: 'SYS-' + stem });
        cards.push(first.cardId!);
      }
      assert.equal((await b.confirm(cards)).status, 200);
      for (let i = 0; i < 4; i += 1) await b.solve(accounts[0]!.token);
      const round = await b.round();
      assert.deepEqual([round.reviews.verified, round.completed], [3, 4]);
      assert.equal(b.reviewMostInFlight(), 1);
      assert.ok(round.calls + round.reviews.calls <= QUESTION_BANK_ROUND.maxCalls);
    } finally { await b.close(); }
  });
}
