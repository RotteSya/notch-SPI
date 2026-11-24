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

/** A model call counts once whatever its outcome; the first call and two retries. Review jobs use the same cap. */
export const TRANSCRIPTION_MAX_CALLS = 3;
/** Job error codes, for transcription and review jobs alike. Short codes only, never model text. */
export type TranscriptionError = 'invalid_transcript' | 'output_truncated' | 'upstream_error' | 'timeout' | 'lease_expired' | 'image_deleted' | 'attempt_missing' | 'card_missing';

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

/** A running job whose lease expired; its model attempt, if any, still needs closing. */
export interface StaleTranscription { jobId: string; kind: 'transcribe' | 'review'; deviceId: number | null; modelAttemptId: string | null }

/**
 * How a review ended. `agrees`: the reviewer's answer content equals the one production answer
 * content on the card. `disagrees`: it differs. `not_ready`: the reviewer gave no usable ready
 * result (retake, review, wrong format, cut short). `answers_differ`: the card's own production
 * answers already differ, so no reviewer was called.
 */
export type ReviewOutcome = 'agrees' | 'disagrees' | 'not_ready' | 'answers_differ';

/** What a finished review job keeps for the adjudication page. Null fields: no reviewer call or no usable result. */
export interface QuestionBankReviewResult {
  outcome: ReviewOutcome;
  provider: string | null;
  model: string | null;
  state: string | null;
  kind: string | null;
  answer: string | null;
  content: string | null;
  /** The production answer contents compared against. */
  answers: string[];
}

/** The solve a review re-asks: its own saved prompt, effort and images, and its transcript's options. */
export interface ReviewSolve {
  bankAttemptId: string;
  deviceId: number;
  requestId: string;
  captureId: string;
  system: string;
  task: string;
  reasoningEffort: QuestionBankReasoningEffort | null;
  images: Array<{ mediaType: string; bytes: Buffer }>;
  options: QuestionBankTranscript['options'];
}

export interface ClaimedReview {
  jobId: string;
  attemptCount: number;
  modelAttemptId: string;
  operationId: string;
  cardId: string;
  /** The latest counted solve on the card whose images are all stored; null when none is left. */
  solve: ReviewSolve | null;
  /** Distinct production answer contents among the card's counted solves. */
  answers: string[];
}

/** A counted solve on a matchable card, as the review and adjudication lists read it. */
export interface ReviewSolveRow {
  attemptId: string;
  cardId: string;
  createdAt: string;
  finalAnswer: string;
  questionKind: string | null;
  options: QuestionBankTranscript['options'];
  /** Every image of the solve is still stored. */
  imagesStored: boolean;
}

export interface ReviewCardRow {
  cardId: string;
  stem: string;
  options: QuestionBankTranscript['options'];
  state: QuestionBankCard['state'];
  createdAt: string;
}

export interface ReviewJobRow {
  jobId: string;
  cardId: string;
  /** The solve the review re-asked; null before it is claimed, or once that solve's account was deleted. */
  reviewedAttemptId: string | null;
  operationId: string;
  status: string;
  errorCode: string | null;
  result: QuestionBankReviewResult | null;
  createdAt: string;
  updatedAt: string;
}

/** One card state change. Review jobs write actor `review_job` and the outcome as basis. */
export interface QuestionBankCardEvent {
  eventId: string;
  cardId: string;
  at: string;
  actor: string;
  fromState: QuestionBankCard['state'];
  toState: QuestionBankCard['state'];
  basis: string;
  answer: string | null;
  jobId: string | null;
  operationId: string | null;
}

/** Raw rows for the review and adjudication lists; the lists themselves are computed by `questionBankCardViews`. */
export interface QuestionBankReviewData {
  cards: ReviewCardRow[];
  solves: ReviewSolveRow[];
  jobs: ReviewJobRow[];
  events: QuestionBankCardEvent[];
}

/**
 * Why a card cannot be put up for review now. `review_open`: a review job is pending or running.
 * `reviewed`: the card is no longer unverified. `not_repeated`: fewer than two counted solves.
 * `images_expired`: no counted solve still has all its images.
 */
export type ReviewBlock = 'review_open' | 'reviewed' | 'not_repeated' | 'images_expired';

export interface QuestionBankCardView {
  cardId: string;
  stem: string;
  options: QuestionBankTranscript['options'];
  state: QuestionBankCard['state'];
  createdAt: string;
  /** Counted solves on the card: transcribed, account not internal or release-qa now. */
  occurrences: number;
  answers: Array<{ content: string; example: string; count: number }>;
  answersDiffer: boolean;
  /** The solve a review would re-ask: the latest counted one with all images stored. */
  reviewAttemptId: string | null;
  blocked: ReviewBlock | null;
  latestReview: ReviewJobRow | null;
  latestEvent: QuestionBankCardEvent | null;
}

/** The known cost of one finished model call, for estimating what a review batch will spend. */
export interface ModelCallCost { purpose: string; costMicros: number; startedAt: string }

/**
 * How much of a review batch today's remaining budget allows. Jobs run one at a time: each holds its
 * own reservation only while it runs and is then settled at its actual cost. Both counts walk the
 * batch in order; `expectedCalls` at the expected costs (null when any is unknown), the worst case at
 * the full reservations.
 */
export function reviewBudgetFit(remaining: number, cards: Array<{ reservation: number; expected: number | null }>) {
  const run = (cost: (card: { reservation: number; expected: number | null }) => number) => {
    let left = remaining, calls = 0;
    for (const card of cards) {
      if (left < card.reservation) break;
      left -= cost(card);
      calls += 1;
    }
    return calls;
  };
  const expectedCalls = cards.every(card => card.expected !== null) ? run(card => card.expected!) : null;
  const worstCaseCalls = run(card => card.reservation);
  return {
    expectedCalls, fitsExpected: expectedCalls === null ? null : expectedCalls === cards.length,
    worstCaseCalls, fitsWorstCase: worstCaseCalls === cards.length,
  };
}

/** The outcome of confirming a review batch: the jobs made, or every card that may not be reviewed and why. */
export type QuestionBankReviewConfirm = QuestionBankOperation<{ cards: string[] }> | { blocked: Array<{ cardId: string; reason: ReviewBlock | 'missing' }> };

/** One stored solve as statistics see it. `internal` is the device's flag at query time. */
export interface QuestionBankOccurrenceRow {
  attemptId: string;
  deviceId: number;
  createdAt: string;
  internal: boolean;
  jobStatus: string | null;
  jobErrorCode: string | null;
  cardId: string | null;
  matchable: boolean;
}

/** A solve shown for a spot check: its own transcript and which of its images are still stored. */
export interface QuestionBankSample {
  attemptId: string;
  createdAt: string;
  cardId: string | null;
  transcript: QuestionBankTranscript | null;
  images: Array<{ ordinal: number; mediaType: string; byteCount: number; stored: boolean }>;
}

/** Two solves linked to the same matchable card. */
export interface QuestionBankMatchSample { cardId: string; first: QuestionBankSample; second: QuestionBankSample }

export type QuestionBankMarkKind = 'transcript' | 'match';
export type QuestionBankVerdict = 'correct' | 'wrong' | 'same' | 'different';
export const MARK_VERDICTS: Record<QuestionBankMarkKind, readonly QuestionBankVerdict[]> = {
  transcript: ['correct', 'wrong'], match: ['same', 'different'],
};

/** A spot-check verdict. A match mark names its pair in attempt id order. */
export interface QuestionBankMark {
  markId: string;
  kind: QuestionBankMarkKind;
  attemptId: string;
  otherAttemptId: string | null;
  verdict: QuestionBankVerdict;
  actor: string;
  createdAt: string;
}

/** Stored content, as opposed to the shadow statistics: cards, images and the question bank's own model costs. */
export interface QuestionBankInventory {
  cards: Array<{ state: QuestionBankCard['state']; matchable: boolean; count: number }>;
  images: { stored: number; storedBytes: number; cleared: number };
  costs: Array<{ purpose: string; currency: string; calls: number; knownMicros: string; unknown: number }>;
}

/** What deleting one account's question-bank data removes, and what other accounts' cards keep. */
export interface QuestionBankFootprint {
  attempts: number;
  images: number;
  storedImages: number;
  /** Jobs deleted: the account's transcriptions and the review jobs of cards that go. */
  jobs: number;
  marks: number;
  cardsDeleted: number;
  cardsKept: number;
  /** Review jobs of kept cards that re-asked one of the account's solves: kept with their result, the link to the solve removed. */
  reviewsDetached: number;
}

/** An audited admin action. The same operation id returns its first result; a different request under it is a conflict. */
export type QuestionBankOperation<T> = { result: T; replayed: boolean } | 'conflict';

export type QuestionBankOperationKind = 'requeue_failed' | 'delete_account' | 'review' | 'adjudicate';

/** One row of the admin audit log. */
export interface QuestionBankOperationRecord {
  operationId: string;
  kind: QuestionBankOperationKind;
  deviceId: number | null;
  actor: string;
  reason: string;
  createdAt: string;
  before: unknown;
  after: unknown;
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
  /** Expired running jobs of either kind count one call: pending again, or failed at the cap. */
  recoverStaleJobs(now: string): Promise<StaleTranscription[]>;
  /** Claim the oldest due pending transcription under a lease. Null when none is due. */
  claimTranscription(input: { now: string; leaseUntil: string; modelAttemptId: string }): Promise<ClaimedTranscription | null>;
  /** Back to pending without counting a call: no budget or capacity, upstream overload, or the round ended. Either job kind. */
  releaseTranscription(jobId: string, now: string): Promise<void>;
  /**
   * One failed call: pending again from `retryAt`, or failed at the cap. An output cut at the token
   * limit (`truncatedAtMaxTokens`) fails at once, since the same limit would cut it again. Either job kind.
   */
  failTranscription(input: { jobId: string; errorCode: TranscriptionError; now: string; retryAt: string; truncatedAtMaxTokens?: number }): Promise<'pending' | 'failed' | null>;
  /** Finished without a model call: the images were cleared or the solve is gone. Either job kind. */
  skipTranscription(jobId: string, errorCode: TranscriptionError, now: string): Promise<void>;
  /** Store the transcript on the solve, link its card (shared by fingerprint when matchable), finish the job. */
  completeTranscription(input: { jobId: string; transcript: QuestionBankTranscript; now: string }): Promise<string | null>;
  /**
   * Failed transcriptions become pending with a fresh call count, except outputs truncated at a token
   * limit of at least `maxTokens`: the current limit would cut them again. Returns how many.
   */
  requeueFailedTranscriptions(now: string, maxTokens: number): Promise<number>;
  occurrenceRows(): Promise<QuestionBankOccurrenceRow[]>;
  inventory(): Promise<QuestionBankInventory>;
  /** Random counted solves (transcribed, account not internal or release-qa now) with at least one stored image. */
  sampleTranscripts(count: number): Promise<QuestionBankSample[]>;
  /** Random matchable cards with two counted solves that still have images; a random pair from each. */
  sampleMatches(count: number): Promise<QuestionBankMatchSample[]>;
  image(attemptId: string, ordinal: number): Promise<{ mediaType: string; bytes: Buffer } | null>;
  /** `missing`: no such transcribed solve, or a match pair not on one matchable card. */
  recordMark(input: QuestionBankMark): Promise<'recorded' | 'replayed' | 'conflict' | 'missing'>;
  marks(): Promise<QuestionBankMark[]>;
  /** `requeueFailedTranscriptions` as an audited admin operation. */
  requeueFailed(input: { operationId: string; actor: string; reason: string; now: string; maxTokens: number }): Promise<QuestionBankOperation<{ requeued: number }>>;
  accountFootprint(deviceId: number): Promise<QuestionBankFootprint>;
  /**
   * Delete one account's solves, images, transcription jobs and the spot-check marks that name them,
   * then every card no other account's solve links to, with its state events and review jobs. A kept
   * card's review job that re-asked one of these solves stays, with its result, and loses only that
   * link. Works on `device_id` alone, so it also clears solves whose devices row no longer exists.
   */
  deleteAccount(input: { operationId: string; deviceId: number; actor: string; reason: string; now: string }): Promise<QuestionBankOperation<QuestionBankFootprint>>;
  /** The audit log, newest first. */
  operations(limit: number): Promise<QuestionBankOperationRecord[]>;
  /** Matchable cards (all, or the given ids) with their counted solves, review jobs and state events. */
  reviewData(cardIds?: string[]): Promise<QuestionBankReviewData>;
  /**
   * The only way a review job comes to exist: one pending job per card, all or none, under an
   * audited operation id. Every card must pass `reviewBlock` inside the same transaction.
   */
  confirmReview(input: { operationId: string; cardIds: string[]; actor: string; reason: string; now: string }): Promise<QuestionBankReviewConfirm>;
  /** Claim the oldest due review job, pick the solve to re-ask and read the card's production answers. */
  claimReview(input: { now: string; leaseUntil: string; modelAttemptId: string }): Promise<ClaimedReview | null>;
  /**
   * Finish a running review job and move its card from `unverified` to `verified_model` (agrees) or
   * `disputed` (anything else), with a state event. Returns the new state, or null when the job was
   * not running or the card had already left `unverified`.
   */
  completeReview(input: { jobId: string; now: string; called: boolean; result: QuestionBankReviewResult }): Promise<QuestionBankCard['state'] | null>;
  /** A disputed card becomes `verified_human` with the admin's answer and basis, under an audited operation id. */
  adjudicate(input: { operationId: string; cardId: string; answer: string; basis: string; actor: string; now: string }): Promise<QuestionBankOperation<{ state: 'verified_human' }> | 'missing' | 'not_disputed'>;
  cardEvents(cardId: string): Promise<QuestionBankCardEvent[]>;
  /** The request a review of this solve would send: its saved prompt, effort and images. Null unless it is transcribed and every image is stored. */
  reviewSolve(attemptId: string): Promise<ReviewSolve | null>;
  /** Spot-check views of the given solves, in the given order; missing ones are left out. */
  solveSamples(attemptIds: string[]): Promise<QuestionBankSample[]>;
  /**
   * Known costs of the most recent succeeded answer and review calls of one model, newest first. A
   * review sends exactly the request an answer did, so both show what a review call costs.
   */
  recentModelCosts(input: { provider: string; model: string; currency: string; limit: number }): Promise<ModelCallCost[]>;
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

export const QUESTION_BANK_CHECKPOINTS = [1000, 1500, 2000] as const;
export const QUESTION_BANK_TOP_ACCOUNTS = 5;

export interface QuestionBankStats {
  denominator: number;
  repeated: number;
  sameAccount: number;
  otherAccount: number;
  repeatRate: number | null;
  sameAccountRate: number | null;
  otherAccountRate: number | null;
  checkpoints: { reached: number[]; next: number | null };
  topAccounts: Array<{ deviceId: number; solves: number; share: number }>;
  /** The top accounts left out as if internal: neither counted nor a precedent for others. */
  withoutTopAccounts: { denominator: number; repeated: number; repeatRate: number | null };
  /** Non-internal solves by transcription state. `coverage` is done ÷ solves. */
  transcription: { solves: number; done: number; waiting: number; failed: number; skipped: number; coverage: number | null; failedByError: Record<string, number> };
}

const ratio = (numerator: number, denominator: number) => denominator === 0 ? null : numerator / denominator;

/** The statistics page numbers, all computed now from the solves (section 9 of the plan). */
export function questionBankStats(rows: QuestionBankOccurrenceRow[]): QuestionBankStats {
  const all = questionBankOccurrences(rows);
  const perAccount = new Map<number, number>();
  for (const row of all.occurrences) perAccount.set(row.deviceId, (perAccount.get(row.deviceId) ?? 0) + 1);
  const top = [...perAccount].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, QUESTION_BANK_TOP_ACCOUNTS);
  const topIds = new Set(top.map(([deviceId]) => deviceId));
  const without = questionBankOccurrences(rows.map(row => topIds.has(row.deviceId) ? { ...row, internal: true } : row));
  const external = rows.filter(row => !row.internal);
  const failedByError: Record<string, number> = {};
  for (const row of external) if (row.jobStatus === 'failed') failedByError[row.jobErrorCode ?? 'unknown'] = (failedByError[row.jobErrorCode ?? 'unknown'] ?? 0) + 1;
  return {
    denominator: all.denominator, repeated: all.repeated, sameAccount: all.sameAccount, otherAccount: all.otherAccount,
    repeatRate: ratio(all.repeated, all.denominator),
    sameAccountRate: ratio(all.sameAccount, all.denominator),
    otherAccountRate: ratio(all.otherAccount, all.denominator),
    checkpoints: {
      reached: QUESTION_BANK_CHECKPOINTS.filter(point => all.denominator >= point),
      next: QUESTION_BANK_CHECKPOINTS.find(point => all.denominator < point) ?? null,
    },
    topAccounts: top.map(([deviceId, solves]) => ({ deviceId, solves, share: solves / all.denominator })),
    withoutTopAccounts: { denominator: without.denominator, repeated: without.repeated, repeatRate: ratio(without.repeated, without.denominator) },
    transcription: {
      solves: external.length, done: all.denominator, waiting: all.waiting, failed: all.failed, skipped: all.skipped,
      coverage: ratio(all.denominator, external.length), failedByError,
    },
  };
}

/** Counts of each verdict, taking only the latest mark per solve or per pair. */
export function questionBankMarkSummary(marks: QuestionBankMark[]): { transcript: { correct: number; wrong: number }; match: { same: number; different: number } } {
  const latest = new Map<string, QuestionBankMark>();
  for (const mark of [...marks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.markId.localeCompare(b.markId))) {
    latest.set(JSON.stringify([mark.kind, mark.attemptId, mark.otherAttemptId]), mark);
  }
  const summary = { transcript: { correct: 0, wrong: 0 }, match: { same: 0, different: 0 } };
  for (const mark of latest.values()) {
    if (mark.kind === 'transcript' && (mark.verdict === 'correct' || mark.verdict === 'wrong')) summary.transcript[mark.verdict] += 1;
    if (mark.kind === 'match' && (mark.verdict === 'same' || mark.verdict === 'different')) summary.match[mark.verdict] += 1;
  }
  return summary;
}

/** Transcription and review model calls by purpose and currency; a missing cost stays unknown. */
export function questionBankCosts(attempts: Array<{ purpose: string; currency: string; costMicros: string | null }>): QuestionBankInventory['costs'] {
  const rows = new Map<string, QuestionBankInventory['costs'][number]>();
  for (const attempt of attempts) {
    const key = JSON.stringify([attempt.purpose, attempt.currency]);
    const row = rows.get(key) ?? { purpose: attempt.purpose, currency: attempt.currency, calls: 0, knownMicros: '0', unknown: 0 };
    row.calls += 1;
    if (attempt.costMicros === null || !/^\d+$/.test(attempt.costMicros)) row.unknown += 1;
    else row.knownMicros = (BigInt(row.knownMicros) + BigInt(attempt.costMicros)).toString();
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.purpose.localeCompare(b.purpose) || a.currency.localeCompare(b.currency));
}

/** Distinct answer contents of solves on one card, most frequent first, each with a raw example. */
export function cardAnswers(solves: Array<Pick<ReviewSolveRow, 'finalAnswer' | 'questionKind' | 'options' | 'createdAt' | 'attemptId'>>): QuestionBankCardView['answers'] {
  const answers = new Map<string, { content: string; example: string; count: number }>();
  for (const solve of [...solves].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.attemptId.localeCompare(b.attemptId))) {
    const content = answerContent(solve.finalAnswer, solve.questionKind, solve.options);
    const row = answers.get(content) ?? { content, example: solve.finalAnswer, count: 0 };
    row.count += 1;
    answers.set(content, row);
  }
  return [...answers.values()].sort((a, b) => b.count - a.count || a.content.localeCompare(b.content));
}

/** The solve a review re-asks: the latest counted one whose images are all still stored. */
export function reviewSolveOf<T extends Pick<ReviewSolveRow, 'createdAt' | 'attemptId' | 'imagesStored'>>(solves: T[]): T | null {
  return [...solves].filter(solve => solve.imagesStored)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.attemptId.localeCompare(a.attemptId))[0] ?? null;
}

const byTime = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

/** The review and adjudication view of each card, computed now from its counted solves, review jobs and events. */
export function questionBankCardViews(data: QuestionBankReviewData): QuestionBankCardView[] {
  const solves = new Map<string, ReviewSolveRow[]>(), jobs = new Map<string, ReviewJobRow[]>(), events = new Map<string, QuestionBankCardEvent[]>();
  for (const solve of data.solves) solves.set(solve.cardId, [...solves.get(solve.cardId) ?? [], solve]);
  for (const job of data.jobs) jobs.set(job.cardId, [...jobs.get(job.cardId) ?? [], job]);
  for (const event of data.events) events.set(event.cardId, [...events.get(event.cardId) ?? [], event]);
  return data.cards.map(card => {
    const own = solves.get(card.cardId) ?? [];
    const answers = cardAnswers(own);
    const reviewSolve = reviewSolveOf(own);
    const cardJobs = [...jobs.get(card.cardId) ?? []].sort((a, b) => byTime(a, b) || a.jobId.localeCompare(b.jobId));
    const cardEvents = [...events.get(card.cardId) ?? []].sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId));
    const open = cardJobs.some(job => job.status === 'pending' || job.status === 'running');
    const blocked: ReviewBlock | null = open ? 'review_open' : card.state !== 'unverified' ? 'reviewed'
      : own.length < 2 ? 'not_repeated' : reviewSolve === null ? 'images_expired' : null;
    return {
      cardId: card.cardId, stem: card.stem, options: card.options, state: card.state, createdAt: card.createdAt,
      occurrences: own.length, answers, answersDiffer: answers.length > 1, reviewAttemptId: reviewSolve?.attemptId ?? null,
      blocked, latestReview: cardJobs.at(-1) ?? null, latestEvent: cardEvents.at(-1) ?? null,
    };
  });
}

/** Every requested card that may not be put up for review now, with the reason; missing or unmatchable cards included. */
export function blockedForReview(cardIds: string[], views: QuestionBankCardView[]): Array<{ cardId: string; reason: ReviewBlock | 'missing' }> {
  const byId = new Map(views.map(view => [view.cardId, view]));
  return cardIds.flatMap((cardId): Array<{ cardId: string; reason: ReviewBlock | 'missing' }> => {
    const view = byId.get(cardId);
    return !view ? [{ cardId, reason: 'missing' }] : view.blocked ? [{ cardId, reason: view.blocked }] : [];
  });
}

/** Most counted solves first; then the older card. */
export function byOccurrences(a: QuestionBankCardView, b: QuestionBankCardView): number {
  return b.occurrences - a.occurrences || a.createdAt.localeCompare(b.createdAt) || a.cardId.localeCompare(b.cardId);
}

/** Binds an operation id to the request it was first used for. */
export function operationFingerprint(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** A random selection without repeats; `Math.random` is enough for a spot check. */
export function sampleOf<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
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
