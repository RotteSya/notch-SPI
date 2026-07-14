import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Account, RegisteredDevice, Store } from './db.ts';
import { hashToken, newToken } from './db.ts';

// Local/self-hosted store: SQLite via the Node built-in driver. Kept in its own module so
// platforms without node:sqlite (or with a read-only filesystem) never load it — the storage
// factory imports implementations dynamically.

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
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_device ON usage_events(device_id);
CREATE INDEX IF NOT EXISTS idx_topups_device ON topups(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_reference ON topups(reference);
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
    // Lazy migration: databases created before the admin grant tool lack topups.note. SQLite's
    // ADD COLUMN has no IF NOT EXISTS, so probe the schema first (idempotent on every boot).
    this.ensureColumn('topups', 'note');
  }

  private ensureColumn(table: string, column: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }

  async registerDevice(input: {
    platform: string;
    appVersion: string;
    trialQuestions: number;
  }): Promise<RegisteredDevice> {
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

  async getAccount(token: string): Promise<Account | null> {
    const row = this.deviceByToken(token);
    if (!row) return null;
    return {
      balanceQuestions: row.balance_questions,
      totalQuestions: row.total_questions,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
    };
  }

  async chargeForUsage(input: {
    token: string;
    questions: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }): Promise<number | null> {
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

  async credit(input: {
    token: string;
    questions: number;
    amountCents: number;
    currency: string;
    provider: string;
    reference: string;
    note?: string;
  }): Promise<number | null> {
    return this.tx(() => {
      const dev = this.deviceByToken(input.token);
      if (!dev) return null;
      // Idempotency: a reference that was already credited (retried webhook delivery)
      // must not credit twice. Return the current balance unchanged.
      const dup = this.db
        .prepare(`SELECT id FROM topups WHERE reference = ?`)
        .get(input.reference);
      if (dup) return dev.balance_questions;

      const now = new Date().toISOString();
      const newBalance = dev.balance_questions + input.questions;
      this.db
        .prepare(`UPDATE devices SET balance_questions = ?, updated_at = ? WHERE id = ?`)
        .run(newBalance, now, dev.id);
      this.db
        .prepare(
          `INSERT INTO topups (device_id, questions, amount_cents, currency, provider, reference, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(dev.id, input.questions, input.amountCents, input.currency, input.provider, input.reference, input.note ?? null, now);
      return newBalance;
    });
  }

  async bumpCounter(name: string): Promise<number> {
    const row = this.db
      .prepare(
        `INSERT INTO counters (name, value) VALUES (?, 1)
         ON CONFLICT(name) DO UPDATE SET value = value + 1
         RETURNING value`,
      )
      .get(name) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  async getCounter(name: string): Promise<number> {
    const row = this.db.prepare(`SELECT value FROM counters WHERE name = ?`).get(name) as
      | { value: number }
      | undefined;
    return row?.value ?? 0;
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

  async close(): Promise<void> {
    this.db.close();
  }
}
