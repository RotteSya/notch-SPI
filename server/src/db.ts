import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Data access is behind this interface so the SQLite implementation can be swapped for a
// Postgres one in production without touching routes. The account balance is an integer number
// of QUESTIONS (题数额度制); token counts are kept for internal cost accounting only. Money
// (integer cents) appears only on top-up records. Time is ISO-8601 UTC.

export interface Account {
  balanceQuestions: number;
  totalQuestions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface RegisteredDevice {
  token: string; // plaintext, returned ONCE at registration
  balanceQuestions: number;
}

export interface Store {
  registerDevice(input: {
    platform: string;
    appVersion: string;
    trialQuestions: number;
  }): RegisteredDevice;

  /** Account snapshot for a bearer token, or null if the token is unknown/invalid. */
  getAccount(token: string): Account | null;

  /**
   * Atomically deduct `questions`, add to lifetime totals, and append a usage row.
   * Returns the new question balance, or null if the token is invalid. The balance may go
   * negative when a capture was already in flight as it hit zero; the pre-request gate stops
   * the NEXT capture — honest accounting over silent clamping.
   */
  chargeForUsage(input: {
    token: string;
    questions: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }): number | null;

  /** Credit a purchased question pack. Returns the new balance, or null if the token is invalid. */
  credit(input: {
    token: string;
    questions: number;
    amountCents: number;
    currency: string;
    provider: string;
    reference: string;
  }): number | null;

  close(): void;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  // Opaque, URL-safe bearer credential. "dev_" prefix matches the client's expectation.
  return 'dev_' + randomBytes(24).toString('base64url');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash          TEXT NOT NULL UNIQUE,
  platform            TEXT,
  app_version         TEXT,
  balance_questions   INTEGER NOT NULL DEFAULT 0,
  total_questions     INTEGER NOT NULL DEFAULT 0,
  total_input_tokens  INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     INTEGER NOT NULL REFERENCES devices(id),
  questions     INTEGER NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  model         TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    INTEGER NOT NULL REFERENCES devices(id),
  questions    INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  provider     TEXT NOT NULL,
  reference    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_device ON usage_events(device_id);
CREATE INDEX IF NOT EXISTS idx_topups_device ON topups(device_id);
`;

interface DeviceRow {
  id: number;
  balance_questions: number;
  total_questions: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  registerDevice(input: {
    platform: string;
    appVersion: string;
    trialQuestions: number;
  }): RegisteredDevice {
    const token = newToken();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO devices (token_hash, platform, app_version, balance_questions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(hashToken(token), input.platform, input.appVersion, input.trialQuestions, now, now);
    return { token, balanceQuestions: input.trialQuestions };
  }

  private deviceByToken(token: string): DeviceRow | null {
    const row = this.db
      .prepare(
        `SELECT id, balance_questions, total_questions, total_input_tokens, total_output_tokens
         FROM devices WHERE token_hash = ?`,
      )
      .get(hashToken(token)) as DeviceRow | undefined;
    return row ?? null;
  }

  getAccount(token: string): Account | null {
    const row = this.deviceByToken(token);
    if (!row) return null;
    return {
      balanceQuestions: row.balance_questions,
      totalQuestions: row.total_questions,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
    };
  }

  chargeForUsage(input: {
    token: string;
    questions: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }): number | null {
    return this.tx(() => {
      const dev = this.deviceByToken(input.token);
      if (!dev) return null;
      const now = new Date().toISOString();
      const newBalance = dev.balance_questions - input.questions;
      this.db
        .prepare(
          `UPDATE devices SET balance_questions = ?,
             total_questions = total_questions + ?,
             total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             updated_at = ? WHERE id = ?`,
        )
        .run(newBalance, input.questions, input.inputTokens, input.outputTokens, now, dev.id);
      this.db
        .prepare(
          `INSERT INTO usage_events (device_id, questions, input_tokens, output_tokens, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(dev.id, input.questions, input.inputTokens, input.outputTokens, input.model, now);
      return newBalance;
    });
  }

  credit(input: {
    token: string;
    questions: number;
    amountCents: number;
    currency: string;
    provider: string;
    reference: string;
  }): number | null {
    return this.tx(() => {
      const dev = this.deviceByToken(input.token);
      if (!dev) return null;
      const now = new Date().toISOString();
      const newBalance = dev.balance_questions + input.questions;
      this.db
        .prepare(`UPDATE devices SET balance_questions = ?, updated_at = ? WHERE id = ?`)
        .run(newBalance, now, dev.id);
      this.db
        .prepare(
          `INSERT INTO topups (device_id, questions, amount_cents, currency, provider, reference, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(dev.id, input.questions, input.amountCents, input.currency, input.provider, input.reference, now);
      return newBalance;
    });
  }

  /** Run `fn` inside a transaction; rollback on any throw. node:sqlite is synchronous. */
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}
