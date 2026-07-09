import type { FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { Provider, CaptureRequest } from './providers/types.ts';
import type { PaymentProvider } from './payments.ts';
import { ApiError, errorBody, beginSSE, SSE_DONE } from './http.ts';
import { requireAccount } from './auth.ts';
import { findPack } from './pricing.ts';
import { isValidTokenShape, normalizeLang } from './payments.ts';

export interface AppContext {
  config: Config;
  store: Store;
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

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, store, provider, payment } = ctx;

  app.get('/healthz', async () => ({ ok: true, provider: provider.name }));

  // POST /v1/devices — anonymous registration, grants the free question quota. No auth.
  app.post('/v1/devices', async (req, reply) => {
    const body = (req.body ?? {}) as DeviceBody;
    const device = store.registerDevice({
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
    const { account } = requireAccount(req, store);
    return reply.send({
      balance_questions: account.balanceQuestions,
      total_questions: account.totalQuestions,
      total_input_tokens: account.totalInputTokens,
      total_output_tokens: account.totalOutputTokens,
    });
  });

  // POST /v1/captures — streamed answer; one successful capture costs one question. Auth.
  app.post('/v1/captures', async (req, reply) => {
    const { token, account } = requireAccount(req, store);
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
      const newBalance = store.chargeForUsage({
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

  // GET /topup?device=<token>&lang=<zh|ja|en> — payment web page (not an API endpoint).
  // No bearer auth; the client passes its resolved UI language so the page matches the app.
  app.get('/topup', async (req, reply) => {
    const q = (req.query ?? {}) as { device?: unknown; lang?: unknown };
    const raw = str(q.device);
    // Only ever reflect a well-formed token; anything else renders as empty (belt-and-suspenders
    // with jsStringLiteral, since this endpoint is unauthenticated).
    const device = isValidTokenShape(raw) ? raw : '';
    const html = payment.renderTopUpPage({
      deviceToken: device,
      packs: config.packs,
      currency: config.currency,
      baseURL: config.publicBaseURL,
      lang: normalizeLang(str(q.lang)),
      stubEnabled: config.allowStubTopUp && payment.name === 'stub',
    });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // POST /topup/stub-complete — DEV-ONLY credit endpoint used by the stub top-up page. A real
  // payment provider replaces this with a signed webhook; guarded so it can't run in prod.
  app.post('/topup/stub-complete', async (req, reply) => {
    if (!(config.allowStubTopUp && payment.name === 'stub')) {
      throw new ApiError(404, '未启用');
    }
    const body = (req.body ?? {}) as StubTopUpBody;
    const token = str(body.device_token);
    if (!token) throw new ApiError(400, '缺少设备令牌');
    const pack = findPack(config.packs, str(body.pack_id));
    if (!pack) throw new ApiError(400, '题包无效');

    const newBalance = store.credit({
      token,
      questions: pack.questions,
      amountCents: pack.amountCents,
      currency: config.currency,
      provider: 'stub',
      reference: `stub-${Date.now()}`,
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
