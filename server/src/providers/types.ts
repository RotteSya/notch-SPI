// A vendor-agnostic contract for the official service's model call. Each provider streams
// text deltas via `onDelta` and resolves with the metered token usage, which the capture
// route turns into a charge. Providers throw on failure; the route emits an SSE error event
// and does not charge.

export interface CaptureRequest {
  system: string;
  task: string;
  imageBase64: string;
  imageMediaType: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Provider {
  readonly name: string;
  stream(
    req: CaptureRequest,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<Usage>;
}

/**
 * Parse a vendor SSE body, invoking `onEvent` with each `data:` JSON payload (already
 * JSON-parsed). Skips `[DONE]` and non-data lines. Shared by the Anthropic and OpenAI
 * providers; the line-buffering logic is unit-tested via `splitSSEChunk`.
 */
export async function readVendorSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (payload: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = (payload: string): void => {
    if (payload === '' || payload === '[DONE]') return;
    try {
      onEvent(JSON.parse(payload));
    } catch {
      // ignore malformed keep-alive / comment lines
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { lines, rest } = splitSSEChunk(buffer);
    buffer = rest;
    for (const payload of lines) emit(payload);
  }
  // Flush any bytes held by the decoder (a trailing multi-byte char split across the final
  // chunk boundary), then drain the buffer including a final data: line without a newline.
  buffer += decoder.decode();
  const { lines, rest } = splitSSEChunk(buffer);
  for (const payload of lines) emit(payload);
  const tail = rest.trimStart();
  if (tail.startsWith('data:')) emit(tail.slice('data:'.length).trim());
}

/**
 * Split accumulated SSE text into complete `data:` payloads plus the unterminated remainder.
 * Pure, so line buffering across chunk boundaries is testable without a network.
 */
export function splitSSEChunk(buffer: string): { lines: string[]; rest: string } {
  const out: string[] = [];
  let rest = buffer;
  let nl = rest.indexOf('\n');
  while (nl !== -1) {
    const line = rest.slice(0, nl).replace(/\r$/, '');
    rest = rest.slice(nl + 1);
    const trimmed = line.trimStart();
    if (trimmed.startsWith('data:')) {
      out.push(trimmed.slice('data:'.length).trim());
    }
    nl = rest.indexOf('\n');
  }
  return { lines: out, rest };
}
