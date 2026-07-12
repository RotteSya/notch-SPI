import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { Provider, CaptureRequest } from './providers/types.ts';
import type { PaymentProvider, PageBanner, PageMode } from './payments.ts';
import type { StoreKind } from './storage.ts';
import { ApiError, errorBody, beginSSE, SSE_DONE } from './http.ts';
import { requireAccount } from './auth.ts';
import { findPack } from './pricing.ts';
import { isValidTokenShape, normalizeLang } from './payments.ts';
import { verifyStripeSignature, createCheckoutSession, type StripeEvent } from './stripe.ts';
import { renderLandingPage, resolveSiteLang } from './site.ts';

export interface AppContext {
  config: Config;
  store: Store;
  storeKind: StoreKind;
  provider: Provider;
  payment: PaymentProvider;
}

// Body shapes coming off the wire (all fields untrusted; validated in the handlers).
interface DeviceBody {
  platform?: unknown;
  app_version?: unknown;
}
interface CaptureBody {
  system?: unknown;
  task?: unknown;
  image_base64?: unknown;
  image_media_type?: unknown;
}
interface StubTopUpBody {
  device_token?: unknown;
  pack_id?: unknown;
}
interface CheckoutBody {
  device_token?: unknown;
  pack_id?: unknown;
  lang?: unknown;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, store, storeKind, provider, payment } = ctx;
  const stripeLive = payment.name === 'stripe' && config.stripeSecretKey !== '';

  // Config-at-a-glance for operators: which provider answers, where data lives, how payments
  // are wired. `db: "memory"` on a production deployment means POSTGRES_URL is missing.
  // GET / — the public product site (also the "company website" for payment-provider review).
  // Language: ?lang wins, then Accept-Language, defaulting to Japanese. Cacheable at the CDN;
  // Vary keeps the language negotiation honest.
  app.get('/', async (req, reply) => {
    const q = (req.query ?? {}) as { lang?: unknown };
    const lang = resolveSiteLang(str(q.lang), str(req.headers['accept-language']));
    const html = renderLandingPage({
      packs: config.packs,
      trialQuestions: config.trialQuestions,
      currency: config.currency,
      lang,
    });
    return reply
      .header('Cache-Control', 'public, max-age=300')
      .header('Vary', 'Accept-Language')
      .type('text/html; charset=utf-8')
      .send(html);
  });

  app.get('/healthz', async () => ({
    ok: true,
    provider: provider.name,
    db: storeKind,
    payments: stripeLive ? 'stripe' : config.allowStubTopUp ? 'stub' : 'disabled',
    webhook: stripeLive ? (config.stripeWebhookSecret !== '' ? 'configured' : 'MISSING_SECRET') : 'n/a',
  }));

  // POST /v1/devices — anonymous registration, grants the free question quota. No auth.
  app.post('/v1/devices', async (req, reply) => {
    const body = (req.body ?? {}) as DeviceBody;
    const device = await store.registerDevice({
      platform: str(body.platform, 'unknown').slice(0, 32),
      appVersion: str(body.app_version, 'unknown').slice(0, 32),
      trialQuestions: config.trialQuestions,
    });
    return reply.send({
      device_token: device.token,
      balance_questions: device.balanceQuestions,
    });
  });

  // GET /v1/account — question balance + lifetime usage. Auth.
  app.get('/v1/account', async (req, reply) => {
    const { account } = await requireAccount(req, store);
    return reply.send({
      balance_questions: account.balanceQuestions,
      total_questions: account.totalQuestions,
      total_input_tokens: account.totalInputTokens,
      total_output_tokens: account.totalOutputTokens,
    });
  });

  // POST /v1/captures — streamed answer; one successful capture costs one question. Auth.
  app.post('/v1/captures', async (req, reply) => {
    const { token, account } = await requireAccount(req, store);
    const body = (req.body ?? {}) as CaptureBody;

    const captureReq: CaptureRequest = {
      system: str(body.system),
      task: str(body.task),
      imageBase64: str(body.image_base64),
      imageMediaType: str(body.image_media_type, 'image/jpeg'),
    };
    // Contract requires system, task, and image. Validate up front (JSON 400) rather than
    // streaming with empty prompts and failing mid-stream inside the vendor call.
    if (!captureReq.system) throw new ApiError(400, '缺少 system 提示词');
    if (!captureReq.task) throw new ApiError(400, '缺少 task 文本');
    if (!captureReq.imageBase64) throw new ApiError(400, '缺少截图数据');

    // Pre-request gate: no questions left is refused as JSON 402 BEFORE any streaming.
    if (account.balanceQuestions <= 0) {
      throw new ApiError(402, '额度已用完，请充值后继续', 'insufficient_quota');
    }

    // Take over the socket for manual SSE writing.
    reply.hijack();
    const send = beginSSE(reply);

    // Abort the upstream call only on a real client disconnect. We listen on the RESPONSE
    // socket (not req.raw, whose 'close' fires as soon as the request body is fully read) and
    // guard with `done` so our own end() doesn't trigger an abort.
    const abort = new AbortController();
    let done = false;
    reply.raw.on('close', () => {
      if (!done) abort.abort();
    });

    try {
      const usage = await provider.stream(captureReq, (text) => send({ type: 'delta', text }), abort.signal);
      const newBalance = await store.chargeForUsage({
        token,
        questions: 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        model: `${provider.name}:${config.model}`,
      });
      if (newBalance === null) {
        // Token vanished mid-request (deleted); report as a stream error, no charge applied.
        send({ type: 'error', error: { message: '设备令牌无效', code: 'invalid_token' } });
      } else {
        send({
          type: 'usage',
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          questions_charged: 1,
          balance_questions: newBalance,
        });
      }
      reply.raw.write(SSE_DONE);
    } catch (err) {
      const message = err instanceof Error ? err.message : '模型服务错误';
      // On failure we do NOT charge — a broken answer never costs a question.
      send({ type: 'error', error: { message, code: 'upstream_error' } });
    } finally {
      done = true;
      reply.raw.end();
    }
  });

  // GET /topup?device=<token>&lang=<zh|ja|en>[&paid=1|&canceled=1] — payment web page.
  // No bearer auth; the client passes its resolved UI language so the page matches the app.
  app.get('/topup', async (req, reply) => {
    const q = (req.query ?? {}) as { device?: unknown; lang?: unknown; paid?: unknown; canceled?: unknown };
    const raw = str(q.device);
    // Only ever reflect a well-formed token; anything else renders as empty (belt-and-suspenders
    // with jsStringLiteral, since this endpoint is unauthenticated).
    const device = isValidTokenShape(raw) ? raw : '';
    const mode: PageMode = stripeLive ? 'stripe' : config.allowStubTopUp && payment.name === 'stub' ? 'stub' : 'disabled';
    const banner: PageBanner = str(q.paid) === '1' ? 'paid' : str(q.canceled) === '1' ? 'canceled' : null;
    const html = payment.renderTopUpPage({
      deviceToken: device,
      packs: config.packs,
      currency: config.currency,
      baseURL: config.publicBaseURL,
      lang: normalizeLang(str(q.lang)),
      mode,
      banner,
    });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // POST /topup/checkout — create a Stripe Checkout session for a pack. Called by the page.
  app.post('/topup/checkout', async (req, reply) => {
    if (!stripeLive) throw new ApiError(404, '未启用');
    const body = (req.body ?? {}) as CheckoutBody;
    const token = str(body.device_token);
    if (!isValidTokenShape(token)) throw new ApiError(400, '设备令牌无效');
    // The token must belong to a real account — no checkout sessions for junk tokens.
    if ((await store.getAccount(token)) === null) throw new ApiError(401, '设备令牌无效');
    const pack = findPack(config.packs, str(body.pack_id));
    if (!pack) throw new ApiError(400, '题包无效');

    const result = await createCheckoutSession(config.stripeSecretKey, {
      pack,
      deviceToken: token,
      currency: config.currency,
      publicBaseURL: config.publicBaseURL,
      lang: normalizeLang(str(body.lang)),
    });
    if ('error' in result) {
      req.log.error({ stripeError: result.error }, 'checkout session creation failed');
      throw new ApiError(502, '支付服务暂时不可用，请稍后再试', 'upstream_error');
    }
    return reply.send({ url: result.url });
  });

  // POST /webhooks/stripe — Stripe calls this after payment. Signature-verified against the
  // RAW body; `checkout.session.completed` credits the pack idempotently (session id is the
  // reference, so Stripe's redeliveries are clean no-ops).
  app.post('/webhooks/stripe', async (req, reply) => {
    if (!stripeLive) throw new ApiError(404, '未启用');
    if (!config.stripeWebhookSecret) {
      req.log.error('STRIPE_WEBHOOK_SECRET is not configured; rejecting webhook');
      throw new ApiError(500, 'webhook 未配置');
    }
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const signature = req.headers['stripe-signature'];
    if (!rawBody || typeof signature !== 'string' ||
        !verifyStripeSignature(rawBody.toString('utf8'), signature, config.stripeWebhookSecret)) {
      throw new ApiError(400, '签名校验失败');
    }

    const event = (req.body ?? {}) as StripeEvent;
    if (event.type !== 'checkout.session.completed') {
      return reply.send({ received: true }); // acknowledge everything else
    }
    const session = event.data?.object;
    if (!session?.id || session.payment_status !== 'paid') {
      return reply.send({ received: true });
    }
    const token = session.metadata?.device_token ?? '';
    const pack = findPack(config.packs, session.metadata?.pack_id ?? '');
    if (!isValidTokenShape(token) || !pack) {
      req.log.error({ sessionId: session.id }, 'paid session with unusable metadata');
      return reply.send({ received: true }); // don't make Stripe retry something unfixable
    }
    // Defense in depth: the paid amount must match the catalog — a mismatch means the catalog
    // changed mid-flight or the session was tampered with; log loudly, don't credit.
    if (session.amount_total !== pack.amountCents ||
        (session.currency ?? '').toLowerCase() !== config.currency.toLowerCase()) {
      req.log.error({ sessionId: session.id, amount: session.amount_total, currency: session.currency },
        'paid amount does not match the pack catalog; NOT crediting');
      return reply.send({ received: true });
    }

    const newBalance = await store.credit({
      token,
      questions: pack.questions,
      amountCents: pack.amountCents,
      currency: config.currency,
      provider: 'stripe',
      reference: session.id, // idempotency key: redelivered webhooks are no-ops
    });
    if (newBalance === null) {
      req.log.error({ sessionId: session.id }, 'paid session for an unknown device token');
    } else {
      req.log.info({ sessionId: session.id, questions: pack.questions, newBalance }, 'pack credited');
    }
    return reply.send({ received: true });
  });

  // POST /topup/stub-complete — DEV-ONLY credit endpoint used by the stub top-up page. The
  // Stripe webhook above replaces this in production; guarded so it can't run there.
  app.post('/topup/stub-complete', async (req, reply) => {
    if (!(config.allowStubTopUp && payment.name === 'stub')) {
      throw new ApiError(404, '未启用');
    }
    const body = (req.body ?? {}) as StubTopUpBody;
    const token = str(body.device_token);
    if (!token) throw new ApiError(400, '缺少设备令牌');
    const pack = findPack(config.packs, str(body.pack_id));
    if (!pack) throw new ApiError(400, '题包无效');

    const newBalance = await store.credit({
      token,
      questions: pack.questions,
      amountCents: pack.amountCents,
      currency: config.currency,
      provider: 'stub',
      reference: `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    if (newBalance === null) throw new ApiError(401, '设备令牌无效');
    return reply.send({ balance_questions: newBalance });
  });

  // Uniform error body: {"error":{"message":"…","code":"…"}} with the right status code.
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send(errorBody(err.message, err.code));
    }
    const e = err as { statusCode?: number; message?: string };
    const statusCode = typeof e.statusCode === 'number' ? e.statusCode : 500;
    const message = statusCode === 500 ? '服务器内部错误' : (e.message ?? '请求错误');
    return reply.code(statusCode).send(errorBody(message, statusCode === 500 ? 'internal' : 'bad_request'));
  });
}
