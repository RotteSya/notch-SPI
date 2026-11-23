import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { BankBudgetHold } from './billing.ts';
import { captureCost } from './capture-service.ts';
import { TransientProviderError, type CaptureRequest, type Provider, type Usage } from './providers/types.ts';
import { parseTranscript, TRANSCRIBE_MAX_TOKENS, TRANSCRIBE_PROMPT } from './question-bank-prompt.ts';
import type { ClaimedTranscription } from './question-bank.ts';

/** One round: at most 60 s, 4 calls at a time, 20 s per call, 12 calls. */
export const QUESTION_BANK_ROUND = {
  totalMs: 60_000, concurrency: 4, callMs: 20_000, maxCalls: 12,
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
  log?: { warn(fields: Record<string, unknown>, message: string): void };
  now?: () => number;
}

export type QuestionBankRoundStop = 'drained' | 'call_limit' | 'deadline' | 'disabled' | 'degraded' | 'budget' | 'busy' | 'overload' | 'error';
export interface QuestionBankRoundResult {
  imagesCleared: number; recovered: number; calls: number; completed: number; failed: number; skipped: number;
  stop: QuestionBankRoundStop;
}

type Outcome = 'empty' | 'skipped' | 'completed' | 'failed' | { stop: 'budget' | 'busy' | 'overload' | 'error'; called: boolean };

/** The companion hold on the question-bank budget; the official hold uses the model attempt id itself. */
export function questionBankHoldId(modelAttemptId: string): string { return modelAttemptId + ':question_bank'; }

function holdIds(modelAttemptId: string): string[] { return [modelAttemptId, questionBankHoldId(modelAttemptId)]; }

/** Rate limiting, overload, or an exhausted upstream account: every further call this round would fail the same way. */
export function upstreamSaturated(error: unknown): boolean {
  if (error instanceof TransientProviderError) return error.kind === 'http' && [429, 502, 503, 504, 529].includes(error.status);
  return error instanceof Error && error.message === 'Upstream billing quota unavailable';
}

const running = new WeakMap<Store, Promise<QuestionBankRoundResult>>();

/**
 * Background question-bank work: image retention, then transcription. A second call for the same
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
  const result: QuestionBankRoundResult = { imagesCleared: 0, recovered: 0, calls: 0, completed: 0, failed: 0, skipped: 0, stop: 'drained' };
  // Retention runs even with the bank switched off: a stored image never outlives its period.
  result.imagesCleared = await store.questionBank.purgeImages(
    iso(started - config.questionBankImageRetentionDays * 86_400_000), iso(started), QUESTION_BANK_ROUND.imagePurgeLimit);
  if (!config.questionBankEnabled) return { ...result, stop: 'disabled' };
  for (const stale of await store.questionBank.recoverStaleTranscriptions(iso(clock()))) {
    result.recovered += 1;
    if (stale.deviceId !== null && stale.modelAttemptId) {
      await store.billing.finishBankAttempt({
        deviceId: stale.deviceId, attemptId: stale.modelAttemptId, holdIds: holdIds(stale.modelAttemptId),
        result: { status: 'unknown', inputTokens: null, outputTokens: null, costMicros: null }, actualMicros: null, started: true,
      });
    }
  }
  if (deps.providerDegraded !== null) return { ...result, stop: 'degraded' };
  if (config.questionBankDailyBudgetMicros <= 0) return { ...result, stop: 'budget' };
  let stop: QuestionBankRoundStop | null = null;
  // The first real reason wins; an empty queue seen by one worker does not hide another worker's reason.
  const halt = (reason: QuestionBankRoundStop) => { if (stop === null || stop === 'drained') stop = reason; };
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stop) return;
      if (result.calls >= QUESTION_BANK_ROUND.maxCalls) { halt('call_limit'); return; }
      // Start a call only when its whole time limit fits in the round.
      if (deadline - clock() < QUESTION_BANK_ROUND.callMs) { halt('deadline'); return; }
      result.calls += 1;
      let outcome: Outcome;
      try { outcome = await transcribeOne(deps, clock); }
      catch { outcome = { stop: 'error', called: false }; }
      if (outcome === 'completed') result.completed += 1;
      else if (outcome === 'failed') result.failed += 1;
      else {
        result.calls -= 1;
        if (outcome === 'skipped') { result.skipped += 1; continue; }
        if (outcome === 'empty') { stop ??= 'drained'; return; }
        if (outcome.called) result.calls += 1;
        halt(outcome.stop);
        if (outcome.stop === 'error') deps.log?.warn({ event: 'question_bank_round_failed' }, 'question_bank_round_failed');
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: QUESTION_BANK_ROUND.concurrency }, worker));
  return { ...result, stop: stop ?? 'drained' };
}

async function reservation(config: Config, provider: Provider, request: CaptureRequest): Promise<{ micros: number; tokens: number }> {
  let quote: { micros: number; inputUpper: number; outputUpper: number } | null = null;
  if (provider.estimateReservation && config.modelCostCurrency === 'USD') {
    try {
      const estimate = await provider.estimateReservation(request, config.modelPricingJSON);
      if (Number.isSafeInteger(estimate.micros) && estimate.micros > 0) quote = estimate;
    } catch { /* the configured attempt upper bound applies */ }
  }
  return {
    micros: quote?.micros ?? config.attemptBudgetUpperMicros,
    tokens: Math.max(quote?.inputUpper ?? 24_000, quote?.outputUpper ?? TRANSCRIBE_MAX_TOKENS),
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
    const timeout = AbortSignal.timeout(QUESTION_BANK_ROUND.callMs);
    let text = '', usage: Usage | null = null, error: unknown = null;
    try { usage = await provider.stream(request, delta => { text += delta; }, timeout); }
    catch (caught) { error = caught; }
    const transcript = error === null ? parseTranscript(text) : null;
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
        jobId: job.jobId, errorCode: error === null ? 'invalid_transcript' : timeout.aborted ? 'timeout' : 'upstream_error',
        now: iso(now), retryAt: iso(now + QUESTION_BANK_ROUND.retryDelayMs),
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
