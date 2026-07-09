// Central configuration, read from environment with safe defaults so the server boots
// out-of-the-box for local development (mock provider, in-repo SQLite file). Every value
// an operator must set for production (vendor keys, payment provider) is surfaced here and
// documented in .env.example.

import { parsePacks, DEFAULT_PACKS_JSON } from './pricing.ts';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

// Which vendor the official service proxies to. "mock" streams a canned answer with synthetic
// usage so the whole billing pipeline runs end-to-end without any real API key.
export type ProviderName = 'anthropic' | 'openai' | 'mock';

function envProvider(): ProviderName {
  const v = envStr('OFFICIAL_PROVIDER', 'mock').toLowerCase();
  return v === 'anthropic' || v === 'openai' ? v : 'mock';
}

export const config = {
  host: envStr('HOST', '0.0.0.0'),
  port: envInt('PORT', 8787),

  // SQLite file path. ":memory:" is handy for tests. Swap the whole Store for Postgres in prod.
  dbPath: envStr('DB_PATH', './data/notchspi.db'),

  // Public base URL of THIS server, used to build absolute links (e.g. the top-up page).
  publicBaseURL: envStr('PUBLIC_BASE_URL', 'http://localhost:8787'),

  // ---- Quota model (题数额度制) ----------------------------------------------------------
  // The account balance is an integer number of QUESTIONS; one successful capture costs one
  // question. Money only appears at purchase time (the top-up page sells question packs).

  // Free questions granted to each newly registered device.
  trialQuestions: envInt('TRIAL_QUESTIONS', 180),

  // Question packs sold on the top-up page: JSON `[{"id":"pack100","questions":100,"amount_cents":900}, …]`.
  // Prices are cents in `currency`. Falls back to the default catalog on parse errors.
  packs: parsePacks(envStr('PACKS_JSON', DEFAULT_PACKS_JSON)),

  // Currency the packs are priced in (display + payment provider).
  currency: envStr('CURRENCY', 'CNY'),

  provider: envProvider(),
  // Model the official service uses. The client never chooses; the server decides.
  model: envStr('OFFICIAL_MODEL', 'claude-opus-4-8'),
  maxTokens: envInt('OFFICIAL_MAX_TOKENS', 4096),

  anthropicKey: envStr('ANTHROPIC_API_KEY', ''),
  anthropicBaseURL: envStr('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
  openaiKey: envStr('OPENAI_API_KEY', ''),
  openaiBaseURL: envStr('OPENAI_BASE_URL', 'https://api.openai.com'),

  // Payment provider for the top-up page. "stub" credits the account via a dev-only endpoint
  // so the flow is testable; real providers (Stripe / Alipay / WeChat) plug in behind the same
  // PaymentProvider interface. The stub top-up endpoint can arbitrarily credit balances and is
  // unauthenticated, so it is DISABLED by default — a production deploy stays safe unless an
  // operator explicitly sets ALLOW_STUB_TOPUP=1 for local development.
  paymentProvider: envStr('PAYMENT_PROVIDER', 'stub'),
  allowStubTopUp: envStr('ALLOW_STUB_TOPUP', '0') === '1',
} as const;

export type Config = typeof config;
