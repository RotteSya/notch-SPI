export const PLUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS plus_subscriptions (
 device_id BIGINT PRIMARY KEY REFERENCES devices(id), created_at TEXT NOT NULL, intent_id TEXT NOT NULL UNIQUE,
 checkout_id TEXT UNIQUE, checkout_url TEXT, subscription_id TEXT UNIQUE, customer_id TEXT,
 status TEXT NOT NULL, paid_from TEXT, paid_until TEXT, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
 generation BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plus_paid_invoices (
 invoice_id TEXT PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES devices(id), subscription_id TEXT NOT NULL,
 paid_from TEXT NOT NULL, paid_until TEXT NOT NULL, amount_cents BIGINT NOT NULL, currency TEXT NOT NULL
);`;
