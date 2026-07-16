import type { Account, RegisteredDevice, Store } from './db.ts';
import { hashToken, newToken } from './db.ts';

// Pure-JS in-memory store. Used as the EPHEMERAL fallback on serverless platforms when no
// POSTGRES_URL is configured (data vanishes per instance — /healthz reports db:"memory" so a
// misconfigured production is visible at a glance), and in tests where a filesystem-free store
// keeps things fast. Same semantics as SqliteStore, including idempotent credits.

interface DeviceRecord {
  tokenHash: string;
  balanceQuestions: number;
  totalQuestions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cliEnabled: boolean;
}

export class MemoryStore implements Store {
  private devices = new Map<string, DeviceRecord>(); // keyed by token hash
  private creditedReferences = new Set<string>();
  private counters = new Map<string, number>();

  async registerDevice(input: {
    platform: string;
    appVersion: string;
    trialQuestions: number;
  }): Promise<RegisteredDevice> {
    const token = newToken();
    this.devices.set(hashToken(token), {
      tokenHash: hashToken(token),
      balanceQuestions: input.trialQuestions,
      totalQuestions: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cliEnabled: false,
    });
    return { token, balanceQuestions: input.trialQuestions };
  }

  async getAccount(token: string): Promise<Account | null> {
    const d = this.devices.get(hashToken(token));
    if (!d) return null;
    return {
      balanceQuestions: d.balanceQuestions,
      totalQuestions: d.totalQuestions,
      totalInputTokens: d.totalInputTokens,
      totalOutputTokens: d.totalOutputTokens,
      cliEnabled: d.cliEnabled,
    };
  }

  async setCliEnabled(token: string, enabled: boolean): Promise<boolean | null> {
    const d = this.devices.get(hashToken(token));
    if (!d) return null;
    d.cliEnabled = enabled;
    return enabled;
  }

  async chargeForUsage(input: {
    token: string;
    questions: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }): Promise<number | null> {
    const d = this.devices.get(hashToken(input.token));
    if (!d) return null;
    d.balanceQuestions -= input.questions;
    d.totalQuestions += input.questions;
    d.totalInputTokens += input.inputTokens;
    d.totalOutputTokens += input.outputTokens;
    return d.balanceQuestions;
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
    const d = this.devices.get(hashToken(input.token));
    if (!d) return null;
    if (this.creditedReferences.has(input.reference)) return d.balanceQuestions;
    this.creditedReferences.add(input.reference);
    d.balanceQuestions += input.questions;
    return d.balanceQuestions;
  }

  async bumpCounter(name: string): Promise<number> {
    const value = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, value);
    return value;
  }

  async getCounter(name: string): Promise<number> {
    return this.counters.get(name) ?? 0;
  }

  async close(): Promise<void> {}
}
