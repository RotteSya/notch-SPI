import {AttemptTrace} from '../src/attempt-diagnostics.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { CaptureTiming, captureRuntimePolicy } from '../src/capture-timing.ts';
import { CaptureService } from '../src/capture-service.ts';
import { MemoryStore } from '../src/db-memory.ts';
import { config } from '../src/config.ts';
import { StubPaymentProvider } from '../src/payments.ts';
import { OpenAIProvider } from '../src/providers/openai.ts';
import type { Provider } from '../src/providers/types.ts';

test('runtime policy reports effective numeric limits without arbitrary config strings', () => {
  const policy = captureRuntimePolicy({...config, model:'secret-model', objectiveModel:'deepseek-flash',
    maxTokens:32768, objectiveMaxTokens:16384, deepseekReasoningEffort:'secret-effort', objectiveDeepseekReasoningEffort:'low'});
  assert.deepEqual(policy, {officialMaxTokens:32768,objectiveMaxTokens:16384,
    officialModelIsDeepseekFlash:false,objectiveModelIsDeepseekFlash:true,
    officialReasoningEffort:'other',objectiveReasoningEffort:'low'});
  assert.equal(JSON.stringify(policy).includes('secret'), false);
  assert.equal(captureRuntimePolicy({...config, maxTokens:NaN}).officialMaxTokens, null);
  assert.equal(captureRuntimePolicy({...config, objectiveMaxTokens:-1}).objectiveMaxTokens, null);
});

test('timings retain the first event using one monotonic clock', () => {
  let clock=100;
  const timing=new CaptureTiming(()=>clock);
  clock=120;timing.mark('upstreamFirstReasoning');
  clock=155;timing.mark('upstreamFirstAnswer');
  clock=180;timing.mark('upstreamFirstAnswer');
  assert.deepEqual(timing.offsets,{handlerStarted:0,upstreamFirstReasoning:20,upstreamFirstAnswer:55});
});

test('provider separates headers, reasoning and answer without forwarding reasoning or timing fields', async t => {
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  const timing=new CaptureTiming();
  let body='';
  globalThis.fetch=async (_url,init)=>{
    body=String(init?.body);
    assert.ok(timing.offsets.upstreamRequest!==undefined);
    return new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"hidden-secret"}}]}',
      'data: {"choices":[{"delta":{"content":"B"}}]}',
      'data: {"choices":[{"delta":{"content":"60"}}]}',
      'data: [DONE]\n',
    ].join('\n'));
  };
  let answer='',progress=0;
  const provider=new OpenAIProvider('test-key','http://unused.invalid','unchanged',100);
  await provider.stream({system:'test',task:'test',images:[],onTiming:stage=>timing.mark(stage)},
    delta=>{answer+=delta;},new AbortController().signal,()=>{progress++;});
  assert.equal(answer,'B60');assert.equal(progress,1);
  assert.equal(body.includes('onTiming'),false);
  const stages=['upstreamRequest','upstreamHeaders','upstreamFirstEvent','upstreamFirstReasoning','upstreamFirstAnswer'] as const;
  for(let i=1;i<stages.length;i++) assert.ok(timing.offsets[stages[i]!]!>=timing.offsets[stages[i-1]!]!);
  assert.equal(JSON.stringify(timing.offsets).includes('hidden-secret'),false);
});

test('capture diagnostics are opt-in, preserve one charge, and log no input or answer', async t => {
  const previous=process.env.NSPI_SERVER_LATENCY_TRACE;
  t.after(()=>{if(previous===undefined)delete process.env.NSPI_SERVER_LATENCY_TRACE;else process.env.NSPI_SERVER_LATENCY_TRACE=previous;});
  for(const enabled of [false,true]) {
    process.env.NSPI_SERVER_LATENCY_TRACE=enabled?'1':'0';
    const records:Array<Record<string,unknown>>=[];
    const app=Fastify({logger:{stream:{write(line:string){records.push(JSON.parse(line));}}}});
    let timingRowsAtResponse=-1;
    app.addHook('onResponse',async()=>{
      timingRowsAtResponse=records.filter(row=>row.msg==='capture timing').length;
    });
    const store=new MemoryStore();
    let calls=0;
    const provider:Provider={name:'mock',async stream(input,delta){
      calls++;assert.equal(typeof input.onTiming,'function');
      input.onTiming?.('upstreamRequest');input.onTiming?.('upstreamHeaders');
      input.onTiming?.('upstreamFirstAnswer');
      delta('FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}');
      return {inputTokens:10,outputTokens:20};
    }};
    const service=new CaptureService({config:{...config,provider:'mock',dbPath:':memory:',requireDurableStorage:false,
      requestHmacKeysJSON:JSON.stringify({test:Buffer.alloc(32,7).toString('base64')}),requestHmacKeyVersion:'test',modelDailyBudgetMicros:0},store,storeKind:'memory',provider,objectiveProvider:provider,
      providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
    app.post('/v1/captures',(req,reply)=>service.solve(req,reply));
    const {token}=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30});
    try {
      const id=randomUUID();
      const response=await app.inject({method:'POST',url:'/v1/captures',headers:{authorization:'Bearer '+token},
        payload:{capture_id:id,result_protocol:'objective_v1',system:'secret-system',task:'secret-task',image_base64:'c2VjcmV0LWltYWdl'}});
      assert.equal(response.statusCode,200);assert.equal(calls,1);
      assert.match(response.body,/"questions_charged":1/);
      const rows=records.filter(row=>row.msg==='capture timing');
      assert.equal(rows.length,enabled?1:0);
      assert.equal(timingRowsAtResponse,enabled?1:0,'timing must exist before response completion');
      if(enabled){
        assert.equal(rows[0]!.captureId,id);
        const offsets=rows[0]!.captureTiming as Record<string,number>;
        const order=['handlerStarted','authReady','validationReady','reapReady','duplicateCheckReady','budgetReady','admissionReady','providerStarted','upstreamRequest','upstreamHeaders','upstreamFirstAnswer','firstDeltaSent','providerCompleted','responseFinishing'];
        for(let i=1;i<order.length;i++) assert.ok(offsets[order[i]!]!>=offsets[order[i-1]!]!,order[i]);
        for(const secret of [token,'secret-system','secret-task','c2VjcmV0LWltYWdl','NSPI_RESULT_V1']) assert.equal(JSON.stringify(rows).includes(secret),false);
        const rejected=await app.inject({method:'POST',url:'/v1/captures',payload:{capture_id:'untrusted-secret-id'}});
        assert.equal(rejected.statusCode,401);assert.equal(calls,1);
        const failure=records.filter(row=>row.msg==='capture timing').at(-1)!;
        assert.equal(failure.captureId,undefined);
        const failedOffsets=failure.captureTiming as Record<string,number>;
        assert.ok(failedOffsets.handlerFinished!==undefined);
        assert.equal(failedOffsets.providerStarted,undefined);
        assert.equal(JSON.stringify(failure).includes('untrusted-secret-id'),false);

      }
    } finally {await app.close();await store.close();}
  }
});

 test('OpenAI sends only internal correlation UUID and captures HTTP identity even on failure',async t=>{
  const id=randomUUID();let headers:Record<string,string>={},status:number|undefined;
  t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
    assert.equal(new Headers(init.headers).get('X-Client-Request-Id'),id);
    assert.equal(String(init.body).includes(id),false);
    return new Response('private error',{status:503,headers:{'x-request-id':'req_fixture','retry-after':'1'}});
  });
  const p=new OpenAIProvider('test','http://unused.invalid','fixture',100);
  await assert.rejects(p.stream({system:'private',task:'private',images:[],clientRequestId:id,
    onHeaders:(h,s)=>{headers=h;status=s;}},()=>{},new AbortController().signal));
  assert.equal(status,503);assert.equal(headers['x-request-id'],'req_fixture');
 });

test('attempt diagnostics whitelist excludes arbitrary headers and invalid request IDs',()=>{
 const trace=new AttemptTrace();trace.headers({'authorization':'secret','x-request-id':'bad\nsecret'},999);
 trace.mark('upstreamRequest');trace.mark('upstreamHeaders');
 const d=trace.finish('startup_timeout',20000);
 assert.equal(d.httpStatus,undefined);assert.equal(d.upstreamRequestId,undefined);
 assert.equal(JSON.stringify(d).includes('secret'),false);assert.equal(d.usageReceived,false);
 assert.ok(d.stages.upstreamHeaders!>=d.stages.upstreamRequest!);
});

test('OpenAI distinguishes a network failure from a clean but incomplete stream',async t=>{
 const p=new OpenAIProvider('test','http://unused.invalid','gpt-6-astra',100,{astraTier:'default'});
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('private connection error');});
 await assert.rejects(p.stream({system:'test',task:'test',images:[]},()=>{},new AbortController().signal),
  (e:unknown)=>!!e&&typeof e==='object'&&'kind' in e&&e.kind==='network');
 t.mock.method(globalThis,'fetch',async()=>new Response('data: {"model":"gpt-6-astra","service_tier":"default","choices":[{"delta":{"content":"B"}}]}\n\n',
  {headers:{'content-type':'text/event-stream'}}));
 await assert.rejects(p.stream({system:'test',task:'test',images:[]},()=>{},new AbortController().signal),
  (e:unknown)=>!!e&&typeof e==='object'&&'kind' in e&&e.kind==='incomplete_stream');
});
