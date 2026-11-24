import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { BankBudgetHold } from './billing.ts';
import { captureCost } from './capture-service.ts';
import { CAPTURE_DEADLINE } from './capture-deadline.ts';
import { composeObjectiveResult } from './objective-result.ts';
import { TransientProviderError, type CaptureRequest, type Provider, type Usage } from './providers/types.ts';
import { parseTranscript, TRANSCRIBE_MAX_TOKENS, TRANSCRIBE_PROMPT } from './question-bank-prompt.ts';
import { answerContent, type ClaimedReview, type ClaimedTranscription, type QuestionBankCard, type QuestionBankReviewResult, type ReviewSolve } from './question-bank.ts';

/**
 * One round: new calls start only within the first 60 s, 4 at a time, at most 12. A call already
 * started runs to its own limit: the first-progress limit its upstream declares (60 s for Terra,
 * which says nothing until its reasoning is complete), otherwise 20 s. A review call gets the answer
 * path's whole generation limit, and only one review call runs at a time.
 */
export const QUESTION_BANK_ROUND = {
  totalMs: 60_000, concurrency: 4, callMs: 20_000, maxCalls: 12,
  reviewCallMs: CAPTURE_DEADLINE.generationMs,
  /** A claimed job not finished by then counts one call and is retried; well past any round. */
  leaseMs: 5 * 60_000,
  /** A failed call is retried no earlier than the next scheduled round. */
  retryDelayMs: 10 * 60_000,
  imagePurgeLimit: 200,
} as const;

export interface QuestionBankRoundDeps {
  config: Config;
  store: Store;
  /** The current objective slot, the same provider and model that answer objective questions. */
  provider: Provider;
  providerDegraded: string | null;
  /** The configured reviewer, or null. It is called only for review jobs, which only an admin confirmation creates. */
  reviewProvider?: Provider | null;
  reviewProviderDegraded?: string | null;
  log?: { warn(fields: Record<string, unknown>, message: string): void };
  now?: () => number;
}

export type QuestionBankRoundStop = 'drained' | 'call_limit' | 'deadline' | 'disabled' | 'degraded' | 'budget' | 'busy' | 'overload' | 'error';
export interface QuestionBankRoundResult {
  /** `calls`…`stop` describe transcription; `reviews` describes admin-confirmed review jobs. */
  imagesCleared: number; recovered: number; calls: number; completed: number; failed: number; skipped: number;
  stop: QuestionBankRoundStop;
  reviews: { calls: number; verified: number; disputed: number; failed: number; skipped: number; stop: QuestionBankRoundStop };
}

type Stop = { stop: 'budget' | 'busy' | 'overload' | 'error'; called: boolean };
type Outcome = 'empty' | 'skipped' | 'completed' | 'failed' | Stop;
type ReviewRoundOutcome = 'empty' | 'skipped' | 'failed' | { state: QuestionBankCard['state'] | null; called: boolean } | Stop;

/** The companion hold on the question-bank budget; the official hold uses the model attempt id itself. */
export function questionBankHoldId(modelAttemptId: string): string { return modelAttemptId + ':question_bank'; }
/** The companion hold on the review budget, which transcription never uses. */
export function questionBankReviewHoldId(modelAttemptId: string): string { return modelAttemptId + ':question_bank_review'; }

function holdIds(modelAttemptId: string, kind: 'transcribe' | 'review' = 'transcribe'): string[] {
  return [modelAttemptId, kind === 'review' ? questionBankReviewHoldId(modelAttemptId) : questionBankHoldId(modelAttemptId)];
}

/** The same allowance the answer path gives this upstream before its first sign of life. */
export function questionBankCallLimitMs(provider: Provider): number {
  return provider.firstProgressMs ?? QUESTION_BANK_ROUND.callMs;
}

/** Rate limiting, overload, or an exhausted upstream account: every further call this round would fail the same way. */
export function upstreamSaturated(error: unknown): boolean {
  if (error instanceof TransientProviderError) return error.kind === 'http' && [429, 502, 503, 504, 529].includes(error.status);
  return error instanceof Error && error.message === 'Upstream billing quota unavailable';
}

const running = new WeakMap<Store, Promise<QuestionBankRoundResult>>();

/**
 * Background question-bank work: image retention, then transcription and admin-confirmed reviews. A second call for the same
 * store while a round runs in this process joins that round. Callers start it only after their own
 * response is complete, so nothing here can delay or change an answer or the reaper's reply.
 */
export function runQuestionBankRound(deps: QuestionBankRoundDeps): Promise<QuestionBankRoundResult> {
  const current = running.get(deps.store);
  if (current) return current;
  const next = round(deps).finally(() => { running.delete(deps.store); });
  running.set(deps.store, next);
  return next;
}

async function round(deps: QuestionBankRoundDeps): Promise<QuestionBankRoundResult> {
  const { config, store } = deps;
  const clock = deps.now ?? Date.now;
  const iso = (ms: number) => new Date(ms).toISOString();
  const started = clock(), deadline = started + QUESTION_BANK_ROUND.totalMs;
  const result: QuestionBankRoundResult = {
    imagesCleared: 0, recovered: 0, calls: 0, completed: 0, failed: 0, skipped: 0, stop: 'drained',
    reviews: { calls: 0, verified: 0, disputed: 0, failed: 0, skipped: 0, stop: 'drained' },
  };
  // Retention runs even with the bank switched off: a stored image never outlives its period.
  result.imagesCleared = await store.questionBank.purgeImages(
    iso(started - config.questionBankImageRetentionDays * 86_400_000), iso(started), QUESTION_BANK_ROUND.imagePurgeLimit);
  if (!config.questionBankEnabled) return { ...result, stop: 'disabled', reviews: { ...result.reviews, stop: 'disabled' } };
  for (const stale of await store.questionBank.recoverStaleJobs(iso(clock()))) {
    result.recovered += 1;
    if (stale.deviceId !== null && stale.modelAttemptId) {
      await store.billing.finishBankAttempt({
        deviceId: stale.deviceId, attemptId: stale.modelAttemptId, holdIds: holdIds(stale.modelAttemptId, stale.kind),
        result: { status: 'unknown', inputTokens: null, outputTokens: null, costMicros: null }, actualMicros: null, started: true,
      });
    }
  }
  const reviewer = deps.reviewProvider ?? null;
  let stop: QuestionBankRoundStop | null = deps.providerDegraded !== null ? 'degraded' : config.questionBankDailyBudgetMicros <= 0 ? 'budget' : null;
  let reviewStop: QuestionBankRoundStop | null = reviewer === null ? 'disabled' : (deps.reviewProviderDegraded ?? null) !== null ? 'degraded'
    : config.questionBankReviewDailyBudgetMicros <= 0 ? 'budget' : null;
  const finish = () => ({ ...result, stop: stop ?? 'drained', reviews: { ...result.reviews, stop: reviewStop ?? 'drained' } });
  if (stop !== null && reviewStop !== null) return finish();
  // The first real reason wins; an empty queue seen by one worker does not hide another worker's reason.
  const halt = (reason: QuestionBankRoundStop) => { if (stop === null || stop === 'drained') stop = reason; };
  const haltReview = (reason: QuestionBankRoundStop) => { if (reviewStop === null || reviewStop === 'drained') reviewStop = reason; };
  // One review call at a time, so transcription keeps the other workers.
  let reviewing = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      const reviewNext = reviewStop === null && !reviewing;
      if (!reviewNext && stop) return;
      if (result.calls + result.reviews.calls >= QUESTION_BANK_ROUND.maxCalls) { halt('call_limit'); haltReview('call_limit'); return; }
      // The round limit governs starting a call; one already started finishes within its own limit.
      if (clock() >= deadline) { halt('deadline'); haltReview('deadline'); return; }
      if (reviewNext) {
        reviewing = true;
        result.reviews.calls += 1;
        let outcome: ReviewRoundOutcome;
        try { outcome = await reviewOne(deps, reviewer!, clock); }
        catch { outcome = { stop: 'error', called: false }; }
        finally { reviewing = false; }
        if (outcome === 'failed') result.reviews.failed += 1;
        else if (typeof outcome === 'object' && 'state' in outcome) {
          if (!outcome.called) result.reviews.calls -= 1;
          if (outcome.state === 'verified_model') result.reviews.verified += 1;
          else if (outcome.state === 'disputed') result.reviews.disputed += 1;
        } else {
          result.reviews.calls -= 1;
          if (outcome === 'skipped') result.reviews.skipped += 1;
          else if (outcome === 'empty') haltReview('drained');
          else {
            if (outcome.called) result.reviews.calls += 1;
            haltReview(outcome.stop);
            if (outcome.stop === 'error') deps.log?.warn({ event: 'question_bank_review_failed' }, 'question_bank_review_failed');
          }
        }
        continue;
      }
      result.calls += 1;
      let outcome: Outcome;
      try { outcome = await transcribeOne(deps, clock); }
      catch { outcome = { stop: 'error', called: false }; }
      if (outcome === 'completed') result.completed += 1;
      else if (outcome === 'failed') result.failed += 1;
      else {
        result.calls -= 1;
        if (outcome === 'skipped') { result.skipped += 1; continue; }
        if (outcome === 'empty') { stop ??= 'drained'; continue; }
        if (outcome.called) result.calls += 1;
        halt(outcome.stop);
        if (outcome.stop === 'error') deps.log?.warn({ event: 'question_bank_round_failed' }, 'question_bank_round_failed');
      }
    }
  };
  await Promise.all(Array.from({ length: QUESTION_BANK_ROUND.concurrency }, worker));
  return finish();
}

/**
 * The budget reservation for one call: the provider's own estimate, else the configured attempt upper
 * bound. `inputUpper` is the estimate's input token bound, null without an estimate.
 */
export async function reservation(config: Config, provider: Provider, request: CaptureRequest, outputFallback = TRANSCRIBE_MAX_TOKENS): Promise<{ micros: number; tokens: number; inputUpper: number | null }> {
  let quote: { micros: number; inputUpper: number; outputUpper: number } | null = null;
  if (provider.estimateReservation && config.modelCostCurrency === 'USD') {
    try {
      const estimate = await provider.estimateReservation(request, config.modelPricingJSON);
      if (Number.isSafeInteger(estimate.micros) && estimate.micros > 0) quote = estimate;
    } catch { /* the configured attempt upper bound applies */ }
  }
  return {
    micros: quote?.micros ?? config.attemptBudgetUpperMicros,
    tokens: Math.max(quote?.inputUpper ?? 24_000, quote?.outputUpper ?? outputFallback),
    inputUpper: quote?.inputUpper ?? null,
  };
}

async function transcribeOne(deps: QuestionBankRoundDeps, clock: () => number): Promise<Outcome> {
  const { config, store, provider } = deps;
  const bank = store.questionBank, iso = (ms: number) => new Date(ms).toISOString();
  const modelAttemptId = randomUUID();
  const claimedAt = clock();
  const job: ClaimedTranscription | null = await bank.claimTranscription({
    now: iso(claimedAt), leaseUntil: iso(claimedAt + QUESTION_BANK_ROUND.leaseMs), modelAttemptId,
  });
  if (!job) return 'empty';
  let begun = false;
  try {
    if (!job.images.length || job.images.some(image => !image.bytes)) {
      await bank.skipTranscription(job.jobId, 'image_deleted', iso(clock()));
      return 'skipped';
    }
    const model = config.objectiveModel;
    const request: CaptureRequest = {
      system: TRANSCRIBE_PROMPT.system, task: TRANSCRIBE_PROMPT.task, maxTokens: TRANSCRIBE_MAX_TOKENS, reasoningEffort: 'low',
      purpose: 'transcribe', images: job.images.map(image => ({ base64: image.bytes!.toString('base64'), mediaType: image.mediaType })),
    };
    const quote = await reservation(config, provider, request);
    if (quote.micros <= 0) {
      await bank.releaseTranscription(job.jobId, iso(clock()));
      return { stop: 'budget', called: false };
    }
    // Question-bank calls queue behind every user: the share an unpaid device may use, and on the
    // official budget only below the headroom a guarded answer would leave.
    const share = Math.min(100, Math.max(0, config.unpaidSharePercent)) / 100;
    const channel = JSON.stringify(['question_bank', provider.name, model]);
    const holds: BankBudgetHold[] = [
      { holdId: modelAttemptId, scope: 'official', limitMicros: config.modelDailyBudgetMicros, channel,
        share: share * (config.requestBudgetMode === 'guarded-request' ? 0.8 : 1) },
      { holdId: questionBankHoldId(modelAttemptId), scope: 'question_bank', limitMicros: config.questionBankDailyBudgetMicros, channel, share: 1 },
    ];
    const start = await store.billing.beginBankAttempt({
      deviceId: job.deviceId, requestId: job.requestId,
      attempt: { attemptId: modelAttemptId, captureId: job.captureId, purpose: 'transcribe', provider: provider.name, model,
        policyVersion: config.clientConfigRevision, currency: config.modelCostCurrency, pricingVersion: config.modelPricingVersion },
      reservedMicros: quote.micros, currency: config.modelCostCurrency, now: clock(), utcOffsetMinutes: config.modelBudgetUtcOffsetMinutes,
      holds, capacityTokens: quote.tokens, capacityShare: share,
    });
    if (start === 'missing') {
      await bank.skipTranscription(job.jobId, 'attempt_missing', iso(clock()));
      return 'skipped';
    }
    if (start !== 'started') {
      await bank.releaseTranscription(job.jobId, iso(clock()));
      return { stop: start, called: false };
    }
    begun = true;
    const timeout = AbortSignal.timeout(questionBankCallLimitMs(provider));
    let text = '', usage: Usage | null = null, error: unknown = null;
    try { usage = await provider.stream(request, delta => { text += delta; }, timeout); }
    catch (caught) { error = caught; }
    // Cut at the token limit: the same request would be cut again, so it is not retried.
    const truncated = error === null && usage?.finishReason === 'length';
    const transcript = error === null && !truncated ? parseTranscript(text) : null;
    const cost = usage ? captureCost(config.modelPricingJSON, provider.name, model, usage) ?? null : null;
    await store.billing.finishBankAttempt({
      deviceId: job.deviceId, attemptId: modelAttemptId, holdIds: holdIds(modelAttemptId), started: true, actualMicros: cost,
      result: { status: transcript ? 'succeeded' : 'failed', inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null, costMicros: cost === null ? null : String(cost) },
    });
    const now = clock();
    if (upstreamSaturated(error)) {
      // Not the question's fault: back to pending without counting this call, and stop the round.
      await bank.releaseTranscription(job.jobId, iso(now));
      return { stop: 'overload', called: true };
    }
    if (!transcript) {
      await bank.failTranscription({
        jobId: job.jobId,
        errorCode: truncated ? 'output_truncated' : error === null ? 'invalid_transcript' : timeout.aborted ? 'timeout' : 'upstream_error',
        now: iso(now), retryAt: iso(now + QUESTION_BANK_ROUND.retryDelayMs),
        ...(truncated ? { truncatedAtMaxTokens: TRANSCRIBE_MAX_TOKENS } : {}),
      });
      return 'failed';
    }
    await bank.completeTranscription({ jobId: job.jobId, transcript, now: iso(now) });
    return 'completed';
  } catch {
    // Before the model attempt exists the job simply goes back; after it, the lease expires and
    // the next round closes the attempt and counts the call.
    if (!begun) await bank.releaseTranscription(job.jobId, iso(clock())).catch(() => undefined);
    return { stop: 'error', called: begun };
  }
}

/**
 * The review request: exactly the reviewed solve's own request, its saved system and task, effort
 * and images, with purpose `review`. Nothing is appended and no answer is included.
 */
export function reviewRequest(solve: ReviewSolve): CaptureRequest {
  return {
    system: solve.system, task: solve.task, purpose: 'review',
    images: solve.images.map(image => ({ base64: image.bytes.toString('base64'), mediaType: image.mediaType })),
    ...(solve.reasoningEffort ? { reasoningEffort: solve.reasoningEffort } : {}),
  };
}

/**
 * Compare a reviewer's raw output with the card's one production answer content. Only a v1 result
 * in state `ready` with a final answer can agree; anything else is `not_ready`.
 */
export function judgeReview(raw: string, options: ReviewSolve['options'], answers: string[], provider: string, model: string): QuestionBankReviewResult {
  const composed = composeObjectiveResult(raw, true);
  const parsed = composed.parserPath === 'v1' ? composed.result : null;
  const base = { provider, model, answers, state: parsed?.state ?? null, kind: parsed?.kind ?? null, answer: composed.finalAnswer, content: null };
  if (!parsed || parsed.state !== 'ready' || !composed.finalAnswer) return { ...base, outcome: 'not_ready' };
  const content = answerContent(composed.finalAnswer, parsed.kind, options);
  return { ...base, content, outcome: answers.length === 1 && content === answers[0] ? 'agrees' : 'disagrees' };
}

async function reviewOne(deps: QuestionBankRoundDeps, reviewer: Provider, clock: () => number): Promise<ReviewRoundOutcome> {
  const { config, store } = deps;
  const bank = store.questionBank, iso = (ms: number) => new Date(ms).toISOString();
  const modelAttemptId = randomUUID();
  const claimedAt = clock();
  const job: ClaimedReview | null = await bank.claimReview({
    now: iso(claimedAt), leaseUntil: iso(claimedAt + QUESTION_BANK_ROUND.leaseMs), modelAttemptId,
  });
  if (!job) return 'empty';
  let begun = false;
  try {
    if (!job.solve) {
      await bank.skipTranscription(job.jobId, 'image_deleted', iso(clock()));
      return 'skipped';
    }
    const solve = job.solve;
    if (job.answers.length !== 1) {
      // The card's own production answers already differ: disputed without calling the reviewer.
      const state = await bank.completeReview({
        jobId: job.jobId, now: iso(clock()), called: false,
        result: { outcome: 'answers_differ', provider: null, model: null, state: null, kind: null, answer: null, content: null, answers: job.answers },
      });
      return { state, called: false };
    }
    const model = config.questionBankReviewModel;
    const request = reviewRequest(solve);
    const quote = await reservation(config, reviewer, request, config.objectiveMaxTokens);
    if (quote.micros <= 0) {
      await bank.releaseTranscription(job.jobId, iso(clock()));
      return { stop: 'budget', called: false };
    }
    // Like transcription, a review queues behind every user on the shared budget and capacity.
    const share = Math.min(100, Math.max(0, config.unpaidSharePercent)) / 100;
    const channel = JSON.stringify(['question_bank_review', reviewer.name, model]);
    const holds: BankBudgetHold[] = [
      { holdId: modelAttemptId, scope: 'official', limitMicros: config.modelDailyBudgetMicros, channel,
        share: share * (config.requestBudgetMode === 'guarded-request' ? 0.8 : 1) },
      { holdId: questionBankReviewHoldId(modelAttemptId), scope: 'question_bank_review', limitMicros: config.questionBankReviewDailyBudgetMicros, channel, share: 1 },
    ];
    const start = await store.billing.beginBankAttempt({
      deviceId: solve.deviceId, requestId: solve.requestId,
      attempt: { attemptId: modelAttemptId, captureId: solve.captureId, purpose: 'review', provider: reviewer.name, model,
        policyVersion: config.clientConfigRevision, currency: config.modelCostCurrency, pricingVersion: config.modelPricingVersion },
      reservedMicros: quote.micros, currency: config.modelCostCurrency, now: clock(), utcOffsetMinutes: config.modelBudgetUtcOffsetMinutes,
      holds, capacityTokens: quote.tokens, capacityShare: share,
    });
    if (start === 'missing') {
      await bank.skipTranscription(job.jobId, 'attempt_missing', iso(clock()));
      return 'skipped';
    }
    if (start !== 'started') {
      await bank.releaseTranscription(job.jobId, iso(clock()));
      return { stop: start, called: false };
    }
    begun = true;
    const timeout = AbortSignal.timeout(QUESTION_BANK_ROUND.reviewCallMs);
    let text = '', usage: Usage | null = null, error: unknown = null;
    try { usage = await reviewer.stream(request, delta => { text += delta; }, timeout); }
    catch (caught) { error = caught; }
    // As on the answer path, a reported finish other than `stop` leaves no usable result.
    const cut = usage?.finishReason !== undefined && usage.finishReason !== 'stop';
    const cost = usage ? captureCost(config.modelPricingJSON, reviewer.name, model, usage) ?? null : null;
    await store.billing.finishBankAttempt({
      deviceId: solve.deviceId, attemptId: modelAttemptId, holdIds: holdIds(modelAttemptId, 'review'), started: true, actualMicros: cost,
      result: { status: error === null && !cut ? 'succeeded' : 'failed', inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null, costMicros: cost === null ? null : String(cost) },
    });
    const now = clock();
    if (upstreamSaturated(error)) {
      await bank.releaseTranscription(job.jobId, iso(now));
      return { stop: 'overload', called: true };
    }
    if (error !== null) {
      await bank.failTranscription({
        jobId: job.jobId, errorCode: timeout.aborted ? 'timeout' : 'upstream_error', now: iso(now), retryAt: iso(now + QUESTION_BANK_ROUND.retryDelayMs),
      });
      return 'failed';
    }
    const state = await bank.completeReview({
      jobId: job.jobId, now: iso(now), called: true, result: judgeReview(cut ? '' : text, solve.options, job.answers, reviewer.name, model),
    });
    return { state, called: true };
  } catch {
    if (!begun) await bank.releaseTranscription(job.jobId, iso(clock())).catch(() => undefined);
    return { stop: 'error', called: begun };
  }
}
