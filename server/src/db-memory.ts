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
}

export class MemoryStore implements Store {
  private devices = new Map<string, DeviceRecord>(); // keyed by token hash
  private creditedReferences = new Set<string>();

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
    };
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
  }): Promise<number | null> {
    const d = this.devices.get(hashToken(input.token));
    if (!d) return null;
    if (this.creditedReferences.has(input.reference)) return d.balanceQuestions;
    this.creditedReferences.add(input.reference);
    d.balanceQuestions += input.questions;
    return d.balanceQuestions;
  }

  async close(): Promise<void> {}
}
