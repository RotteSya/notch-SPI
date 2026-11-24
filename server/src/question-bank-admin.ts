import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from './routes.ts';
import { ApiError } from './http.ts';
import { REPORT_STYLE } from './admin-reports.ts';
import { TRANSCRIBE_MAX_TOKENS } from './question-bank-prompt.ts';
import { reservation, reviewRequest } from './question-bank-worker.ts';
import { budgetCeiling, type BudgetInspection } from './budget-policy.ts';
import {
  byOccurrences, MARK_VERDICTS, questionBankCardViews, questionBankMarkSummary, questionBankStats,
  type QuestionBankCardView, type QuestionBankFootprint, type QuestionBankMarkKind, type QuestionBankSample, type QuestionBankVerdict,
} from './question-bank.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
/** The repeat-rate threshold in the plan; shown beside the rate, not applied by the server. */
const TARGET_REPEAT_RATE = 0.15;
/** Cards one review confirmation may name, and cards the review list shows. */
const REVIEW_BATCH = 50;
const REVIEW_LIST = 200;

function objectBody(req: FastifyRequest, allowed: string[]): Record<string, unknown> {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '请求格式无效');
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, '请求包含未知字段');
  return body as Record<string, unknown>;
}

function deviceIdOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new ApiError(400, '账户编号无效');
  return value;
}

function uuidOf(value: unknown, message: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ApiError(400, message);
  return value;
}

/** Same rules as the manual PLUS console: a short name and a reason, never a recovery code or the admin key. */
function textOf(value: unknown, adminToken: string, min: number, max: number, message: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) throw new ApiError(400, message);
  if (/dev_[A-Za-z0-9_-]+/.test(text) || (adminToken !== '' && text.includes(adminToken))) throw new ApiError(400, '操作人或原因不能包含恢复码、管理员密钥');
  return text;
}

function countOf(req: FastifyRequest): number {
  const raw = (req.query as Record<string, unknown> | undefined)?.count;
  if (raw === undefined) return 10;
  if (typeof raw !== 'string' || !/^(?:[1-9]|1[0-9]|20)$/.test(raw)) throw new ApiError(400, '抽取数量须为 1–20');
  return Number(raw);
}

function sample(item: QuestionBankSample) {
  return {
    attempt_id: item.attemptId, created_at: item.createdAt, card_id: item.cardId, transcript: item.transcript,
    images: item.images.map(image => ({ ordinal: image.ordinal, media_type: image.mediaType, byte_count: image.byteCount, stored: image.stored })),
  };
}

function cardIdsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > REVIEW_BATCH) throw new ApiError(400, '请选择 1–' + REVIEW_BATCH + ' 张卡片');
  const ids = value.map(id => uuidOf(id, '卡片编号无效'));
  if (new Set(ids).size !== ids.length) throw new ApiError(400, '卡片编号重复');
  return [...ids].sort();
}

function cardView(view: QuestionBankCardView) {
  const review = view.latestReview, event = view.latestEvent;
  return {
    card_id: view.cardId, stem: view.stem, options: view.options, state: view.state, created_at: view.createdAt,
    occurrences: view.occurrences, answers: view.answers, answers_differ: view.answersDiffer,
    review_attempt_id: view.reviewAttemptId, blocked: view.blocked,
    latest_review: review && {
      job_id: review.jobId, operation_id: review.operationId, status: review.status, error_code: review.errorCode, updated_at: review.updatedAt,
      outcome: review.result?.outcome ?? null, provider: review.result?.provider ?? null, model: review.result?.model ?? null,
      state: review.result?.state ?? null, answer: review.result?.answer ?? null,
    },
    latest_event: event && {
      at: event.at, actor: event.actor, from_state: event.fromState, to_state: event.toState, basis: event.basis, answer: event.answer,
    },
  };
}

/** Today's window of one budget scope: the window's own limit once it exists, else the configured one. */
function budgetToday(inspection: BudgetInspection, scope: string, currency: string, limit: number, offsetMinutes: number, share = 1) {
  const offset = offsetMinutes * 60_000, now = Date.now();
  const start = new Date(Math.floor((now + offset) / 86_400_000) * 86_400_000 - offset).toISOString();
  const window = inspection.windows.find(w => w.scope === scope && w.currency === currency && w.start === start);
  const windowLimit = window?.limit ?? limit;
  const spent = window?.spent ?? 0, held = window?.held ?? 0;
  return { limit_micros: windowLimit, spent_micros: spent, held_micros: held, remaining_micros: Math.max(0, budgetCeiling(windowLimit, false, share) - spent - held) };
}

function footprint(value: QuestionBankFootprint) {
  return {
    attempts: value.attempts, images: value.images, stored_images: value.storedImages, jobs: value.jobs, marks: value.marks,
    cards_deleted: value.cardsDeleted, cards_kept: value.cardsKept, reviews_detached: value.reviewsDetached,
  };
}

export function registerQuestionBankAdmin(app: FastifyInstance, ctx: AppContext, requireAdmin: (req: FastifyRequest) => void): void {
  const adminToken = ctx.config.adminToken;
  const store = ctx.store, bank = store.questionBank;
  const actorOf = (value: unknown) => textOf(value, adminToken, 2, 80, '请填写操作人（2–80 字）');
  const reasonOf = (value: unknown) => textOf(value, adminToken, 5, 500, '请填写原因（5–500 字）');
  const reviewer = ctx.reviewProvider ?? null;
  /** Review needs a configured, healthy reviewer; preview and confirmation refuse otherwise. */
  const requireReviewer = () => {
    if (reviewer === null) throw new ApiError(409, '复核未配置：需要设置 QUESTION_BANK_REVIEW_PROVIDER 和 QUESTION_BANK_REVIEW_MODEL', 'feature_disabled');
    if ((ctx.reviewProviderDegraded ?? null) !== null) throw new ApiError(409, '复核服务配置有误，暂不可用', 'feature_disabled');
    return reviewer;
  };

  // The page carries no secret; the key is entered on the page and sent with each request.
  app.get('/admin/question-bank', async (_req, reply) => {
    if (adminToken === '') throw new ApiError(404, '未启用');
    return reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex, nofollow')
      .header('Content-Security-Policy', QUESTION_BANK_PAGE_CSP).header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff').type('text/html; charset=utf-8').send(renderQuestionBankPage());
  });

  // No request body, question text, credential or SQL error reaches the normal log.
  app.register(async scope => {
    scope.addHook('onRequest', async (req, reply) => { reply.header('Cache-Control', 'no-store'); requireAdmin(req); });
    scope.setErrorHandler((error, req, reply) => {
      if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      const code = (error as { statusCode?: number }).statusCode;
      if (code === 400 || code === 413) return reply.code(code).send({ error: { code: 'bad_request', message: '请求格式或大小无效' } });
      req.log.error('question bank admin operation failed');
      return reply.code(500).send({ error: { code: 'internal', message: '保存或读取失败，请保留当前操作并重试' } });
    });

    scope.get('/admin/question-bank/stats', async () => {
      const rows = await bank.occurrenceRows();
      const inventory = await bank.inventory();
      const marks = questionBankMarkSummary(await bank.marks());
      const operations = await bank.operations(20);
      const stats = questionBankStats(rows);
      const reviewData = await bank.reviewData();
      const views = questionBankCardViews(reviewData);
      const reviewJobs: Record<string, number> = {};
      for (const job of reviewData.jobs) reviewJobs[job.status] = (reviewJobs[job.status] ?? 0) + 1;
      return {
        definition: 'question-bank-stats-v1', generated_at: new Date().toISOString(), enabled: ctx.config.questionBankEnabled,
        solves: {
          denominator: stats.denominator, repeated: stats.repeated, repeat_rate: stats.repeatRate, target_rate: TARGET_REPEAT_RATE,
          same_account: stats.sameAccount, same_account_rate: stats.sameAccountRate,
          other_account: stats.otherAccount, other_account_rate: stats.otherAccountRate,
        },
        checkpoints: stats.checkpoints,
        top_accounts: stats.topAccounts.map(account => ({ device_id: account.deviceId, solves: account.solves, share: account.share })),
        without_top_accounts: {
          denominator: stats.withoutTopAccounts.denominator, repeated: stats.withoutTopAccounts.repeated, repeat_rate: stats.withoutTopAccounts.repeatRate,
        },
        transcription: {
          solves: stats.transcription.solves, done: stats.transcription.done, waiting: stats.transcription.waiting,
          failed: stats.transcription.failed, skipped: stats.transcription.skipped, coverage: stats.transcription.coverage,
          failed_by_error: stats.transcription.failedByError, max_tokens: TRANSCRIBE_MAX_TOKENS,
        },
        cards: inventory.cards,
        answers_differ: views.filter(view => view.answersDiffer).length,
        review_jobs: reviewJobs,
        images: { stored: inventory.images.stored, stored_bytes: inventory.images.storedBytes, cleared: inventory.images.cleared },
        costs: inventory.costs.map(cost => ({ purpose: cost.purpose, currency: cost.currency, calls: cost.calls, known_micros: cost.knownMicros, unknown: cost.unknown })),
        marks,
        recent_operations: operations.map(operation => ({
          operation_id: operation.operationId, kind: operation.kind, device_id: operation.deviceId, actor: operation.actor,
          reason: operation.reason, created_at: operation.createdAt, result: operation.after,
        })),
      };
    });

    scope.post('/admin/question-bank/requeue', { bodyLimit: 4096 }, async req => {
      const body = objectBody(req, ['operation_id', 'actor', 'reason']);
      const operationId = uuidOf(body.operation_id, '操作号无效');
      const outcome = await bank.requeueFailed({
        operationId, actor: actorOf(body.actor), reason: reasonOf(body.reason), now: new Date().toISOString(), maxTokens: TRANSCRIBE_MAX_TOKENS,
      });
      if (outcome === 'conflict') throw new ApiError(409, '这个操作号已用于另一次操作，请刷新页面后重试', 'idempotency_conflict');
      return { operation_id: operationId, requeued: outcome.result.requeued, replayed: outcome.replayed };
    });

    scope.get('/admin/question-bank/samples/transcripts', async req => ({ items: (await bank.sampleTranscripts(countOf(req))).map(sample) }));

    scope.get('/admin/question-bank/samples/matches', async req => ({
      items: (await bank.sampleMatches(countOf(req))).map(pair => ({ card_id: pair.cardId, first: sample(pair.first), second: sample(pair.second) })),
    }));

    scope.get('/admin/question-bank/attempts/:attemptId/images/:ordinal', async (req, reply) => {
      const params = req.params as { attemptId: string; ordinal: string };
      if (!UUID.test(params.attemptId) || !/^(?:0|[1-9][0-9]?)$/.test(params.ordinal)) throw new ApiError(400, '题图编号无效');
      const image = await bank.image(params.attemptId, Number(params.ordinal));
      if (!image) throw new ApiError(404, '题图不存在或已过保留期');
      return reply.type(IMAGE_TYPES.has(image.mediaType) ? image.mediaType : 'application/octet-stream')
        .header('Content-Security-Policy', "default-src 'none'; sandbox").header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', 'inline').send(image.bytes);
    });

    scope.post('/admin/question-bank/marks', { bodyLimit: 4096 }, async req => {
      const body = objectBody(req, ['mark_id', 'kind', 'attempt_id', 'other_attempt_id', 'verdict', 'actor']);
      const markId = uuidOf(body.mark_id, '标记编号无效');
      if (body.kind !== 'transcript' && body.kind !== 'match') throw new ApiError(400, '抽查类型无效');
      const kind: QuestionBankMarkKind = body.kind;
      if (typeof body.verdict !== 'string' || !MARK_VERDICTS[kind].includes(body.verdict as QuestionBankVerdict)) throw new ApiError(400, '抽查结论无效');
      const first = uuidOf(body.attempt_id, '作答编号无效');
      const other = kind === 'match' ? uuidOf(body.other_attempt_id, '作答编号无效') : null;
      if (kind === 'transcript' && body.other_attempt_id !== undefined) throw new ApiError(400, '抽查转写只针对一条作答');
      const [attemptId, otherAttemptId] = other === null ? [first, null] : [first, other].sort() as [string, string];
      const outcome = await bank.recordMark({
        markId, kind, attemptId, otherAttemptId, verdict: body.verdict as QuestionBankVerdict, actor: actorOf(body.actor), createdAt: new Date().toISOString(),
      });
      if (outcome === 'conflict') throw new ApiError(409, '这个标记编号已用于另一条标记，请刷新页面后重试', 'idempotency_conflict');
      if (outcome === 'missing') throw new ApiError(404, '作答不存在或未转写，或两条作答不在同一张可匹配卡片上');
      return { mark_id: markId, replayed: outcome === 'replayed' };
    });

    scope.get('/admin/question-bank/review/cards', async () => {
      const repeated = questionBankCardViews(await bank.reviewData()).filter(view => view.occurrences >= 2).sort(byOccurrences);
      return {
        reviewer: reviewer === null ? null : { provider: reviewer.name, model: ctx.config.questionBankReviewModel, available: (ctx.reviewProviderDegraded ?? null) === null },
        total: repeated.length, items: repeated.slice(0, REVIEW_LIST).map(cardView),
      };
    });

    scope.post('/admin/question-bank/review/preview', { bodyLimit: 16_384 }, async req => {
      const provider = requireReviewer();
      const cardIds = cardIdsOf(objectBody(req, ['card_ids']).card_ids);
      const views = new Map(questionBankCardViews(await bank.reviewData(cardIds)).map(view => [view.cardId, view]));
      const items = [];
      let estimated = 0;
      for (const cardId of cardIds) {
        const view = views.get(cardId);
        const blocked = !view ? 'missing' : view.blocked;
        const call = !blocked && !view!.answersDiffer;
        let micros = 0;
        if (call) {
          // The same reservation the review call takes; estimating never calls the reviewer.
          const solve = await bank.reviewSolve(view!.reviewAttemptId!);
          micros = solve ? (await reservation(ctx.config, provider, reviewRequest(solve), ctx.config.objectiveMaxTokens)).micros : 0;
          estimated += micros;
        }
        items.push({ card_id: cardId, blocked, call, answers_differ: view?.answersDiffer ?? false, estimated_micros: micros });
      }
      const inspection = await store.billing.inspectBudget();
      const config = ctx.config;
      const review = budgetToday(inspection, 'question_bank_review', config.modelCostCurrency, config.questionBankReviewDailyBudgetMicros, config.modelBudgetUtcOffsetMinutes);
      const share = Math.min(100, Math.max(0, config.unpaidSharePercent)) / 100 * (config.requestBudgetMode === 'guarded-request' ? 0.8 : 1);
      const official = config.modelDailyBudgetMicros > 0
        ? budgetToday(inspection, 'official', config.modelCostCurrency, config.modelDailyBudgetMicros, config.modelBudgetUtcOffsetMinutes, share) : null;
      return {
        cards: cardIds.length, calls: items.filter(item => item.call).length, without_call: items.filter(item => !item.blocked && !item.call).length,
        blocked: items.filter(item => item.blocked).length, estimated_micros: estimated, currency: config.modelCostCurrency, items,
        review_budget: { ...review, enough: review.remaining_micros >= estimated },
        official_budget: official && { ...official, enough: official.remaining_micros >= estimated },
      };
    });

    scope.post('/admin/question-bank/review/confirm', { bodyLimit: 16_384 }, async (req, reply) => {
      requireReviewer();
      const body = objectBody(req, ['card_ids', 'operation_id', 'actor', 'reason']);
      const cardIds = cardIdsOf(body.card_ids), operationId = uuidOf(body.operation_id, '操作号无效');
      const outcome = await bank.confirmReview({ operationId, cardIds, actor: actorOf(body.actor), reason: reasonOf(body.reason), now: new Date().toISOString() });
      if (outcome === 'conflict') throw new ApiError(409, '这个操作号已用于另一次操作，请重新预览后再确认', 'idempotency_conflict');
      if ('blocked' in outcome) {
        return reply.code(409).send({
          error: { code: 'review_blocked', message: '有卡片不能复核，本次一张都没有提交，请重新加载列表后再选' },
          blocked: outcome.blocked.map(item => ({ card_id: item.cardId, reason: item.reason })),
        });
      }
      return { operation_id: operationId, cards: outcome.result.cards, replayed: outcome.replayed };
    });

    scope.get('/admin/question-bank/review/disputed', async () => {
      const disputed = questionBankCardViews(await bank.reviewData()).filter(view => view.state === 'disputed').sort(byOccurrences).slice(0, REVIEW_LIST);
      const samples = new Map((await bank.solveSamples(disputed.flatMap(view => view.reviewAttemptId ?? []))).map(item => [item.attemptId, item]));
      return {
        items: disputed.map(view => {
          const shown = view.reviewAttemptId ? samples.get(view.reviewAttemptId) : undefined;
          return { ...cardView(view), images: shown ? sample(shown) : null };
        }),
      };
    });

    scope.post('/admin/question-bank/review/adjudicate', { bodyLimit: 8192 }, async (req, reply) => {
      const body = objectBody(req, ['card_id', 'operation_id', 'answer', 'basis', 'actor']);
      const cardId = uuidOf(body.card_id, '卡片编号无效'), operationId = uuidOf(body.operation_id, '操作号无效');
      const outcome = await bank.adjudicate({
        operationId, cardId, actor: actorOf(body.actor),
        answer: textOf(body.answer, adminToken, 1, 500, '请填写正确答案（1–500 字）'),
        basis: textOf(body.basis, adminToken, 5, 500, '请填写依据（5–500 字）'), now: new Date().toISOString(),
      });
      if (outcome === 'conflict') throw new ApiError(409, '这个操作号已用于另一次操作，请刷新页面后重试', 'idempotency_conflict');
      if (outcome === 'missing') throw new ApiError(404, '卡片不存在');
      if (outcome === 'not_disputed') return reply.code(409).send({ error: { code: 'card_not_disputed', message: '这张卡片不是“有争议”状态，不能裁决' } });
      return { operation_id: operationId, card_id: cardId, state: outcome.result.state, replayed: outcome.replayed };
    });

    scope.post('/admin/question-bank/accounts/preview', { bodyLimit: 4096 }, async req => {
      const deviceId = deviceIdOf(objectBody(req, ['device_id']).device_id);
      return { device_id: deviceId, ...footprint(await bank.accountFootprint(deviceId)) };
    });

    scope.post('/admin/question-bank/accounts/delete', { bodyLimit: 4096 }, async req => {
      const body = objectBody(req, ['device_id', 'operation_id', 'actor', 'reason']);
      const deviceId = deviceIdOf(body.device_id), operationId = uuidOf(body.operation_id, '操作号无效');
      const outcome = await bank.deleteAccount({
        operationId, deviceId, actor: actorOf(body.actor), reason: reasonOf(body.reason), now: new Date().toISOString(),
      });
      if (outcome === 'conflict') throw new ApiError(409, '这个操作号已用于另一次操作，请重新预览后再确认', 'idempotency_conflict');
      return { operation_id: operationId, device_id: deviceId, replayed: outcome.replayed, deleted: footprint(outcome.result) };
    });
  });
}

export const QUESTION_BANK_SCRIPT = String.raw`
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const node = (tag, text, parent) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); if (parent) parent.append(e); return e; };
  const pct = value => value === null || value === undefined ? '没有样本' : (value * 100).toFixed(1) + '%';
  const money = micros => (Number(micros) / 1e6).toFixed(6);
  const ERRORS = { invalid_transcript: '输出格式不合格', output_truncated: '输出被长度上限截断', upstream_error: '上游报错', timeout: '超过单次时限', lease_expired: '进程中断，租约过期' };
  const STATES = { unverified: '未核实', verified_model: '模型复核一致', verified_human: '人工裁决', disputed: '有争议' };
  const STATUS = { ok: '单题', multiple: '多道题', unreadable: '读不清' };
  const PURPOSES = { transcribe: '转写', review: '复核' };
  const OUTCOMES = { agrees: '复核一致', disagrees: '复核答案不同', not_ready: '复核未给出可用答案', answers_differ: '已有答案不一致，未调用模型' };
  const BLOCKS = { review_open: '复核进行中', reviewed: '已复核或已裁决', not_repeated: '计入看数的作答少于 2 次', images_expired: '题图已过期，不能复核', missing: '卡片不存在或不可匹配' };
  const JOBS = { pending: '等待', running: '进行中', done: '完成', failed: '失败', skipped: '跳过' };
  const OPERATIONS = { requeue_failed: '全部重新入队', delete_account: '按账户删除', review: '确认复核', adjudicate: '裁决' };
  const urls = { transcripts: [], matches: [], disputed: [] };
  const message = (text, error) => { $('status').textContent = text; $('status').className = error ? 'error' : 'muted'; };
  const key = () => $('key').value.trim();
  const actor = () => $('actor').value.trim();
  const uuid = () => crypto.randomUUID();
  async function call(path, body) {
    if (!key()) throw new Error('请输入管理员密钥。');
    const init = { cache: 'no-store', headers: { 'x-admin-token': key() } };
    if (body) { init.method = 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((data.error && data.error.message) || '请求失败（' + response.status + '）');
    return data;
  }
  function table(parent, headers, rows) {
    const wrap = node('div', undefined, parent); wrap.className = 'table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', headers[0] + '表，可横向滚动');
    const t = node('table', undefined, wrap), head = node('tr', undefined, node('thead', undefined, t));
    for (const h of headers) { const th = node('th', h, head); th.scope = 'col'; }
    const body = node('tbody', undefined, t);
    for (const row of rows) { const tr = node('tr', undefined, body); for (const value of row) node('td', value, tr); }
  }

  async function loadStats() {
    message('正在读取看数…');
    try {
      const d = await call('/admin/question-bank/stats');
      const out = $('stats'); out.replaceChildren();
      node('p', d.enabled ? '服务端题库开关：开' : '服务端题库开关：关（已有数据照常统计）', out).className = 'muted';
      const s = d.solves;
      table(out, ['计数范围内作答（道）', '重复', '总重复率（与 ' + pct(s.target_rate) + ' 比较）', '与同一账户更早作答重复', '与其他账户更早作答重复'],
        [[s.denominator, s.repeated, pct(s.repeat_rate), s.same_account + ' · ' + pct(s.same_account_rate), s.other_account + ' · ' + pct(s.other_account_rate)]]);
      const cp = d.checkpoints;
      node('p', '判断点 1000 / 1500 / 2000：已到 ' + (cp.reached.length ? cp.reached.join('、') : '无') + '；下一个 ' + (cp.next === null ? '没有了' : cp.next + '（还差 ' + (cp.next - s.denominator) + ' 道）'), out);
      node('h3', '用量最大的账户', out);
      if (d.top_accounts.length) table(out, ['账户编号', '计数范围内作答', '占比'], d.top_accounts.map(a => [a.device_id, a.solves, pct(a.share)]));
      else node('p', '没有样本。', out).className = 'empty';
      const w = d.without_top_accounts;
      node('p', '不含这些账户：作答 ' + w.denominator + ' 道，重复 ' + w.repeated + '，总重复率 ' + pct(w.repeat_rate) + '。含这些账户的总重复率见上表。两个拆分和这一项只供判断，不参与达标判定。', out);
      node('h3', '转写', out);
      const t = d.transcription;
      table(out, ['作答', '已转写', '覆盖率', '等待中', '失败', '跳过（题图已清理等）'], [[t.solves, t.done, pct(t.coverage), t.waiting, t.failed, t.skipped]]);
      const errors = Object.entries(t.failed_by_error);
      if (errors.length) table(out, ['失败原因', '数量'], errors.map(([code, n]) => [ERRORS[code] || code, n]));
      node('p', '以上只算非内部／测试账户：is_internal=1 或平台为 release-qa 的账户不计入，修改内部标记后刷新即重算。', out).className = 'muted';
      node('h3', '卡片（含内部／测试账户）', out);
      node('p', '卡片、题图和成本是库存数字，包含内部／测试账户的作答和调用；上面的重复率和转写数字不含。', out).className = 'muted';
      if (d.cards.length) table(out, ['状态', '可匹配', '数量'], d.cards.map(c => [STATES[c.state] || c.state, c.matchable ? '是' : '否', c.count]));
      else node('p', '还没有卡片。', out).className = 'empty';
      node('p', '答案不一致的卡片：' + d.answers_differ + ' 张（同一张可匹配卡片上，计入看数的作答给出了不止一种答案内容；只算非内部／测试账户的作答）。', out);
      const jobs = Object.entries(d.review_jobs);
      node('p', '复核任务：' + (jobs.length ? jobs.map(([status, n]) => (JOBS[status] || status) + ' ' + n).join('，') : '还没有'), out).className = 'muted';
      node('h3', '题图（含内部／测试账户）', out);
      table(out, ['保存中', '保存中字节数', '已过保留期清理'], [[d.images.stored, d.images.stored_bytes + '（约 ' + (d.images.stored_bytes / 1048576).toFixed(1) + ' MB）', d.images.cleared]]);
      node('h3', '题库调用成本（累计，含内部／测试账户）', out);
      if (d.costs.length) table(out, ['用途', '币种', '调用次数', '已知成本', '成本未知次数'], d.costs.map(c => [PURPOSES[c.purpose] || c.purpose, c.currency, c.calls, money(c.known_micros), c.unknown]));
      else node('p', '还没有转写或复核调用。', out).className = 'empty';
      node('h3', '抽查结果', out);
      table(out, ['转写正确', '转写有误', '确实相同', '认错了'], [[d.marks.transcript.correct, d.marks.transcript.wrong, d.marks.match.same, d.marks.match.different]]);
      node('p', '同一条作答或同一对作答只算最后一次标记。', out).className = 'muted';
      node('h3', '最近的管理操作', out);
      if (d.recent_operations.length) table(out, ['时间', '操作', '账户编号', '操作人', '原因', '结果'], d.recent_operations.map(o => [o.created_at,
        OPERATIONS[o.kind] || o.kind, o.device_id === null ? '—' : o.device_id, o.actor, o.reason, JSON.stringify(o.result)]));
      else node('p', '还没有管理操作。', out).className = 'empty';
      message('看数已更新 · ' + d.generated_at);
    } catch (error) { message(error.message, true); }
  }
  $('load-stats').addEventListener('click', loadStats);

  let requeueId = uuid();
  $('requeue').addEventListener('click', async () => {
    if (!actor()) { message('请填写操作人。', true); return; }
    if (!confirm('把全部失败的转写任务重新入队？')) return;
    $('requeue').disabled = true;
    try {
      const d = await call('/admin/question-bank/requeue', { operation_id: requeueId, actor: actor(), reason: $('requeue-reason').value.trim() });
      message((d.replayed ? '这次操作已经执行过：' : '') + '已重新入队 ' + d.requeued + ' 个任务。');
      requeueId = uuid();
      loadStats();
    } catch (error) { message(error.message, true); } finally { $('requeue').disabled = false; }
  });

  async function picture(parent, section, attemptId, image) {
    const figure = node('figure', undefined, parent);
    const label = '第 ' + (image.ordinal + 1) + ' 张';
    if (!image.stored) { node('figcaption', label + '：已过保留期清理', figure).className = 'muted'; return; }
    try {
      const response = await fetch('/admin/question-bank/attempts/' + encodeURIComponent(attemptId) + '/images/' + image.ordinal, { cache: 'no-store', headers: { 'x-admin-token': key() } });
      if (!response.ok) throw new Error('read failed');
      const url = URL.createObjectURL(await response.blob());
      urls[section].push(url);
      const img = node('img', undefined, figure); img.src = url; img.alt = label + '题图';
    } catch (error) { node('figcaption', label + '读取失败', figure).className = 'error'; }
  }
  function release(section) { while (urls[section].length) URL.revokeObjectURL(urls[section].pop()); }
  function transcript(parent, t) {
    if (!t) { node('p', '没有转写', parent).className = 'muted'; return; }
    node('p', STATUS[t.status] + ' · 语言 ' + t.language + ' · ' + (t.has_figure ? '依赖图表' : '不依赖图表'), parent).className = 'muted';
    node('p', t.stem || '（题干为空）', parent).className = 'stem';
    if (t.options.length) { const list = node('ol', undefined, parent); list.className = 'options'; for (const o of t.options) node('li', o.label + '  ' + o.text, list); }
  }
  function markButtons(parent, kind, attemptId, otherAttemptId, choices) {
    const row = node('div', undefined, parent); row.className = 'actions';
    const buttons = [];
    for (const [verdict, label] of choices) {
      const button = node('button', label, row); button.type = 'button'; buttons.push(button);
      let markId = uuid();
      button.addEventListener('click', async () => {
        if (!actor()) { message('请填写操作人。', true); return; }
        for (const b of buttons) b.disabled = true;
        try {
          const body = { mark_id: markId, kind, attempt_id: attemptId, verdict, actor: actor() };
          if (otherAttemptId) body.other_attempt_id = otherAttemptId;
          await call('/admin/question-bank/marks', body);
          markId = uuid();
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
          note.textContent = '已记录：' + label; note.className = 'muted';
        } catch (error) { note.textContent = error.message; note.className = 'error'; }
        finally { for (const b of buttons) b.disabled = false; }
      });
    }
    const note = node('span', '', row);
  }
  function attemptLine(parent, item) { node('p', '作答 ' + item.attempt_id + ' · ' + item.created_at, parent).className = 'muted'; }

  $('load-transcripts').addEventListener('click', async () => {
    release('transcripts'); const out = $('transcripts'); out.replaceChildren();
    message('正在抽取作答…');
    try {
      const d = await call('/admin/question-bank/samples/transcripts?count=' + encodeURIComponent($('transcript-count').value));
      if (!d.items.length) node('p', '没有可抽查的作答：需要非内部／测试账户、已转写，且题图仍在保留期内。', out).className = 'empty';
      for (const item of d.items) {
        const pair = node('article', undefined, out); pair.className = 'pair';
        const left = node('div', undefined, pair), right = node('div', undefined, pair);
        transcript(right, item.transcript); attemptLine(right, item);
        markButtons(right, 'transcript', item.attempt_id, null, [['correct', '正确'], ['wrong', '有误']]);
        for (const image of item.images) await picture(left, 'transcripts', item.attempt_id, image);
      }
      message('已抽取 ' + d.items.length + ' 条作答。');
    } catch (error) { message(error.message, true); }
  });

  $('load-matches').addEventListener('click', async () => {
    release('matches'); const out = $('matches'); out.replaceChildren();
    message('正在抽取作答对…');
    try {
      const d = await call('/admin/question-bank/samples/matches?count=' + encodeURIComponent($('match-count').value));
      if (!d.items.length) node('p', '没有可抽查的作答对：需要同一张可匹配卡片上有两条非内部／测试账户、题图仍在保留期内的作答。', out).className = 'empty';
      for (const item of d.items) {
        const card = node('article', undefined, out); card.className = 'match';
        node('p', '卡片 ' + item.card_id, card).className = 'muted';
        const pair = node('div', undefined, card); pair.className = 'pair';
        const columns = [item.first, item.second].map(side => { const column = node('div', undefined, pair); transcript(column, side.transcript); attemptLine(column, side); return column; });
        markButtons(card, 'match', item.first.attempt_id, item.second.attempt_id, [['same', '确实相同'], ['different', '认错了']]);
        for (const [index, side] of [item.first, item.second].entries()) for (const image of side.images) await picture(columns[index], 'matches', side.attempt_id, image);
      }
      message('已抽取 ' + d.items.length + ' 对作答。');
    } catch (error) { message(error.message, true); }
  });

  const brief = text => text.length > 80 ? text.slice(0, 80) + '…' : text;
  const answerText = item => item.answers.map(a => a.example + ' ×' + a.count).join('；') + (item.answers_differ ? '（答案不一致）' : '');
  const reviewText = r => !r ? '—' : r.outcome ? OUTCOMES[r.outcome] + (r.answer ? '：' + r.answer : '') : (JOBS[r.status] || r.status) + (r.error_code ? '（' + (ERRORS[r.error_code] || r.error_code) + '）' : '');
  let pendingReview = null;
  const resetReview = () => { pendingReview = null; $('confirm-review').hidden = true; $('review-preview').replaceChildren(); };
  const selectedCards = () => [...document.querySelectorAll('#review input[type=checkbox]:checked')].map(box => box.value);
  $('load-review').addEventListener('click', async () => {
    resetReview(); const out = $('review'); out.replaceChildren();
    message('正在读取复核列表…');
    try {
      const d = await call('/admin/question-bank/review/cards');
      node('p', d.reviewer ? '复核模型：' + d.reviewer.provider + ' / ' + d.reviewer.model + (d.reviewer.available ? '' : '（配置有误，暂不可用）') : '复核未配置：需要设置 QUESTION_BANK_REVIEW_PROVIDER 和 QUESTION_BANK_REVIEW_MODEL。', out).className = 'muted';
      if (!d.items.length) { node('p', '还没有重复出现的卡片。', out).className = 'empty'; message('复核列表已更新。'); return; }
      const wrap = node('div', undefined, out); wrap.className = 'table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', '复核列表，可横向滚动');
      const t = node('table', undefined, wrap), head = node('tr', undefined, node('thead', undefined, t));
      for (const h of ['选择', '出现次数', '题干', '答案（次数）', '状态', '不能复核的原因', '最近一次复核']) { const th = node('th', h, head); th.scope = 'col'; }
      const body = node('tbody', undefined, t);
      for (const item of d.items) {
        const tr = node('tr', undefined, body), cell = node('td', undefined, tr);
        const box = node('input', undefined, cell); box.type = 'checkbox'; box.value = item.card_id; box.disabled = !!item.blocked;
        box.setAttribute('aria-label', '选择卡片 ' + item.card_id); box.addEventListener('change', resetReview);
        for (const value of [item.occurrences, brief(item.stem), answerText(item), STATES[item.state] || item.state, item.blocked ? BLOCKS[item.blocked] : '—', reviewText(item.latest_review)]) node('td', value, tr);
      }
      if (d.total > d.items.length) node('p', '共 ' + d.total + ' 张，只显示出现次数最多的 ' + d.items.length + ' 张。', out).className = 'muted';
      message('复核列表已更新。');
    } catch (error) { message(error.message, true); }
  });
  $('preview-review').addEventListener('click', async () => {
    resetReview();
    const cardIds = selectedCards();
    if (!cardIds.length) { message('请先勾选卡片。', true); return; }
    try {
      const d = await call('/admin/question-bank/review/preview', { card_ids: cardIds });
      const out = $('review-preview');
      table(out, ['卡片', '调用模型', '不调用、直接置为有争议', '不能复核', '预计成本（按预留上限，' + d.currency + '）'], [[d.cards, d.calls, d.without_call, d.blocked, money(d.estimated_micros)]]);
      const r = d.review_budget;
      node('p', '复核预算今日剩余 ' + money(r.remaining_micros) + '（上限 ' + money(r.limit_micros) + '，已用 ' + money(r.spent_micros) + '，占用中 ' + money(r.held_micros) + '）：' + (r.enough ? '够这一批' : '不够这一批，用尽后任务会等到明天'), out).className = r.enough ? 'muted' : 'error';
      if (d.official_budget) node('p', '共享每日模型预算中题库可用的剩余 ' + money(d.official_budget.remaining_micros) + '：' + (d.official_budget.enough ? '够这一批' : '不够这一批'), out).className = d.official_budget.enough ? 'muted' : 'error';
      if (d.blocked) {
        table(out, ['不能复核的卡片', '原因'], d.items.filter(i => i.blocked).map(i => [i.card_id, BLOCKS[i.blocked] || i.blocked]));
        message('有卡片不能复核，请取消勾选后重新预览。', true); return;
      }
      pendingReview = { cardIds, operationId: uuid() };
      $('confirm-review').hidden = false;
      message('请核对预览，填写原因后确认复核。');
    } catch (error) { message(error.message, true); }
  });
  $('confirm-review').addEventListener('click', async () => {
    if (!pendingReview) return;
    if (!actor()) { message('请填写操作人。', true); return; }
    if (!confirm('为 ' + pendingReview.cardIds.length + ' 张卡片生成复核任务？确认后由后台调用复核模型并产生费用。')) return;
    $('confirm-review').disabled = true;
    try {
      const d = await call('/admin/question-bank/review/confirm', { card_ids: pendingReview.cardIds, operation_id: pendingReview.operationId, actor: actor(), reason: $('review-reason').value.trim() });
      message((d.replayed ? '这次确认已经执行过：' : '') + '已为 ' + d.cards.length + ' 张卡片生成复核任务，后台下一轮开始处理。操作号 ' + d.operation_id);
      resetReview();
    } catch (error) { message(error.message, true); } finally { $('confirm-review').disabled = false; }
  });

  $('load-disputed').addEventListener('click', async () => {
    release('disputed'); const out = $('disputed'); out.replaceChildren();
    message('正在读取有争议的卡片…');
    try {
      const d = await call('/admin/question-bank/review/disputed');
      if (!d.items.length) node('p', '没有“有争议”的卡片。', out).className = 'empty';
      for (const item of d.items) {
        const card = node('article', undefined, out); card.className = 'match';
        node('p', '卡片 ' + item.card_id + ' · 计入看数的作答 ' + item.occurrences + ' 次', card).className = 'muted';
        const pair = node('div', undefined, card); pair.className = 'pair';
        const left = node('div', undefined, pair), right = node('div', undefined, pair);
        node('p', item.stem || '（题干为空）', right).className = 'stem';
        if (item.options.length) { const list = node('ol', undefined, right); list.className = 'options'; for (const o of item.options) node('li', o.label + '  ' + o.text, list); }
        node('h3', '作答给出的答案', right);
        if (item.answers.length) { const list = node('ul', undefined, right); for (const a of item.answers) node('li', a.example + ' · ' + a.count + ' 次', list); }
        else node('p', '没有计入看数的作答。', right).className = 'muted';
        if (item.answers_differ) node('p', '答案不一致', right).className = 'error';
        const r = item.latest_review;
        node('h3', '复核', right);
        node('p', r ? (r.provider ? r.provider + ' / ' + r.model + ' · ' : '') + reviewText(r) + (r.state ? '（状态 ' + r.state + '）' : '') : '没有复核记录。', right);
        const form = node('div', undefined, right); form.className = 'grid';
        const answerLabel = node('label', '正确答案', form), answer = node('input', undefined, answerLabel); answer.maxLength = 500;
        const basisLabel = node('label', '依据', form), basis = node('input', undefined, basisLabel); basis.maxLength = 500;
        const row = node('div', undefined, right); row.className = 'actions';
        const button = node('button', '提交裁决', row); button.type = 'button'; button.className = 'primary';
        const note = node('span', '', row);
        let operationId = uuid();
        button.addEventListener('click', async () => {
          if (!actor()) { message('请填写操作人。', true); return; }
          button.disabled = true;
          try {
            const result = await call('/admin/question-bank/review/adjudicate', { card_id: item.card_id, operation_id: operationId, answer: answer.value.trim(), basis: basis.value.trim(), actor: actor() });
            note.textContent = (result.replayed ? '这次裁决已经提交过。' : '') + '已置为“人工裁决”。'; note.className = 'muted';
            answer.disabled = true; basis.disabled = true;
          } catch (error) { note.textContent = error.message; note.className = 'error'; operationId = uuid(); button.disabled = false; }
        });
        if (item.images) { for (const image of item.images.images) await picture(left, 'disputed', item.images.attempt_id, image); }
        else node('p', '题图已过期，不能显示。', left).className = 'muted';
      }
      message('已读取 ' + d.items.length + ' 张有争议的卡片。');
    } catch (error) { message(error.message, true); }
  });

  let pending = null;
  const resetDelete = () => { pending = null; $('confirm-delete').hidden = true; $('delete-preview').replaceChildren(); };
  $('device-id').addEventListener('input', resetDelete);
  $('preview-delete').addEventListener('click', async () => {
    resetDelete();
    const deviceId = Number($('device-id').value);
    try {
      const d = await call('/admin/question-bank/accounts/preview', { device_id: deviceId });
      table($('delete-preview'), ['作答', '题图（仍保存）', '任务', '抽查标记', '将删除的卡片', '保留的卡片（有其他账户作答）', '保留的复核记录（去掉与该账户作答的关联）'],
        [[d.attempts, d.images + '（' + d.stored_images + '）', d.jobs, d.marks, d.cards_deleted, d.cards_kept, d.reviews_detached]]);
      pending = { deviceId, operationId: uuid() };
      $('confirm-delete').hidden = false;
      message('请核对预览，填写原因后确认删除。');
    } catch (error) { message(error.message, true); }
  });
  $('confirm-delete').addEventListener('click', async () => {
    if (!pending) return;
    if (!actor()) { message('请填写操作人。', true); return; }
    if (!confirm('删除账户 ' + pending.deviceId + ' 的全部题库数据？此操作不能撤销。')) return;
    $('confirm-delete').disabled = true;
    try {
      const d = await call('/admin/question-bank/accounts/delete', { device_id: pending.deviceId, operation_id: pending.operationId, actor: actor(), reason: $('delete-reason').value.trim() });
      const x = d.deleted;
      message((d.replayed ? '这次删除已经执行过。' : '已删除。') + '作答 ' + x.attempts + '，题图 ' + x.images + '，任务 ' + x.jobs + '，抽查标记 ' + x.marks + '，卡片 ' + x.cards_deleted
        + '；保留 ' + x.cards_kept + ' 张有其他账户作答的卡片，' + x.reviews_detached + ' 条复核记录保留并去掉了与该账户作答的关联。操作号 ' + d.operation_id);
      pending = null; $('confirm-delete').hidden = true;
    } catch (error) { message(error.message, true); } finally { $('confirm-delete').disabled = false; }
  });
})();`;

const PAGE_STYLE = '.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;border-top:1px solid var(--line);padding-top:16px;margin-top:16px}'
  + '.match{border-top:1px solid var(--line);margin-top:16px;padding-top:12px}.match .pair{border-top:0;margin-top:0;padding-top:0}'
  + 'figure{margin:0 0 12px}img{max-width:100%;border:1px solid var(--line);border-radius:6px;background:#fff}'
  + '.stem{white-space:pre-wrap;overflow-wrap:anywhere}.options{list-style:none;padding:0;overflow-wrap:anywhere}'
  + '@media(max-width:760px){.pair{grid-template-columns:1fr}}';

export const QUESTION_BANK_PAGE_CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'self'; img-src blob:; "
  + "style-src 'unsafe-inline'; script-src 'sha256-" + createHash('sha256').update(QUESTION_BANK_SCRIPT).digest('base64') + "'";

export function renderQuestionBankPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NotchSPI · 题库</title><style>${REPORT_STYLE}${PAGE_STYLE}</style></head>
<body><main><a href="/admin">← 管理后台</a><h1>题库</h1><p class="muted">看数、抽查、复核、裁决和按账户删除。题目文字和题图只在本页显示，不写进日志。</p>
<div class="grid"><label class="key">管理员密钥<input id="key" type="password" autocomplete="off" spellcheck="false"></label><label class="key">操作人<input id="actor" maxlength="80" autocomplete="off"></label></div>
<p class="muted">密钥仅在当前页面使用。重新入队、抽查标记、复核、裁决和删除都会记下操作人。</p>
<p id="status" role="status" aria-live="polite" class="muted">输入管理员密钥后加载。</p>
<section><h2>看数</h2><div class="actions"><button id="load-stats" class="primary" type="button">加载看数</button></div><div id="stats"></div>
<h3>全部重新入队</h3><p class="muted">把全部失败的转写任务改回等待，调用次数归零。输出被长度上限截断的任务在上限提高前不放回。</p>
<div class="grid"><label>原因<input id="requeue-reason" maxlength="500"></label></div><div class="actions"><button id="requeue" type="button">全部重新入队</button></div></section>
<section><h2>抽查转写</h2><p class="muted">随机抽取计入看数的作答（非内部／测试账户、已转写），题图仍在保留期内。左边题图，右边转写。</p>
<div class="grid"><label>数量<input id="transcript-count" type="number" min="1" max="20" value="10"></label></div><div class="actions"><button id="load-transcripts" class="primary" type="button">随机抽取</button></div><div id="transcripts"></div></section>
<section><h2>抽查匹配</h2><p class="muted">随机抽取被判为同一张卡片的两条计入看数的作答（非内部／测试账户），并排显示两套题图。</p>
<div class="grid"><label>数量<input id="match-count" type="number" min="1" max="20" value="10"></label></div><div class="actions"><button id="load-matches" class="primary" type="button">随机抽取</button></div><div id="matches"></div></section>
<section><h2>复核</h2><p class="muted">列出重复出现的卡片（同一张可匹配卡片上计入看数的作答不少于 2 次），按出现次数从多到少。勾选后先预览卡片数和预计成本，确认后才生成复核任务，后台每轮最多同时进行一个复核调用。复核使用被复核那次作答原样的提示词和题图，不提供已有答案。已有答案不一致的卡片不调用模型，直接置为“有争议”。题图已过期的卡片不能复核。</p>
<div class="actions"><button id="load-review" class="primary" type="button">加载复核列表</button></div><div id="review"></div>
<div class="grid"><label>原因<input id="review-reason" maxlength="500"></label></div>
<div class="actions"><button id="preview-review" type="button">预览</button><button id="confirm-review" class="primary" type="button" hidden>确认复核</button></div><div id="review-preview"></div></section>
<section><h2>裁决</h2><p class="muted">列出“有争议”的卡片，显示题图、作答给出的答案和复核结果。填写正确答案和依据后置为“人工裁决”，写入卡片状态记录。</p>
<div class="actions"><button id="load-disputed" class="primary" type="button">加载有争议的卡片</button></div><div id="disputed"></div></section>
<section><h2>按账户删除</h2><p class="muted">删除该账户的作答、题图、任务和指向这些作答的抽查标记；只有该账户作答的卡片一并删除，有其他账户作答的卡片保留。保留卡片上复核过该账户作答的复核记录留下，只去掉与这条作答的关联。按账户编号删除，账户行已不存在时同样可以删除。操作写入审计记录。</p>
<div class="grid"><label>账户编号<input id="device-id" type="number" min="1" step="1"></label><label>原因<input id="delete-reason" maxlength="500"></label></div>
<div class="actions"><button id="preview-delete" type="button">预览</button><button id="confirm-delete" class="primary" type="button" hidden>确认删除</button></div><div id="delete-preview"></div></section>
</main><script>${QUESTION_BANK_SCRIPT}</script></body></html>`;
}
