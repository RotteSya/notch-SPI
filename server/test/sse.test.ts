import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseFrame, SSE_DONE } from '../src/http.ts';
import { splitSSEChunk } from '../src/providers/types.ts';

test('sseFrame serializes one event as a data: frame', () => {
  assert.equal(sseFrame({ type: 'delta', text: 'hi' }), 'data: {"type":"delta","text":"hi"}\n\n');
});

test('usage frame carries all billing fields', () => {
  const frame = sseFrame({
    type: 'usage',
    input_tokens: 10,
    output_tokens: 5,
    cost_cents: 1,
    balance_cents: 99,
  });
  assert.match(frame, /"balance_cents":99/);
  assert.match(frame, /"cost_cents":1/);
});

test('DONE sentinel matches the client contract', () => {
  assert.equal(SSE_DONE, 'data: [DONE]\n\n');
});

test('splitSSEChunk extracts complete data lines and keeps the remainder', () => {
  const { lines, rest } = splitSSEChunk('data: {"a":1}\ndata: {"b":2}\ndata: {"c"');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  assert.equal(rest, 'data: {"c"'); // unterminated tail preserved for the next chunk
});

test('splitSSEChunk tolerates CRLF and blank/comment lines', () => {
  const { lines } = splitSSEChunk('data: {"a":1}\r\n\r\n: keep-alive\r\ndata: [DONE]\r\n');
  assert.deepEqual(lines, ['{"a":1}', '[DONE]']);
});

test('splitSSEChunk buffers a payload split across two chunks', () => {
  const first = splitSSEChunk('data: {"partial":');
  assert.deepEqual(first.lines, []);
  const second = splitSSEChunk(first.rest + 'true}\n');
  assert.deepEqual(second.lines, ['{"partial":true}']);
});
