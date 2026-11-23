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
  /** Raw model output, including the machine result line. */
  modelOutput: string;
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
  /** Null once retention has cleared the image; the row and its byte count stay. */
  bytes: Buffer | null;
}

/** The transcription call's whole output: one line of JSON with exactly these keys. */
export interface QuestionBankTranscript {
  status: 'ok' | 'multiple' | 'unreadable';
  language: string;
  stem: string;
  options: Array<{ label: string; text: string }>;
  has_figure: boolean;
}

export interface QuestionBankCard {
  cardId: string;
  /** Null for a card that never matches another solve. */
  fingerprint: string | null;
  matchable: boolean;
  language: string;
  stem: string;
  options: Array<{ label: string; text: string }>;
  hasFigure: boolean;
  transcriptStatus: QuestionBankTranscript['status'];
  state: 'unverified' | 'verified_model' | 'verified_human' | 'disputed';
  createdAt: string;
}

/** A model call counts once whatever its outcome; the first call and two retries. */
export const TRANSCRIPTION_MAX_CALLS = 3;
export type TranscriptionError = 'invalid_transcript' | 'output_truncated' | 'upstream_error' | 'timeout' | 'lease_expired' | 'image_deleted' | 'attempt_missing';

export interface ClaimedTranscription {
  jobId: string;
  /** Calls already made for this job. */
  attemptCount: number;
  /** Model attempt id reserved for this call; also the official budget hold id. */
  modelAttemptId: string;
  bankAttemptId: string;
  deviceId: number;
  requestId: string;
  captureId: string;
  images: Array<{ mediaType: string; bytes: Buffer | null }>;
}

/** A running transcription whose lease expired; its model attempt, if any, still needs closing. */
export interface StaleTranscription { jobId: string; deviceId: number | null; modelAttemptId: string | null }

/** One stored solve as statistics see it. `internal` is the device's flag at query time. */
export interface QuestionBankOccurrenceRow {
  attemptId: string;
  deviceId: number;
  createdAt: string;
  internal: boolean;
  jobStatus: string | null;
  cardId: string | null;
  matchable: boolean;
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
  modelOutput: string;
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
  jobErrorCode: string | null;
  cardId: string | null;
  transcript: QuestionBankTranscript | null;
}

export interface QuestionBankCounts {
  attempts: number;
  images: number;
  prompts: number;
  jobs: number;
  cards: number;
}

export interface QuestionBankStore {
  /** Insert the attempt, its images, and a pending transcribe job. A repeated capture id is a no-op. */
  recordSolve(input: QuestionBankSolveInput): Promise<void>;
  /** Fill explanation text on an existing solve. Missing rows and a second write are no-ops. */
  appendExplanation(input: { token: string; captureId: string; explanation: string }): Promise<void>;
  findByCapture(captureId: string): Promise<StoredQuestionBankAttempt | null>;
  findCard(cardId: string): Promise<QuestionBankCard | null>;
  counts(): Promise<QuestionBankCounts>;
  /** Clear the bytes of images created before `cutoff`. Rows, byte counts, transcripts and cards stay. Returns images cleared. */
  purgeImages(cutoff: string, now: string, limit: number): Promise<number>;
  /** Expired running transcriptions count one call: pending again, or failed at the cap. */
  recoverStaleTranscriptions(now: string): Promise<StaleTranscription[]>;
  /** Claim the oldest due pending transcription under a lease. Null when none is due. */
  claimTranscription(input: { now: string; leaseUntil: string; modelAttemptId: string }): Promise<ClaimedTranscription | null>;
  /** Back to pending without counting a call: no budget or capacity, upstream overload, or the round ended. */
  releaseTranscription(jobId: string, now: string): Promise<void>;
  /**
   * One failed call: pending again from `retryAt`, or failed at the cap. An output cut at the token
   * limit (`truncatedAtMaxTokens`) fails at once, since the same limit would cut it again.
   */
  failTranscription(input: { jobId: string; errorCode: TranscriptionError; now: string; retryAt: string; truncatedAtMaxTokens?: number }): Promise<'pending' | 'failed' | null>;
  /** Finished without a model call: the images were cleared or the solve is gone. */
  skipTranscription(jobId: string, errorCode: TranscriptionError, now: string): Promise<void>;
  /** Store the transcript on the solve, link its card (shared by fingerprint when matchable), finish the job. */
  completeTranscription(input: { jobId: string; transcript: QuestionBankTranscript; now: string }): Promise<string | null>;
  /**
   * Failed transcriptions become pending with a fresh call count, except outputs truncated at a token
   * limit of at least `maxTokens`: the current limit would cut them again. Returns how many.
   */
  requeueFailedTranscriptions(now: string, maxTokens: number): Promise<number>;
  occurrenceRows(): Promise<QuestionBankOccurrenceRow[]>;
}

/**
 * Text comparison form: Unicode NFKC, trimmed, runs of whitespace as one space, and only ASCII
 * A–Z lowered. Digits are text, so a changed number is a different question.
 */
export function normalizeQuestionText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').replace(/[A-Z]/g, letter => letter.toLowerCase());
}

/** Code point order, which plain string comparison does not give outside the BMP. */
function byCodePoint(a: string, b: string): number {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Only a clean single question with text and without a figure or table may share a card with another solve. */
export function transcriptMatchable(transcript: QuestionBankTranscript): boolean {
  return transcript.status === 'ok' && !transcript.has_figure && normalizeQuestionText(transcript.stem) !== '';
}

/** `fp1:` + SHA-256 of [normalized stem, normalized option texts in code point order]. Labels and option order do not count. */
export function questionFingerprint(transcript: Pick<QuestionBankTranscript, 'stem' | 'options'>): string {
  const options = transcript.options.map(option => normalizeQuestionText(option.text)).sort(byCodePoint);
  const body = JSON.stringify([normalizeQuestionText(transcript.stem), options]);
  return 'fp1:' + createHash('sha256').update(body).digest('hex');
}

/** An option label as printed, without brackets or trailing punctuation: "(A)", "A.", "a" all become "a". */
function normalizeLabel(label: string): string {
  return normalizeQuestionText(label).replace(/^[([{]\s*/u, '').replace(/\s*[)\]}.:、]$/u, '').trim();
}

/**
 * What an answer says, comparable across solves of one card. For choice questions every label in
 * the final answer is replaced by its option text; when any label does not match an option, the
 * normalized answer itself is used.
 */
export function answerContent(finalAnswer: string, questionKind: string | null, options: QuestionBankTranscript['options']): string {
  const answer = normalizeQuestionText(finalAnswer);
  if ((questionKind === 'single_choice' || questionKind === 'multiple_choice') && options.length) {
    const texts = new Map(options.map(option => [normalizeLabel(option.label), normalizeQuestionText(option.text)]));
    const labels = answer.split(/[\s,，、;；/]+/u).map(normalizeLabel).filter(Boolean);
    if (labels.length && labels.every(label => texts.has(label))) {
      return JSON.stringify([...new Set(labels.map(label => texts.get(label)!))].sort(byCodePoint));
    }
  }
  return JSON.stringify([answer]);
}

export interface QuestionBankOccurrence {
  attemptId: string;
  deviceId: number;
  /** An earlier counted solve exists on the same matchable card. */
  cardSeenBefore: boolean;
  sameAccountBefore: boolean;
  otherAccountBefore: boolean;
}

export interface QuestionBankOccurrenceSummary {
  /** Counted solves: non-internal now, transcription finished (ok, multiple or unreadable). */
  denominator: number;
  /** Counted solves whose card already had an earlier counted solve. */
  repeated: number;
  sameAccount: number;
  otherAccount: number;
  /** Non-internal solves still waiting for, or out of, transcription. Not in the denominator. */
  waiting: number;
  failed: number;
  skipped: number;
  occurrences: QuestionBankOccurrence[];
}

/**
 * The three "seen before" answers per solve, computed now from the solves themselves. Nothing is
 * stored per solve, so changing a device's internal flag changes these numbers on the next read.
 * Only earlier counted solves are compared; an earlier internal solve does not make a repeat.
 */
export function questionBankOccurrences(rows: QuestionBankOccurrenceRow[]): QuestionBankOccurrenceSummary {
  const external = rows.filter(row => !row.internal);
  const counted = external.filter(row => row.jobStatus === 'done')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.attemptId.localeCompare(b.attemptId));
  const seen = new Map<string, Set<number>>();
  const occurrences: QuestionBankOccurrence[] = [];
  for (const row of counted) {
    const devices = row.matchable && row.cardId ? seen.get(row.cardId) : undefined;
    occurrences.push({
      attemptId: row.attemptId, deviceId: row.deviceId,
      cardSeenBefore: !!devices?.size,
      sameAccountBefore: !!devices?.has(row.deviceId),
      otherAccountBefore: !!devices && [...devices].some(device => device !== row.deviceId),
    });
    if (row.matchable && row.cardId) seen.set(row.cardId, (devices ?? new Set<number>()).add(row.deviceId));
  }
  return {
    denominator: counted.length,
    repeated: occurrences.filter(row => row.cardSeenBefore).length,
    sameAccount: occurrences.filter(row => row.sameAccountBefore).length,
    otherAccount: occurrences.filter(row => row.otherAccountBefore).length,
    waiting: external.filter(row => row.jobStatus === 'pending' || row.jobStatus === 'running').length,
    failed: external.filter(row => row.jobStatus === 'failed').length,
    skipped: external.filter(row => row.jobStatus === 'skipped').length,
    occurrences,
  };
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
