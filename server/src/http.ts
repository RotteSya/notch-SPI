import type { FastifyReply } from 'fastify';

// The client's contract error body: {"error": {"message": "<user-readable>"}}.
// Thrown anywhere in a handler and translated to this shape by the error hook in index.ts.
export class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }
}

export function errorBody(message: string): { error: { message: string } } {
  return { error: { message } };
}

// --- SSE (Server-Sent Events) for POST /v1/captures ---------------------------------------

// Every stream event the contract defines. `data: <json>` lines, one JSON object per event.
export type StreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'usage';
      input_tokens: number;
      output_tokens: number;
      cost_cents: number;
      balance_cents: number;
    }
  | { type: 'error'; error: { message: string } };

/** Serialize one event to an SSE `data:` frame (pure — unit-tested). */
export function sseFrame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** The terminal sentinel line the client watches for. */
export const SSE_DONE = 'data: [DONE]\n\n';

/** Prepare a Fastify reply for streaming SSE and hand back a raw writer. */
export function beginSSE(reply: FastifyReply): (event: StreamEvent) => void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering so deltas flush promptly
  });
  return (event: StreamEvent) => reply.raw.write(sseFrame(event));
}
