import { randomUUID } from 'node:crypto';
import {
  imageDigest, promptDigest, questionFingerprint, transcriptMatchable, TRANSCRIPTION_MAX_CALLS,
  type ClaimedTranscription, type QuestionBankCard, type QuestionBankCounts, type QuestionBankOccurrenceRow,
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
  leaseExpiresAt: string | null; errorCode: string | null;
}

// Every method finishes its reads and writes without an await, like one SQL transaction.
export class MemoryQuestionBankStore implements QuestionBankStore {
  private prompts = new Map<string, PromptRow>();
  private attempts = new Map<string, AttemptRow>();
  private images: ImageRow[] = [];
  private jobs: JobRow[] = [];
  private cards = new Map<string, QuestionBankCard>();
  private readonly deviceId: (token: string) => number | null;
  private readonly internal: (deviceId: number) => boolean;

  constructor(deviceId: (token: string) => number | null, internal: (deviceId: number) => boolean = () => false) {
    this.deviceId = deviceId;
    this.internal = internal;
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
      createdAt: now, updatedAt: now, nextAttemptAt: now, leaseExpiresAt: null, errorCode: null,
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

  async failTranscription(input: { jobId: string; errorCode: TranscriptionError; now: string; retryAt: string }): Promise<'pending' | 'failed' | null> {
    const job = this.running(input.jobId);
    if (!job) return null;
    job.attemptCount += 1;
    const status = job.attemptCount >= TRANSCRIPTION_MAX_CALLS ? 'failed' : 'pending';
    Object.assign(job, { status, errorCode: input.errorCode, leaseExpiresAt: null, nextAttemptAt: input.retryAt, updatedAt: input.now });
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

  async requeueFailedTranscriptions(now: string): Promise<number> {
    const failed = this.jobs.filter(job => job.kind === 'transcribe' && job.status === 'failed');
    for (const job of failed) Object.assign(job, { status: 'pending', attemptCount: 0, errorCode: null, nextAttemptAt: now, updatedAt: now });
    return failed.length;
  }

  async occurrenceRows(): Promise<QuestionBankOccurrenceRow[]> {
    return [...this.attempts.values()].map(row => ({
      attemptId: row.attemptId, deviceId: row.deviceId, createdAt: row.createdAt, internal: this.internal(row.deviceId),
      jobStatus: this.jobs.find(job => job.attemptId === row.attemptId && job.kind === 'transcribe')?.status ?? null,
      cardId: row.cardId, matchable: row.cardId ? this.cards.get(row.cardId)?.matchable ?? false : false,
    }));
  }
}
