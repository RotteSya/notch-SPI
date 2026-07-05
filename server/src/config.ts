// Central configuration, read from environment with safe defaults so the server boots
// out-of-the-box for local development (mock provider, in-repo SQLite file). Every value
// an operator must set for production (vendor keys, payment provider) is surfaced here and
// documented in .env.example.

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

  // Currency shown to the client. Pricing below is expressed in this currency's cents.
  currency: envStr('CURRENCY', 'CNY'),

  // Trial credit granted to each newly registered device, in cents.
  trialCreditCents: envInt('TRIAL_CREDIT_CENTS', 500),

  provider: envProvider(),
  // Model the official service uses. The client never chooses; the server decides.
  model: envStr('OFFICIAL_MODEL', 'claude-opus-4-8'),
  maxTokens: envInt('OFFICIAL_MAX_TOKENS', 4096),

  anthropicKey: envStr('ANTHROPIC_API_KEY', ''),
  anthropicBaseURL: envStr('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
  openaiKey: envStr('OPENAI_API_KEY', ''),
  openaiBaseURL: envStr('OPENAI_BASE_URL', 'https://api.openai.com'),

  // Pricing: cents (in `currency`) charged per one million tokens. Defaults bake in a markup
  // over raw vendor cost; tune per model. cost = ceil((in*inRate + out*outRate) / 1e6).
  priceInputCentsPerMTok: envInt('PRICE_INPUT_CENTS_PER_MTOK', 1500),
  priceOutputCentsPerMTok: envInt('PRICE_OUTPUT_CENTS_PER_MTOK', 7500),

  // Payment provider for the top-up page. "stub" credits the account via a dev-only endpoint
  // so the flow is testable; real providers (Stripe / Alipay / WeChat) plug in behind the same
  // PaymentProvider interface. The stub is refused unless ALLOW_STUB_TOPUP is truthy.
  paymentProvider: envStr('PAYMENT_PROVIDER', 'stub'),
  allowStubTopUp: envStr('ALLOW_STUB_TOPUP', '1') === '1',
} as const;

export type Config = typeof config;
