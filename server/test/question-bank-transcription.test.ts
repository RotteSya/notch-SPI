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
import { TransientProviderError, type CaptureRequest, type Provider } from '../src/providers/types.ts';
import type { Store } from '../src/db.ts';
import { aggregateEconomics, type ReportQuery } from '../src/reporting.ts';
import {
  answerContent, cardUnmatchableReason, normalizeQuestionText, questionBankOccurrences, questionFingerprint, transcriptMatchable, unmatchableReason,
  type QuestionBankOccurrenceRow, type QuestionBankTranscript,
} from '../src/question-bank.ts';
import { parseTranscript, TRANSCRIBE_MAX_TOKENS, TRANSCRIBE_PROMPT } from '../src/question-bank-prompt.ts';
import { QUESTION_BANK_ROUND, questionBankCallLimitMs, questionBankHoldId, runQuestionBankRound, type QuestionBankRoundResult } from '../src/question-bank-worker.ts';
import { OpenAIProvider, TERRA_MODEL } from '../src/providers/openai.ts';
import { settledRequestWork } from '../src/request-lifecycle.ts';
import { corruptPixels, pngBase64 as png } from './helpers/images.ts';
import { openEphemeralPostgres } from './helpers/ephemeral-postgres.ts';

const ready = 'FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
const CRON = 'c'.repeat(40);
// One micro per input token and two per output token: an answer costs 25, a transcription 1100.
const PRICING = JSON.stringify([{ model: 'mock:bank-test', input_micros_per_million_tokens: 1_000_000, output_micros_per_million_tokens: 2_000_000 }]);
const SPEED = 'A car travels 120 km in 2 hours. What is its average speed?';
const REAP_KEYS = ['checked_at', 'checkouts_credited', 'checkouts_failed', 'checkouts_review', 'events_pruned', 'finance_failed',
  'finance_reconciled', 'model_budget', 'more_possible', 'processed', 'refunds_failed', 'refunds_reconciled'];
const iso = (ms: number) => new Date(ms).toISOString();
const MINUTE = 60_000, DAY = 86_400_000;

const postgres = await openEphemeralPostgres();
const admin = postgres ? new pg.Pool({ connectionString: postgres.url, ssl: resolvePostgresSSL({ connectionString: postgres.url }) }) : null;
after(async () => { await admin?.end(); await postgres?.close(); });

function transcript(stem: string, extra: Partial<QuestionBankTranscript> = {}): string {
  return JSON.stringify({ status: 'ok', language: 'en', stem, options: [{ label: 'A', text: '40 km/h' }, { label: 'B', text: '60 km/h' }], has_figure: false, ...extra });
}

/** A string is the output of a finished call; an object sets how the call ended. */
type Reply = string | Error | { text: string; finishReason: string } | (() => Promise<string>);
interface Bank {
  store: Store;
  schema: string | null;
  token: string;
  settings: Config;
  replies: Reply[];
  requests: CaptureRequest[];
  provider: Provider;
  transcribeCalls: () => number;
  maxInFlight: () => number;
  register: () => Promise<string>;
  solve: (token?: string) => Promise<string>;
  reap: () => Promise<{ statusCode: number; json: Record<string, unknown> }>;
  round: (at?: number, settings?: Partial<Config>) => Promise<QuestionBankRoundResult>;
  close: () => Promise<void>;
}

async function bank(kind: 'memory' | 'sqlite' | 'postgres', overrides: Partial<Config> = {}): Promise<Bank> {
  let schema: string | null = null;
  let store: Store;
  if (kind === 'postgres') {
    if (!postgres || !admin) throw new Error('PostgreSQL fixture requires a server');
    schema = 'qbt_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(postgres.url);
    url.searchParams.set('options', '-c search_path=' + schema);
    store = new PostgresStore(url.toString(), resolvePostgresSSL({ connectionString: url.toString() }));
  } else store = kind === 'memory' ? new MemoryStore() : new SqliteStore(':memory:');
  const replies: Reply[] = [], requests: CaptureRequest[] = [];
  let calls = 0, inFlight = 0, maxInFlight = 0;
  const provider: Provider = {
    name: 'mock',
    async stream(req, delta) {
      if (req.purpose !== 'transcribe') {
        delta(ready);
        return { inputTokens: 11, outputTokens: 7, finishReason: 'stop' };
      }
      calls += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      requests.push(req);
      try {
        const next = replies.shift() ?? transcript('Default question');
        const value = typeof next === 'function' ? await next() : next;
        if (value instanceof Error) throw value;
        if (typeof value === 'object') { delta(value.text); return { inputTokens: 1000, outputTokens: 50, finishReason: value.finishReason }; }
        delta(value);
        return { inputTokens: 1000, outputTokens: 50, finishReason: 'stop' };
      } finally { inFlight -= 1; }
    },
  };
  const settings: Config = {
    ...config,
    provider: 'mock', objectiveProvider: 'mock', model: 'bank-test', objectiveModel: 'bank-test',
    requireDurableStorage: false, isServerless: false, requestBudgetMode: 'fixed', capturePerMinute: 0,
    modelDailyBudgetMicros: 1_000_000, attemptBudgetUpperMicros: 10_000, questionBankDailyBudgetMicros: 100_000,
    modelPricingJSON: PRICING, modelPricingVersion: 'qb-test', modelCostCurrency: 'USD', cronSecret: CRON,
    questionBankEnabled: true, questionBankImageRetentionDays: 90,
    requestHmacKeysJSON: JSON.stringify({ test: randomBytes(32).toString('base64') }), requestHmacKeyVersion: 'test',
    ...overrides,
  };
  const app = Fastify({ logger: false });
  registerRoutes(app, {
    config: settings, store, storeKind: kind, provider, objectiveProvider: provider,
    providerDegraded: null, objectiveProviderDegraded: null, payment: new StubPaymentProvider(),
  });
  const register = async () => (await store.registerDevice({ platform: 'macos', appVersion: '4.0', trialQuestions: 30 })).token;
  const token = await register();
  return {
    store, schema, token, settings, replies, requests, provider,
    transcribeCalls: () => calls,
    maxInFlight: () => maxInFlight,
    register,
    solve: async (who = token) => {
      const captureId = randomUUID();
      const response = await app.inject({
        method: 'POST', url: '/v1/captures', headers: { authorization: `Bearer ${who}` },
        payload: {
          capture_id: captureId, result_protocol: 'objective_v1', operation: 'solve', system: 'SYS-PROMPT', task: 'TASK-PROMPT',
          images_base64: [png, corruptPixels().toString('base64')], image_media_type: 'image/png', reasoning_effort: 'low', question_bank_v1: true,
        },
      });
      await settledRequestWork();
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /"terminal_state":"usable"/);
      return captureId;
    },
    reap: async () => {
      const response = await app.inject({ method: 'GET', url: '/api/internal/reap', headers: { authorization: `Bearer ${CRON}` } });
      return { statusCode: response.statusCode, json: response.json() as Record<string, unknown> };
    },
    round: (at, extra = {}) => runQuestionBankRound({
      config: { ...settings, ...extra }, store, provider, providerDegraded: null, ...(at === undefined ? {} : { now: () => at }),
    }),
    close: async () => {
      await settledRequestWork();
      await app.close();
      await store.close();
      if (schema && admin) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    },
  };
}

/** Every quota table the transcription must leave alone; only Postgres can be read directly here. */
async function quotaRows(b: Bank): Promise<Record<string, number> | null> {
  if (!b.schema || !admin) return null;
  const row = (await admin.query(`SELECT
    (SELECT COUNT(*) FROM ${b.schema}.quota_ledger) AS ledger,
    (SELECT COUNT(*) FROM ${b.schema}.quota_reservations) AS reservations,
    (SELECT COALESCE(SUM(remaining),0) FROM ${b.schema}.quota_lots) AS remaining`)).rows[0] as Record<string, string>;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

async function answerCosts(b: Bank) {
  const overview = await b.store.admin.overview({ from: iso(Date.now() - DAY), to: iso(Date.now() + DAY) });
  return { costs: overview.costs, models: overview.models };
}

async function inference(b: Bank, from: string) {
  const query: ReportQuery = { cohortFrom: from, cohortTo: iso(Date.now() + DAY), asOf: iso(Date.now()) };
  return aggregateEconomics(await b.store.reporting.snapshot(query), query).currencies.find(row => row.currency === 'USD')!.inference_micros;
}

test('fingerprint: whitespace, full-width forms, ASCII case, labels and option order do not matter; any number does', () => {
  const base = { stem: SPEED, options: [{ label: 'A', text: '40 km/h' }, { label: 'B', text: '60 km/h' }, { label: 'C', text: '80 km/h' }] };
  const variant = {
    stem: '  Ａ car  travels １２０ km\nin 2 hours.   What is its average speed? ',
    options: [{ label: '(c)', text: '80 KM/H' }, { label: 'a', text: ' 40 km/h' }, { label: 'B', text: '60　km/h' }],
  };
  assert.match(questionFingerprint(base), /^fp1:[0-9a-f]{64}$/);
  assert.equal(questionFingerprint(variant), questionFingerprint(base));
  assert.notEqual(questionFingerprint({ ...base, stem: SPEED.replace('120', '121') }), questionFingerprint(base));
  assert.notEqual(questionFingerprint({ ...base, options: [...base.options.slice(0, 2), { label: 'C', text: '81 km/h' }] }), questionFingerprint(base));
  assert.equal(normalizeQuestionText('ÄBC ＤＥＦ'), 'Äbc def', 'only ASCII letters are lowered');
});

test('answer content maps choice labels to option text, otherwise it is the normalized answer', () => {
  const options = [{ label: 'A', text: '40 km/h' }, { label: '(B)', text: '60 km/h' }, { label: 'C.', text: '80 km/h' }];
  assert.equal(answerContent('B', 'single_choice', options), JSON.stringify(['60 km/h']));
  assert.equal(answerContent(' (b) ', 'single_choice', options), answerContent('B', 'single_choice', options));
  assert.equal(answerContent('A', 'single_choice', [{ label: 'A', text: '60 KM/H' }]), answerContent('B', 'single_choice', options), 'same text under another label');
  assert.equal(answerContent('C, A', 'multiple_choice', options), JSON.stringify(['40 km/h', '80 km/h']));
  assert.equal(answerContent('D', 'single_choice', options), JSON.stringify(['d']), 'an unknown label keeps the answer itself');
  assert.equal(answerContent('６０ km/h', 'numeric', []), JSON.stringify(['60 km/h']));
});

test('a transcript is exactly one line of JSON with the five keys, optionally inside one code fence', () => {
  const ok = { status: 'ok', language: 'en', stem: 'Q', options: [{ label: 'A', text: '1' }], has_figure: false };
  const line = JSON.stringify(ok);
  for (const good of [' ' + line + '\n', '```json\n' + line + '\n```', '```\n' + line + '\n```\n', '\n```json \n' + line + '\n  ```']) {
    assert.deepEqual(parseTranscript(good), ok, good);
  }
  for (const bad of [
    '```json\n```json\n' + line + '\n```\n```', '```json\n' + line + '\n```\nDone.', 'Here it is:\n```json\n' + line + '\n```',
    '```json\n' + JSON.stringify(ok, null, 2) + '\n```', '```json ' + line + ' ```', '```python\n' + line + '\n```',
    JSON.stringify(ok, null, 2), JSON.stringify({ ...ok, answer: 'A' }),
    JSON.stringify({ status: 'ok', language: 'en', stem: 'Q', options: [] }), JSON.stringify({ ...ok, status: 'maybe' }),
    JSON.stringify({ ...ok, has_figure: 'no' }), JSON.stringify({ ...ok, options: [{ label: 'A' }] }),
    JSON.stringify({ ...ok, options: [{ label: 'A', text: '1', note: 'x' }] }), '[]', 'not json', '',
  ]) assert.equal(parseTranscript(bad), null, bad);
  assert.match(TRANSCRIBE_PROMPT.system, /untrusted/);
});

test('the prompt counts a table as a figure and asks for all the text needed to answer, including the material', () => {
  assert.match(TRANSCRIBE_PROMPT.system, /has_figure is true when answering needs a figure, chart, diagram, picture or table\./);
  assert.match(TRANSCRIBE_PROMPT.system, /stem holds every piece of text needed to answer, copied verbatim: any reading passage or other material/);
  // With output that follows the prompt, a different passage is a different question and a table question never matches.
  const question = 'Which statement agrees with the passage?';
  const options = [{ label: 'A', text: 'He left early.' }, { label: 'B', text: 'He stayed late.' }];
  assert.notEqual(
    questionFingerprint({ stem: 'Tom finished his work at noon and went home.\n' + question, options }),
    questionFingerprint({ stem: 'Tom worked until midnight.\n' + question, options }),
  );
  const table = { status: 'ok' as const, language: 'en', stem: 'According to the table, which city had the most rain?', options, has_figure: true };
  assert.equal(transcriptMatchable(table), false);
});

test('a stem that normalizes to nothing never matches, with or without options', () => {
  const base = { status: 'ok' as const, language: 'en', options: [] as QuestionBankTranscript['options'], has_figure: false };
  for (const stem of ['', '   ', '\n\u3000\t']) assert.equal(transcriptMatchable({ ...base, stem }), false, JSON.stringify(stem));
  assert.equal(transcriptMatchable({ ...base, stem: '', options: [{ label: 'A', text: '1' }] }), false);
  assert.equal(transcriptMatchable({ ...base, stem: 'Q' }), true);
});

test('the prompt keeps page titles, section headings and question numbers out of the stem', () => {
  assert.match(TRANSCRIBE_PROMPT.system, /stem leaves out page titles, section headings and question numbers, such as "練習問題 Q04", "問3" or "第 5 题"\./);
  // The trial's three screenshots of one template: a title kept in one stem made a different card for the same question.
  const options = [{ label: 'A', text: '60 km/h' }, { label: 'B', text: '40 km/h' }];
  const stem = '120 km を 2 時間で走る車の平均速度は？';
  assert.notEqual(questionFingerprint({ stem: '練習問題 Q04\n' + stem, options }), questionFingerprint({ stem, options }));
});

test('every unmatchable transcript has one reason, and a stored card gives the same reason from its columns', () => {
  const base = { language: 'en', options: [] as QuestionBankTranscript['options'] };
  const cases: Array<[QuestionBankTranscript, ReturnType<typeof unmatchableReason>]> = [
    [{ ...base, status: 'ok', stem: 'Q', has_figure: false }, null],
    [{ ...base, status: 'multiple', stem: '', has_figure: false }, 'multiple'],
    [{ ...base, status: 'multiple', stem: '', has_figure: true }, 'multiple'],
    [{ ...base, status: 'unreadable', stem: '', has_figure: false }, 'unreadable'],
    [{ ...base, status: 'ok', stem: 'According to the table?', has_figure: true }, 'figure'],
    [{ ...base, status: 'ok', stem: '', has_figure: true }, 'figure'],
    [{ ...base, status: 'ok', stem: ' 　\n', has_figure: false }, 'empty_stem'],
  ];
  for (const [transcript, reason] of cases) {
    const label = JSON.stringify(transcript);
    assert.equal(unmatchableReason(transcript), reason, label);
    assert.equal(transcriptMatchable(transcript), reason === null, label);
    assert.equal(cardUnmatchableReason({ matchable: transcriptMatchable(transcript), transcriptStatus: transcript.status, hasFigure: transcript.has_figure }), reason, label);
  }
});

test('the three seen-before flags come only from earlier counted solves', () => {
  const row = (attemptId: string, deviceId: number, minute: number, cardId: string, extra: Partial<QuestionBankOccurrenceRow> = {}): QuestionBankOccurrenceRow =>
    ({ attemptId, deviceId, createdAt: iso(Date.UTC(2026, 10, 1, 1, minute)), internal: false, jobStatus: 'done', jobErrorCode: null, cardId, matchable: true, unmatchable: null, ...extra });
  const summary = questionBankOccurrences([
    row('a8', 9, 0, 'q2', { internal: true }),
    row('a3', 2, 3, 'q1'), row('a1', 1, 1, 'q1'), row('a2', 1, 2, 'q1'), row('a4', 2, 4, 'q2'),
    row('a5', 3, 5, 'f1', { matchable: false }), row('a6', 3, 6, 'q2', { jobStatus: 'pending' }), row('a7', 3, 7, 'q2', { jobStatus: 'failed' }),
  ]);
  const flags = (id: string) => {
    const found = summary.occurrences.find(item => item.attemptId === id)!;
    return [found.cardSeenBefore, found.sameAccountBefore, found.otherAccountBefore];
  };
  assert.deepEqual(flags('a1'), [false, false, false], 'first appearance');
  assert.deepEqual(flags('a2'), [true, true, false], 'the same account again');
  assert.deepEqual(flags('a3'), [true, false, true], 'another account');
  assert.deepEqual(flags('a4'), [false, false, false], 'an earlier internal solve is not a precedent');
  assert.deepEqual(flags('a5'), [false, false, false], 'a solve that cannot match is counted but never repeated');
  assert.deepEqual(
    [summary.denominator, summary.repeated, summary.sameAccount, summary.otherAccount, summary.waiting, summary.failed],
    [5, 2, 1, 1, 1, 1],
  );
});

const kinds = ['memory', 'sqlite', ...(postgres ? ['postgres' as const] : [])] as const;
if (!postgres) test('postgres question-bank transcription', { skip: 'no TEST_POSTGRES_URL and no local PostgreSQL binary' }, () => {});

for (const kind of kinds) {
  test(`${kind}: the reaper replies first; its round then transcribes and leaves balances, the ledger and answer costs unchanged`, async () => {
    const from = iso(Date.now() - MINUTE);
    const b = await bank(kind);
    try {
      const captureId = await b.solve();
      const before = { account: await b.store.billing.accountSnapshot(b.token), quota: await quotaRows(b), costs: await answerCosts(b), inference: await inference(b, from) };
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      b.replies.push(async () => { await gate; return transcript(SPEED); });
      const reply = await b.reap();
      assert.equal(reply.statusCode, 200);
      assert.deepEqual(Object.keys(reply.json).sort(), REAP_KEYS, 'the reply carries exactly the reaper fields');
      assert.notEqual((await b.store.questionBank.findByCapture(captureId))?.jobStatus, 'done', 'the reply did not wait for the transcription');
      release();
      await settledRequestWork();

      const saved = await b.store.questionBank.findByCapture(captureId);
      assert.ok(saved?.cardId);
      assert.equal(saved.jobStatus, 'done');
      assert.equal(saved.jobAttemptCount, 1);
      assert.equal(saved.transcript?.stem, SPEED);
      const card = await b.store.questionBank.findCard(saved.cardId);
      assert.equal(card?.matchable, true);
      assert.equal(card?.state, 'unverified');
      assert.equal(card?.fingerprint, questionFingerprint({ stem: SPEED, options: card!.options }));

      const [request] = b.requests;
      assert.equal(request?.purpose, 'transcribe');
      assert.equal(request?.system, TRANSCRIBE_PROMPT.system);
      assert.equal(request?.task, TRANSCRIBE_PROMPT.task);
      assert.equal(request?.maxTokens, TRANSCRIBE_MAX_TOKENS);
      assert.equal(request?.reasoningEffort, 'low');
      assert.deepEqual(request?.images.map(image => image.base64), saved.images.map(image => image.bytes?.toString('base64')));

      assert.deepEqual(await b.store.billing.accountSnapshot(b.token), before.account, 'balance, holds and totals unchanged');
      assert.deepEqual(await quotaRows(b), before.quota, 'no ledger, reservation or lot change');
      assert.deepEqual(await answerCosts(b), before.costs, 'admin cost and model tables exclude the transcription');
      const transcribe = (await b.store.billing.attempts(b.token)).filter(attempt => attempt.purpose === 'transcribe');
      assert.equal(transcribe.length, 1);
      assert.equal(transcribe[0]?.status, 'succeeded');
      assert.equal(transcribe[0]?.costMicros, '1100');
      assert.equal(transcribe[0]?.captureId, captureId);
      const after = await inference(b, from);
      assert.equal(before.inference.by_purpose.transcribe, undefined);
      assert.equal(after.by_purpose.transcribe, 1, 'the call is listed under its purpose');
      for (const field of ['attempts', 'known_subtotal', 'total', 'conservative_upper', 'cost_per_client_usable_solve'] as const) {
        assert.deepEqual(after[field], before.inference[field], field);
      }
      const windows = (await b.store.billing.inspectBudget()).windows;
      assert.deepEqual(windows.filter(w => w.scope === 'question_bank').map(w => [w.spent, w.held]), [[1100, 0]]);
    } finally { await b.close(); }
  });

  test(`${kind}: failed transcriptions retry up to the cap, stay failed, and can be requeued without affecting answers`, async () => {
    const b = await bank(kind);
    try {
      const captureId = await b.solve();
      const t0 = Date.now();
      b.replies.push('not json', new Error('upstream exploded'), JSON.stringify({ status: 'ok' }));
      const job = async () => b.store.questionBank.findByCapture(captureId);
      assert.equal((await b.round(t0)).failed, 1);
      assert.deepEqual([(await job())?.jobStatus, (await job())?.jobAttemptCount, (await job())?.jobErrorCode], ['pending', 1, 'invalid_transcript']);
      assert.equal((await b.round(t0 + MINUTE)).calls, 0, 'a retry waits for a later round');
      await b.round(t0 + 11 * MINUTE);
      assert.deepEqual([(await job())?.jobStatus, (await job())?.jobAttemptCount, (await job())?.jobErrorCode], ['pending', 2, 'upstream_error']);
      await b.round(t0 + 22 * MINUTE);
      assert.deepEqual([(await job())?.jobStatus, (await job())?.jobAttemptCount], ['failed', 3]);
      assert.equal((await b.round(t0 + 60 * MINUTE)).calls, 0);
      assert.equal(b.transcribeCalls(), 3);
      await b.solve();
      assert.equal((await b.store.getAccount(b.token))?.balanceQuestions, 28, 'answering and charging are unaffected');
      assert.equal(await b.store.questionBank.requeueFailedTranscriptions(iso(t0 + 61 * MINUTE), TRANSCRIBE_MAX_TOKENS), 1);
      assert.deepEqual([(await job())?.jobStatus, (await job())?.jobAttemptCount], ['pending', 0]);
      b.replies.push(transcript(SPEED), transcript(SPEED));
      assert.equal((await b.round(t0 + 62 * MINUTE)).completed, 2, 'the requeued job and the later solve');
      assert.deepEqual([(await job())?.jobStatus, (await job())?.jobAttemptCount, (await job())?.transcript?.stem], ['done', 1, SPEED]);
      const failed = (await b.store.billing.attempts(b.token)).filter(attempt => attempt.purpose === 'transcribe' && attempt.status === 'failed');
      assert.equal(failed.length, 3);
    } finally { await b.close(); }
  });

  test(`${kind}: an output cut at the token limit fails at once and is requeued only after the limit is raised`, async () => {
    const b = await bank(kind);
    try {
      const job = async (captureId: string) => {
        const saved = await b.store.questionBank.findByCapture(captureId);
        return [saved?.jobStatus, saved?.jobAttemptCount, saved?.jobErrorCode];
      };
      const cut = await b.solve();
      const t0 = Date.now();
      b.replies.push({ text: '', finishReason: 'length' });
      assert.equal((await b.round(t0)).failed, 1);
      assert.deepEqual(await job(cut), ['failed', 1, 'output_truncated'], 'no retry: the same limit would cut it again');
      const broken = await b.solve();
      b.replies.push('not json', 'not json', 'not json');
      for (const minute of [11, 22, 33]) assert.equal((await b.round(t0 + minute * MINUTE)).calls, 1, 'only the other job is retried');
      assert.deepEqual(await job(broken), ['failed', 3, 'invalid_transcript']);
      assert.equal(b.transcribeCalls(), 4);
      assert.equal(await b.store.questionBank.requeueFailedTranscriptions(iso(t0 + 40 * MINUTE), TRANSCRIBE_MAX_TOKENS), 1);
      assert.deepEqual([await job(cut), await job(broken)], [['failed', 1, 'output_truncated'], ['pending', 0, null]]);
      assert.equal(await b.store.questionBank.requeueFailedTranscriptions(iso(t0 + 41 * MINUTE), TRANSCRIBE_MAX_TOKENS + 1), 1, 'a higher limit gives it another chance');
      assert.deepEqual(await job(cut), ['pending', 0, null]);
      const statuses = (await b.store.billing.attempts(b.token)).filter(attempt => attempt.purpose === 'transcribe').map(attempt => attempt.status);
      assert.deepEqual(statuses, ['failed', 'failed', 'failed', 'failed']);
    } finally { await b.close(); }
  });

  test(`${kind}: transcripts with an empty stem each get their own unmatchable card`, async () => {
    const b = await bank(kind);
    try {
      const first = await b.solve(), second = await b.solve();
      b.replies.push(transcript('', { options: [] }), transcript('  \n', { options: [] }));
      assert.equal((await b.round()).completed, 2);
      const cards = await Promise.all([first, second].map(async captureId => (await b.store.questionBank.findByCapture(captureId))!.cardId!));
      assert.equal(new Set(cards).size, 2);
      for (const cardId of cards) {
        const card = await b.store.questionBank.findCard(cardId);
        assert.deepEqual([card?.matchable, card?.fingerprint], [false, null]);
      }
      const summary = questionBankOccurrences(await b.store.questionBank.occurrenceRows());
      assert.deepEqual([summary.denominator, summary.repeated], [2, 0]);
    } finally { await b.close(); }
  });

  test(`${kind}: once the question-bank budget is spent the jobs wait and no call is made`, async () => {
    // The 10_000 reservation fits a 10_000 cap once; after 1100 is spent the next one does not.
    const b = await bank(kind, { questionBankDailyBudgetMicros: 10_000 });
    try {
      const first = await b.solve(), second = await b.solve();
      const round = await b.round();
      assert.equal(round.stop, 'budget');
      assert.equal(round.completed, 1);
      assert.equal(b.transcribeCalls(), 1);
      const waiting = [await b.store.questionBank.findByCapture(first), await b.store.questionBank.findByCapture(second)].find(row => row?.jobStatus !== 'done');
      assert.deepEqual([waiting?.jobStatus, waiting?.jobAttemptCount], ['pending', 0]);
      assert.equal((await b.round()).calls, 0);
      assert.equal(b.transcribeCalls(), 1);
      assert.equal((await b.round(undefined, { questionBankDailyBudgetMicros: 0 })).stop, 'budget');
      assert.equal(b.transcribeCalls(), 1);
    } finally { await b.close(); }
  });

  test(`${kind}: an upstream rate limit stops the round and does not count against the job`, async () => {
    const b = await bank(kind);
    try {
      const captures: string[] = [];
      for (let i = 0; i < 6; i += 1) captures.push(await b.solve());
      for (let i = 0; i < 6; i += 1) b.replies.push(new TransientProviderError(429, 1000));
      const round = await b.round();
      assert.equal(round.stop, 'overload');
      assert.ok(b.transcribeCalls() >= 1 && b.transcribeCalls() <= QUESTION_BANK_ROUND.concurrency, String(b.transcribeCalls()));
      for (const captureId of captures) {
        const row = await b.store.questionBank.findByCapture(captureId);
        assert.deepEqual([row?.jobStatus, row?.jobAttemptCount], ['pending', 0]);
      }
      const attempts = (await b.store.billing.attempts(b.token)).filter(attempt => attempt.purpose === 'transcribe');
      assert.equal(attempts.length, b.transcribeCalls());
      assert.ok(attempts.every(attempt => attempt.status === 'failed'));
      assert.deepEqual((await b.store.billing.inspectBudget()).windows.map(w => w.held), [0, 0], 'every hold settled');
    } finally { await b.close(); }
  });

  test(`${kind}: retention clears images after the period, keeps transcripts and cards, and skips untranscribed solves without a call`, async () => {
    const b = await bank(kind);
    try {
      const first = await b.solve();
      await b.round();
      const second = await b.solve();
      assert.equal(await b.store.questionBank.purgeImages(iso(Date.now() - DAY), iso(Date.now()), 200), 0, 'nothing inside the period');
      const later = Date.now() + 91 * DAY;
      const off = await b.round(later, { questionBankEnabled: false });
      assert.deepEqual([off.stop, off.imagesCleared], ['disabled', 4], 'retention runs with the bank switched off');
      const kept = await b.store.questionBank.findByCapture(first);
      assert.deepEqual(kept?.images.map(image => image.bytes), [null, null]);
      assert.ok(kept?.images.every(image => image.byteCount > 0), 'byte counts stay');
      assert.equal(kept?.transcript?.stem, 'Default question');
      assert.equal((await b.store.questionBank.findCard(kept!.cardId!))?.stem, 'Default question');
      assert.equal((await b.store.questionBank.counts()).attempts, 2);
      await b.round(later);
      const skipped = await b.store.questionBank.findByCapture(second);
      assert.deepEqual([skipped?.jobStatus, skipped?.jobErrorCode, skipped?.jobAttemptCount], ['skipped', 'image_deleted', 0]);
      assert.equal(b.transcribeCalls(), 1);
    } finally { await b.close(); }
  });

  test(`${kind}: a lease left by a crashed round counts its call and closes its model attempt and holds`, async () => {
    const b = await bank(kind);
    try {
      const captureId = await b.solve();
      const t0 = Date.now(), modelAttemptId = randomUUID();
      const job = await b.store.questionBank.claimTranscription({ now: iso(t0), leaseUntil: iso(t0 + 1000), modelAttemptId });
      assert.ok(job);
      assert.equal(await b.store.billing.beginBankAttempt({
        deviceId: job.deviceId, requestId: job.requestId, reservedMicros: 10_000, currency: 'USD', now: t0, utcOffsetMinutes: 0,
        attempt: { attemptId: modelAttemptId, captureId, purpose: 'transcribe', provider: 'mock', model: 'bank-test', policyVersion: 'test', currency: 'USD', pricingVersion: 'qb-test' },
        holds: [
          { holdId: modelAttemptId, scope: 'official', limitMicros: 1_000_000, channel: 'test', share: 1 },
          { holdId: questionBankHoldId(modelAttemptId), scope: 'question_bank', limitMicros: 100_000, channel: 'test', share: 1 },
        ],
        capacityTokens: 1000, capacityShare: 1,
      }), 'started');
      b.replies.push(transcript(SPEED));
      const round = await b.round(t0 + 2000);
      assert.equal(round.recovered, 1);
      const saved = await b.store.questionBank.findByCapture(captureId);
      assert.deepEqual([saved?.jobStatus, saved?.jobAttemptCount], ['done', 2], 'the lost call counted once and the retry ran at once');
      const statuses = (await b.store.billing.attempts(b.token)).filter(attempt => attempt.purpose === 'transcribe').map(attempt => attempt.status).sort();
      assert.deepEqual(statuses, ['succeeded', 'unknown']);
      const bankWindow = (await b.store.billing.inspectBudget()).windows.find(w => w.scope === 'question_bank');
      assert.deepEqual([bankWindow?.held, bankWindow?.spent], [0, 10_000 + 1100], 'the unknown call is booked at its reservation');
    } finally { await b.close(); }
  });

  test(`${kind}: shadow statistics: first, same-account and cross-account repeats, release-qa excluded, and a device later marked internal`, async () => {
    const b = await bank(kind);
    try {
      const other = await b.register();
      // A release-qa device is test traffic, as the admin overview classifies it: saved, never counted.
      const qa = (await b.store.registerDevice({ platform: 'release-qa', appVersion: '4.0', trialQuestions: 30 })).token;
      const solved: Record<string, string> = {};
      const steps: Array<[string, string | undefined, string]> = [
        ['q1', qa, transcript(SPEED)],
        ['a1', undefined, transcript(SPEED)],
        ['a2', undefined, JSON.stringify({ status: 'ok', language: 'en', stem: '  A car travels １２０ km in 2 hours.  What is its average speed?',
          options: [{ label: 'B', text: '60 KM/H' }, { label: 'A', text: '40 km/h' }], has_figure: false })],
        ['b1', other, transcript(SPEED)],
        ['b2', other, transcript(SPEED.replace('120', '150'))],
        ['b3', other, transcript(SPEED, { has_figure: true })],
        ['b4', other, transcript(SPEED, { status: 'multiple' })],
      ];
      for (const [name, who, reply] of steps) {
        await delay(3); // distinct creation times; equal times are ordered by attempt id
        solved[name] = await b.solve(who);
        b.replies.push(reply);
        assert.equal((await b.round()).completed, 1);
      }
      const rows = async () => {
        const all = await b.store.questionBank.occurrenceRows();
        const byCapture = new Map<string, string>();
        for (const [name, captureId] of Object.entries(solved)) byCapture.set((await b.store.questionBank.findByCapture(captureId))!.attemptId, name);
        return { all, name: (attemptId: string) => byCapture.get(attemptId)! };
      };
      const first = await rows(), summary = questionBankOccurrences(first.all);
      const flags = Object.fromEntries(summary.occurrences.map(row => [first.name(row.attemptId), [row.cardSeenBefore, row.sameAccountBefore, row.otherAccountBefore]]));
      assert.deepEqual(flags, {
        a1: [false, false, false], a2: [true, true, false], b1: [true, false, true], b2: [false, false, false],
        b3: [false, false, false], b4: [false, false, false],
      });
      assert.deepEqual([summary.denominator, summary.repeated, summary.sameAccount, summary.otherAccount], [6, 2, 1, 1]);
      const cards = await Promise.all(['a1', 'a2', 'b1', 'b2', 'b3', 'b4'].map(async name => (await b.store.questionBank.findByCapture(solved[name]!))!.cardId));
      assert.equal(new Set(cards.slice(0, 3)).size, 1, 'whitespace, full-width and option order share one card');
      assert.equal((await b.store.questionBank.findByCapture(solved.q1!))!.cardId, cards[0], 'the release-qa attempt is saved and linked as usual');
      assert.equal(new Set(cards).size, 4, 'a figure question and a multiple-question capture each get their own card');
      for (const cardId of cards.slice(4)) {
        const own = await b.store.questionBank.findCard(cardId!);
        assert.deepEqual([own?.matchable, own?.fingerprint], [false, null]);
      }
      const deviceA = (await b.store.questionBank.findByCapture(solved.a1!))!.deviceId;
      assert.equal(await b.store.reporting.setInternal(deviceA, true, 'qb-' + randomUUID()), true);
      const internal = questionBankOccurrences((await rows()).all);
      assert.deepEqual([internal.denominator, internal.repeated], [4, 0], 'recomputed from the current internal flag');
    } finally { await b.close(); }
  });
}

test('memory: one round makes at most 12 calls, 4 at a time', async () => {
  const b = await bank('memory');
  try {
    for (let i = 0; i < 14; i += 1) {
      await b.solve();
      b.replies.push(async () => { await delay(5); return transcript(`Question ${i}`); });
    }
    const round = await b.round();
    assert.deepEqual([round.stop, round.calls, round.completed], ['call_limit', QUESTION_BANK_ROUND.maxCalls, QUESTION_BANK_ROUND.maxCalls]);
    assert.equal(b.transcribeCalls(), QUESTION_BANK_ROUND.maxCalls);
    assert.ok(b.maxInFlight() <= QUESTION_BANK_ROUND.concurrency && b.maxInFlight() > 1, String(b.maxInFlight()));
  } finally { await b.close(); }
});

test('a call gets the first-progress limit its upstream declares: 60 s for Terra, otherwise 20 s', () => {
  assert.equal(questionBankCallLimitMs(new OpenAIProvider('sk-test', 'https://api.openai.com', TERRA_MODEL, 4096)), 60_000);
  assert.equal(questionBankCallLimitMs(new OpenAIProvider('sk-test', 'https://api.openai.com', 'gpt-other', 4096)), 20_000);
  assert.equal(questionBankCallLimitMs({ name: 'mock', stream: async () => ({ inputTokens: 0, outputTokens: 0 }) }), QUESTION_BANK_ROUND.callMs);
});

test('memory: a call that outlives its declared limit is cut there and fails as a timeout', async () => {
  const b = await bank('memory');
  try {
    const captureId = await b.solve();
    const silent: Provider = {
      name: 'mock', firstProgressMs: 50,
      stream: (_req, _delta, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    };
    const startedAt = Date.now();
    const round = await runQuestionBankRound({ config: b.settings, store: b.store, provider: silent, providerDegraded: null });
    assert.ok(Date.now() - startedAt < 5_000, 'cut at the declared 50 ms, not the 20 s default');
    assert.deepEqual([round.calls, round.failed], [1, 1]);
    const saved = await b.store.questionBank.findByCapture(captureId);
    assert.deepEqual([saved?.jobStatus, saved?.jobErrorCode, saved?.jobAttemptCount], ['pending', 'timeout', 1]);
  } finally { await b.close(); }
});

test('memory: the 60 s round limit only governs starting a call', async () => {
  const b = await bank('memory');
  try {
    const captureId = await b.solve();
    const clockAt = (offset: number) => { const t0 = Date.now(); let first = true; return () => { if (first) { first = false; return t0; } return t0 + offset; }; };
    const late = await runQuestionBankRound({ config: b.settings, store: b.store, provider: b.provider, providerDegraded: null, now: clockAt(QUESTION_BANK_ROUND.totalMs) });
    assert.deepEqual([late.stop, late.calls], ['deadline', 0], 'nothing starts at the 60 s mark');
    assert.equal((await b.store.questionBank.findByCapture(captureId))?.jobStatus, 'pending');
    b.replies.push(transcript(SPEED));
    const lastSecond = await runQuestionBankRound({ config: b.settings, store: b.store, provider: b.provider, providerDegraded: null, now: clockAt(QUESTION_BANK_ROUND.totalMs - 1000) });
    assert.deepEqual([lastSecond.calls, lastSecond.completed], [1, 1], 'a call may start with less than its own limit left in the round');
    assert.equal((await b.store.questionBank.findByCapture(captureId))?.jobStatus, 'done');
  } finally { await b.close(); }
});
