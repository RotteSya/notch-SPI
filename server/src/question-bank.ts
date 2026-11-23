import { createHash } from 'node:crypto';

export type QuestionBankReasoningEffort = 'low' | 'high' | 'max';

export interface QuestionBankImageInput {
  mediaType: string;
  bytes: Buffer;
}

/** One consented, usable objective solve. The caller has already applied the save gate. */
export interface QuestionBankSolveInput {
  token: string;
  captureId: string;
  requestId: string;
  createdAt: string;
  durationMs: number;
  provider: string;
  model: string;
  reasoningEffort: QuestionBankReasoningEffort | null;
  configRevision: string;
  resultProtocol: string;
  resultState: string | null;
  questionKind: string | null;
  parserPath: string | null;
  visibleText: string;
  finalAnswer: string;
  answerAttemptId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  system: string;
  task: string;
  images: QuestionBankImageInput[];
}

export interface StoredQuestionBankImage {
  ordinal: number;
  mediaType: string;
  byteCount: number;
  sha256: string;
  bytes: Buffer;
}

export interface StoredQuestionBankAttempt {
  attemptId: string;
  deviceId: number;
  captureId: string;
  requestId: string;
  createdAt: string;
  durationMs: number;
  provider: string;
  model: string;
  reasoningEffort: QuestionBankReasoningEffort | null;
  configRevision: string;
  resultProtocol: string;
  resultState: string | null;
  questionKind: string | null;
  parserPath: string | null;
  visibleText: string;
  finalAnswer: string;
  explanation: string | null;
  answerAttemptId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  promptSha256: string;
  system: string;
  task: string;
  images: StoredQuestionBankImage[];
  jobKind: string | null;
  jobStatus: string | null;
  jobAttemptCount: number | null;
}

export interface QuestionBankCounts {
  attempts: number;
  images: number;
  prompts: number;
  jobs: number;
}

export interface QuestionBankStore {
  /** Insert the attempt, its images, and a pending transcribe job. A repeated capture id is a no-op. */
  recordSolve(input: QuestionBankSolveInput): Promise<void>;
  /** Fill explanation text on an existing solve. Missing rows and a second write are no-ops. */
  appendExplanation(input: { token: string; captureId: string; explanation: string }): Promise<void>;
  findByCapture(captureId: string): Promise<StoredQuestionBankAttempt | null>;
  counts(): Promise<QuestionBankCounts>;
}

let writeFailures = 0;

export function noteQuestionBankWriteFailure(): void {
  writeFailures += 1;
}

export function questionBankWriteFailureCount(): number {
  return writeFailures;
}

/** Length-prefixed so two different prompt pairs cannot share a digest. */
export function promptDigest(system: string, task: string): string {
  const body = `${Buffer.byteLength(system)}\n${system}${Buffer.byteLength(task)}\n${task}`;
  return createHash('sha256').update(body).digest('hex');
}

export function imageDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
