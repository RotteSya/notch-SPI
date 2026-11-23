import { randomUUID } from 'node:crypto';
import { hashToken } from './db.ts';
import { query, type Row, type RunTransaction, type Transaction } from './billing-sql.ts';
import {
  imageDigest, promptDigest,
  type QuestionBankCounts, type QuestionBankSolveInput, type QuestionBankStore, type StoredQuestionBankAttempt,
  type StoredQuestionBankImage,
} from './question-bank.ts';

export function questionBankSchema(imageSqlType: 'BYTEA' | 'BLOB'): string {
  return `
CREATE TABLE IF NOT EXISTS question_bank_prompts (
  prompt_sha256 TEXT PRIMARY KEY,
  system_text TEXT NOT NULL,
  task_text TEXT NOT NULL
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
  prompt_sha256 TEXT NOT NULL REFERENCES question_bank_prompts(prompt_sha256)
);
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
  error_code TEXT
);
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

function bytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error('Question bank image missing');
}

function attempt(row: Row, images: StoredQuestionBankImage[]): StoredQuestionBankAttempt {
  const effort = textOrNull(row.reasoning_effort);
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
        `INSERT INTO question_bank_jobs (job_id, kind, status, attempt_count, bank_attempt_id, created_at, updated_at)
         VALUES (?,'transcribe','pending',0,?,?,?)`,
        randomUUID(), attemptId, now, now,
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
        `SELECT a.*, p.system_text, p.task_text, j.kind AS job_kind, j.status AS job_status, j.attempt_count AS job_attempt_count
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
        bytes: bytes(image.content),
      })));
    })());
  }

  counts(): Promise<QuestionBankCounts> {
    return this.run((function* (): Transaction<QuestionBankCounts> {
      const row = (yield* query(
        `SELECT
           (SELECT COUNT(*) FROM question_bank_attempts) AS attempts,
           (SELECT COUNT(*) FROM question_bank_images) AS images,
           (SELECT COUNT(*) FROM question_bank_prompts) AS prompts,
           (SELECT COUNT(*) FROM question_bank_jobs) AS jobs`,
      ))[0]!;
      return {
        attempts: integer(row.attempts),
        images: integer(row.images),
        prompts: integer(row.prompts),
        jobs: integer(row.jobs),
      };
    })());
  }
}
