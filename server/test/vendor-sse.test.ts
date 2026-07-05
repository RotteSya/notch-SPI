import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVendorSSE } from '../src/providers/types.ts';

/** Build a ReadableStream that emits the given byte arrays as separate chunks. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
  });
}

test('readVendorSSE reassembles a multi-byte char split across chunk boundaries', async () => {
  // A frame whose text ("电") is a 3-byte UTF-8 sequence; split the frame mid-character so the
  // decoder must hold bytes across reads and flush at end-of-stream.
  const frame = 'data: {"t":"电"}\n';
  const bytes = new TextEncoder().encode(frame);
  const cut = bytes.indexOf(0x7d) - 1; // one byte before the closing brace → inside "电"
  const events: unknown[] = [];
  await readVendorSSE(streamOf([bytes.slice(0, cut), bytes.slice(cut)]), (e) => events.push(e));
  assert.deepEqual(events, [{ t: '电' }]);
});

test('readVendorSSE drains a final data line that has no trailing newline', async () => {
  const enc = new TextEncoder();
  const events: unknown[] = [];
  await readVendorSSE(
    streamOf([enc.encode('data: {"a":1}\ndata: {"b":2}')]), // second line unterminated
    (e) => events.push(e),
  );
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
});

test('readVendorSSE ignores [DONE] and malformed lines', async () => {
  const enc = new TextEncoder();
  const events: unknown[] = [];
  await readVendorSSE(
    streamOf([enc.encode('data: [DONE]\ndata: not-json\ndata: {"ok":true}\n')]),
    (e) => events.push(e),
  );
  assert.deepEqual(events, [{ ok: true }]);
});
