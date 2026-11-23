import { after } from 'node:test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http, { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { SCREEN_QUERY_VERSION } from '../src/screen-query.ts';
import { questionBankWriteFailureCount } from '../src/question-bank.ts';
import { SQLQuestionBankStore } from '../src/question-bank-sql.ts';
import type { RunTransaction, Transaction } from '../src/billing-sql.ts';
import { settledRequestWork } from '../src/request-lifecycle.ts';
import { corruptPixels, pngBase64 as png } from './helpers/images.ts';
import { openEphemeralPostgres } from './helpers/ephemeral-postgres.ts';

const ready = 'FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
const retake = 'NSPI_RESULT_V1: {"v":1,"kind":"other","state":"retake","answer":null,"reason":"unreadable"}';
const legacy = '答案：B。平均速度是 60 km/h。';
const postgres = await openEphemeralPostgres();
const admin = postgres ? new pg.Pool({ connectionString: postgres.url, ssl: resolvePostgresSSL({ connectionString: postgres.url }) }) : null;
after(async () => { await admin?.end(); await postgres?.close(); });

interface Fixture {
  store: Store;
  schema: string | null;
  /** Postgres connection string scoped to this fixture's schema; null for memory and SQLite. */
  connection: string | null;
  post: (url: string, payload: object) => Promise<{ statusCode: number; body: string }>;
  token: string;
  close: () => Promise<void>;
  script: (value: string) => void;
  fail: (value?: boolean) => void;
  replaceRecord: (write: Store['questionBank']['recordSolve']) => void;
  /** Serve on a loopback port; returns the port and the raw HTTP server. */
  listen: () => Promise<{ port: number; server: http.Server }>;
  /** The next provider call reports `started`, then waits until `release` before answering. */
  holdProvider: () => { started: Promise<void>; release: () => void };
}

async function fixture(kind: 'memory' | 'sqlite' | 'postgres', enabled: boolean, screen = false): Promise<Fixture> {
  let schema: string | null = null;
  let connection: string | null = null;
  let store: Store;
  if (kind === 'postgres') {
    if (!postgres || !admin) throw new Error('PostgreSQL fixture requires a server');
    schema = 'qb_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(postgres.url);
    url.searchParams.set('options', '-c search_path=' + schema);
    connection = url.toString();
    store = new PostgresStore(connection, resolvePostgresSSL({ connectionString: connection }));
  } else store = kind === 'memory' ? new MemoryStore() : new SqliteStore(':memory:');
  const app = Fastify({ logger: false });
  let script = ready;
  let fail = false;
  let hold: { started: () => void; released: Promise<void> } | null = null;
  const provider: Provider = {
    name: 'mock',
    async stream(req, delta) {
      const held = hold;
      hold = null;
      if (held) { held.started(); await held.released; }
      if (fail) throw new Error('upstream down');
      const text = req.purpose === 'explain'
        ? JSON.stringify({ consistent: true, explanation: 'Because B.' })
        : req.purpose === 'recover' ? ready : script;
      delta(text);
      return { inputTokens: 11, outputTokens: 7, finishReason: 'stop' };
    },
  };
  const settings: Config = {
    ...config,
    provider: 'mock', objectiveProvider: 'mock', model: 'bank-test', objectiveModel: 'bank-test',
    requireDurableStorage: false, isServerless: false, requestBudgetMode: 'fixed',
    modelDailyBudgetMicros: 0, attemptBudgetUpperMicros: 0, questionBankEnabled: enabled,
    requestHmacKeysJSON: JSON.stringify({ test: randomBytes(32).toString('base64') }), requestHmacKeyVersion: 'test',
    screenQueryEnabled: screen, explanationEnabled: screen, enabledSupportProfiles: 'reading_practice',
  };
  registerRoutes(app, {
    config: settings, store, storeKind: kind, provider, objectiveProvider: provider,
    providerDegraded: null, objectiveProviderDegraded: null, payment: new StubPaymentProvider(),
  });
  const { token } = await store.registerDevice({ platform: 'macos', appVersion: '4.0', trialQuestions: 30 });
  return {
    store, schema, connection, token,
    post: async (url, payload) => {
      try {
        return await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
      } finally {
        await settledRequestWork();
      }
    },
    script: value => { script = value; },
    fail: value => { fail = value ?? true; },
    replaceRecord: write => { store.questionBank.recordSolve = write; },
    listen: async () => {
      await app.listen({ host: '127.0.0.1', port: 0 });
      return { port: (app.server.address() as AddressInfo).port, server: app.server };
    },
    holdProvider: () => {
      let started!: () => void;
      let release!: () => void;
      const startedPromise = new Promise<void>(resolve => { started = resolve; });
      hold = { started, released: new Promise<void>(resolve => { release = resolve; }) };
      return { started: startedPromise, release };
    },
    close: async () => {
      await app.close();
      await store.close();
      if (schema && admin) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    },
  };
}

function objective(captureId = randomUUID(), extra: Record<string, unknown> = {}) {
  return {
    capture_id: captureId, result_protocol: 'objective_v1', operation: 'solve', system: 'SYS-PROMPT', task: 'TASK-PROMPT',
    images_base64: [png, corruptPixels().toString('base64')], image_media_type: 'image/png', reasoning_effort: 'low', ...extra,
  };
}

function screen(captureId = randomUUID(), extra: Record<string, unknown> = {}) {
  return {
    capture_id: captureId, result_protocol: 'objective_v1', response_contract: 'screen_query_v1', operation: 'solve',
    images_base64: [png], image_media_type: 'image/png', profile_id: 'reading_practice',
    profile_version: SCREEN_QUERY_VERSION, prompt_version: SCREEN_QUERY_VERSION, ui_language: 'en',
    scope: { target_count: 1, question_image_index: 0, rect: { x: 0, y: 0, width: 1, height: 1 } }, ...extra,
  };
}

function events(body: string): Array<Record<string, unknown>> {
  return body.split('\n').flatMap(line => {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) return [];
    return [JSON.parse(line.slice(6)) as Record<string, unknown>];
  });
}

function settlement(body: string) {
  const rows = events(body);
  const usage = rows.find(row => row.type === 'usage');
  assert.ok(usage);
  return {
    text: rows.filter(row => row.type === 'delta').map(row => String(row.text)).join(''),
    charged: usage.questions_charged, terminal: usage.terminal_state, status: usage.settlement_status,
    usable: usage.usable_result, error: rows.some(row => row.type === 'error'),
  };
}

const kinds = ['memory', 'sqlite', ...(postgres ? ['postgres' as const] : [])] as const;
if (!postgres) test('postgres question bank', { skip: 'no TEST_POSTGRES_URL and no local PostgreSQL binary' }, () => {});

for (const kind of kinds) {
  test(`${kind}: a consented usable objective solve stores the attempt, both images, the prompt, and a pending job`, async () => {
    const f = await fixture(kind, true);
    try {
      const first = objective();
      const response = await f.post('/v1/captures', { ...first, question_bank_v1: true });
      assert.equal(response.statusCode, 200);
      assert.equal(settlement(response.body).terminal, 'usable');
      assert.equal(settlement(response.body).charged, 1);
      const saved = await f.store.questionBank.findByCapture(first.capture_id);
      assert.ok(saved);
      assert.equal(saved.resultProtocol, 'objective_v1');
      assert.equal(saved.reasoningEffort, 'low');
      assert.equal(saved.system, 'SYS-PROMPT');
      assert.equal(saved.task, 'TASK-PROMPT');
      assert.equal(saved.finalAnswer, 'B');
      assert.equal(saved.modelOutput.includes('FINAL: B'), true);
      assert.equal(saved.provider, 'mock');
      assert.equal(saved.model, 'bank-test');
      assert.equal(saved.inputTokens, 11);
      assert.equal(saved.outputTokens, 7);
      assert.equal(saved.jobKind, 'transcribe');
      assert.equal(saved.jobStatus, 'pending');
      assert.equal(saved.jobAttemptCount, 0);
      assert.equal(saved.explanation, null);
      assert.deepEqual(saved.images.map(image => image.bytes?.toString('base64')), first.images_base64);
      assert.deepEqual(saved.images.map(image => image.byteCount), saved.images.map(image => image.bytes?.length));
      assert.deepEqual(saved.images.map(image => image.ordinal), [0, 1]);
      const second = await f.post('/v1/captures', { ...objective(), question_bank_v1: true });
      assert.equal(second.statusCode, 200);
      assert.equal((await f.store.questionBank.counts()).prompts, 1);
      assert.equal((await f.store.questionBank.counts()).attempts, 2);
      const again = await f.store.questionBank.findByCapture(first.capture_id);
      assert.ok(again);
      await f.store.questionBank.recordSolve({
        token: f.token, captureId: again.captureId, requestId: again.requestId, createdAt: again.createdAt,
        durationMs: again.durationMs, provider: again.provider, model: again.model, reasoningEffort: again.reasoningEffort,
        configRevision: again.configRevision, resultProtocol: again.resultProtocol, resultState: again.resultState,
        questionKind: again.questionKind, parserPath: again.parserPath, modelOutput: again.modelOutput,
        finalAnswer: again.finalAnswer, answerAttemptId: again.answerAttemptId, inputTokens: again.inputTokens,
        outputTokens: again.outputTokens, system: again.system, task: again.task,
        images: again.images.map(image => ({ mediaType: image.mediaType, bytes: image.bytes! })),
      });
      assert.equal((await f.store.questionBank.counts()).attempts, 2);
      const replay = await f.post('/v1/captures', { ...first, question_bank_v1: true });
      assert.equal(replay.statusCode, 200);
      assert.equal((await f.store.questionBank.counts()).attempts, 2);
      if (f.schema && admin) {
        const column = await admin.query(
          `SELECT udt_name FROM information_schema.columns
           WHERE table_schema=$1 AND table_name='question_bank_images' AND column_name='content'`,
          [f.schema],
        );
        assert.equal(column.rows[0]?.udt_name, 'bytea');
      }
    } finally { await f.close(); }
  });

  test(`${kind}: a delivery-recovery solve, the path the Mac client takes, stores the attempt`, async () => {
    const f = await fixture(kind, true);
    try {
      const solve = objective(randomUUID(), { delivery_recovery_v1: true, question_bank_v1: true });
      const response = await f.post('/v1/captures', solve);
      assert.equal(response.statusCode, 200);
      const settled = settlement(response.body);
      assert.equal(settled.terminal, 'usable');
      assert.equal(settled.charged, 1);
      assert.equal(settled.text.includes('FINAL: B'), true);
      assert.ok((await f.store.billing.capture(f.token, solve.capture_id))?.deliveryOwner);
      const saved = await f.store.questionBank.findByCapture(solve.capture_id);
      assert.ok(saved);
      assert.equal(saved.finalAnswer, 'B');
      assert.equal(saved.jobStatus, 'pending');
      assert.deepEqual(saved.images.map(image => image.bytes?.toString('base64')), solve.images_base64);
    } finally { await f.close(); }
  });

  test(`${kind}: a delivery-recovery solve whose connection closed before it finished is still charged and stored`, async () => {
    const f = await fixture(kind, true);
    let held: ReturnType<Fixture['holdProvider']> | null = null;
    try {
      const { port, server } = await f.listen();
      held = f.holdProvider();
      const solve = objective(randomUUID(), { delivery_recovery_v1: true, question_bank_v1: true });
      const body = JSON.stringify(solve);
      const arrived = new Promise<ServerResponse>(resolve => server.once('request', (_request, response) => resolve(response)));
      const client = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/v1/captures',
        headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      });
      client.on('error', () => undefined);
      client.end(body);
      const response = await arrived;
      await held.started;
      const closed = once(response, 'close');
      client.destroy();
      await closed;
      held.release();
      await settledRequestWork();
      const capture = await f.store.billing.capture(f.token, solve.capture_id);
      assert.ok(capture?.deliveryOwner);
      assert.equal(capture.settlementStatus, 'settled');
      assert.equal(capture.terminalState, 'usable');
      assert.equal((await f.store.getAccount(f.token))?.balanceQuestions, 29);
      const saved = await f.store.questionBank.findByCapture(solve.capture_id);
      assert.ok(saved);
      assert.equal(saved.finalAnswer, 'B');
      assert.deepEqual(saved.images.map(image => image.bytes?.toString('base64')), solve.images_base64);
    } finally {
      held?.release();
      await f.close();
    }
  });

  test(`${kind}: the bank stays empty unless the switch is on, the flag is boolean true, and the solve is a usable objective_v1`, async () => {
    const off = await fixture(kind, false);
    try {
      assert.equal((await off.post('/v1/captures', { ...objective(), question_bank_v1: true })).statusCode, 200);
      assert.equal((await off.store.questionBank.counts()).attempts, 0);
      assert.equal((await off.store.questionBank.counts()).images, 0);
    } finally { await off.close(); }
    const on = await fixture(kind, true);
    try {
      assert.equal((await on.post('/v1/captures', objective())).statusCode, 200);
      assert.equal((await on.post('/v1/captures', { ...objective(), question_bank_v1: 'true' })).statusCode, 200);
      on.script(legacy);
      const personality = await on.post('/v1/captures', {
        capture_id: randomUUID(), operation: 'solve', system: 'personality', task: 'questionnaire',
        image_base64: png, image_media_type: 'image/png', question_bank_v1: true,
      });
      assert.equal(personality.statusCode, 200);
      assert.equal(settlement(personality.body).charged, 1);
      on.script(retake);
      const retaken = await on.post('/v1/captures', { ...objective(), question_bank_v1: true });
      assert.equal(settlement(retaken.body).terminal, 'retake');
      assert.equal(settlement(retaken.body).charged, 0);
      on.fail();
      const failed = await on.post('/v1/captures', { ...objective(), question_bank_v1: true });
      assert.equal(settlement(failed.body).terminal, 'failed');
      assert.equal((await on.store.questionBank.counts()).attempts, 0);
      assert.equal((await on.store.questionBank.counts()).prompts, 0);
    } finally { await on.close(); }
  });

  test(`${kind}: question_bank_v1 does not change requestHmac, and the write happens after the terminal event`, async () => {
    const f = await fixture(kind, true);
    const write = ServerResponse.prototype.write;
    const end = ServerResponse.prototype.end;
    const state = { done: false, ended: false, sawWrite: false };
    ServerResponse.prototype.write = function (this: ServerResponse, chunk, encoding, callback) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (text.includes('data: [DONE]')) state.done = true;
      return write.call(this, chunk, encoding, callback);
    } as typeof ServerResponse.prototype.write;
    ServerResponse.prototype.end = function (this: ServerResponse, chunk, encoding, callback) {
      state.ended = true;
      return end.call(this, chunk, encoding, callback);
    } as typeof ServerResponse.prototype.end;
    const original = f.store.questionBank.recordSolve.bind(f.store.questionBank);
    f.replaceRecord(async input => {
      state.sawWrite = true;
      assert.equal(state.done, true);
      assert.equal(state.ended, true);
      return original(input);
    });
    try {
      const marked = objective();
      const plain = objective();
      assert.equal((await f.post('/v1/captures', { ...marked, question_bank_v1: true })).statusCode, 200);
      assert.equal(state.sawWrite, true);
      assert.equal((await f.post('/v1/captures', plain)).statusCode, 200);
      const withFlag = await f.store.billing.capture(f.token, marked.capture_id);
      const withoutFlag = await f.store.billing.capture(f.token, plain.capture_id);
      assert.equal(withFlag?.requestHmac, withoutFlag?.requestHmac);
      assert.equal((await f.store.questionBank.counts()).attempts, 1);
    } finally {
      ServerResponse.prototype.write = write;
      ServerResponse.prototype.end = end;
      await f.close();
    }
  });

  test(`${kind}: a question-bank write failure leaves delivery, settlement, and the charge unchanged`, async () => {
    const broken = await fixture(kind, true);
    const healthy = await fixture(kind, false);
    const before = questionBankWriteFailureCount();
    broken.replaceRecord(async () => { throw new Error('question text must not be logged'); });
    try {
      const left = await broken.post('/v1/captures', { ...objective(), question_bank_v1: true });
      const right = await healthy.post('/v1/captures', { ...objective(), question_bank_v1: true });
      assert.equal(left.statusCode, 200);
      assert.equal(right.statusCode, 200);
      assert.deepEqual(settlement(left.body), settlement(right.body));
      assert.equal((await broken.store.getAccount(broken.token))?.balanceQuestions, 29);
      assert.equal((await healthy.store.getAccount(healthy.token))?.balanceQuestions, 29);
      assert.equal((await broken.store.getAccount(broken.token))?.totalQuestions, 1);
      assert.equal((await broken.store.questionBank.counts()).attempts, 0);
      assert.equal(questionBankWriteFailureCount(), before + 1);
    } finally { await broken.close(); await healthy.close(); }
  });

  test(`${kind}: explain appends onto an existing screen-query solve and recover does not create an attempt`, async () => {
    // Explain and recover are only accepted for a screen_query_v1 parent. That contract is off in production.
    const f = await fixture(kind, true, true);
    try {
      const parent = screen(randomUUID(), { question_bank_v1: true });
      assert.equal((await f.post('/v1/captures', parent)).statusCode, 200);
      assert.equal((await f.store.questionBank.counts()).attempts, 1);
      const explained = await f.post(`/v1/captures/${parent.capture_id}/explanation`, {
        ...parent, explanation_id: randomUUID(), final_answer: 'B', question_bank_v1: true,
      });
      assert.equal(explained.statusCode, 200);
      assert.equal((await f.store.questionBank.findByCapture(parent.capture_id))?.explanation, 'Because B.');
      assert.equal((await f.store.questionBank.counts()).attempts, 1);
      const recovered = await f.post(`/v1/captures/${parent.capture_id}/recovery`, {
        ...parent, recovery_id: randomUUID(), question_bank_v1: true,
      });
      assert.equal(recovered.statusCode, 200);
      assert.equal((await f.store.questionBank.counts()).attempts, 1);
    } finally { await f.close(); }
  });
}

/** Resolves with the value, or with null when it is still pending after `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally { clearTimeout(timer); }
}

// SQLite runs a transaction synchronously and memory has no row locks, so only Postgres can show this.
if (postgres) test('postgres: an uncommitted question-bank write does not hold up the same account\'s next solve', async () => {
  const f = await fixture('postgres', true);
  const connection = f.connection!;
  const pool = new pg.Pool({ connectionString: connection, ssl: resolvePostgresSSL({ connectionString: connection }) });
  let entered!: () => void;
  let release!: () => void;
  const inside = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  // Runs the statements the way PostgresStore does, then keeps the transaction open before COMMIT.
  const heldCommit: RunTransaction = async <T,>(transaction: Transaction<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let step = transaction.next();
      while (!step.done) {
        let position = 0;
        const result = await client.query(step.value.sql.replace(/\?/g, () => '$' + (++position)), step.value.args);
        step = transaction.next(result.rows);
      }
      entered();
      await released;
      await client.query('COMMIT');
      return step.value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  };
  const writing = new SQLQuestionBankStore(heldCommit).recordSolve({
    token: f.token, captureId: randomUUID(), requestId: randomUUID(), createdAt: new Date().toISOString(), durationMs: 1,
    provider: 'mock', model: 'bank-test', reasoningEffort: 'low', configRevision: 'test', resultProtocol: 'objective_v1',
    resultState: 'ready', questionKind: 'single_choice', parserPath: 'v1', modelOutput: ready, finalAnswer: 'B',
    answerAttemptId: null, inputTokens: 11, outputTokens: 7, system: 'SYS-PROMPT', task: 'TASK-PROMPT',
    images: [{ mediaType: 'image/png', bytes: Buffer.from(png, 'base64') }, { mediaType: 'image/png', bytes: corruptPixels() }],
  });
  writing.catch(() => undefined);
  let next: Promise<{ statusCode: number; body: string }> | null = null;
  try {
    await inside;
    // Without the consent flag, so this solve's own bank write does not wait on the uncommitted prompt row.
    next = f.post('/v1/captures', objective());
    next.catch(() => undefined);
    const outcome = await within(next, 5000);
    assert.ok(outcome, 'the next solve waited for the question-bank commit');
    assert.equal(outcome.statusCode, 200);
    assert.equal(settlement(outcome.body).terminal, 'usable');
    assert.equal(settlement(outcome.body).charged, 1);
    assert.equal((await f.store.getAccount(f.token))?.balanceQuestions, 29);
    assert.equal((await f.store.questionBank.counts()).attempts, 0);
    release();
    await writing;
    assert.equal((await f.store.questionBank.counts()).attempts, 1);
    assert.equal((await f.store.questionBank.counts()).images, 2);
  } finally {
    release();
    await Promise.allSettled([writing, next]);
    await pool.end();
    await f.close();
  }
});
