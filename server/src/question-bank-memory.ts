import { randomUUID } from 'node:crypto';
import {
  blockedForReview, cardAnswers, imageDigest, operationFingerprint, promptDigest, questionBankCardViews, questionBankCosts, questionFingerprint, reviewSolveOf, sampleOf,
  cardUnmatchableReason, transcriptMatchable, TRANSCRIPTION_MAX_CALLS,
  type ClaimedReview, type ClaimedTranscription, type QuestionBankCard, type QuestionBankCardEvent, type QuestionBankCounts, type QuestionBankFootprint,
  type QuestionBankInventory, type QuestionBankMark, type QuestionBankMatchSample, type QuestionBankOccurrenceRow, type QuestionBankOperation,
  type QuestionBankOperationKind, type QuestionBankOperationRecord, type QuestionBankReviewConfirm, type QuestionBankReviewData,
  type ModelCallCost, type QuestionBankReviewResult, type QuestionBankSample, type ReviewSolve,
  type QuestionBankSolveInput, type QuestionBankStore, type QuestionBankTranscript, type StaleTranscription,
  type StoredQuestionBankAttempt, type StoredQuestionBankImage, type TranscriptionError,
} from './question-bank.ts';

interface PromptRow { sha256: string; system: string; task: string }
interface AttemptRow extends Omit<StoredQuestionBankAttempt,
  'system' | 'task' | 'images' | 'jobKind' | 'jobStatus' | 'jobAttemptCount' | 'jobErrorCode'> {}
interface ImageRow extends StoredQuestionBankImage { attemptId: string; createdAt: string; deletedAt: string | null }
interface JobRow {
  /** The solve a job works on; a review job gets one only when it is claimed. */
  jobId: string; attemptId: string | null; kind: string; status: string; attemptCount: number; cardId: string | null;
  modelAttemptId: string | null; createdAt: string; updatedAt: string; nextAttemptAt: string;
  leaseExpiresAt: string | null; errorCode: string | null; truncatedMaxTokens: number | null;
  operationId: string | null; review: QuestionBankReviewResult | null;
}
interface OperationRow {
  operationId: string; kind: QuestionBankOperationKind; deviceId: number | null; actor: string; reason: string;
  fingerprint: string; createdAt: string; before: unknown; after: unknown;
}
/** A model call as the question-bank costs read it. */
export interface MemoryBankAttempt {
  purpose: string; currency: string; costMicros: string | null; provider: string; model: string; status: string; startedAt: string;
}

// Every method finishes its reads and writes without an await, like one SQL transaction.
export class MemoryQuestionBankStore implements QuestionBankStore {
  private prompts = new Map<string, PromptRow>();
  private attempts = new Map<string, AttemptRow>();
  private images: ImageRow[] = [];
  private jobs: JobRow[] = [];
  private cards = new Map<string, QuestionBankCard>();
  private cardEventRows: QuestionBankCardEvent[] = [];
  private operationRows = new Map<string, OperationRow>();
  private markRows: QuestionBankMark[] = [];
  private readonly deviceId: (token: string) => number | null;
  private readonly internal: (deviceId: number) => boolean;
  private readonly bankAttempts: () => MemoryBankAttempt[];

  constructor(
    deviceId: (token: string) => number | null,
    internal: (deviceId: number) => boolean = () => false,
    bankAttempts: () => MemoryBankAttempt[] = () => [],
  ) {
    this.deviceId = deviceId;
    this.internal = internal;
    this.bankAttempts = bankAttempts;
  }

  async recordSolve(input: QuestionBankSolveInput): Promise<void> {
    const deviceId = this.deviceId(input.token);
    if (deviceId === null) throw new Error('Question bank device missing');
    if ([...this.attempts.values()].some(row => row.captureId === input.captureId)) return;
    const sha256 = promptDigest(input.system, input.task);
    if (!this.prompts.has(sha256)) this.prompts.set(sha256, { sha256, system: input.system, task: input.task });
    const attemptId = randomUUID();
    this.attempts.set(attemptId, {
      attemptId, deviceId, captureId: input.captureId, requestId: input.requestId, createdAt: input.createdAt,
      durationMs: input.durationMs, provider: input.provider, model: input.model, reasoningEffort: input.reasoningEffort,
      configRevision: input.configRevision, resultProtocol: input.resultProtocol, resultState: input.resultState,
      questionKind: input.questionKind, parserPath: input.parserPath, modelOutput: input.modelOutput,
      finalAnswer: input.finalAnswer, explanation: null, answerAttemptId: input.answerAttemptId,
      inputTokens: input.inputTokens, outputTokens: input.outputTokens, promptSha256: sha256,
      cardId: null, transcript: null,
    });
    input.images.forEach((image, ordinal) => {
      this.images.push({
        attemptId, ordinal, mediaType: image.mediaType, byteCount: image.bytes.length,
        sha256: imageDigest(image.bytes), bytes: Buffer.from(image.bytes), createdAt: input.createdAt, deletedAt: null,
      });
    });
    const now = new Date().toISOString();
    this.jobs.push({
      jobId: randomUUID(), attemptId, kind: 'transcribe', status: 'pending', attemptCount: 0, cardId: null, modelAttemptId: null,
      createdAt: now, updatedAt: now, nextAttemptAt: now, leaseExpiresAt: null, errorCode: null, truncatedMaxTokens: null,
      operationId: null, review: null,
    });
  }

  async appendExplanation(input: { token: string; captureId: string; explanation: string }): Promise<void> {
    const deviceId = this.deviceId(input.token);
    if (deviceId === null) return;
    const row = [...this.attempts.values()].find(item => item.captureId === input.captureId && item.deviceId === deviceId);
    if (row && row.explanation === null) row.explanation = input.explanation;
  }

  async findByCapture(captureId: string): Promise<StoredQuestionBankAttempt | null> {
    const row = [...this.attempts.values()].find(item => item.captureId === captureId);
    if (!row) return null;
    const prompt = this.prompts.get(row.promptSha256);
    if (!prompt) return null;
    const job = this.jobs.find(item => item.attemptId === row.attemptId && item.kind === 'transcribe') ?? null;
    const images = this.images.filter(item => item.attemptId === row.attemptId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(image => ({
        ordinal: image.ordinal, mediaType: image.mediaType, byteCount: image.byteCount, sha256: image.sha256,
        bytes: image.bytes ? Buffer.from(image.bytes) : null,
      }));
    return {
      ...row, transcript: row.transcript ? structuredClone(row.transcript) : null, system: prompt.system, task: prompt.task, images,
      jobKind: job?.kind ?? null, jobStatus: job?.status ?? null, jobAttemptCount: job?.attemptCount ?? null, jobErrorCode: job?.errorCode ?? null,
    };
  }

  async findCard(cardId: string): Promise<QuestionBankCard | null> {
    const found = this.cards.get(cardId);
    return found ? structuredClone(found) : null;
  }

  async counts(): Promise<QuestionBankCounts> {
    return { attempts: this.attempts.size, images: this.images.length, prompts: this.prompts.size, jobs: this.jobs.length, cards: this.cards.size };
  }

  async purgeImages(cutoff: string, now: string, limit: number): Promise<number> {
    // As in SQL: the oldest `limit` due image rows pick the solves, and every due image of those solves is cleared.
    const due = new Set(this.images.filter(image => image.bytes && image.createdAt < cutoff)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit).map(image => image.attemptId));
    let cleared = 0;
    for (const image of this.images) {
      if (image.bytes && image.createdAt < cutoff && due.has(image.attemptId)) { image.bytes = null; image.deletedAt = now; cleared += 1; }
    }
    return cleared;
  }

  async recoverStaleJobs(now: string): Promise<StaleTranscription[]> {
    const stale: StaleTranscription[] = [];
    for (const job of this.jobs.filter(item => item.status === 'running' && item.leaseExpiresAt !== null && item.leaseExpiresAt <= now)
      .sort((a, b) => a.leaseExpiresAt!.localeCompare(b.leaseExpiresAt!)).slice(0, 50)) {
      job.attemptCount += 1;
      job.status = job.attemptCount >= TRANSCRIPTION_MAX_CALLS ? 'failed' : 'pending';
      Object.assign(job, { leaseExpiresAt: null, errorCode: 'lease_expired', nextAttemptAt: now, updatedAt: now });
      stale.push({
        jobId: job.jobId, kind: job.kind === 'review' ? 'review' : 'transcribe',
        deviceId: job.attemptId === null ? null : this.attempts.get(job.attemptId)?.deviceId ?? null, modelAttemptId: job.modelAttemptId,
      });
    }
    return stale;
  }

  async claimTranscription(input: { now: string; leaseUntil: string; modelAttemptId: string }): Promise<ClaimedTranscription | null> {
    const due = this.jobs.filter(job => job.kind === 'transcribe' && job.status === 'pending' && job.nextAttemptAt <= input.now)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId));
    for (const job of due) {
      Object.assign(job, { status: 'running', leaseExpiresAt: input.leaseUntil, modelAttemptId: input.modelAttemptId, updatedAt: input.now });
      const solve = job.attemptId === null ? undefined : this.attempts.get(job.attemptId);
      if (!solve) {
        Object.assign(job, { status: 'skipped', errorCode: 'attempt_missing', leaseExpiresAt: null, updatedAt: input.now });
        continue;
      }
      return {
        jobId: job.jobId, attemptCount: job.attemptCount, modelAttemptId: input.modelAttemptId, bankAttemptId: solve.attemptId,
        deviceId: solve.deviceId, requestId: solve.requestId, captureId: solve.captureId,
        images: this.images.filter(image => image.attemptId === solve.attemptId).sort((a, b) => a.ordinal - b.ordinal)
          .map(image => ({ mediaType: image.mediaType, bytes: image.bytes ? Buffer.from(image.bytes) : null })),
      };
    }
    return null;
  }

  private running(jobId: string): JobRow | undefined {
    return this.jobs.find(job => job.jobId === jobId && job.status === 'running');
  }

  async releaseTranscription(jobId: string, now: string): Promise<void> {
    const job = this.running(jobId);
    if (job) Object.assign(job, { status: 'pending', leaseExpiresAt: null, modelAttemptId: null, updatedAt: now });
  }

  async failTranscription(input: { jobId: string; errorCode: TranscriptionError; now: string; retryAt: string; truncatedAtMaxTokens?: number }): Promise<'pending' | 'failed' | null> {
    const job = this.running(input.jobId);
    if (!job) return null;
    job.attemptCount += 1;
    const truncatedMaxTokens = input.truncatedAtMaxTokens ?? null;
    const status = truncatedMaxTokens !== null || job.attemptCount >= TRANSCRIPTION_MAX_CALLS ? 'failed' : 'pending';
    Object.assign(job, { status, errorCode: input.errorCode, truncatedMaxTokens, leaseExpiresAt: null, nextAttemptAt: input.retryAt, updatedAt: input.now });
    return status;
  }

  async skipTranscription(jobId: string, errorCode: TranscriptionError, now: string): Promise<void> {
    const job = this.running(jobId);
    if (job) Object.assign(job, { status: 'skipped', errorCode, leaseExpiresAt: null, updatedAt: now });
  }

  async completeTranscription(input: { jobId: string; transcript: QuestionBankTranscript; now: string }): Promise<string | null> {
    const job = this.running(input.jobId);
    if (!job) return null;
    const solve = job.attemptId === null ? undefined : this.attempts.get(job.attemptId);
    if (!solve) {
      Object.assign(job, { status: 'skipped', errorCode: 'attempt_missing', leaseExpiresAt: null, updatedAt: input.now });
      return null;
    }
    const transcript = structuredClone(input.transcript);
    const matchable = transcriptMatchable(transcript);
    const fingerprint = matchable ? questionFingerprint(transcript) : null;
    let found = fingerprint ? [...this.cards.values()].find(item => item.fingerprint === fingerprint) : undefined;
    if (!found) {
      found = {
        cardId: randomUUID(), fingerprint, matchable, language: transcript.language, stem: transcript.stem,
        options: structuredClone(transcript.options), hasFigure: transcript.has_figure, transcriptStatus: transcript.status,
        state: 'unverified', createdAt: input.now,
      };
      this.cards.set(found.cardId, found);
    }
    solve.cardId = found.cardId;
    solve.transcript = transcript;
    job.attemptCount += 1;
    Object.assign(job, { status: 'done', cardId: found.cardId, errorCode: null, leaseExpiresAt: null, updatedAt: input.now });
    return found.cardId;
  }

  async requeueFailedTranscriptions(now: string, maxTokens: number): Promise<number> {
    return this.requeueFailedJobs(now, maxTokens);
  }

  private requeueFailedJobs(now: string, maxTokens: number): number {
    const failed = this.jobs.filter(job => job.kind === 'transcribe' && job.status === 'failed'
      && !(job.truncatedMaxTokens !== null && job.truncatedMaxTokens >= maxTokens));
    for (const job of failed) Object.assign(job, { status: 'pending', attemptCount: 0, errorCode: null, truncatedMaxTokens: null, nextAttemptAt: now, updatedAt: now });
    return failed.length;
  }

  async occurrenceRows(): Promise<QuestionBankOccurrenceRow[]> {
    return [...this.attempts.values()].map(row => {
      const card = row.cardId ? this.cards.get(row.cardId) : undefined;
      return {
        attemptId: row.attemptId, deviceId: row.deviceId, createdAt: row.createdAt, internal: this.internal(row.deviceId),
        jobStatus: this.jobs.find(job => job.attemptId === row.attemptId && job.kind === 'transcribe')?.status ?? null,
        jobErrorCode: this.jobs.find(job => job.attemptId === row.attemptId && job.kind === 'transcribe')?.errorCode ?? null,
        cardId: row.cardId, matchable: card?.matchable ?? false, unmatchable: card ? cardUnmatchableReason(card) : null,
      };
    });
  }

  async inventory(): Promise<QuestionBankInventory> {
    const cards = new Map<string, QuestionBankInventory['cards'][number]>();
    for (const card of this.cards.values()) {
      const key = JSON.stringify([card.state, card.matchable]);
      const row = cards.get(key) ?? { state: card.state, matchable: card.matchable, count: 0 };
      row.count += 1;
      cards.set(key, row);
    }
    const stored = this.images.filter(image => image.bytes);
    return {
      cards: [...cards.values()].sort((a, b) => a.state.localeCompare(b.state) || Number(a.matchable) - Number(b.matchable)),
      images: { stored: stored.length, storedBytes: stored.reduce((sum, image) => sum + image.byteCount, 0), cleared: this.images.length - stored.length },
      costs: questionBankCosts(this.bankAttempts().filter(attempt => attempt.purpose === 'transcribe' || attempt.purpose === 'review')),
    };
  }

  /** In the statistics denominator: transcribed, and the account is not internal now. Spot checks draw from these alone. */
  private counted(row: AttemptRow): boolean {
    return row.transcript !== null && !this.internal(row.deviceId);
  }

  private hasStoredImage(attemptId: string): boolean {
    return this.images.some(image => image.attemptId === attemptId && image.bytes);
  }

  private sample(attemptId: string): QuestionBankSample | null {
    const row = this.attempts.get(attemptId);
    if (!row) return null;
    return {
      attemptId, createdAt: row.createdAt, cardId: row.cardId, transcript: row.transcript ? structuredClone(row.transcript) : null,
      images: this.images.filter(image => image.attemptId === attemptId).sort((a, b) => a.ordinal - b.ordinal)
        .map(image => ({ ordinal: image.ordinal, mediaType: image.mediaType, byteCount: image.byteCount, stored: image.bytes !== null })),
    };
  }

  async sampleTranscripts(count: number): Promise<QuestionBankSample[]> {
    const ready = [...this.attempts.values()].filter(row => this.counted(row) && this.hasStoredImage(row.attemptId));
    return sampleOf(ready, count).map(row => this.sample(row.attemptId)!);
  }

  async sampleMatches(count: number): Promise<QuestionBankMatchSample[]> {
    const byCard = new Map<string, string[]>();
    for (const row of this.attempts.values()) {
      if (!row.cardId || !this.counted(row) || !this.cards.get(row.cardId)?.matchable || !this.hasStoredImage(row.attemptId)) continue;
      byCard.set(row.cardId, [...byCard.get(row.cardId) ?? [], row.attemptId]);
    }
    return sampleOf([...byCard].filter(([, ids]) => ids.length >= 2), count).map(([cardId, ids]) => {
      const [first, second] = sampleOf(ids, 2).sort();
      return { cardId, first: this.sample(first!)!, second: this.sample(second!)! };
    });
  }

  async image(attemptId: string, ordinal: number): Promise<{ mediaType: string; bytes: Buffer } | null> {
    const found = this.images.find(image => image.attemptId === attemptId && image.ordinal === ordinal);
    return found?.bytes ? { mediaType: found.mediaType, bytes: Buffer.from(found.bytes) } : null;
  }

  async recordMark(input: QuestionBankMark): Promise<'recorded' | 'replayed' | 'conflict' | 'missing'> {
    const prior = this.markRows.find(row => row.markId === input.markId);
    if (prior) {
      return prior.kind === input.kind && prior.attemptId === input.attemptId && prior.otherAttemptId === input.otherAttemptId
        && prior.verdict === input.verdict && prior.actor === input.actor ? 'replayed' : 'conflict';
    }
    const first = this.attempts.get(input.attemptId);
    if (input.kind === 'transcript') {
      if (!first?.transcript) return 'missing';
    } else {
      const second = input.otherAttemptId === null ? undefined : this.attempts.get(input.otherAttemptId);
      if (!first || !second || first === second || !first.cardId || first.cardId !== second.cardId || !this.cards.get(first.cardId)?.matchable) return 'missing';
    }
    this.markRows.push({ ...input });
    return 'recorded';
  }

  async marks(): Promise<QuestionBankMark[]> {
    return [...this.markRows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.markId.localeCompare(b.markId)).map(row => ({ ...row }));
  }

  private prior<T>(operationId: string, fingerprint: string): { result: T } | 'conflict' | null {
    const row = this.operationRows.get(operationId);
    if (!row) return null;
    return row.fingerprint === fingerprint ? { result: structuredClone(row.after) as T } : 'conflict';
  }

  async requeueFailed(input: { operationId: string; actor: string; reason: string; now: string; maxTokens: number }): Promise<QuestionBankOperation<{ requeued: number }>> {
    const fingerprint = operationFingerprint(['requeue_failed', input.actor, input.reason, input.maxTokens]);
    const prior = this.prior<{ requeued: number }>(input.operationId, fingerprint);
    if (prior === 'conflict') return prior;
    if (prior) return { result: prior.result, replayed: true };
    const failed = this.jobs.filter(job => job.kind === 'transcribe' && job.status === 'failed').length;
    const requeued = this.requeueFailedJobs(input.now, input.maxTokens);
    this.operationRows.set(input.operationId, {
      operationId: input.operationId, kind: 'requeue_failed', deviceId: null, actor: input.actor, reason: input.reason, fingerprint,
      createdAt: input.now, before: { failed }, after: { requeued },
    });
    return { result: { requeued }, replayed: false };
  }

  private footprint(deviceId: number): { footprint: QuestionBankFootprint; cards: string[] } {
    const owned = new Set([...this.attempts.values()].filter(row => row.deviceId === deviceId).map(row => row.attemptId));
    const images = this.images.filter(image => owned.has(image.attemptId));
    const cardIds = new Set([...this.attempts.values()].filter(row => owned.has(row.attemptId) && row.cardId).map(row => row.cardId!));
    const shared = new Set([...this.attempts.values()].filter(row => !owned.has(row.attemptId) && row.cardId && cardIds.has(row.cardId)).map(row => row.cardId!));
    const cards = [...cardIds].filter(cardId => !shared.has(cardId)).sort();
    const reviews = this.jobs.filter(job => job.kind === 'review' && job.cardId !== null && cardIds.has(job.cardId));
    return {
      footprint: {
        attempts: owned.size, images: images.length, storedImages: images.filter(image => image.bytes).length,
        jobs: this.jobs.filter(job => job.kind === 'transcribe' && job.attemptId !== null && owned.has(job.attemptId)).length
          + reviews.filter(job => !shared.has(job.cardId!)).length,
        marks: this.markRows.filter(row => owned.has(row.attemptId) || (row.otherAttemptId !== null && owned.has(row.otherAttemptId))).length,
        cardsDeleted: cards.length, cardsKept: shared.size,
        reviewsDetached: reviews.filter(job => shared.has(job.cardId!) && job.attemptId !== null && owned.has(job.attemptId)).length,
      },
      cards,
    };
  }

  async accountFootprint(deviceId: number): Promise<QuestionBankFootprint> {
    return this.footprint(deviceId).footprint;
  }

  async deleteAccount(input: { operationId: string; deviceId: number; actor: string; reason: string; now: string }): Promise<QuestionBankOperation<QuestionBankFootprint>> {
    const fingerprint = operationFingerprint(['delete_account', input.deviceId, input.actor, input.reason]);
    const prior = this.prior<QuestionBankFootprint>(input.operationId, fingerprint);
    if (prior === 'conflict') return prior;
    if (prior) return { result: prior.result, replayed: true };
    const { footprint, cards } = this.footprint(input.deviceId);
    const owned = new Set([...this.attempts.values()].filter(row => row.deviceId === input.deviceId).map(row => row.attemptId));
    const gone = new Set(cards);
    this.markRows = this.markRows.filter(row => !owned.has(row.attemptId) && !(row.otherAttemptId !== null && owned.has(row.otherAttemptId)));
    this.images = this.images.filter(image => !owned.has(image.attemptId));
    // A review keeps its result; only its link to the solve goes. Reviews of cards that go are deleted with them.
    for (const job of this.jobs) if (job.kind === 'review' && job.attemptId !== null && owned.has(job.attemptId)) job.attemptId = null;
    this.jobs = this.jobs.filter(job => !(job.attemptId !== null && owned.has(job.attemptId)) && !(job.cardId !== null && gone.has(job.cardId)));
    for (const attemptId of owned) this.attempts.delete(attemptId);
    this.cardEventRows = this.cardEventRows.filter(event => !gone.has(event.cardId));
    for (const cardId of gone) this.cards.delete(cardId);
    this.operationRows.set(input.operationId, {
      operationId: input.operationId, kind: 'delete_account', deviceId: input.deviceId, actor: input.actor, reason: input.reason, fingerprint,
      createdAt: input.now, before: footprint, after: footprint,
    });
    return { result: structuredClone(footprint), replayed: false };
  }

  private allImagesStored(attemptId: string): boolean {
    const images = this.images.filter(image => image.attemptId === attemptId);
    return images.length > 0 && images.every(image => image.bytes !== null);
  }

  private reviewRows(cardIds: string[] | null): QuestionBankReviewData {
    const wanted = cardIds ? new Set(cardIds) : null;
    const cards = [...this.cards.values()].filter(card => card.matchable && (!wanted || wanted.has(card.cardId)));
    const ids = new Set(cards.map(card => card.cardId));
    return {
      cards: cards.map(card => ({ cardId: card.cardId, stem: card.stem, options: structuredClone(card.options), state: card.state, createdAt: card.createdAt })),
      solves: [...this.attempts.values()].filter(row => row.cardId !== null && ids.has(row.cardId) && this.counted(row)).map(row => ({
        attemptId: row.attemptId, cardId: row.cardId!, createdAt: row.createdAt, finalAnswer: row.finalAnswer, questionKind: row.questionKind,
        options: structuredClone(row.transcript!.options), imagesStored: this.allImagesStored(row.attemptId),
      })),
      jobs: this.jobs.filter(job => job.kind === 'review' && job.cardId !== null && ids.has(job.cardId)).map(job => ({
        jobId: job.jobId, cardId: job.cardId!, reviewedAttemptId: job.attemptId, operationId: job.operationId!, status: job.status, errorCode: job.errorCode,
        result: job.review ? structuredClone(job.review) : null, createdAt: job.createdAt, updatedAt: job.updatedAt,
      })),
      events: this.cardEventRows.filter(event => ids.has(event.cardId)).map(event => ({ ...event })),
    };
  }

  async reviewData(cardIds?: string[]): Promise<QuestionBankReviewData> {
    return this.reviewRows(cardIds ?? null);
  }

  async confirmReview(input: { operationId: string; cardIds: string[]; actor: string; reason: string; now: string }): Promise<QuestionBankReviewConfirm> {
    const cardIds = [...new Set(input.cardIds)].sort();
    const fingerprint = operationFingerprint(['review', cardIds, input.actor, input.reason]);
    const prior = this.prior<{ cards: string[] }>(input.operationId, fingerprint);
    if (prior === 'conflict') return prior;
    if (prior) return { result: prior.result, replayed: true };
    const blocked = blockedForReview(cardIds, questionBankCardViews(this.reviewRows(cardIds)));
    if (blocked.length || !cardIds.length) return { blocked };
    this.operationRows.set(input.operationId, {
      operationId: input.operationId, kind: 'review', deviceId: null, actor: input.actor, reason: input.reason, fingerprint,
      createdAt: input.now, before: { cards: cardIds.length }, after: { cards: cardIds },
    });
    for (const cardId of cardIds) {
      this.jobs.push({
        jobId: randomUUID(), attemptId: null, kind: 'review', status: 'pending', attemptCount: 0, cardId, modelAttemptId: null,
        createdAt: input.now, updatedAt: input.now, nextAttemptAt: input.now, leaseExpiresAt: null, errorCode: null, truncatedMaxTokens: null,
        operationId: input.operationId, review: null,
      });
    }
    return { result: { cards: cardIds }, replayed: false };
  }

  async claimReview(input: { now: string; leaseUntil: string; modelAttemptId: string }): Promise<ClaimedReview | null> {
    const due = this.jobs.filter(job => job.kind === 'review' && job.status === 'pending' && job.nextAttemptAt <= input.now)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId));
    for (const job of due) {
      Object.assign(job, { status: 'running', leaseExpiresAt: input.leaseUntil, modelAttemptId: input.modelAttemptId, updatedAt: input.now });
      const data = this.reviewRows([job.cardId!]);
      if (!data.cards.length) {
        Object.assign(job, { status: 'skipped', errorCode: 'card_missing', leaseExpiresAt: null, updatedAt: input.now });
        continue;
      }
      const chosen = reviewSolveOf(data.solves);
      const solve = chosen ? this.reviewSolveOfAttempt(chosen.attemptId) : null;
      if (solve) job.attemptId = solve.bankAttemptId;
      return {
        jobId: job.jobId, attemptCount: job.attemptCount, modelAttemptId: input.modelAttemptId, operationId: job.operationId!, cardId: job.cardId!,
        solve, answers: cardAnswers(data.solves).map(answer => answer.content),
      };
    }
    return null;
  }

  async completeReview(input: { jobId: string; now: string; called: boolean; result: QuestionBankReviewResult }): Promise<QuestionBankCard['state'] | null> {
    const job = this.jobs.find(item => item.jobId === input.jobId && item.kind === 'review' && item.status === 'running');
    if (!job) return null;
    const target: QuestionBankCard['state'] = input.result.outcome === 'agrees' ? 'verified_model' : 'disputed';
    const card = this.cards.get(job.cardId!);
    const moved = card?.state === 'unverified';
    if (card && moved) {
      card.state = target;
      this.cardEventRows.push({
        eventId: randomUUID(), cardId: card.cardId, at: input.now, actor: 'review_job', fromState: 'unverified', toState: target,
        basis: input.result.outcome, answer: input.result.answer, jobId: job.jobId, operationId: job.operationId,
      });
    }
    Object.assign(job, {
      status: 'done', attemptCount: job.attemptCount + (input.called ? 1 : 0), errorCode: null, leaseExpiresAt: null,
      review: structuredClone(input.result), modelAttemptId: input.called ? job.modelAttemptId : null, updatedAt: input.now,
    });
    return moved ? target : null;
  }

  async adjudicate(input: { operationId: string; cardId: string; answer: string; basis: string; actor: string; now: string }): Promise<QuestionBankOperation<{ state: 'verified_human' }> | 'missing' | 'not_disputed'> {
    const fingerprint = operationFingerprint(['adjudicate', input.cardId, input.answer, input.basis, input.actor]);
    const prior = this.prior<{ state: 'verified_human' }>(input.operationId, fingerprint);
    if (prior === 'conflict') return prior;
    if (prior) return { result: prior.result, replayed: true };
    const card = this.cards.get(input.cardId);
    if (!card) return 'missing';
    if (card.state !== 'disputed') return 'not_disputed';
    card.state = 'verified_human';
    this.cardEventRows.push({
      eventId: randomUUID(), cardId: card.cardId, at: input.now, actor: input.actor, fromState: 'disputed', toState: 'verified_human',
      basis: input.basis, answer: input.answer, jobId: null, operationId: input.operationId,
    });
    this.operationRows.set(input.operationId, {
      operationId: input.operationId, kind: 'adjudicate', deviceId: null, actor: input.actor, reason: input.basis, fingerprint,
      createdAt: input.now, before: { card_id: input.cardId, state: 'disputed' }, after: { state: 'verified_human' },
    });
    return { result: { state: 'verified_human' }, replayed: false };
  }

  private reviewSolveOfAttempt(attemptId: string): ReviewSolve | null {
    const row = this.attempts.get(attemptId);
    const prompt = row ? this.prompts.get(row.promptSha256) : undefined;
    if (!row?.transcript || !prompt || !this.allImagesStored(attemptId)) return null;
    return {
      bankAttemptId: attemptId, deviceId: row.deviceId, requestId: row.requestId, captureId: row.captureId,
      system: prompt.system, task: prompt.task, reasoningEffort: row.reasoningEffort,
      images: this.images.filter(image => image.attemptId === attemptId).sort((a, b) => a.ordinal - b.ordinal)
        .map(image => ({ mediaType: image.mediaType, bytes: Buffer.from(image.bytes!) })),
      options: structuredClone(row.transcript.options),
    };
  }

  async reviewSolve(attemptId: string): Promise<ReviewSolve | null> {
    return this.reviewSolveOfAttempt(attemptId);
  }

  async solveSamples(attemptIds: string[]): Promise<QuestionBankSample[]> {
    return attemptIds.flatMap(attemptId => this.sample(attemptId) ?? []);
  }

  async recentModelCosts(input: { provider: string; model: string; currency: string; limit: number }): Promise<ModelCallCost[]> {
    return this.bankAttempts()
      .filter(attempt => attempt.status === 'succeeded' && (attempt.purpose === 'answer' || attempt.purpose === 'review')
        && attempt.provider === input.provider && attempt.model === input.model && attempt.currency === input.currency
        && attempt.costMicros !== null && /^\d+$/.test(attempt.costMicros))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, input.limit)
      .map(attempt => ({ purpose: attempt.purpose, costMicros: Number(attempt.costMicros), startedAt: attempt.startedAt }));
  }

  async cardEvents(cardId: string): Promise<QuestionBankCardEvent[]> {
    return this.cardEventRows.filter(event => event.cardId === cardId)
      .sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId)).map(event => ({ ...event }));
  }

  async operations(limit: number): Promise<QuestionBankOperationRecord[]> {
    return [...this.operationRows.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.operationId.localeCompare(a.operationId)).slice(0, limit)
      .map(row => ({
        operationId: row.operationId, kind: row.kind, deviceId: row.deviceId, actor: row.actor, reason: row.reason, createdAt: row.createdAt,
        before: structuredClone(row.before), after: structuredClone(row.after),
      }));
  }
}
