import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Data access is behind this interface so the SQLite implementation can be swapped for a
// Postgres one in production without touching routes. All money is integer cents; all token
// counts are integers. Time is ISO-8601 UTC.

export interface Account {
  balanceCents: number;
  currency: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface RegisteredDevice {
  token: string; // plaintext, returned ONCE at registration
  balanceCents: number;
  currency: string;
}

export interface Store {
  registerDevice(input: {
    platform: string;
    appVersion: string;
    trialCreditCents: number;
    currency: string;
  }): RegisteredDevice;

  /** Account snapshot for a bearer token, or null if the token is unknown/invalid. */
  getAccount(token: string): Account | null;

  /**
   * Atomically deduct `costCents`, add to lifetime token totals, and append a usage row.
   * Returns the new balance, or null if the token is invalid. Balance may go negative when a
   * single in-flight capture exceeds the remaining balance; the pre-request gate stops the
   * NEXT capture — honest accounting over silent clamping.
   */
  chargeForUsage(input: {
    token: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    model: string;
  }): number | null;

  /** Credit a top-up. Returns the new balance, or null if the token is invalid. */
  credit(input: {
    token: string;
    amountCents: number;
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
  currency            TEXT NOT NULL,
  balance_cents       INTEGER NOT NULL DEFAULT 0,
  total_input_tokens  INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     INTEGER NOT NULL REFERENCES devices(id),
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cents    INTEGER NOT NULL,
  model         TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    INTEGER NOT NULL REFERENCES devices(id),
  amount_cents INTEGER NOT NULL,
  provider     TEXT NOT NULL,
  reference    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_device ON usage_events(device_id);
CREATE INDEX IF NOT EXISTS idx_topups_device ON topups(device_id);
`;

interface DeviceRow {
  id: number;
  currency: string;
  balance_cents: number;
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
    trialCreditCents: number;
    currency: string;
  }): RegisteredDevice {
    const token = newToken();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO devices (token_hash, platform, app_version, currency, balance_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hashToken(token),
        input.platform,
        input.appVersion,
        input.currency,
        input.trialCreditCents,
        now,
        now,
      );
    return { token, balanceCents: input.trialCreditCents, currency: input.currency };
  }

  private deviceByToken(token: string): DeviceRow | null {
    const row = this.db
      .prepare(
        `SELECT id, currency, balance_cents, total_input_tokens, total_output_tokens
         FROM devices WHERE token_hash = ?`,
      )
      .get(hashToken(token)) as DeviceRow | undefined;
    return row ?? null;
  }

  getAccount(token: string): Account | null {
    const row = this.deviceByToken(token);
    if (!row) return null;
    return {
      balanceCents: row.balance_cents,
      currency: row.currency,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
    };
  }

  chargeForUsage(input: {
    token: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    model: string;
  }): number | null {
    return this.tx(() => {
      const dev = this.deviceByToken(input.token);
      if (!dev) return null;
      const now = new Date().toISOString();
      const newBalance = dev.balance_cents - input.costCents;
      this.db
        .prepare(
          `UPDATE devices SET balance_cents = ?,
             total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             updated_at = ? WHERE id = ?`,
        )
        .run(newBalance, input.inputTokens, input.outputTokens, now, dev.id);
      this.db
        .prepare(
          `INSERT INTO usage_events (device_id, input_tokens, output_tokens, cost_cents, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(dev.id, input.inputTokens, input.outputTokens, input.costCents, input.model, now);
      return newBalance;
    });
  }

  credit(input: {
    token: string;
    amountCents: number;
    provider: string;
    reference: string;
  }): number | null {
    return this.tx(() => {
      const dev = this.deviceByToken(input.token);
      if (!dev) return null;
      const now = new Date().toISOString();
      const newBalance = dev.balance_cents + input.amountCents;
      this.db
        .prepare(`UPDATE devices SET balance_cents = ?, updated_at = ? WHERE id = ?`)
        .run(newBalance, now, dev.id);
      this.db
        .prepare(
          `INSERT INTO topups (device_id, amount_cents, provider, reference, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(dev.id, input.amountCents, input.provider, input.reference, now);
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
