import { randomUUID } from 'node:crypto';
import {
  imageDigest, promptDigest,
  type QuestionBankCounts, type QuestionBankSolveInput, type QuestionBankStore, type StoredQuestionBankAttempt,
  type StoredQuestionBankImage,
} from './question-bank.ts';

interface PromptRow { sha256: string; system: string; task: string }
interface AttemptRow extends Omit<StoredQuestionBankAttempt, 'system' | 'task' | 'images' | 'jobKind' | 'jobStatus' | 'jobAttemptCount'> {}
interface ImageRow extends StoredQuestionBankImage { attemptId: string }
interface JobRow { attemptId: string; kind: string; status: string; attemptCount: number }

export class MemoryQuestionBankStore implements QuestionBankStore {
  private prompts = new Map<string, PromptRow>();
  private attempts = new Map<string, AttemptRow>();
  private images: ImageRow[] = [];
  private jobs: JobRow[] = [];
  private readonly deviceId: (token: string) => number | null;

  constructor(deviceId: (token: string) => number | null) { this.deviceId = deviceId; }

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
      questionKind: input.questionKind, parserPath: input.parserPath, visibleText: input.visibleText,
      finalAnswer: input.finalAnswer, explanation: null, answerAttemptId: input.answerAttemptId,
      inputTokens: input.inputTokens, outputTokens: input.outputTokens, promptSha256: sha256,
    });
    input.images.forEach((image, ordinal) => {
      this.images.push({
        attemptId, ordinal, mediaType: image.mediaType, byteCount: image.bytes.length,
        sha256: imageDigest(image.bytes), bytes: Buffer.from(image.bytes),
      });
    });
    this.jobs.push({ attemptId, kind: 'transcribe', status: 'pending', attemptCount: 0 });
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
      .map(image => ({ ordinal: image.ordinal, mediaType: image.mediaType, byteCount: image.byteCount, sha256: image.sha256, bytes: Buffer.from(image.bytes) }));
    return {
      ...row, system: prompt.system, task: prompt.task, images,
      jobKind: job?.kind ?? null, jobStatus: job?.status ?? null, jobAttemptCount: job?.attemptCount ?? null,
    };
  }

  async counts(): Promise<QuestionBankCounts> {
    return { attempts: this.attempts.size, images: this.images.length, prompts: this.prompts.size, jobs: this.jobs.length };
  }
}
