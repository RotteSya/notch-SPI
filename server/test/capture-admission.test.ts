import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { config, type Config } from '../src/config.ts';
import { CaptureService } from '../src/capture-service.ts';
import { MemoryStore } from '../src/db-memory.ts';
import { SqliteStore } from '../src/db-sqlite.ts';
import type { Store } from '../src/db.ts';
import type { Provider } from '../src/providers/types.ts';
import { StubPaymentProvider } from '../src/payments.ts';
import { SCREEN_QUERY_VERSION } from '../src/screen-query.ts';
import { pngBase64 } from './helpers/images.ts';

function latch() {
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}
function pause<Args extends unknown[],Result>(call:(...args:Args)=>Promise<Result>,afterCommit=true) {
  const entered=latch(),resume=latch();let first=true;
  return {entered:entered.promise,resume:resume.resolve,call:async (...args:Args):Promise<Result>=>{
    if(!first)return call(...args);first=false;
    if(!afterCommit){entered.resolve();await resume.promise;return call(...args);}
    const result=await call(...args);entered.resolve();await resume.promise;return result;
  }};
}
function failOnce<Args extends unknown[],Result>(call:(...args:Args)=>Promise<Result>,afterCommit:boolean) {
  let first=true;
  return async (...args:Args):Promise<Result>=>{
    if(!first)return call(...args);first=false;
    if(afterCommit)await call(...args);
    throw new Error('Injected transaction acknowledgement failure');
  };
}
const implementations:Array<[string,()=>Store|Promise<Store>]>=[
  ['memory',()=>new MemoryStore()],['sqlite',()=>new SqliteStore(':memory:')],
];
if(process.env.TEST_POSTGRES_URL) {
  const url=new URL(process.env.TEST_POSTGRES_URL);
  if(!/test/i.test(url.pathname))throw new Error('Admission tests require an isolated database named test');
  const {PostgresStore,resolvePostgresSSL}=await import('../src/db-postgres.ts');
  const pg=(await import('pg')).default;
  const admin=new pg.Pool({connectionString:url.toString(),ssl:resolvePostgresSSL({connectionString:url.toString()})});
  const schema='admission_test_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options','-c search_path='+schema);
  const connection=url.toString(),ssl=resolvePostgresSSL({connectionString:connection});
  after(async()=>{await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  implementations.push(['postgres',async()=>{
    const store=new PostgresStore(connection,ssl);await store.getAccount('__admission_test__');
    // Device ids restart with each store, so the per-device rate buckets must start empty as well.
    await admin.query(`TRUNCATE ${schema}.devices, ${schema}.budget_windows, ${schema}.attempt_budget_holds, ${schema}.rate_limit_buckets RESTART IDENTITY CASCADE`);
    return store;
  }]);
}
const ready='FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
function body() {
  return {capture_id:randomUUID(),result_protocol:'objective_v1',response_contract:'screen_query_v1',operation:'solve',
    images_base64:[pngBase64],image_media_type:'image/png',profile_id:'reading_practice',
    profile_version:SCREEN_QUERY_VERSION,prompt_version:SCREEN_QUERY_VERSION,ui_language:'en',
    scope:{target_count:1,question_image_index:0,rect:{x:0,y:0,width:1,height:1}}};
}
type Operation='solve'|'explain'|'recover';
async function fixture(make:()=>Store|Promise<Store>,concurrency=1,perMinute=config.capturePerMinute,unpaidShare=100) {
  const store=await make(),app=Fastify({logger:false,forceCloseConnections:true});let calls=0;
  const provider:Provider={name:'test',async stream(request,delta) {
    calls++;delta(request.system.includes('consistent (boolean)')?JSON.stringify({consistent:true,explanation:'B follows from the passage.'}):ready);
    return {inputTokens:10,outputTokens:2};
  }};
  const settings:Config={...config,provider:'mock',objectiveProvider:'mock',model:'test',objectiveModel:'test',
    dbPath:':memory:',requireDurableStorage:false,requestHmacKeysJSON:JSON.stringify({test:randomBytes(32).toString('base64')}),
    requestHmacKeyVersion:'test',screenQueryEnabled:true,explanationEnabled:true,enabledSupportProfiles:'reading_practice',
    captureConcurrencyPerToken:concurrency,capturePerMinute:perMinute,unpaidSharePercent:unpaidShare,attemptBudgetUpperMicros:100,modelDailyBudgetMicros:100,
    modelCostCurrency:'CNY',modelPricingJSON:JSON.stringify([{model:'test:test',input_micros_per_million_tokens:0,output_micros_per_million_tokens:0}])};
  const service=new CaptureService({config:settings,store,storeKind:'memory',provider,objectiveProvider:provider,
    providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
  const watches=new Map<string,{closed:ReturnType<typeof latch>;finished:ReturnType<typeof latch>}>();
  // Instrument only the handler lifecycle. Requests still use real HTTP, production
  // CaptureService/auth/image decoding and the selected real billing implementation.
  for(const [url,operation] of [['/v1/captures','solve'],['/v1/captures/:id/explanation','explain'],['/v1/captures/:id/recovery','recover']] as const) {
    app.post(url,async(req,reply)=>{
      const watch=watches.get(String(req.headers['x-test-request']))!;
      reply.raw.once('close',watch.closed.resolve);
      try {
        if(operation==='solve')await service.solve(req,reply);else await service.auxiliary(req,reply,operation);
      } finally {watch.finished.resolve();}
    });
  }
  const base=await app.listen({port:0,host:'127.0.0.1'});
  const {token}=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30});
  function request(url:string,payload:object,bearer=token) {
    const id=randomUUID(),closed=latch(),finished=latch(),abort=new AbortController();
    watches.set(id,{closed,finished});
    const response=fetch(base+url,{method:'POST',signal:abort.signal,headers:{'content-type':'application/json',
      authorization:'Bearer '+bearer,'x-test-request':id},body:JSON.stringify(payload)})
      .then(async r=>({status:r.status,payload:await r.text()}),()=>null).catch(()=>null);
    return {response,finished:finished.promise,cancel:async()=>{abort.abort();await closed.promise;}};
  }
  async function target(operation:Operation) {
    const input=body();
    if(operation==='solve')return {url:'/v1/captures',payload:input,id:input.capture_id};
    const parent=request('/v1/captures',input);assert.equal((await parent.response)?.status,200);await parent.finished;
    assert.equal((await store.billing.capture(token,input.capture_id))?.settlementStatus,'settled');
    const id=randomUUID();return {url:`/v1/captures/${input.capture_id}/${operation==='explain'?'explanation':'recovery'}`,
      payload:{...input,[operation==='explain'?'explanation_id':'recovery_id']:id,final_answer:'B'},id};
  }
  async function budgetAvailable(expected=true) {
    const id=randomUUID();assert.equal(await store.billing.reserveBudget(token,id,'official','CNY',100,100),expected);
    await store.billing.releaseBudget(token,id);
  }
  return {store,token,provider,request,target,budgetAvailable,calls:()=>calls,
    close:async()=>{await app.close();await store.close();}};
}

for(const [kind,make] of implementations) {
  for(const operation of ['solve','explain','recover'] as const)for(const afterCommit of [false,true]) {
    test(`${kind}: ${operation} attempt/budget completion ${afterCommit?'lost acknowledgement':'failure'} sends no final receipt`,async()=>{
      const f=await fixture(make);
      try {
        const target=await f.target(operation),billing=f.store.billing,before=f.calls();
        billing.finishAttemptAndBudget=failOnce(billing.finishAttemptAndBudget.bind(billing),afterCommit);
        if(operation==='solve'){
          const req=f.request(target.url,target.payload),response=await req.response;await req.finished;
          assert.match(response!.payload,/data: \[DONE\]/);assert.match(response!.payload,/"questions_charged":1/);
          assert.equal(f.calls(),before+1);assert.equal((await billing.quota(f.token))?.balanceQuestions,29);
          const attempt=(await billing.attempts(f.token)).find(a=>a.captureId===target.id)!;assert.equal(attempt.status,'succeeded');return;
        }
        const req=f.request(target.url,target.payload),response=await req.response;await req.finished;
        assert.equal(f.calls(),before+1);assert.equal(response?.status,200);
        assert.match(response!.payload,/正在核对/);assert.doesNotMatch(response!.payload,/data: \[DONE\]/);
        assert.doesNotMatch(response!.payload,/"type":"usage"/);
        const capture=await billing.capture(f.token,target.id);assert.equal(capture?.settlementStatus,'released');
        assert.equal((await billing.quota(f.token))?.heldQuestions,0);
        assert.equal((await billing.quota(f.token))?.balanceQuestions,operation==='explain'?29:30);
        const attempt=(await billing.attempts(f.token)).find(a=>a.captureId===target.id)!;
        assert.equal(attempt.status,afterCommit?'succeeded':'running');
        assert.equal(attempt.costMicros,afterCommit?'0':null);
        // Solve has an independent best-effort cost retry. An uncertain auxiliary cost
        // keeps the full bound until reconciliation instead of fabricating a zero.
        await f.budgetAvailable(afterCommit);
      }finally{await f.close();}
    });
  }
  for(const operation of ['solve','explain','recover'] as const) {
    for(const stage of ['before_budget','budget','begin_attempt'] as const) {
      test(`${kind}: ${operation} HTTP disconnect at ${stage} never starts a vendor and releases admission`,{timeout:10_000},async()=>{
        const f=await fixture(make);let resume:()=>void=()=>{};
        try {
          const target=await f.target(operation),before=f.calls(),billing=f.store.billing;
          const gate=stage==='before_budget'
            ? operation==='solve'?pause(billing.reap.bind(billing)):pause(billing.attempts.bind(billing))
            : stage==='budget'?pause(billing.reserveBudget.bind(billing))
            : pause(billing.beginWithAttempt.bind(billing));
          // Each pause follows a successful real operation, including committed writes.
          if(stage==='before_budget') {
            if(operation==='solve')billing.reap=gate.call as typeof billing.reap;
            else billing.attempts=gate.call as typeof billing.attempts;
          } else if(stage==='budget')billing.reserveBudget=gate.call as typeof billing.reserveBudget;
          else billing.beginWithAttempt=gate.call as typeof billing.beginWithAttempt;
          resume=gate.resume;
          const req=f.request(target.url,target.payload);await gate.entered;await req.cancel();resume();await req.finished;
          assert.equal(await req.response,null);assert.equal(f.calls(),before);
          const capture=await billing.capture(f.token,target.id),held=stage==='begin_attempt';
          assert.equal(capture?.settlementStatus??null,held?'released':null);
          const quota=(await billing.quota(f.token))!;
          assert.equal(quota.heldQuestions,0);
          // The parent solve stays charged: a caller that hangs up on its own recovery is not compensated.
          assert.equal(quota.balanceQuestions,operation==='solve'?30:29);
          assert.equal(quota.quotaBreakdown.goodwill,0);
          const attempt=(await billing.attempts(f.token)).find(a=>a.captureId===target.id);
          if(stage==='begin_attempt') {
            assert.equal(attempt?.status,'failed');assert.equal(attempt.costMicros,'0');assert.equal(attempt.inputTokens,0);
          } else assert.equal(attempt,undefined);
          await f.budgetAvailable();
          const next=f.request('/v1/captures',body());assert.equal((await next.response)?.status,200);await next.finished;
          assert.equal(f.calls(),before+1,'the concurrency slot is reusable');
        } finally {resume();await f.close();}
      });
    }
    for(const method of ['reserveBudget','beginWithAttempt'] as const)for(const afterCommit of [false,true]) {
      test(`${kind}: ${operation} ${method} ${afterCommit?'lost commit acknowledgement':'rollback'} leaves no admission leak`,{timeout:10_000},async()=>{
        const f=await fixture(make);
        try {
          const target=await f.target(operation),before=f.calls(),billing=f.store.billing;
          if(method==='reserveBudget')billing.reserveBudget=failOnce(billing.reserveBudget.bind(billing),afterCommit);
          else billing.beginWithAttempt=failOnce(billing.beginWithAttempt.bind(billing),afterCommit);
          const req=f.request(target.url,target.payload);const response=await req.response;await req.finished;
          if(method==='beginWithAttempt'){
            assert.equal(f.calls(),before+1);assert.match(response!.payload,/data: \[DONE\]/);
            assert.equal((await billing.quota(f.token))?.heldQuestions,0);
            assert.equal((await billing.quota(f.token))?.balanceQuestions,29);
            assert.equal((await billing.attempts(f.token)).filter(a=>a.captureId===target.id).length,1);return;
          }
          assert.equal(f.calls(),before);
          const captured=false;
          assert.equal((await billing.capture(f.token,target.id))?.settlementStatus??null,captured?'released':null);
          const quota=(await billing.quota(f.token))!;assert.equal(quota.heldQuestions,0);
          assert.equal(quota.balanceQuestions,operation==='solve'?30:operation==='recover'&&captured?30:29);
          const attempt=(await billing.attempts(f.token)).find(a=>a.captureId===target.id);
          assert.equal(attempt,undefined);
          await f.budgetAvailable();
          const next=f.request('/v1/captures',body());assert.equal((await next.response)?.status,200);await next.finished;
          assert.equal(f.calls(),before+1);
        } finally {await f.close();}
      });
    }
  }
  test(`${kind}: uncertain duplicate admission cannot release another worker's capture`,{timeout:10_000},async()=>{
    const f=await fixture(make);let resume:()=>void=()=>{};
    try {
      const billing=f.store.billing,original=billing.beginWithAttempt.bind(billing),target=await f.target('solve');
      const gate=pause(async (...args:Parameters<typeof original>)=>{
        await original(...args);throw new Error('Duplicate acknowledgement lost');
      },false);resume=gate.resume;billing.beginWithAttempt=gate.call;
      const req=f.request(target.url,target.payload);await gate.entered;
      const otherId=randomUUID();
      assert.equal((await billing.begin({token:f.token,captureId:target.id,requestHmac:'another worker',requestId:otherId})).ok,true);
      billing.beginWithAttempt=original;
      // The paused operation observes a duplicate and loses its database acknowledgement.
      await req.cancel();resume();await req.finished;
      assert.equal((await billing.capture(f.token,target.id))?.requestId,otherId);
      assert.equal((await billing.capture(f.token,target.id))?.settlementStatus,'held');
      assert.equal((await billing.quota(f.token))?.heldQuestions,1);assert.equal(f.calls(),0);await f.budgetAvailable();
      await billing.finish({token:f.token,captureId:target.id,charge:false,terminalState:'canceled'});
    } finally {resume();await f.close();}
  });
  for(const operation of ['solve','explain','recover'] as const) {
    for (const afterCommit of [false, true]) {
      test(`${kind}: ${operation} combined settlement ${afterCommit?'lost commit acknowledgement':'failure'} never sends a false receipt`, {timeout:10_000}, async()=>{
        const f=await fixture(make);
        try {
          const target=await f.target(operation),billing=f.store.billing;
          billing.finishWithCapture=failOnce(billing.finishWithCapture.bind(billing),afterCommit);
          const req=f.request(target.url,target.payload),response=await req.response;await req.finished;
          assert.equal(response?.status,200);
          if(operation==='solve'){
            const a=(await billing.attempts(f.token)).find(a=>a.captureId===target.id)!;
            assert.equal(a.diagnostics?.outcome,'completed');
            assert.ok(a.diagnostics?.startedAt);
            assert.match(response.payload,/data: \[DONE\]/);assert.match(response.payload,/"questions_charged":1/);
            assert.equal((await billing.quota(f.token))?.balanceQuestions,29);assert.equal((await billing.quota(f.token))?.heldQuestions,0);
            const once=await billing.quota(f.token);await billing.finishWithCapture({token:f.token,captureId:target.id,charge:true,terminalState:'usable'});
            assert.deepEqual(await billing.quota(f.token),once);return;
          }
          assert.ok(!response.payload.includes('"type":"usage"'));
          assert.ok(!response.payload.includes('data: [DONE]'));
          const capture=await billing.capture(f.token,target.id);
          assert.equal(capture?.settlementStatus,'released');
          assert.equal(capture?.usableResult,afterCommit);
          const quota=(await billing.quota(f.token))!;
          assert.equal(quota.heldQuestions,0);
          assert.equal(quota.balanceQuestions,afterCommit||operation==='explain'?29:30);
          await billing.finishWithCapture({token:f.token,captureId:target.id,charge:false,terminalState:'failed'});
          assert.deepEqual(await billing.quota(f.token),quota);
        } finally {await f.close();}
      });
    }
    test(`${kind}: ${operation} synchronous provider failure is settled without an unhandled deadline rejection`,{timeout:10_000},async()=>{
      const f=await fixture(make);
      try {
        const target=await f.target(operation);
        f.provider.stream=()=>{throw new Error('Provider initialization failed');};
        const req=f.request(target.url,target.payload),response=await req.response;await req.finished;
        assert.equal(response?.status,200);assert.ok(response.payload.endsWith('data: [DONE]\n\n'));
        assert.equal((await f.store.billing.capture(f.token,target.id))?.settlementStatus,'released');
        const attempt=(await f.store.billing.attempts(f.token)).find(a=>a.captureId===target.id)!;
        assert.equal(attempt.status,'failed');assert.equal(attempt.costMicros,null);await f.budgetAvailable(false);
      } finally {await f.close();}
    });
    test(`${kind}: ${operation} disconnect after vendor invocation retains unknown cost and rejects late deltas`,{timeout:10_000},async()=>{
      const f=await fixture(make),entered=latch(),late=latch();let emit:(text:string)=>void=()=>{};
      let lateUsage:()=>void=()=>{};
      try {
        const target=await f.target(operation),before=f.calls();
        f.provider.stream=async(_input,delta)=>{emit=delta;lateUsage=()=>_input.onUsage?.({inputTokens:99,outputTokens:10});entered.resolve();await late.promise;delta(ready);return {inputTokens:99,outputTokens:10};};
        const req=f.request(target.url,target.payload);await entered.promise;await req.cancel();await req.finished;
        const capture=await f.store.billing.capture(f.token,target.id);assert.equal(capture?.settlementStatus,'released');
        if(operation==='solve'){
          const before=(await f.store.billing.attempts(f.token)).find(a=>a.captureId===target.id)!;
          assert.equal(before.diagnostics?.outcome,'client_disconnect');
          lateUsage();await new Promise(resolve=>setImmediate(resolve));
          assert.deepEqual((await f.store.billing.attempts(f.token)).find(a=>a.captureId===target.id),before);
        }
        const attempt=(await f.store.billing.attempts(f.token)).find(a=>a.captureId===target.id)!;
        assert.equal(attempt.status,'failed');assert.equal(attempt.costMicros,null);assert.equal(attempt.inputTokens,null);
        assert.equal((await f.store.billing.quota(f.token))?.heldQuestions,0);await f.budgetAvailable(false);
        const snapshot=await f.store.billing.quota(f.token);emit(ready);late.resolve();await Promise.resolve();await Promise.resolve();
        assert.deepEqual(await f.store.billing.quota(f.token),snapshot);assert.equal(f.calls(),before);
      } finally {late.resolve();await f.close();}
    });
  }
  test(`${kind}: solve sends its committed receipt without a second capture lookup`, {timeout:10_000}, async()=>{
    const f=await fixture(make);
    try {
      const target=await f.target('solve'),billing=f.store.billing,lookup=billing.capture.bind(billing);
      let reads=0;
      billing.capture=async(...args)=>{reads++;assert.equal(reads,1,'only the pre-admission idempotency lookup is needed');return lookup(...args);};
      const req=f.request(target.url,target.payload),response=await req.response;await req.finished;
      assert.equal(response?.status,200);assert.ok(response.payload.endsWith('data: [DONE]\n\n'));
      assert.ok(response.payload.includes('"type":"usage"'));
      assert.equal(reads,1);
      assert.equal((await lookup(f.token,target.id))?.settlementStatus,'settled');
    } finally {await f.close();}
  });
}


test('healthy thinking still completes after 20 seconds without startup retry or leaked reasoning', {timeout:30_000}, async()=>{
  const f=await fixture(()=>new MemoryStore());
  try {
    f.provider.stream=async(_request,delta,signal,onProgress)=>{
      onProgress?.();
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(resolve,20_250);
        signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));},{once:true});
      });
      delta(ready);return {inputTokens:10,outputTokens:2};
    };
    const target=await f.target('solve'),req=f.request(target.url,target.payload);
    const response=await req.response;await req.finished;
    assert.equal(response?.status,200);
    assert.match(response!.payload,/FINAL: B/);
    assert.match(response!.payload,/data: \[DONE\]/);
    assert.equal((await f.store.billing.capture(f.token,target.id))?.settlementStatus,'settled');
    assert.equal((await f.store.billing.quota(f.token))?.heldQuestions,0);
    assert.equal((await f.store.billing.quota(f.token))?.balanceQuestions,29);
  } finally {await f.close();}
});

for (const operation of ['solve', 'explain', 'recover'] as const) {
  test(`user reasoning effort is validated and forwarded for ${operation}`, async () => {
    const f = await fixture(() => new MemoryStore());
    try {
      const target = await f.target(operation);
      const callsBefore = f.calls();
      const invalid = f.request(target.url, {...target.payload, reasoning_effort: 'medium'});
      assert.equal((await invalid.response)?.status, 400);
      await invalid.finished;
      assert.equal(f.calls(), callsBefore);
      let effort: unknown;
      const stream = f.provider.stream.bind(f.provider);
      f.provider.stream = async (input, delta, signal) => {
        effort = input.reasoningEffort;
        return stream(input, delta, signal);
      };
      const request = f.request(target.url, {...target.payload, reasoning_effort: 'max'});
      assert.equal((await request.response)?.status, 200);
      await request.finished;
      assert.equal(effort, 'max');
      if (operation === 'solve') {
        const duplicate = f.request(target.url, {...target.payload, reasoning_effort: 'low'});
        const response = await duplicate.response;
        await duplicate.finished;
        assert.equal(response?.status, 409);
        assert.match(response?.payload ?? '', /idempotency_conflict/);
      }
    } finally { await f.close(); }
  });
}

for(const [kind,make] of implementations) {
  for(const visible of ['',ready]) test(`${kind}: token truncation never bills even with a valid-looking answer`,async()=>{
    const f=await fixture(make);
    try {
      const target=await f.target('solve');
      let calls=0;
      f.provider.stream=async(_req,delta)=>{calls++;delta(visible);return {inputTokens:1314,outputTokens:4096,finishReason:'length'};};
      const request=f.request(target.url,target.payload);const result=await request.response;await request.finished;
      assert.match(result!.payload,/model_output_limit/);
      assert.match(result!.payload,/"questions_charged":0/);
      assert.match(result!.payload,/"usable_result":false/);
      assert.equal((await f.store.billing.capture(f.token,target.id))?.settlementStatus,'released');
      assert.equal((await f.store.billing.quota(f.token))?.balanceQuestions,30);
      assert.equal((await f.store.billing.quota(f.token))?.heldQuestions,0);
      assert.equal((await f.store.billing.attempts(f.token))[0]?.status,'failed');
      assert.equal(calls,1); // No invisible retry/spending loop.
    } finally {await f.close();}
  });
  test(`${kind}: a complete answer above the former 4096 cap settles exactly once`,async()=>{
    const f=await fixture(make);
    try {
      const target=await f.target('solve');
      f.provider.stream=async(_req,delta)=>{delta(ready);return {inputTokens:1314,outputTokens:9000,finishReason:'stop'};};
      const request=f.request(target.url,target.payload);const result=await request.response;await request.finished;
      assert.match(result!.payload,/"questions_charged":1/);
      assert.equal((await f.store.billing.quota(f.token))?.balanceQuestions,29);
      assert.equal((await f.store.billing.quota(f.token))?.heldQuestions,0);
    } finally {await f.close();}
  });
  for(const operation of ['explain','recover'] as const) test(`${kind}: ${operation} never accepts a truncated valid-looking payload`,async()=>{
    const f=await fixture(make);
    try {
      const target=await f.target(operation);
      f.provider.stream=async(_req,delta)=>{delta(operation==='explain'?JSON.stringify({consistent:true,explanation:'Partial'}):ready);return {inputTokens:10,outputTokens:8192,finishReason:'length'};};
      const request=f.request(target.url,target.payload);const result=await request.response;await request.finished;
      assert.match(result!.payload,/model_output_limit/);assert.doesNotMatch(result!.payload,/"type":"delta"/);
      assert.match(result!.payload,/"questions_charged":0/);
      assert.equal((await f.store.billing.quota(f.token))?.heldQuestions,0);
    } finally {await f.close();}
  });
}

for(const [kind,make] of implementations) {
  test(`${kind}: a solve without quota is refused before capacity or budget is taken`,{timeout:20_000},async()=>{
    const f=await fixture(make);
    try {
      const empty=await f.store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0});
      const billing=f.store.billing,acquire=billing.acquireCapacity.bind(billing),reserve=billing.reserveBudget.bind(billing);
      let acquired=0,reserved=0;
      billing.acquireCapacity=(...args)=>{acquired++;return acquire(...args);};
      billing.reserveBudget=(...args)=>{reserved++;return reserve(...args);};
      // 34 leases of the default 24,000-token estimate would fill the 800,000-token minute.
      for(let i=0;i<40;i++) {
        const refused=f.request('/v1/captures',body(),empty.token),response=await refused.response;
        assert.equal(response?.status,402);assert.match(response!.payload,/"insufficient_quota"/);await refused.finished;
      }
      assert.equal(acquired,0);assert.equal(reserved,0);assert.equal(f.calls(),0);
      const funded=f.request('/v1/captures',body());
      assert.equal((await funded.response)?.status,200);await funded.finished;
      assert.equal(acquired,1);assert.equal((await billing.quota(f.token))!.balanceQuestions,29);
    } finally {await f.close();}
  });

  test(`${kind}: admission shares begin's quota decision and never judges a repeated or auxiliary request`,async()=>{
    const store=await make();
    try {
      const billing=store.billing,input=(token:string)=>({token,captureId:randomUUID(),requestHmac:randomUUID()});
      assert.equal(await billing.admitCapture(input('dev_unknown'),0),null);
      const empty=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0});
      assert.deepEqual(await billing.admitCapture(input(empty.token),0),{rejection:'insufficient_quota',paid:false});
      assert.deepEqual(await billing.admitCapture({...input(empty.token),operation:'explain'},0),{rejection:null,paid:false});
      const last=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:1}),held=input(last.token);
      assert.deepEqual(await billing.admitCapture(held,0),{rejection:null,paid:false});
      assert.equal((await billing.begin(held)).ok,true);
      // The held capture took the only question; resuming it is still begin's decision.
      assert.deepEqual(await billing.admitCapture(held,0),{rejection:null,paid:false});
      assert.deepEqual(await billing.admitCapture(input(last.token),0),{rejection:'insufficient_quota',paid:false});
      const packOnly=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0});
      await store.credit({token:packOnly.token,questions:5,amountCents:100,currency:'CNY',provider:'test',reference:randomUUID()});
      const guarded={...input(packOnly.token),allowPurchasedCredits:false};
      assert.deepEqual(await billing.admitCapture(guarded,0),{rejection:'paid_credits_disabled',paid:true});
      assert.deepEqual(await billing.begin(guarded),{ok:false,reason:'paid_credits_disabled'});
      assert.deepEqual(await billing.admitCapture({...guarded,allowPurchasedCredits:true},0),{rejection:null,paid:true});
    } finally {await store.close();}
  });

  test(`${kind}: new solves are counted per device per minute and refusals do not count`,async()=>{
    const store=await make();
    try {
      const billing=store.billing,now=Date.parse('2031-01-01T00:00:10.000Z');
      const a=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:5});
      const b=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:5});
      const empty=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0});
      const input=(token:string)=>({token,captureId:randomUUID(),requestHmac:randomUUID()});
      for(let i=0;i<5;i++)assert.deepEqual(await billing.admitCapture(input(empty.token),2,now),{rejection:'insufficient_quota',paid:false});
      assert.deepEqual(await billing.admitCapture(input(a.token),2,now),{rejection:null,paid:false});
      assert.deepEqual(await billing.admitCapture(input(a.token),2,now+1000),{rejection:null,paid:false});
      assert.deepEqual(await billing.admitCapture(input(a.token),2,now+2000),{rejection:'rate_limited',paid:false});
      assert.deepEqual(await billing.admitCapture(input(b.token),2,now+2000),{rejection:null,paid:false});
      assert.deepEqual(await billing.admitCapture(input(a.token),2,now+60_000),{rejection:null,paid:false});
      assert.deepEqual(await billing.admitCapture(input(a.token),0,now+60_000),{rejection:null,paid:false});
    } finally {await store.close();}
  });

  test(`${kind}: the per-device limit answers 429 without charging or calling the model`,{timeout:20_000},async()=>{
    const f=await fixture(make,1,1);
    try {
      // Three sequential solves cross at most one minute boundary, so at least one is refused.
      const statuses:number[]=[];
      for(let i=0;i<3;i++) {
        const sent=f.request('/v1/captures',body()),response=await sent.response;await sent.finished;
        statuses.push(response!.status);
        if(response!.status===429)assert.match(response!.payload,/"rate_limited"/);
      }
      const refused=statuses.filter(status=>status===429).length;
      assert.ok(refused>=1,statuses.join());assert.equal(statuses.filter(status=>status===200).length,3-refused);
      assert.equal(f.calls(),3-refused);
      assert.equal((await f.store.billing.quota(f.token))!.balanceQuestions,30-(3-refused));
    } finally {await f.close();}
  });

  test(`${kind}: a lease whose supplier call never started leaves the rate window`,async()=>{
    const store=await make();
    try {
      const billing=store.billing,now=Date.now()+3_600_000;
      const {token}=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:1});
      const lease=async()=>{const id=randomUUID();assert.equal(await billing.acquireCapacity(token,id,24_000,now),true);return id;};
      // 33 leases of 24,000 tokens leave no room for another inside the 800,000-token minute.
      for(let i=0;i<24;i++)await billing.releaseCapacity(token,await lease());
      const unstarted:string[]=[];for(let i=0;i<9;i++)unstarted.push(await lease());
      assert.equal(await billing.acquireCapacity(token,randomUUID(),24_000,now),false);
      await billing.releaseCapacity(token,unstarted[0]!);
      assert.equal(await billing.acquireCapacity(token,randomUUID(),24_000,now),false);
      for(const id of unstarted.slice(1))await billing.releaseCapacity(token,id,false);
      assert.equal(await billing.acquireCapacity(token,randomUUID(),24_000,now),true);
    } finally {await store.close();}
  });
}

for(const [kind,make] of implementations) {
  test(`${kind}: only unconsumed purchased, Plus or pre-migration questions make a device paying`,async()=>{
    const store=await make();
    try {
      const billing=store.billing,input=(token:string)=>({token,captureId:randomUUID(),requestHmac:randomUUID()});
      const paid=async(token:string)=>(await billing.admitCapture(input(token),0))!.paid;
      const trial=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30});
      assert.equal(await paid(trial.token),false);
      const pack=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0});
      await store.credit({token:pack.token,questions:1,amountCents:100,currency:'CNY',provider:'test',reference:randomUUID()});
      assert.equal(await paid(pack.token),true);
      const held=input(pack.token);assert.equal((await billing.begin(held)).ok,true);
      // The held question is still the device's own; resuming it keeps full access.
      assert.equal((await billing.admitCapture(held,0))!.paid,true);
      await billing.finish({...held,charge:true,terminalState:'usable'});
      assert.equal(await paid(pack.token),false);
      const gift=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0});
      await store.credit({token:gift.token,questions:5,amountCents:0,currency:'CNY',provider:'test',reference:randomUUID()});
      assert.equal(await paid(gift.token),false);
      const plus=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0}),now=Date.now();
      const reserved=(await store.plus.reserve(plus.token))!,ticket=(await store.plus.beginSync(reserved.intentId))!;
      await store.plus.apply(reserved.intentId,ticket.generation,{subscriptionId:'sub_share',customerId:'cus_share',status:'active',
        cancelAtPeriodEnd:false,paidFrom:new Date(now-1000).toISOString(),paidUntil:new Date(now+86_400_000).toISOString(),invoiceId:'in_share'});
      assert.equal(await paid(plus.token),true);
    } finally {await store.close();}
  });

  test(`${kind}: a device without paid questions leaves part of the budget and rate window free`,async()=>{
    const store=await make();
    try {
      const billing=store.billing,later=Date.now()+7_200_000;
      const {token}=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:1});
      const hold=(scope:string,guarded:boolean,share:number)=>billing.reserveBudget(token,randomUUID(),scope,'CNY',100,1000,86_400_000,undefined,0,guarded,'default',share);
      for(let i=0;i<8;i++)assert.equal(await hold('share_plain',false,0.8),true);
      assert.equal(await hold('share_plain',false,0.8),false);
      assert.equal(await hold('share_plain',false,1),true);assert.equal(await hold('share_plain',false,1),true);
      assert.equal(await hold('share_plain',false,1),false);
      // Guarded windows keep 20% headroom first: 800 usable, 640 of it without paid questions.
      for(let i=0;i<6;i++)assert.equal(await hold('share_guarded',true,0.8),true);
      assert.equal(await hold('share_guarded',true,0.8),false);
      assert.equal(await hold('share_guarded',true,1),true);assert.equal(await hold('share_guarded',true,1),true);
      assert.equal(await hold('share_guarded',true,1),false);
      const lease=(at:number,tokens:number,share:number)=>billing.acquireCapacity(token,randomUUID(),tokens,at,share);
      // 24 concurrent slots: 19 without paid questions, the last 5 only for paying devices.
      for(let i=0;i<19;i++)assert.equal(await lease(later,1000,0.8),true);
      assert.equal(await lease(later,1000,0.8),false);
      for(let i=0;i<5;i++)assert.equal(await lease(later,1000,1),true);
      assert.equal(await lease(later,1000,1),false);
      // A fresh minute after those leases expired: 640,000 of the 800,000 tokens without paid questions.
      const fresh=later+200_000;
      assert.equal(await lease(fresh,640_001,0.8),false);assert.equal(await lease(fresh,640_000,0.8),true);
      assert.equal(await lease(fresh,160_001,1),false);assert.equal(await lease(fresh,160_000,1),true);
    } finally {await store.close();}
  });

  test(`${kind}: at the reserved share a device without paid questions waits while a paying one is served`,{timeout:20_000},async()=>{
    // The fixture's daily budget fits one attempt, so half of it admits nothing unpaid.
    const f=await fixture(make,1,0,50);
    try {
      const refused=f.request('/v1/captures',body()),response=await refused.response;await refused.finished;
      assert.equal(response?.status,503);assert.match(response!.payload,/"budget_exceeded"/);
      assert.equal(f.calls(),0);assert.equal((await f.store.billing.quota(f.token))!.balanceQuestions,30);
      await f.store.credit({token:f.token,questions:5,amountCents:100,currency:'CNY',provider:'test',reference:randomUUID()});
      const served=f.request('/v1/captures',body());
      assert.equal((await served.response)?.status,200);await served.finished;
      assert.equal(f.calls(),1);assert.equal((await f.store.billing.quota(f.token))!.balanceQuestions,34);
    } finally {await f.close();}
  });
}

for(const [kind,make] of implementations) {
  test(`${kind}: hanging up on a running recovery keeps the original charge; a supplier failure is compensated once`,{timeout:20_000},async()=>{
    for(const hangUp of [true,false]) {
      const f=await fixture(make);
      try {
        const target=await f.target('recover'),started=latch();
        f.provider.stream=async(_request,_delta,signal)=>{
          started.resolve();
          if(!hangUp)throw new Error('supplier failure');
          await new Promise<never>((_,reject)=>signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
          throw new Error('unreachable');
        };
        const sent=f.request(target.url,target.payload);await started.promise;
        if(hangUp)await sent.cancel();else assert.equal((await sent.response)?.status,200);
        await sent.finished;
        const quota=(await f.store.billing.quota(f.token))!,capture=(await f.store.billing.capture(f.token,target.id))!;
        assert.equal(capture.settlementStatus,'released');assert.equal(capture.usableResult,false);
        assert.equal(quota.heldQuestions,0);assert.equal(quota.quotaBreakdown.goodwill,hangUp?0:1);
        assert.equal(quota.balanceQuestions,hangUp?29:30);
      } finally {await f.close();}
    }
  });

  test(`${kind}: recovery compensation lapses with the allowance that paid for the question`,async t=>{
    // One second before the Beijing-midnight reset of daily allowances.
    const start=Date.parse('2026-10-16T15:59:59.000Z');t.mock.timers.enable({apis:['Date'],now:start});
    const store=await make();
    try {
      const billing=store.billing,id=()=>({captureId:randomUUID(),requestHmac:randomUUID()});
      const failedRecovery=async(token:string,after=0)=>{
        const parent={token,...id()};assert.equal((await billing.begin(parent)).ok,true);
        await billing.finish({...parent,charge:true,terminalState:'usable'});
        if(after)t.mock.timers.setTime(Date.now()+after);
        const recovery={token,...id(),operation:'recover' as const,parentCaptureId:parent.captureId};
        assert.equal((await billing.begin(recovery)).ok,true);
        await billing.finish({token,captureId:recovery.captureId,charge:false,terminalState:'failed',compensateGoodwill:true});
        return (await billing.quota(token))!;
      };
      const daily=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0,freeTrialEligible:true});
      await billing.claimFreeTrial(daily.token);
      const permanent=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30});
      const lapsed=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:0,freeTrialEligible:true});
      await billing.claimFreeTrial(lapsed.token);
      const compensated=await failedRecovery(daily.token);
      assert.equal(compensated.quotaBreakdown.goodwill,1);assert.equal(compensated.balanceQuestions,400);
      assert.equal((await failedRecovery(permanent.token)).quotaBreakdown.goodwill,1);
      // The charged allowance has already reset by the time this recovery fails.
      const late=await failedRecovery(lapsed.token,2000);
      assert.equal(late.quotaBreakdown.goodwill,0);assert.equal(late.balanceQuestions,400);
      const nextDay=(await billing.quota(daily.token))!;
      assert.equal(nextDay.quotaBreakdown.goodwill,0);assert.equal(nextDay.balanceQuestions,400);
      const kept=(await billing.quota(permanent.token))!;
      assert.equal(kept.quotaBreakdown.goodwill,1);assert.equal(kept.balanceQuestions,30);
    } finally {await store.close();}
  });
}
