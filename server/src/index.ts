import Fastify from 'fastify';
import { config } from './config.ts';
import { SqliteStore } from './db.ts';
import { makeProvider } from './providers/index.ts';
import { makePaymentProvider } from './payments.ts';
import { registerRoutes } from './routes.ts';

// Compose the app so it can also be built in-process by tests (no listen).
export function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Screenshots arrive as base64 JPEG; allow generous bodies.
    bodyLimit: 16 * 1024 * 1024,
  });
  const store = new SqliteStore(config.dbPath);
  const provider = makeProvider(config, (msg) => app.log.warn(msg));
  const payment = makePaymentProvider(config);
  registerRoutes(app, { config, store, provider, payment });
  app.addHook('onClose', async () => store.close());
  return app;
}

// Only start listening when run directly (not when imported by a test).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = buildApp();
  app
    .listen({ host: config.host, port: config.port })
    .then(() => {
      app.log.info(
        `NotchSPI official server up — provider=${config.provider} model=${config.model} currency=${config.currency}`,
      );
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
