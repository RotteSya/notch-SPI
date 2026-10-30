import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseFrame, SSE_DONE } from '../src/http.ts';
import { splitSSEChunk } from '../src/providers/types.ts';

test('sseFrame serializes one event as a data: frame', () => {
  assert.equal(sseFrame({ type: 'delta', text: 'hi' }), 'data: {"type":"delta","text":"hi"}\n\n');
});

test('usage frame carries all quota fields', () => {
  const frame = sseFrame({
    type: 'usage',
    input_tokens: 10,
    output_tokens: 5,
    questions_charged: 1,
    balance_questions: 179,
  });
  assert.match(frame, /"balance_questions":179/);
  assert.match(frame, /"questions_charged":1/);
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

test('SSE headers reach the client before provider output and deltas do not wait for completion', async () => {
  const {default:Fastify}=await import('fastify');
  const {get}=await import('node:http');
  const {beginSSE}=await import('../src/http.ts');
  const app=Fastify();
  let send:ReturnType<typeof beginSSE>|undefined;
  let end:(()=>void)|undefined;
  app.get('/stream',(_req,reply)=>{
    reply.hijack();send=beginSSE(reply);end=()=>reply.raw.end(SSE_DONE);
  });
  await app.listen({host:'127.0.0.1',port:0});
  const address=app.server.address();assert.ok(address&&typeof address!=='string');
  try {
    await new Promise<void>((resolve,reject)=>{
      const request=get(`http://127.0.0.1:${address.port}/stream`,response=>{
        assert.equal(response.statusCode,200);
        assert.equal(response.headers['content-type'],'text/event-stream; charset=utf-8');
        let text='';let sawDelta=false;
        response.setEncoding('utf8');
        response.on('data',chunk=>{
          text+=chunk;
          if(!sawDelta&&text.includes('answer')){sawDelta=true;end!();}
        });
        response.on('end',()=>{
          try{assert.equal(text,sseFrame({type:'delta',text:'answer'})+SSE_DONE);resolve();}catch(error){reject(error);}
        });
        response.on('error',reject);
        // No model output was sent until the client received the response headers.
        send!({type:'delta',text:'answer'});
      });
      request.setTimeout(1000,()=>request.destroy(new Error('headers were buffered until first delta')));
      request.on('error',reject);
    });
  } finally {app.server.closeAllConnections();await app.close();}
});
