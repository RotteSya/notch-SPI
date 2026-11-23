import { randomUUID } from 'node:crypto';
import { hashToken } from './db.ts';
import { query, type Row, type RunTransaction, type Transaction } from './billing-sql.ts';
import {
  imageDigest, promptDigest, questionFingerprint, transcriptMatchable, TRANSCRIPTION_MAX_CALLS,
  type ClaimedTranscription, type QuestionBankCard, type QuestionBankCounts, type QuestionBankOccurrenceRow,
  type QuestionBankSolveInput, type QuestionBankStore, type QuestionBankTranscript, type StaleTranscription,
  type StoredQuestionBankAttempt, type StoredQuestionBankImage, type TranscriptionError,
} from './question-bank.ts';

export function questionBankSchema(imageSqlType: 'BYTEA' | 'BLOB'): string {
  return `
CREATE TABLE IF NOT EXISTS question_bank_prompts (
  prompt_sha256 TEXT PRIMARY KEY,
  system_text TEXT NOT NULL,
  task_text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS question_bank_cards (
  card_id TEXT PRIMARY KEY,
  fingerprint TEXT UNIQUE,
  matchable INTEGER NOT NULL CHECK(matchable IN (0,1)),
  language TEXT NOT NULL,
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL,
  has_figure INTEGER NOT NULL CHECK(has_figure IN (0,1)),
  transcript_status TEXT NOT NULL CHECK(transcript_status IN ('ok','multiple','unreadable')),
  state TEXT NOT NULL CHECK(state IN ('unverified','verified_model','verified_human','disputed')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS question_bank_attempts (
  attempt_id TEXT PRIMARY KEY,
  device_id BIGINT NOT NULL,
  capture_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  duration_ms BIGINT NOT NULL CHECK(duration_ms >= 0),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT CHECK(reasoning_effort IS NULL OR reasoning_effort IN ('low','high','max')),
  config_revision TEXT NOT NULL,
  result_protocol TEXT NOT NULL,
  result_state TEXT,
  question_kind TEXT,
  parser_path TEXT,
  model_output TEXT NOT NULL,
  final_answer TEXT NOT NULL,
  explanation TEXT,
  answer_attempt_id TEXT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  prompt_sha256 TEXT NOT NULL REFERENCES question_bank_prompts(prompt_sha256),
  card_id TEXT REFERENCES question_bank_cards(card_id),
  transcript_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_question_bank_attempts_card ON question_bank_attempts(card_id);
CREATE TABLE IF NOT EXISTS question_bank_images (
  attempt_id TEXT NOT NULL REFERENCES question_bank_attempts(attempt_id),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  media_type TEXT NOT NULL,
  byte_count BIGINT NOT NULL CHECK(byte_count >= 0),
  sha256 TEXT NOT NULL,
  content ${imageSqlType},
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(attempt_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_question_bank_images_created ON question_bank_images(created_at);
CREATE TABLE IF NOT EXISTS question_bank_jobs (
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('transcribe','review')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','skipped')),
  attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
  bank_attempt_id TEXT REFERENCES question_bank_attempts(attempt_id),
  card_id TEXT,
  model_attempt_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  lease_expires_at TEXT,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_question_bank_jobs_due ON question_bank_jobs(kind, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_question_bank_jobs_attempt ON question_bank_jobs(bank_attempt_id);
`;
}

function integer(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== '') return Number(value);
  throw new Error('Question bank number missing');
}

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return integer(value);
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function bytesOrNull(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error('Question bank image missing');
}

function attempt(row: Row, images: StoredQuestionBankImage[]): StoredQuestionBankAttempt {
  const effort = textOrNull(row.reasoning_effort);
  const transcript = textOrNull(row.transcript_json);
  return {
    attemptId: String(row.attempt_id),
    deviceId: integer(row.device_id),
    captureId: String(row.capture_id),
    requestId: String(row.request_id),
    createdAt: String(row.created_at),
    durationMs: integer(row.duration_ms),
    provider: String(row.provider),
    model: String(row.model),
    reasoningEffort: effort === 'low' || effort === 'high' || effort === 'max' ? effort : null,
    configRevision: String(row.config_revision),
    resultProtocol: String(row.result_protocol),
    resultState: textOrNull(row.result_state),
    questionKind: textOrNull(row.question_kind),
    parserPath: textOrNull(row.parser_path),
    modelOutput: String(row.model_output),
    finalAnswer: String(row.final_answer),
    explanation: textOrNull(row.explanation),
    answerAttemptId: textOrNull(row.answer_attempt_id),
    inputTokens: integerOrNull(row.input_tokens),
    outputTokens: integerOrNull(row.output_tokens),
    promptSha256: String(row.prompt_sha256),
    system: String(row.system_text),
    task: String(row.task_text),
    images,
    jobKind: textOrNull(row.job_kind),
    jobStatus: textOrNull(row.job_status),
    jobAttemptCount: integerOrNull(row.job_attempt_count),
    jobErrorCode: textOrNull(row.job_error_code),
    cardId: textOrNull(row.card_id),
    transcript: transcript === null ? null : JSON.parse(transcript) as QuestionBankTranscript,
  };
}

function card(row: Row): QuestionBankCard {
  return {
    cardId: String(row.card_id),
    fingerprint: textOrNull(row.fingerprint),
    matchable: integer(row.matchable) === 1,
    language: String(row.language),
    stem: String(row.stem),
    options: JSON.parse(String(row.options_json)) as QuestionBankCard['options'],
    hasFigure: integer(row.has_figure) === 1,
    transcriptStatus: String(row.transcript_status) as QuestionBankCard['transcriptStatus'],
    state: String(row.state) as QuestionBankCard['state'],
    createdAt: String(row.created_at),
  };
}

export class SQLQuestionBankStore implements QuestionBankStore {
  private readonly run: RunTransaction;
  constructor(run: RunTransaction) { this.run = run; }

  recordSolve(input: QuestionBankSolveInput): Promise<void> {
    const digest = promptDigest(input.system, input.task);
    const createdAt = input.createdAt;
    return this.run((function* (): Transaction<void> {
      // Unlocked read. Billing admission locks this devices row FOR UPDATE, so neither a row lock
      // here nor a foreign key to devices (its check takes FOR KEY SHARE) may be held until commit.
      const device = (yield* query('SELECT id FROM devices WHERE token_hash=?', hashToken(input.token)))[0];
      if (!device) throw new Error('Question bank device missing');
      const deviceId = integer(device.id);
      yield* query(
        'INSERT INTO question_bank_prompts (prompt_sha256, system_text, task_text) VALUES (?,?,?) ON CONFLICT (prompt_sha256) DO NOTHING',
        digest, input.system, input.task,
      );
      const attemptId = randomUUID();
      const inserted = yield* query(
        `INSERT INTO question_bank_attempts (
          attempt_id, device_id, capture_id, request_id, created_at, duration_ms, provider, model,
          reasoning_effort, config_revision, result_protocol, result_state, question_kind, parser_path,
          model_output, final_answer, answer_attempt_id, input_tokens, output_tokens, prompt_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (capture_id) DO NOTHING RETURNING attempt_id`,
        attemptId, deviceId, input.captureId, input.requestId, createdAt, input.durationMs, input.provider, input.model,
        input.reasoningEffort, input.configRevision, input.resultProtocol, input.resultState, input.questionKind, input.parserPath,
        input.modelOutput, input.finalAnswer, input.answerAttemptId, input.inputTokens, input.outputTokens, digest,
      );
      if (!inserted.length) return;
      for (let ordinal = 0; ordinal < input.images.length; ordinal += 1) {
        const image = input.images[ordinal]!;
        yield* query(
          `INSERT INTO question_bank_images (attempt_id, ordinal, media_type, byte_count, sha256, content, created_at)
           VALUES (?,?,?,?,?,?,?)`,
          attemptId, ordinal, image.mediaType, image.bytes.length, imageDigest(image.bytes), image.bytes, createdAt,
        );
      }
      const now = new Date().toISOString();
      yield* query(
        `INSERT INTO question_bank_jobs (job_id, kind, status, attempt_count, bank_attempt_id, created_at, updated_at, next_attempt_at)
         VALUES (?,'transcribe','pending',0,?,?,?,?)`,
        randomUUID(), attemptId, now, now, now,
      );
    })());
  }

  appendExplanation(input: { token: string; captureId: string; explanation: string }): Promise<void> {
    return this.run((function* (): Transaction<void> {
      const device = (yield* query('SELECT id FROM devices WHERE token_hash=?', hashToken(input.token)))[0];
      if (!device) return;
      yield* query(
        `UPDATE question_bank_attempts SET explanation=?
         WHERE capture_id=? AND device_id=? AND explanation IS NULL`,
        input.explanation, input.captureId, integer(device.id),
      );
    })());
  }

  findByCapture(captureId: string): Promise<StoredQuestionBankAttempt | null> {
    return this.run((function* (): Transaction<StoredQuestionBankAttempt | null> {
      const row = (yield* query(
        `SELECT a.*, p.system_text, p.task_text, j.kind AS job_kind, j.status AS job_status, j.attempt_count AS job_attempt_count,
           j.error_code AS job_error_code
         FROM question_bank_attempts a
         JOIN question_bank_prompts p ON p.prompt_sha256 = a.prompt_sha256
         LEFT JOIN question_bank_jobs j ON j.bank_attempt_id = a.attempt_id AND j.kind = 'transcribe'
         WHERE a.capture_id = ?`,
        captureId,
      ))[0];
      if (!row) return null;
      const images = yield* query(
        'SELECT ordinal, media_type, byte_count, sha256, content FROM question_bank_images WHERE attempt_id=? ORDER BY ordinal',
        String(row.attempt_id),
      );
      return attempt(row, images.map(image => ({
        ordinal: integer(image.ordinal),
        mediaType: String(image.media_type),
        byteCount: integer(image.byte_count),
        sha256: String(image.sha256),
        bytes: bytesOrNull(image.content),
      })));
    })());
  }

  findCard(cardId: string): Promise<QuestionBankCard | null> {
    return this.run((function* (): Transaction<QuestionBankCard | null> {
      const row = (yield* query('SELECT * FROM question_bank_cards WHERE card_id=?', cardId))[0];
      return row ? card(row) : null;
    })());
  }

  counts(): Promise<QuestionBankCounts> {
    return this.run((function* (): Transaction<QuestionBankCounts> {
      const row = (yield* query(
        `SELECT
           (SELECT COUNT(*) FROM question_bank_attempts) AS attempts,
           (SELECT COUNT(*) FROM question_bank_images) AS images,
           (SELECT COUNT(*) FROM question_bank_prompts) AS prompts,
           (SELECT COUNT(*) FROM question_bank_jobs) AS jobs,
           (SELECT COUNT(*) FROM question_bank_cards) AS cards`,
      ))[0]!;
      return {
        attempts: integer(row.attempts),
        images: integer(row.images),
        prompts: integer(row.prompts),
        jobs: integer(row.jobs),
        cards: integer(row.cards),
      };
    })());
  }

  purgeImages(cutoff: string, now: string, limit: number): Promise<number> {
    return this.run((function* (): Transaction<number> {
      const cleared = yield* query(
        `UPDATE question_bank_images SET content=NULL, deleted_at=?
         WHERE content IS NOT NULL AND created_at<? AND attempt_id IN (
           SELECT attempt_id FROM question_bank_images WHERE content IS NOT NULL AND created_at<? ORDER BY created_at LIMIT ?
         ) RETURNING attempt_id`,
        now, cutoff, cutoff, limit,
      );
      return cleared.length;
    })());
  }

  recoverStaleTranscriptions(now: string): Promise<StaleTranscription[]> {
    return this.run((function* (): Transaction<StaleTranscription[]> {
      const rows = yield* query(
        `SELECT j.job_id, j.attempt_count, j.model_attempt_id, a.device_id
         FROM question_bank_jobs j LEFT JOIN question_bank_attempts a ON a.attempt_id = j.bank_attempt_id
         WHERE j.kind='transcribe' AND j.status='running' AND j.lease_expires_at<=? ORDER BY j.lease_expires_at LIMIT 50`,
        now,
      );
      const stale: StaleTranscription[] = [];
      for (const row of rows) {
        const calls = integer(row.attempt_count) + 1;
        const updated = yield* query(
          `UPDATE question_bank_jobs SET status=?, attempt_count=?, lease_expires_at=NULL, error_code='lease_expired',
             next_attempt_at=?, updated_at=? WHERE job_id=? AND status='running' RETURNING job_id`,
          calls >= TRANSCRIPTION_MAX_CALLS ? 'failed' : 'pending', calls, now, now, String(row.job_id),
        );
        if (updated.length) stale.push({ jobId: String(row.job_id), deviceId: integerOrNull(row.device_id), modelAttemptId: textOrNull(row.model_attempt_id) });
      }
      return stale;
    })());
  }

  claimTranscription(input: { now: string; leaseUntil: string; modelAttemptId: string }): Promise<ClaimedTranscription | null> {
    return this.run((function* (): Transaction<ClaimedTranscription | null> {
      const due = yield* query(
        `SELECT job_id FROM question_bank_jobs WHERE kind='transcribe' AND status='pending' AND next_attempt_at<=?
         ORDER BY next_attempt_at, created_at, job_id LIMIT 8`,
        input.now,
      );
      for (const candidate of due) {
        // Another worker may have claimed it after the read; only the update that still sees pending wins.
        const claimed = (yield* query(
          `UPDATE question_bank_jobs SET status='running', lease_expires_at=?, model_attempt_id=?, updated_at=?
           WHERE job_id=? AND status='pending' RETURNING job_id, attempt_count, bank_attempt_id`,
          input.leaseUntil, input.modelAttemptId, input.now, String(candidate.job_id),
        ))[0];
        if (!claimed) continue;
        const solve = (yield* query(
          'SELECT attempt_id, device_id, request_id, capture_id FROM question_bank_attempts WHERE attempt_id=?',
          textOrNull(claimed.bank_attempt_id),
        ))[0];
        if (!solve) {
          yield* query(
            `UPDATE question_bank_jobs SET status='skipped', error_code='attempt_missing', lease_expires_at=NULL, updated_at=? WHERE job_id=?`,
            input.now, String(claimed.job_id),
          );
          continue;
        }
        const images = yield* query(
          'SELECT media_type, content FROM question_bank_images WHERE attempt_id=? ORDER BY ordinal', String(solve.attempt_id),
        );
        return {
          jobId: String(claimed.job_id), attemptCount: integer(claimed.attempt_count), modelAttemptId: input.modelAttemptId,
          bankAttemptId: String(solve.attempt_id), deviceId: integer(solve.device_id), requestId: String(solve.request_id),
          captureId: String(solve.capture_id),
          images: images.map(image => ({ mediaType: String(image.media_type), bytes: bytesOrNull(image.content) })),
        };
      }
      return null;
    })());
  }

  releaseTranscription(jobId: string, now: string): Promise<void> {
    return this.run((function* (): Transaction<void> {
      yield* query(
        `UPDATE question_bank_jobs SET status='pending', lease_expires_at=NULL, model_attempt_id=NULL, updated_at=?
         WHERE job_id=? AND status='running'`,
        now, jobId,
      );
    })());
  }

  failTranscription(input: { jobId: string; errorCode: TranscriptionError; now: string; retryAt: string }): Promise<'pending' | 'failed' | null> {
    return this.run((function* (): Transaction<'pending' | 'failed' | null> {
      const job = (yield* query(`SELECT attempt_count FROM question_bank_jobs WHERE job_id=? AND status='running'`, input.jobId))[0];
      if (!job) return null;
      const calls = integer(job.attempt_count) + 1;
      const status = calls >= TRANSCRIPTION_MAX_CALLS ? 'failed' : 'pending';
      yield* query(
        `UPDATE question_bank_jobs SET status=?, attempt_count=?, error_code=?, lease_expires_at=NULL, next_attempt_at=?, updated_at=?
         WHERE job_id=? AND status='running'`,
        status, calls, input.errorCode, input.retryAt, input.now, input.jobId,
      );
      return status;
    })());
  }

  skipTranscription(jobId: string, errorCode: TranscriptionError, now: string): Promise<void> {
    return this.run((function* (): Transaction<void> {
      yield* query(
        `UPDATE question_bank_jobs SET status='skipped', error_code=?, lease_expires_at=NULL, updated_at=? WHERE job_id=? AND status='running'`,
        errorCode, now, jobId,
      );
    })());
  }

  completeTranscription(input: { jobId: string; transcript: QuestionBankTranscript; now: string }): Promise<string | null> {
    const transcript = input.transcript;
    const matchable = transcriptMatchable(transcript);
    const fingerprint = matchable ? questionFingerprint(transcript) : null;
    return this.run((function* (): Transaction<string | null> {
      const job = (yield* query(`SELECT bank_attempt_id FROM question_bank_jobs WHERE job_id=? AND status='running'`, input.jobId))[0];
      if (!job) return null;
      const solve = (yield* query('SELECT attempt_id FROM question_bank_attempts WHERE attempt_id=?', textOrNull(job.bank_attempt_id)))[0];
      if (!solve) {
        yield* query(`UPDATE question_bank_jobs SET status='skipped', error_code='attempt_missing', lease_expires_at=NULL, updated_at=? WHERE job_id=?`, input.now, input.jobId);
        return null;
      }
      const fields = [transcript.language, transcript.stem, JSON.stringify(transcript.options), transcript.has_figure ? 1 : 0, transcript.status] as const;
      let cardId: string;
      if (fingerprint) {
        // The first transcript of a question names the card; later identical questions join it.
        yield* query(
          `INSERT INTO question_bank_cards (card_id, fingerprint, matchable, language, stem, options_json, has_figure, transcript_status, state, created_at)
           VALUES (?,?,1,?,?,?,?,?,'unverified',?) ON CONFLICT (fingerprint) DO NOTHING`,
          randomUUID(), fingerprint, ...fields, input.now,
        );
        cardId = String((yield* query('SELECT card_id FROM question_bank_cards WHERE fingerprint=?', fingerprint))[0]!.card_id);
      } else {
        cardId = randomUUID();
        yield* query(
          `INSERT INTO question_bank_cards (card_id, fingerprint, matchable, language, stem, options_json, has_figure, transcript_status, state, created_at)
           VALUES (?,NULL,0,?,?,?,?,?,'unverified',?)`,
          cardId, ...fields, input.now,
        );
      }
      yield* query('UPDATE question_bank_attempts SET card_id=?, transcript_json=? WHERE attempt_id=?', cardId, JSON.stringify(transcript), String(solve.attempt_id));
      yield* query(
        `UPDATE question_bank_jobs SET status='done', attempt_count=attempt_count+1, card_id=?, error_code=NULL, lease_expires_at=NULL, updated_at=?
         WHERE job_id=?`,
        cardId, input.now, input.jobId,
      );
      return cardId;
    })());
  }

  requeueFailedTranscriptions(now: string): Promise<number> {
    return this.run((function* (): Transaction<number> {
      return (yield* query(
        `UPDATE question_bank_jobs SET status='pending', attempt_count=0, error_code=NULL, next_attempt_at=?, updated_at=?
         WHERE kind='transcribe' AND status='failed' RETURNING job_id`,
        now, now,
      )).length;
    })());
  }

  occurrenceRows(): Promise<QuestionBankOccurrenceRow[]> {
    return this.run((function* (): Transaction<QuestionBankOccurrenceRow[]> {
      const rows = yield* query(
        `SELECT a.attempt_id, a.device_id, a.created_at, a.card_id, c.matchable, d.is_internal, j.status AS job_status
         FROM question_bank_attempts a
         LEFT JOIN question_bank_cards c ON c.card_id = a.card_id
         LEFT JOIN devices d ON d.id = a.device_id
         LEFT JOIN question_bank_jobs j ON j.bank_attempt_id = a.attempt_id AND j.kind = 'transcribe'`,
      );
      return rows.map(row => ({
        attemptId: String(row.attempt_id), deviceId: integer(row.device_id), createdAt: String(row.created_at),
        internal: row.is_internal === true || Number(row.is_internal) === 1, jobStatus: textOrNull(row.job_status),
        cardId: textOrNull(row.card_id), matchable: integerOrNull(row.matchable) === 1,
      }));
    })());
  }
}
