import { randomUUID } from 'node:crypto';
import {
  imageDigest, operationFingerprint, promptDigest, questionBankCosts, questionFingerprint, sampleOf, transcriptMatchable, TRANSCRIPTION_MAX_CALLS,
  type ClaimedTranscription, type QuestionBankCard, type QuestionBankCounts, type QuestionBankFootprint, type QuestionBankInventory,
  type QuestionBankMark, type QuestionBankMatchSample, type QuestionBankOccurrenceRow, type QuestionBankOperation, type QuestionBankOperationRecord,
  type QuestionBankSample,
  type QuestionBankSolveInput, type QuestionBankStore, type QuestionBankTranscript, type StaleTranscription,
  type StoredQuestionBankAttempt, type StoredQuestionBankImage, type TranscriptionError,
} from './question-bank.ts';

interface PromptRow { sha256: string; system: string; task: string }
interface AttemptRow extends Omit<StoredQuestionBankAttempt,
  'system' | 'task' | 'images' | 'jobKind' | 'jobStatus' | 'jobAttemptCount' | 'jobErrorCode'> {}
interface ImageRow extends StoredQuestionBankImage { attemptId: string; createdAt: string; deletedAt: string | null }
interface JobRow {
  jobId: string; attemptId: string; kind: string; status: string; attemptCount: number; cardId: string | null;
  modelAttemptId: string | null; createdAt: string; updatedAt: string; nextAttemptAt: string;
  leaseExpiresAt: string | null; errorCode: string | null; truncatedMaxTokens: number | null;
}
interface CardEventRow { eventId: string; cardId: string; at: string; actor: string; fromState: string; toState: string; basis: string }
interface OperationRow {
  operationId: string; kind: 'requeue_failed' | 'delete_account'; deviceId: number | null; actor: string; reason: string;
  fingerprint: string; createdAt: string; before: unknown; after: unknown;
}
/** A transcription or review model call as the question-bank costs read it. */
export interface MemoryBankAttempt { purpose: string; currency: string; costMicros: string | null }

// Every method finishes its reads and writes without an await, like one SQL transaction.
export class MemoryQuestionBankStore implements QuestionBankStore {
  private prompts = new Map<string, PromptRow>();
  private attempts = new Map<string, AttemptRow>();
  private images: ImageRow[] = [];
  private jobs: JobRow[] = [];
  private cards = new Map<string, QuestionBankCard>();
  private cardEvents: CardEventRow[] = [];
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

  async recoverStaleTranscriptions(now: string): Promise<StaleTranscription[]> {
    const stale: StaleTranscription[] = [];
    for (const job of this.jobs.filter(item => item.kind === 'transcribe' && item.status === 'running' && item.leaseExpiresAt !== null && item.leaseExpiresAt <= now)
      .sort((a, b) => a.leaseExpiresAt!.localeCompare(b.leaseExpiresAt!)).slice(0, 50)) {
      job.attemptCount += 1;
      job.status = job.attemptCount >= TRANSCRIPTION_MAX_CALLS ? 'failed' : 'pending';
      Object.assign(job, { leaseExpiresAt: null, errorCode: 'lease_expired', nextAttemptAt: now, updatedAt: now });
      stale.push({ jobId: job.jobId, deviceId: this.attempts.get(job.attemptId)?.deviceId ?? null, modelAttemptId: job.modelAttemptId });
    }
    return stale;
  }

  async claimTranscription(input: { now: string; leaseUntil: string; modelAttemptId: string }): Promise<ClaimedTranscription | null> {
    const due = this.jobs.filter(job => job.kind === 'transcribe' && job.status === 'pending' && job.nextAttemptAt <= input.now)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId));
    for (const job of due) {
      Object.assign(job, { status: 'running', leaseExpiresAt: input.leaseUntil, modelAttemptId: input.modelAttemptId, updatedAt: input.now });
      const solve = this.attempts.get(job.attemptId);
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
    const solve = this.attempts.get(job.attemptId);
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
    return [...this.attempts.values()].map(row => ({
      attemptId: row.attemptId, deviceId: row.deviceId, createdAt: row.createdAt, internal: this.internal(row.deviceId),
      jobStatus: this.jobs.find(job => job.attemptId === row.attemptId && job.kind === 'transcribe')?.status ?? null,
      jobErrorCode: this.jobs.find(job => job.attemptId === row.attemptId && job.kind === 'transcribe')?.errorCode ?? null,
      cardId: row.cardId, matchable: row.cardId ? this.cards.get(row.cardId)?.matchable ?? false : false,
    }));
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
      costs: questionBankCosts(this.bankAttempts()),
    };
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
    const ready = [...this.attempts.values()].filter(row => row.transcript && this.hasStoredImage(row.attemptId));
    return sampleOf(ready, count).map(row => this.sample(row.attemptId)!);
  }

  async sampleMatches(count: number): Promise<QuestionBankMatchSample[]> {
    const byCard = new Map<string, string[]>();
    for (const row of this.attempts.values()) {
      if (!row.cardId || !row.transcript || !this.cards.get(row.cardId)?.matchable || !this.hasStoredImage(row.attemptId)) continue;
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
    return {
      footprint: {
        attempts: owned.size, images: images.length, storedImages: images.filter(image => image.bytes).length,
        jobs: this.jobs.filter(job => owned.has(job.attemptId)).length,
        marks: this.markRows.filter(row => owned.has(row.attemptId) || (row.otherAttemptId !== null && owned.has(row.otherAttemptId))).length,
        cardsDeleted: cards.length, cardsKept: shared.size,
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
    this.jobs = this.jobs.filter(job => !owned.has(job.attemptId) && !(job.cardId !== null && gone.has(job.cardId)));
    for (const attemptId of owned) this.attempts.delete(attemptId);
    this.cardEvents = this.cardEvents.filter(event => !gone.has(event.cardId));
    for (const cardId of gone) this.cards.delete(cardId);
    this.operationRows.set(input.operationId, {
      operationId: input.operationId, kind: 'delete_account', deviceId: input.deviceId, actor: input.actor, reason: input.reason, fingerprint,
      createdAt: input.now, before: footprint, after: footprint,
    });
    return { result: structuredClone(footprint), replayed: false };
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
