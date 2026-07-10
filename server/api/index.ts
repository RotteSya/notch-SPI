import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../src/index.ts';

// Vercel entry: the whole Fastify app runs inside one Node function (vercel.json rewrites
// every path here). Fluid compute keeps instances warm and streams SSE responses; the app is
// built once per instance and reused across invocations.
const appPromise = buildApp();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await appPromise;
  await app.ready();
  app.server.emit('request', req, res);
}
