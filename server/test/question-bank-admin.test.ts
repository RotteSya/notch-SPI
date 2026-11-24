import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import pg from 'pg';
import { config, type Config } from '../src/config.ts';
import { registerRoutes } from '../src/routes.ts';
import { MemoryStore } from '../src/db-memory.ts';
import { SqliteStore } from '../src/db-sqlite.ts';
import { PostgresStore, resolvePostgresSSL } from '../src/db-postgres.ts';
import { StubPaymentProvider } from '../src/payments.ts';
import type { Provider } from '../src/providers/types.ts';
import type { Store } from '../src/db.ts';
import {
  QUESTION_BANK_TOP_ACCOUNTS, questionBankCosts, questionBankMarkSummary, questionBankStats,
  type QuestionBankMark, type QuestionBankOccurrenceRow, type QuestionBankTranscript,
} from '../src/question-bank.ts';
import { runQuestionBankRound } from '../src/question-bank-worker.ts';
import { TRANSCRIBE_MAX_TOKENS } from '../src/question-bank-prompt.ts';
import { settledRequestWork } from '../src/request-lifecycle.ts';
import { corruptPixels, taggedPngBase64 } from './helpers/images.ts';
import { openEphemeralPostgres } from './helpers/ephemeral-postgres.ts';

const ready = 'FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
const KEY = 'k'.repeat(40);
const CRON = 'c'.repeat(40);
// One micro per input token and two per output token: every transcription call costs 1100.
const PRICING = JSON.stringify([{ model: 'mock:bank-test', input_micros_per_million_tokens: 1_000_000, output_micros_per_million_tokens: 2_000_000 }]);
const SPEED = 'A car travels 120 km in 2 hours. What is its average speed?';
const TRAIN = 'A train travels 300 km in 3 hours. What is its average speed?';
// Each solve's first image carries its capture id, a fixed-length UUID, so every solve stores the same number of bytes.
const IMAGE_BYTES = Buffer.from(taggedPngBase64(randomUUID()), 'base64').length + corruptPixels().length;
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const postgres = await openEphemeralPostgres();
const admin = postgres ? new pg.Pool({ connectionString: postgres.url, ssl: resolvePostgresSSL({ connectionString: postgres.url }) }) : null;
after(async () => { await admin?.end(); await postgres?.close(); });

function transcript(stem: string, extra: Partial<QuestionBankTranscript> = {}): string {
  return JSON.stringify({ status: 'ok', language: 'en', stem, options: [{ label: 'A', text: '40 km/h' }, { label: 'B', text: '60 km/h' }], has_figure: false, ...extra });
}

type Reply = string | { text: string; finishReason: string };

async function bank(kind: 'memory' | 'sqlite' | 'postgres', overrides: Partial<Config> = {}) {
  let schema: string | null = null;
  let store: Store;
  if (kind === 'postgres') {
    if (!postgres || !admin) throw new Error('PostgreSQL fixture requires a server');
    schema = 'qba_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(postgres.url);
    url.searchParams.set('options', '-c search_path=' + schema);
    store = new PostgresStore(url.toString(), resolvePostgresSSL({ connectionString: url.toString() }));
  } else store = kind === 'memory' ? new MemoryStore() : new SqliteStore(':memory:');
  // Replies belong to a solve, found by its own first image: jobs due together are claimed in no fixed order.
  const ownReplies = new Map<string, Reply[]>(), captureOfImage = new Map<string, string>();
  const reply = (captureId: string, ...more: Reply[]) => { ownReplies.set(captureId, [...(ownReplies.get(captureId) ?? []), ...more]); };
  const provider: Provider = {
    name: 'mock',
    async stream(req, delta) {
      if (req.purpose !== 'transcribe') { delta(ready); return { inputTokens: 11, outputTokens: 7, finishReason: 'stop' }; }
      const next = ownReplies.get(captureOfImage.get(req.images[0]?.base64 ?? '') ?? '')?.shift() ?? transcript('Default question');
      delta(typeof next === 'string' ? next : next.text);
      return { inputTokens: 1000, outputTokens: 50, finishReason: typeof next === 'string' ? 'stop' : next.finishReason };
    },
  };
  const settings: Config = {
    ...config,
    provider: 'mock', objectiveProvider: 'mock', model: 'bank-test', objectiveModel: 'bank-test',
    requireDurableStorage: false, isServerless: false, requestBudgetMode: 'fixed', capturePerMinute: 0,
    modelDailyBudgetMicros: 1_000_000, attemptBudgetUpperMicros: 10_000, questionBankDailyBudgetMicros: 100_000,
    modelPricingJSON: PRICING, modelPricingVersion: 'qb-test', modelCostCurrency: 'USD', cronSecret: CRON,
    questionBankEnabled: true, questionBankImageRetentionDays: 90, adminToken: KEY,
    requestHmacKeysJSON: JSON.stringify({ test: randomBytes(32).toString('base64') }), requestHmacKeyVersion: 'test',
    ...overrides,
  };
  const app = Fastify({ logger: false });
  registerRoutes(app, {
    config: settings, store, storeKind: kind, provider, objectiveProvider: provider,
    providerDegraded: null, objectiveProviderDegraded: null, payment: new StubPaymentProvider(),
  });
  const account = async (platform = 'macos') => store.registerDevice({ platform, appVersion: '4.0', trialQuestions: 30 });
  const solve = async (token: string) => {
    const captureId = randomUUID(), image = taggedPngBase64(captureId);
    captureOfImage.set(image, captureId);
    const response = await app.inject({
      method: 'POST', url: '/v1/captures', headers: { authorization: `Bearer ${token}` },
      payload: {
        capture_id: captureId, result_protocol: 'objective_v1', operation: 'solve', system: 'SYS-PROMPT', task: 'TASK-PROMPT',
        images_base64: [image, corruptPixels().toString('base64')], image_media_type: 'image/png', reasoning_effort: 'low', question_bank_v1: true,
      },
    });
    await settledRequestWork();
    assert.equal(response.statusCode, 200);
    return captureId;
  };
  const round = (at?: number) => runQuestionBankRound({
    config: settings, store, provider, providerDegraded: null, ...(at === undefined ? {} : { now: () => at }),
  });
  /** Solve, then transcribe that solve with `answer`, so creation order is the solve order. */
  const solved = async (token: string, answer: Reply) => {
    const captureId = await solve(token);
    reply(captureId, answer);
    await round();
    return (await store.questionBank.findByCapture(captureId))!;
  };
  const call = async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, key: string | null = KEY) => {
    const response = await app.inject({ method, url, ...(key === null ? {} : { headers: { 'x-admin-token': key } }), ...(payload ? { payload } : {}) });
    return { status: response.statusCode, json: () => response.json() as Record<string, any>, response };
  };
  return {
    store, app, settings, reply, account, solve, round, solved, call,
    close: async () => {
      await settledRequestWork();
      await app.close();
      await store.close();
      if (schema && admin) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    },
  };
}

const ENDPOINTS: Array<['GET' | 'POST', string, Record<string, unknown>?]> = [
  ['GET', '/admin/question-bank/stats'],
  ['POST', '/admin/question-bank/requeue', { operation_id: randomUUID(), actor: 'tester', reason: 'retry all' }],
  ['GET', '/admin/question-bank/samples/transcripts?count=1'],
  ['GET', '/admin/question-bank/samples/matches?count=1'],
  ['GET', `/admin/question-bank/attempts/${randomUUID()}/images/0`],
  ['POST', '/admin/question-bank/marks', { mark_id: randomUUID(), kind: 'transcript', attempt_id: randomUUID(), verdict: 'correct', actor: 'tester' }],
  ['POST', '/admin/question-bank/accounts/preview', { device_id: 1 }],
  ['POST', '/admin/question-bank/accounts/delete', { device_id: 1, operation_id: randomUUID(), actor: 'tester', reason: 'user asked' }],
];

test('stats: top accounts are left out entirely for the second rate; checkpoints count the denominator', () => {
  const row = (attemptId: string, deviceId: number, minute: number, cardId: string, extra: Partial<QuestionBankOccurrenceRow> = {}): QuestionBankOccurrenceRow =>
    ({ attemptId, deviceId, createdAt: iso(Date.UTC(2026, 10, 1, 0, minute)), internal: false, jobStatus: 'done', jobErrorCode: null, cardId, matchable: true, unmatchable: null, ...extra });
  // Device 1 repeats its own question three times; devices 2–7 each answer once, and 7 repeats 2's question.
  const rows = [
    row('a01', 1, 1, 'c1'), row('a02', 1, 2, 'c1'), row('a03', 1, 3, 'c1'), row('a04', 1, 4, 'c1'),
    row('a05', 2, 5, 'c2'), row('a06', 3, 6, 'c3'), row('a07', 4, 7, 'c4'), row('a08', 5, 8, 'c5'), row('a09', 6, 9, 'c6'), row('a10', 7, 10, 'c2'),
    row('a11', 8, 11, 'c7', { jobStatus: 'failed', jobErrorCode: 'timeout' }), row('a12', 8, 12, 'c7', { jobStatus: 'failed', jobErrorCode: 'output_truncated' }),
    row('a13', 8, 13, 'c7', { jobStatus: 'pending' }),
  ];
  const stats = questionBankStats(rows);
  assert.deepEqual([stats.denominator, stats.repeated, stats.sameAccount, stats.otherAccount], [10, 4, 3, 1]);
  assert.equal(stats.repeatRate, 0.4);
  assert.equal(QUESTION_BANK_TOP_ACCOUNTS, 5);
  assert.deepEqual(stats.topAccounts.map(a => [a.deviceId, a.solves, a.share]), [[1, 4, 0.4], [2, 1, 0.1], [3, 1, 0.1], [4, 1, 0.1], [5, 1, 0.1]]);
  // Without devices 1–5, device 7's solve has no earlier counted solve on c2: 6 and 7 each answer once, no repeat.
  assert.deepEqual(stats.withoutTopAccounts, { denominator: 2, repeated: 0, repeatRate: 0 });
  assert.deepEqual(stats.matchability, { matchable: 10, multiple: 0, unreadable: 0, not_question: 0, figure: 0, empty_stem: 0 });
  assert.equal(stats.matchableRepeatRate, 0.4, 'every solve here can match');
  assert.deepEqual(stats.transcription, { solves: 13, done: 10, waiting: 1, failed: 2, skipped: 0, coverage: 10 / 13, failedByError: { timeout: 1, output_truncated: 1 } });
  const many = (n: number) => Array.from({ length: n }, (_, i) => row('m' + String(i).padStart(4, '0'), 100 + i, 0, 'x' + i));
  assert.deepEqual(questionBankStats(many(999)).checkpoints, { reached: [], next: 1000 });
  assert.deepEqual(questionBankStats(many(1000)).checkpoints, { reached: [1000], next: 1500 });
  assert.deepEqual(questionBankStats(many(2000)).checkpoints, { reached: [1000, 1500, 2000], next: null });
  const empty = questionBankStats([]);
  assert.deepEqual([empty.repeatRate, empty.matchableRepeatRate, empty.transcription.coverage, empty.topAccounts], [null, null, null, []], 'no samples is not 0%');
});

test('stats split the denominator by why a solve can never match, over the same solves', () => {
  const row = (attemptId: string, deviceId: number, minute: number, cardId: string | null, extra: Partial<QuestionBankOccurrenceRow> = {}): QuestionBankOccurrenceRow =>
    ({ attemptId, deviceId, createdAt: iso(Date.UTC(2026, 10, 1, 2, minute)), internal: false, jobStatus: 'done', jobErrorCode: null, cardId, matchable: true, unmatchable: null, ...extra });
  const never = (reason: QuestionBankOccurrenceRow['unmatchable']) => ({ matchable: false, unmatchable: reason });
  const stats = questionBankStats([
    row('b1', 1, 1, 'q1'), row('b2', 2, 2, 'q1'),
    row('b3', 1, 3, 'u1', never('multiple')), row('b4', 2, 4, 'u2', never('multiple')), row('b5', 3, 5, 'u3', never('unreadable')),
    row('b6', 3, 6, 'u4', never('figure')), row('b7', 4, 7, 'u5', never('empty_stem')), row('b11', 4, 11, 'u7', never('not_question')),
    row('b8', 9, 8, 'u6', { ...never('multiple'), internal: true }),                               // internal: not in the denominator
    row('b9', 4, 9, null, { matchable: false, jobStatus: 'pending' }), row('b10', 4, 10, null, { matchable: false, jobStatus: 'failed' }),
  ]);
  assert.equal(stats.denominator, 8);
  assert.deepEqual(stats.matchability, { matchable: 2, multiple: 2, unreadable: 1, not_question: 1, figure: 1, empty_stem: 1 });
  assert.equal(Object.values(stats.matchability).reduce((sum, n) => sum + n, 0), stats.denominator);
  assert.equal(stats.repeated, 1, 'the unmatchable solves stay in the denominator and never repeat');
  assert.deepEqual([stats.repeatRate, stats.matchableRepeatRate], [1 / 8, 1 / 2], 'the same repeats over all counted solves, then over the matchable ones');
  const none = questionBankStats([row('c1', 1, 1, 'u1', never('multiple')), row('c2', 2, 2, 'u2', never('figure'))]);
  assert.deepEqual([none.repeatRate, none.matchableRepeatRate], [0, null], 'no matchable solve is no sample, not 0%');
});

test('mark summary keeps the latest verdict per solve or pair; costs keep unknown costs apart', () => {
  const mark = (markId: string, minute: number, extra: Partial<QuestionBankMark>): QuestionBankMark =>
    ({ markId, kind: 'transcript', attemptId: 'a1', otherAttemptId: null, verdict: 'correct', actor: 't', createdAt: iso(Date.UTC(2026, 10, 1, 0, minute)), ...extra });
  assert.deepEqual(questionBankMarkSummary([
    mark('m1', 1, {}), mark('m2', 2, { verdict: 'wrong' }), mark('m3', 1, { attemptId: 'a2' }),
    mark('m4', 1, { kind: 'match', otherAttemptId: 'a2', verdict: 'different' }), mark('m5', 3, { kind: 'match', otherAttemptId: 'a2', verdict: 'same' }),
  ]), { transcript: { correct: 1, wrong: 1 }, match: { same: 1, different: 0 } });
  assert.deepEqual(questionBankCosts([
    { purpose: 'transcribe', currency: 'USD', costMicros: '1100' }, { purpose: 'transcribe', currency: 'USD', costMicros: null },
    { purpose: 'transcribe', currency: 'USD', costMicros: '900' },
  ]), [{ purpose: 'transcribe', currency: 'USD', calls: 3, knownMicros: '2000', unknown: 1 }]);
});

test('the page and every endpoint are absent when ADMIN_TOKEN is not set', async () => {
  const b = await bank('memory', { adminToken: '' });
  try {
    assert.equal((await b.app.inject({ url: '/admin/question-bank' })).statusCode, 404);
    for (const [method, url, payload] of ENDPOINTS) assert.equal((await b.call(method, url, payload, null)).status, 404, url);
  } finally { await b.close(); }
});

test('the page carries no secret and allows only its own script and blob images', async () => {
  const b = await bank('memory');
  try {
    const page = await b.app.inject({ url: '/admin/question-bank' });
    assert.equal(page.statusCode, 200);
    assert.ok(!page.body.includes(KEY));
    const csp = String(page.headers['content-security-policy']);
    assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
    assert.match(csp, /img-src blob:/);
    assert.match(csp, /default-src 'none'/);
    assert.ok((await b.app.inject({ url: '/admin' })).body.includes('href="/admin/question-bank"'));
  } finally { await b.close(); }
});

const kinds = ['memory', 'sqlite', ...(postgres ? ['postgres' as const] : [])] as const;
if (!postgres) test('postgres question-bank admin', { skip: 'no TEST_POSTGRES_URL and no local PostgreSQL binary' }, () => {});

for (const kind of kinds) {
  test(`${kind}: every endpoint refuses a missing or wrong admin token`, async () => {
    const b = await bank(kind);
    try {
      for (const [method, url, payload] of ENDPOINTS) {
        for (const key of [null, 'wrong-' + KEY.slice(6)]) {
          const reply = await b.call(method, url, payload, key);
          assert.equal(reply.status, 401, `${method} ${url} with ${key === null ? 'no' : 'a wrong'} key`);
          assert.equal(reply.json().error.code, 'invalid_token');
        }
      }
      assert.equal((await b.store.questionBank.operations(10)).length, 0, 'nothing was written');
    } finally { await b.close(); }
  });

  test(`${kind}: stats match a hand count, leave out release-qa and internal accounts, and follow the internal flag`, async () => {
    const b = await bank(kind);
    try {
      const [a, c, d] = [await b.account(), await b.account(), await b.account()];
      const qa = await b.account('release-qa');
      const s1 = await b.solved(a.token, transcript(SPEED));                       // X first
      await b.solved(a.token, transcript(SPEED));                                  // X again, same account
      await b.solved(c.token, transcript(SPEED));                                  // X again, other account
      await b.solved(c.token, transcript(TRAIN));                                  // Y first
      await b.solved(d.token, transcript(TRAIN));                                  // Y again, other account
      await b.solved(d.token, transcript(SPEED, { has_figure: true }));            // own card, never matches
      await b.solved(qa.token, transcript(SPEED));                                 // release-qa: saved, not counted
      await b.solved(a.token, { text: '', finishReason: 'length' });               // failed: truncated
      await b.solve(c.token);                                                      // still waiting
      const reply = await b.call('GET', '/admin/question-bank/stats');
      assert.equal(reply.status, 200);
      const stats = reply.json();
      assert.deepEqual(stats.solves, {
        denominator: 6, repeated: 3, repeat_rate: 0.5, target_rate: 0.15, matchable: 5, matchable_repeat_rate: 3 / 5,
        same_account: 1, same_account_rate: 1 / 6, other_account: 2, other_account_rate: 2 / 6,
      });
      assert.deepEqual(stats.checkpoints, { reached: [], next: 1000 });
      const ids = [a.id, c.id, d.id].sort((x, y) => x - y);
      assert.deepEqual(stats.top_accounts, ids.map(id => ({ device_id: id, solves: 2, share: 2 / 6 })), 'release-qa is not listed');
      assert.deepEqual(stats.without_top_accounts, { denominator: 0, repeated: 0, repeat_rate: null });
      assert.deepEqual(stats.matchability, { matchable: 5, multiple: 0, unreadable: 0, not_question: 0, figure: 1, empty_stem: 0 });
      assert.deepEqual(stats.transcription, {
        solves: 8, done: 6, waiting: 1, failed: 1, skipped: 0, coverage: 0.75, failed_by_error: { output_truncated: 1 }, max_tokens: TRANSCRIBE_MAX_TOKENS,
      });
      assert.deepEqual(stats.cards, [{ state: 'unverified', matchable: false, count: 1 }, { state: 'unverified', matchable: true, count: 2 }]);
      assert.deepEqual(stats.images, { stored: 18, stored_bytes: 9 * IMAGE_BYTES, cleared: 0 });
      assert.deepEqual(stats.costs, [{ purpose: 'transcribe', currency: 'USD', calls: 8, known_micros: '8800', unknown: 0 }]);
      assert.deepEqual(stats.marks, { transcript: { correct: 0, wrong: 0 }, match: { same: 0, different: 0 } });
      assert.deepEqual(stats.recent_operations, []);

      assert.equal(await b.store.reporting.setInternal(d.id, true, 'qba-' + randomUUID()), true);
      const flagged = (await b.call('GET', '/admin/question-bank/stats')).json();
      assert.deepEqual([flagged.solves.denominator, flagged.solves.repeated, flagged.solves.same_account, flagged.solves.other_account], [4, 2, 1, 1],
        'recomputed from the current flag: the internal account neither counts nor makes a repeat');
      assert.deepEqual(flagged.top_accounts.map((row: { device_id: number }) => row.device_id), [a.id, c.id].sort((x, y) => x - y));
      assert.equal(s1.transcript?.stem, SPEED);
    } finally { await b.close(); }
  });

  test(`${kind}: stats show why the denominator's unmatchable solves never match, and follow the internal flag`, async () => {
    const b = await bank(kind);
    try {
      const [a, c] = [await b.account(), await b.account()];
      const qa = await b.account('release-qa');
      const none = { options: [] };
      await b.solved(a.token, transcript(SPEED));
      await b.solved(c.token, transcript(SPEED));
      await b.solved(a.token, transcript('', { status: 'multiple', ...none }));   // two questions on one screen
      await b.solved(c.token, transcript('', { status: 'multiple', ...none }));
      await b.solved(a.token, transcript('', { status: 'unreadable', ...none }));
      await b.solved(c.token, transcript(TRAIN, { has_figure: true }));
      await b.solved(a.token, transcript(' \n'));
      await b.solved(c.token, transcript('Sign in as user@example.com', { status: 'not_question' }));  // a system dialog
      await b.solved(qa.token, transcript('', { status: 'multiple', ...none }));  // release-qa: not counted
      // Filtered on all three calls: failed under its own code.
      const filtered = await b.solve(a.token);
      const t0 = Date.now();
      b.reply(filtered, { text: '', finishReason: 'content_filter' }, { text: '', finishReason: 'content_filter' }, { text: '', finishReason: 'content_filter' });
      for (const minute of [0, 11, 22]) await b.round(t0 + minute * MINUTE);
      const stats = (await b.call('GET', '/admin/question-bank/stats')).json();
      assert.deepEqual([stats.solves.denominator, stats.solves.repeated, stats.solves.matchable], [8, 1, 2]);
      assert.deepEqual([stats.solves.repeat_rate, stats.solves.matchable_repeat_rate], [1 / 8, 1 / 2]);
      assert.deepEqual(stats.matchability, { matchable: 2, multiple: 2, unreadable: 1, not_question: 1, figure: 1, empty_stem: 1 });
      assert.deepEqual(stats.transcription.failed_by_error, { content_filter: 1 });

      assert.equal(await b.store.reporting.setInternal(c.id, true, 'qba-' + randomUUID()), true);
      const flagged = (await b.call('GET', '/admin/question-bank/stats')).json();
      assert.deepEqual([flagged.solves.denominator, flagged.solves.matchable, flagged.solves.matchable_repeat_rate], [4, 1, 0]);
      assert.deepEqual(flagged.matchability, { matchable: 1, multiple: 1, unreadable: 1, not_question: 0, figure: 0, empty_stem: 1 }, 'the same solves as the denominator');
      const page = (await b.app.inject({ url: '/admin/question-bank' })).body;
      for (const label of ['不可匹配：多题', '不可匹配：看不清', '不可匹配：不是题目', '不可匹配：依赖图表', '不可匹配：题干为空', '只算可匹配作答的重复率', '被上游内容过滤拦下']) {
        assert.ok(page.includes(label), label);
      }
    } finally { await b.close(); }
  });

  test(`${kind}: spot checks sample transcribed solves and matched pairs, serve images, and record verdicts`, async () => {
    const b = await bank(kind);
    try {
      const [a, c] = [await b.account(), await b.account()];
      const x1 = await b.solved(a.token, transcript(SPEED));
      const x2 = await b.solved(c.token, transcript(SPEED));
      const y1 = await b.solved(a.token, transcript(TRAIN));
      const y2 = await b.solved(c.token, transcript(TRAIN));
      const figure = await b.solved(a.token, transcript(SPEED, { has_figure: true }));
      const waitingCapture = await b.solve(a.token);
      const waiting = (await b.store.questionBank.findByCapture(waitingCapture))!;

      const transcripts = (await b.call('GET', '/admin/question-bank/samples/transcripts?count=20')).json().items as Array<Record<string, any>>;
      assert.deepEqual(transcripts.map(item => item.attempt_id).sort(), [x1, x2, y1, y2, figure].map(item => item.attemptId).sort(), 'only transcribed solves');
      for (const item of transcripts) {
        assert.ok(item.transcript && item.images.length === 2 && item.images.every((image: { stored: boolean }) => image.stored));
      }
      assert.equal((await b.call('GET', '/admin/question-bank/samples/transcripts?count=2')).json().items.length, 2);
      assert.equal((await b.call('GET', '/admin/question-bank/samples/transcripts?count=21')).status, 400);

      const image = await b.call('GET', `/admin/question-bank/attempts/${x1.attemptId}/images/0`);
      assert.equal(image.status, 200);
      assert.equal(image.response.headers['content-type'], 'image/png');
      assert.deepEqual(image.response.rawPayload, x1.images[0]!.bytes);
      assert.equal((await b.call('GET', `/admin/question-bank/attempts/${x1.attemptId}/images/5`)).status, 404);

      const pairs = (await b.call('GET', '/admin/question-bank/samples/matches?count=20')).json().items as Array<Record<string, any>>;
      assert.deepEqual(pairs.map(pair => pair.card_id).sort(), [x1.cardId, y1.cardId].sort(), 'each matchable card with two solves, nothing else');
      for (const pair of pairs) {
        assert.equal(pair.first.card_id, pair.card_id);
        assert.equal(pair.second.card_id, pair.card_id);
        assert.ok(pair.first.attempt_id < pair.second.attempt_id);
      }

      const mark = (body: Record<string, unknown>) => b.call('POST', '/admin/question-bank/marks', { actor: 'tester', ...body });
      const first = { mark_id: randomUUID(), kind: 'transcript', attempt_id: x1.attemptId, verdict: 'correct' };
      assert.equal((await mark(first)).status, 200);
      assert.equal((await mark(first)).json().replayed, true, 'the same mark id is recorded once');
      assert.equal((await mark({ ...first, verdict: 'wrong' })).status, 409);
      assert.equal((await mark({ mark_id: randomUUID(), kind: 'transcript', attempt_id: waiting.attemptId, verdict: 'wrong' })).status, 404, 'not transcribed');
      assert.equal((await mark({ mark_id: randomUUID(), kind: 'transcript', attempt_id: x1.attemptId, verdict: 'same' })).status, 400);
      assert.equal((await b.call('POST', '/admin/question-bank/marks', { ...first, mark_id: randomUUID(), actor: '' })).status, 400, 'an actor is required');
      assert.equal((await mark({ mark_id: randomUUID(), kind: 'match', attempt_id: x1.attemptId, other_attempt_id: y1.attemptId, verdict: 'same' })).status, 404,
        'two different cards are not a pair');
      assert.equal((await mark({ mark_id: randomUUID(), kind: 'match', attempt_id: figure.attemptId, other_attempt_id: x1.attemptId, verdict: 'same' })).status, 404);
      assert.equal((await mark({ mark_id: randomUUID(), kind: 'match', attempt_id: x2.attemptId, other_attempt_id: x1.attemptId, verdict: 'different' })).status, 200);
      await delay(3); // a later timestamp than the first verdict on x1
      assert.equal((await mark({ mark_id: randomUUID(), kind: 'transcript', attempt_id: x1.attemptId, verdict: 'wrong' })).status, 200);
      const recorded = await b.store.questionBank.marks();
      assert.equal(recorded.length, 3);
      assert.ok(recorded.filter(row => row.kind === 'match').every(row => row.attemptId < row.otherAttemptId!), 'a pair is stored in attempt id order');
      assert.deepEqual((await b.call('GET', '/admin/question-bank/stats')).json().marks,
        { transcript: { correct: 0, wrong: 1 }, match: { same: 0, different: 1 } }, 'the later verdict on x1 replaces the first');

      const later = Date.now() + 91 * 86_400_000;
      await b.round(later);
      assert.equal((await b.call('GET', '/admin/question-bank/samples/transcripts?count=20')).json().items.length, 0, 'no images, nothing to check');
      assert.equal((await b.call('GET', `/admin/question-bank/attempts/${x1.attemptId}/images/0`)).status, 404);
    } finally { await b.close(); }
  });

  test(`${kind}: spot checks draw only from the statistics denominator, never internal or release-qa solves`, async () => {
    const b = await bank(kind);
    try {
      const [user, other, staff] = [await b.account(), await b.account(), await b.account()];
      const qa = await b.account('release-qa');
      assert.equal(await b.store.reporting.setInternal(staff.id, true, 'qba-' + randomUUID()), true);
      const counted = await b.solved(user.token, transcript(SPEED));
      // Test accounts submit the same test image again and again: always the same card.
      const testSolves = [];
      for (const token of [staff.token, staff.token, qa.token, qa.token, staff.token, qa.token]) {
        testSolves.push(await b.solved(token, transcript(TRAIN)));
      }
      testSolves.push(await b.solved(staff.token, transcript(SPEED)), await b.solved(qa.token, transcript(SPEED)));
      const sampled = async () => ({
        transcripts: ((await b.call('GET', '/admin/question-bank/samples/transcripts?count=20')).json().items as Array<{ attempt_id: string }>)
          .map(item => item.attempt_id).sort(),
        matches: ((await b.call('GET', '/admin/question-bank/samples/matches?count=20')).json().items as Array<Record<string, any>>)
          .map(pair => [pair.card_id, pair.first.attempt_id, pair.second.attempt_id]),
      });
      assert.deepEqual(await sampled(), { transcripts: [counted.attemptId], matches: [] },
        'the internal pairs on TRAIN and a counted solve paired with an internal one are both left out');
      assert.equal((await b.call('GET', '/admin/question-bank/stats')).json().solves.denominator, 1, 'the same solves the statistics count');

      const second = await b.solved(other.token, transcript(SPEED));
      assert.deepEqual(await sampled(), {
        transcripts: [counted.attemptId, second.attemptId].sort(),
        matches: [[counted.cardId, ...[counted.attemptId, second.attemptId].sort()]],
      });

      // Read from the current flag, like the statistics.
      assert.equal(await b.store.reporting.setInternal(staff.id, false, 'qba-' + randomUUID()), true);
      const staffSolves = testSolves.filter((_, i) => [0, 1, 4, 6].includes(i)).map(row => row.attemptId);
      assert.deepEqual((await sampled()).transcripts, [counted.attemptId, second.attemptId, ...staffSolves].sort());
    } finally { await b.close(); }
  });

  test(`${kind}: requeueing all failed transcriptions is audited and idempotent and leaves truncated outputs`, async () => {
    const b = await bank(kind);
    try {
      const user = await b.account();
      const broken = await b.solve(user.token);
      const t0 = Date.now();
      b.reply(broken, 'not json', 'not json', 'not json');
      for (const minute of [0, 11, 22]) await b.round(t0 + minute * MINUTE);
      await b.solved(user.token, { text: '', finishReason: 'length' });
      assert.equal((await b.store.questionBank.findByCapture(broken))?.jobStatus, 'failed');
      const body = { operation_id: randomUUID(), actor: 'tester', reason: 'upstream recovered' };
      const first = await b.call('POST', '/admin/question-bank/requeue', body);
      assert.equal(first.status, 200);
      assert.deepEqual(first.json(), { operation_id: body.operation_id, requeued: 1, replayed: false });
      assert.equal((await b.store.questionBank.findByCapture(broken))?.jobStatus, 'pending');
      assert.deepEqual((await b.call('POST', '/admin/question-bank/requeue', body)).json(), { operation_id: body.operation_id, requeued: 1, replayed: true });
      assert.equal((await b.call('POST', '/admin/question-bank/requeue', { ...body, reason: 'another reason' })).status, 409);
      assert.equal((await b.call('POST', '/admin/question-bank/requeue', { ...body, operation_id: 'not-a-uuid' })).status, 400);
      assert.equal((await b.call('POST', '/admin/question-bank/requeue', { ...body, operation_id: randomUUID(), reason: 'no' })).status, 400, 'a reason is required');
      const [audit] = await b.store.questionBank.operations(10);
      assert.deepEqual([audit?.kind, audit?.actor, audit?.reason, audit?.before, audit?.after], ['requeue_failed', 'tester', 'upstream recovered', { failed: 2 }, { requeued: 1 }]);
      assert.equal((await b.call('GET', '/admin/question-bank/stats')).json().recent_operations.length, 1);
    } finally { await b.close(); }
  });

  test(`${kind}: deleting an account removes its solves, images, jobs and marks, and only the cards no one else answered`, async () => {
    const b = await bank(kind);
    try {
      const [a, other] = [await b.account(), await b.account()];
      const shared = await b.solved(a.token, transcript(SPEED));
      const theirs = await b.solved(other.token, transcript(SPEED));
      const own = await b.solved(a.token, transcript(TRAIN));
      const figure = await b.solved(a.token, transcript(SPEED, { has_figure: true }));
      const otherOwn = await b.solved(other.token, transcript('What is 2 + 2?'));
      const waiting = await b.solve(a.token);
      const mark = (body: Record<string, unknown>) => b.call('POST', '/admin/question-bank/marks', { actor: 'tester', mark_id: randomUUID(), ...body });
      assert.equal((await mark({ kind: 'transcript', attempt_id: own.attemptId, verdict: 'correct' })).status, 200);
      assert.equal((await mark({ kind: 'match', attempt_id: shared.attemptId, other_attempt_id: theirs.attemptId, verdict: 'same' })).status, 200);
      assert.equal((await mark({ kind: 'transcript', attempt_id: theirs.attemptId, verdict: 'correct' })).status, 200);
      const before = await b.store.questionBank.counts();

      const expected = { attempts: 4, images: 8, stored_images: 8, jobs: 4, marks: 2, cards_deleted: 2, cards_kept: 1, reviews_detached: 0 };
      assert.deepEqual((await b.call('POST', '/admin/question-bank/accounts/preview', { device_id: a.id })).json(), { device_id: a.id, ...expected });
      const body = { device_id: a.id, operation_id: randomUUID(), actor: 'tester', reason: 'the user asked by email' };
      const deleted = await b.call('POST', '/admin/question-bank/accounts/delete', body);
      assert.equal(deleted.status, 200);
      assert.deepEqual(deleted.json(), { operation_id: body.operation_id, device_id: a.id, replayed: false, deleted: expected });

      for (const solve of [shared, own, figure]) assert.equal(await b.store.questionBank.findByCapture(solve.captureId), null);
      assert.equal(await b.store.questionBank.findByCapture(waiting), null, 'an untranscribed solve goes too');
      assert.equal(await b.store.questionBank.findCard(own.cardId!), null);
      assert.equal(await b.store.questionBank.findCard(figure.cardId!), null);
      assert.ok(await b.store.questionBank.findCard(shared.cardId!), 'a card another account answered stays');
      const kept = await b.store.questionBank.findByCapture(theirs.captureId);
      assert.deepEqual([kept?.cardId, kept?.images.length, kept?.jobStatus], [shared.cardId, 2, 'done']);
      assert.ok(await b.store.questionBank.findByCapture(otherOwn.captureId));
      assert.deepEqual((await b.store.questionBank.marks()).map(row => row.attemptId), [theirs.attemptId], 'marks naming a deleted solve go');
      assert.deepEqual(await b.store.questionBank.counts(), {
        ...before, attempts: before.attempts - 4, images: before.images - 8, jobs: before.jobs - 4, cards: before.cards - 2,
      }, 'prompts stay: they are the shared answer prompt, not the user\'s content');
      assert.deepEqual((await b.call('POST', '/admin/question-bank/accounts/preview', { device_id: a.id })).json(),
        { device_id: a.id, attempts: 0, images: 0, stored_images: 0, jobs: 0, marks: 0, cards_deleted: 0, cards_kept: 0, reviews_detached: 0 });

      const replay = await b.call('POST', '/admin/question-bank/accounts/delete', body);
      assert.deepEqual(replay.json(), { operation_id: body.operation_id, device_id: a.id, replayed: true, deleted: expected });
      assert.equal((await b.call('POST', '/admin/question-bank/accounts/delete', { ...body, device_id: other.id })).status, 409);
      const [audit] = await b.store.questionBank.operations(10);
      assert.deepEqual([audit?.kind, audit?.deviceId, audit?.actor, audit?.reason], ['delete_account', a.id, 'tester', 'the user asked by email']);
      assert.deepEqual(audit?.after, { attempts: 4, images: 8, storedImages: 8, jobs: 4, marks: 2, cardsDeleted: 2, cardsKept: 1, reviewsDetached: 0 });

      // Works on device_id alone: an id with no devices row deletes nothing and is still audited.
      const ghost = await b.call('POST', '/admin/question-bank/accounts/delete', { ...body, device_id: 987_654, operation_id: randomUUID() });
      assert.deepEqual(ghost.json().deleted, { attempts: 0, images: 0, stored_images: 0, jobs: 0, marks: 0, cards_deleted: 0, cards_kept: 0, reviews_detached: 0 });
      assert.equal((await b.store.questionBank.operations(10)).length, 2);
      assert.equal((await b.call('POST', '/admin/question-bank/accounts/delete', { ...body, operation_id: randomUUID(), device_id: 0 })).status, 400);
      assert.equal((await b.call('POST', '/admin/question-bank/accounts/delete', { ...body, operation_id: randomUUID(), reason: 'x' })).status, 400);

      // The other account's statistics are unaffected and a later transcription still works.
      const later = await b.solved(other.token, transcript(SPEED));
      assert.equal(later.cardId, shared.cardId);
    } finally { await b.close(); }
  });
}
