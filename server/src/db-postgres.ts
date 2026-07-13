import pg from 'pg';
import type { Account, RegisteredDevice, Store } from './db.ts';
import { hashToken, newToken } from './db.ts';

// Production store: Postgres via the standard `pg` driver. Works with any provider (Neon,
// Supabase, RDS, …); on serverless platforms use the provider's POOLED connection string.
// Schema is created lazily on first use, so a fresh database needs no migration step.
// Semantics match SqliteStore exactly, including idempotent credits by reference.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id                  BIGSERIAL PRIMARY KEY,
  token_hash          TEXT NOT NULL UNIQUE,
  platform            TEXT,
  app_version         TEXT,
  balance_questions   BIGINT NOT NULL DEFAULT 0,
  total_questions     BIGINT NOT NULL DEFAULT 0,
  total_input_tokens  BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_events (
  id            BIGSERIAL PRIMARY KEY,
  device_id     BIGINT NOT NULL REFERENCES devices(id),
  questions     BIGINT NOT NULL,
  input_tokens  BIGINT NOT NULL,
  output_tokens BIGINT NOT NULL,
  model         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS topups (
  id           BIGSERIAL PRIMARY KEY,
  device_id    BIGINT NOT NULL REFERENCES devices(id),
  questions    BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency     TEXT NOT NULL,
  provider     TEXT NOT NULL,
  reference    TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Lazy migration for databases created before the admin grant tool (Postgres supports the
-- IF NOT EXISTS guard, so this is a safe no-op once the column exists).
ALTER TABLE topups ADD COLUMN IF NOT EXISTS note TEXT;
CREATE INDEX IF NOT EXISTS idx_usage_device ON usage_events(device_id);
CREATE INDEX IF NOT EXISTS idx_topups_device ON topups(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_reference ON topups(reference);
`;

interface DeviceRow {
  id: string;
  balance_questions: string;
  total_questions: string;
  total_input_tokens: string;
  total_output_tokens: string;
}

export class PostgresStore implements Store {
  private pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 5, // serverless-friendly; use the provider's pooled URL for real concurrency
      // Managed Postgres (Neon/Supabase/RDS) requires TLS; local dev URLs can opt out
      // with ?sslmode=disable which the driver honors from the URL itself.
      ssl: connectionString.includes('sslmode=disable') ? undefined : { rejectUnauthorized: false },
    });
  }

  /** Lazily create the schema once per process; all public methods await this. */
  private ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool.query(SCHEMA).then(() => undefined);
    }
    return this.ready;
  }

  async registerDevice(input: {
    platform: string;
    appVersion: string;
    trialQuestions: number;
  }): Promise<RegisteredDevice> {
    await this.ensureSchema();
    const token = newToken();
    await this.pool.query(
      `INSERT INTO devices (token_hash, platform, app_version, balance_questions)
       VALUES ($1, $2, $3, $4)`,
      [hashToken(token), input.platform, input.appVersion, input.trialQuestions],
    );
    return { token, balanceQuestions: input.trialQuestions };
  }

  async getAccount(token: string): Promise<Account | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<DeviceRow>(
      `SELECT id, balance_questions, total_questions, total_input_tokens, total_output_tokens
       FROM devices WHERE token_hash = $1`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      balanceQuestions: Number(row.balance_questions),
      totalQuestions: Number(row.total_questions),
      totalInputTokens: Number(row.total_input_tokens),
      totalOutputTokens: Number(row.total_output_tokens),
    };
  }

  async chargeForUsage(input: {
    token: string;
    questions: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }): Promise<number | null> {
    await this.ensureSchema();
    return this.tx(async (client) => {
      const { rows } = await client.query<DeviceRow>(
        `SELECT id, balance_questions FROM devices WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(input.token)],
      );
      const dev = rows[0];
      if (!dev) return null;
      const newBalance = Number(dev.balance_questions) - input.questions;
      await client.query(
        `UPDATE devices SET balance_questions = $1,
           total_questions = total_questions + $2,
           total_input_tokens = total_input_tokens + $3,
           total_output_tokens = total_output_tokens + $4,
           updated_at = now() WHERE id = $5`,
        [newBalance, input.questions, input.inputTokens, input.outputTokens, dev.id],
      );
      await client.query(
        `INSERT INTO usage_events (device_id, questions, input_tokens, output_tokens, model)
         VALUES ($1, $2, $3, $4, $5)`,
        [dev.id, input.questions, input.inputTokens, input.outputTokens, input.model],
      );
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
    await this.ensureSchema();
    return this.tx(async (client) => {
      const { rows } = await client.query<DeviceRow>(
        `SELECT id, balance_questions FROM devices WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(input.token)],
      );
      const dev = rows[0];
      if (!dev) return null;
      // Idempotency: the unique index on reference is the hard guarantee; this check makes
      // a retried webhook delivery a clean no-op instead of a unique-violation rollback.
      const dup = await client.query(`SELECT 1 FROM topups WHERE reference = $1`, [input.reference]);
      if ((dup.rowCount ?? 0) > 0) return Number(dev.balance_questions);

      const newBalance = Number(dev.balance_questions) + input.questions;
      await client.query(
        `UPDATE devices SET balance_questions = $1, updated_at = now() WHERE id = $2`,
        [newBalance, dev.id],
      );
      await client.query(
        `INSERT INTO topups (device_id, questions, amount_cents, currency, provider, reference, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dev.id, input.questions, input.amountCents, input.currency, input.provider, input.reference, input.note ?? null],
      );
      return newBalance;
    });
  }

  private async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
