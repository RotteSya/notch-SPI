import { createHmac, timingSafeEqual } from 'node:crypto';
import type { QuestionPack } from './pricing.ts';
import type { PaymentProvider, TopUpPageInput, PageLang } from './payments.ts';
import { renderTopUpPage, packDisplayName } from './payments.ts';

// Real payments via Stripe Checkout (hosted page), with zero SDK dependency — the two calls we
// need are a form-encoded POST and an HMAC check, both trivial with the platform built-ins.
//
// Flow: page button → POST /topup/checkout → checkout.sessions.create → redirect to Stripe →
// customer pays → Stripe POSTs checkout.session.completed to /webhooks/stripe (signature
// verified) → store.credit() with the session id as the idempotency reference → customer lands
// back on /topup?paid=1 and refreshes the app.
//
// `payment_method_types` is deliberately NOT set: Stripe's dynamic payment methods pick the
// best-converting eligible methods (cards, Alipay, WeChat Pay, Link, …) per customer, all
// configurable from the Dashboard with no code changes.

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const SIGNATURE_TOLERANCE_SEC = 300; // Stripe's recommended replay window

// MARK: Signature verification (pure, unit-tested)

/**
 * Verify a `Stripe-Signature` header against the raw request payload.
 * Header format: `t=<unix>,v1=<hex>[,v1=<hex>…]`; the signed content is `${t}.${payload}`
 * HMAC-SHA256'd with the endpoint's whsec secret. Rejects stale timestamps (replay defense)
 * and compares in constant time.
 */
export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = SIGNATURE_TOLERANCE_SEC,
): boolean {
  if (!payload || !header || !secret) return false;
  let timestamp = '';
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') candidates.push(v);
  }
  if (!timestamp || candidates.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return candidates.some((c) => {
    const buf = Buffer.from(c, 'utf8');
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
}

// MARK: Checkout session (params builder pure; the POST thin)

export interface CheckoutInput {
  pack: QuestionPack;
  deviceToken: string;
  currency: string; // ISO code matching the Stripe account's settings, e.g. CNY / JPY / USD
  publicBaseURL: string;
  lang: PageLang;
}

/**
 * Build the form body for `checkout.sessions.create`. Amounts are already in the currency's
 * smallest unit (fen for CNY, yen for JPY) — exactly how the pack catalog is configured.
 * The device token + pack ride in metadata so the webhook can credit the right account.
 */
export function buildCheckoutParams(input: CheckoutInput): URLSearchParams {
  const back = `${input.publicBaseURL}/topup?device=${encodeURIComponent(input.deviceToken)}&lang=${input.lang}`;
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', input.currency.toLowerCase());
  p.set('line_items[0][price_data][unit_amount]', String(input.pack.amountCents));
  p.set('line_items[0][price_data][product_data][name]', packDisplayName(input.pack, input.lang));
  p.set('metadata[device_token]', input.deviceToken);
  p.set('metadata[pack_id]', input.pack.id);
  p.set('metadata[questions]', String(input.pack.questions));
  p.set('success_url', `${back}&paid=1`);
  p.set('cancel_url', `${back}&canceled=1`);
  return p;
}

/** Create a hosted Checkout session; returns its redirect URL or a user-safe error. */
export async function createCheckoutSession(
  secretKey: string,
  input: CheckoutInput,
): Promise<{ url: string } | { error: string }> {
  try {
    const res = await fetch(STRIPE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildCheckoutParams(input).toString(),
    });
    const body = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) {
      // Log the vendor detail server-side; never echo Stripe internals to the page.
      return { error: body.error?.message ?? `stripe http ${res.status}` };
    }
    return { url: body.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'stripe request failed' };
  }
}

// MARK: Webhook event shape (the fields we consume)

export interface StripeCheckoutSession {
  id: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  metadata?: { device_token?: string; pack_id?: string };
}

export interface StripeEvent {
  type: string;
  data?: { object?: StripeCheckoutSession };
}

// MARK: Provider

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  renderTopUpPage(input: TopUpPageInput): string {
    return renderTopUpPage(input);
  }
}
