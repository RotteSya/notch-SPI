import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';
import { config } from './config.ts';
import { makeStore } from './storage.ts';
import { makeProvider } from './providers/index.ts';
import { StubPaymentProvider, type PaymentProvider } from './payments.ts';
import { StripePaymentProvider } from './stripe.ts';
import { registerRoutes } from './routes.ts';

// Compose the app so it can also be built in-process by tests (no listen).
export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Screenshots arrive as base64 JPEG; allow generous bodies.
    bodyLimit: 16 * 1024 * 1024,
  });

  // Parse JSON while KEEPING the raw bytes on the request — Stripe webhook signatures are
  // computed over the exact payload, so re-serialized JSON would never verify.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const { store, kind: storeKind } = await makeStore(config);
  if (storeKind === 'memory') {
    app.log.warn('storage: in-memory fallback — data is EPHEMERAL; set POSTGRES_URL for production');
  }
  const provider = makeProvider(config, (msg) => app.log.warn(msg));
  const payment: PaymentProvider =
    config.paymentProvider === 'stripe' && config.stripeSecretKey !== ''
      ? new StripePaymentProvider()
      : new StubPaymentProvider();
  registerRoutes(app, { config, store, storeKind, provider, payment });
  app.addHook('onClose', async () => store.close());
  return app;
}

// Default export: a Node request handler, so this module works as a serverless entry too.
// Vercel's Fastify preset treats src/index.ts as a function and requires a default export that
// is a server or (req,res) handler — without this it fails with "Invalid export found in
// module". The app is built once per instance and reused across invocations, same as api/index.ts.
let appOnce: ReturnType<typeof buildApp> | null = null;
export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  appOnce ??= buildApp();
  const app = await appOnce;
  await app.ready();
  app.server.emit('request', req, res);
}

// Only start listening when run directly (not when imported by a test). Compare via
// pathToFileURL so a relative entry path (e.g. `node src/index.ts`) still matches.
const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  const app = await buildApp();
  app
    .listen({ host: config.host, port: config.port })
    .then(() => {
      app.log.info(
        `NotchSPI official server up — provider=${config.provider} model=${config.model} payments=${config.paymentProvider}`,
      );
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
