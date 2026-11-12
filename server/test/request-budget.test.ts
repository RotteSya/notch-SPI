import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {config,validateTrialPolicy} from '../src/config.ts';
import {registerRoutes} from '../src/routes.ts';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import {StubPaymentProvider} from '../src/payments.ts';
import {AstraProvider} from '../src/providers/astra.ts';
import {OpenAIProvider} from '../src/providers/openai.ts';
import type {Provider,CaptureRequest} from '../src/providers/types.ts';
import {SCREEN_QUERY_VERSION} from '../src/screen-query.ts';
import {pngBase64 as png} from './helpers/images.ts';

const pricing=JSON.stringify([{model:'openai:gpt-6-astra',input_micros_per_million_tokens:25000000,output_micros_per_million_tokens:75000000},
  {model:'openai:gpt-6-astra:fast',input_micros_per_million_tokens:50000000,output_micros_per_million_tokens:150000000}]);
const answer='FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
const body=()=>({capture_id:randomUUID(),result_protocol:'objective_v1',response_contract:'screen_query_v1',operation:'solve',
  images_base64:[png],image_media_type:'image/png',profile_id:'reading_practice',profile_version:SCREEN_QUERY_VERSION,
  prompt_version:SCREEN_QUERY_VERSION,ui_language:'en',scope:{target_count:1,question_image_index:0,rect:{x:0,y:0,width:1,height:1}}});

test('experimental local mode cannot be activated in production or serverless; unknown modes fail',()=>{
  for(const patch of [{requireDurableStorage:true},{isServerless:true}])assert.throws(()=>validateTrialPolicy({...config,requestBudgetMode:'local-request',...patch}),/not production-qualified/);
  assert.throws(()=>validateTrialPolicy({...config,requestBudgetMode:'surprise'}),/Invalid/);
});

test('estimation and actual transport share the same serialized messages and output cap',async t=>{
  const p=new AstraProvider('synthetic','https://api.openai.com',8192,false);
  const builder=new OpenAIProvider('synthetic','https://api.openai.com','gpt-6-astra',8192,{astraTier:'default'});
  const input={system:'完整日文題文',task:'全選択肢',images:[{base64:png,mediaType:'image/png'}],purpose:'explain' as const,maxTokens:8192};
  const expected=JSON.stringify(builder.requestBody(input));const quote=await p.estimateReservation(input,pricing);
  assert.equal(quote.outputUpper,8192);
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    assert.equal(init?.body,expected);
    const identity={model:'gpt-6-astra',service_tier:'default'};
    return new Response('data: '+JSON.stringify({...identity,choices:[{delta:{content:answer},finish_reason:'stop'}]})+'\n\n'
      +'data: '+JSON.stringify({...identity,choices:[],usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n',
      {headers:{'content-type':'text/event-stream'}});
  });
  await p.stream(input,()=>{},new AbortController().signal);
  const routed=new AstraProvider('synthetic','https://api.openai.com',8192,true);
  const fast=await routed.estimateReservation({...input,purpose:'answer'},pricing);
  assert.equal(fast.micros,3*(quote.micros-1)+2);
  assert.equal((await routed.estimateReservation(input,pricing)).micros,quote.micros);
});

test('quotes reject unknown endpoints/catalogs and preserve configured explanation limits',async()=>{
  const input={system:'full prompt',task:'all options',images:[{base64:png,mediaType:'image/png'}],purpose:'explain' as const,maxTokens:2048};
  const p=new AstraProvider('synthetic','https://api.openai.com',8192,true);
  assert.equal((await p.estimateReservation(input,pricing)).outputUpper,2048);
  await assert.rejects(p.estimateReservation(input,'[]'));
  await assert.rejects(new AstraProvider('synthetic','https://proxy.invalid',8192,false).estimateReservation(input,pricing));
  await assert.rejects(p.estimateReservation({...input,images:[]},pricing));
  await assert.rejects(p.estimateReservation({...input,system:'日'.repeat(400000)},pricing));
});

for(const kind of ['memory','sqlite'] as const){
  async function setup(mode='local-request',daily=2_000_000){
    const app=Fastify({logger:false}),store=kind==='memory'?new MemoryStore():new SqliteStore(':memory:');
    const astra=new AstraProvider('synthetic','https://api.openai.com',8192,false);
    const quotes:CaptureRequest[]=[],sent:CaptureRequest[]=[];
    let failEstimate=false,unknownUsage=false,excessInput=false,wait:(()=>Promise<void>)|undefined;
    const provider:Provider={name:'openai',async estimateReservation(req,p){
      if(failEstimate)throw new Error('private details');
      quotes.push(structuredClone(req));return astra.estimateReservation(req,p);
    },async stream(req,delta){sent.push(structuredClone(req));if(wait)await wait();
      if(unknownUsage)throw new Error('missing final usage');
      delta(req.purpose==='explain'?JSON.stringify({consistent:true,explanation:'B follows from the full passage.'}):answer);
      return {inputTokens:excessInput?10000:100,outputTokens:20,finishReason:'stop'};
    }};
    const settings={...config,provider:'openai' as const,objectiveProvider:'openai' as const,model:'gpt-6-astra',objectiveModel:'gpt-6-astra',
      maxTokens:8192,objectiveMaxTokens:8192,explanationMaxTokens:8192,requestBudgetMode:mode,
      requestHmacKeysJSON:JSON.stringify({test:randomBytes(32).toString('base64')}),requestHmacKeyVersion:'test',
      requireDurableStorage:false,isServerless:false,screenQueryEnabled:true,explanationEnabled:true,enabledSupportProfiles:'reading_practice',
      attemptBudgetUpperMicros:1_000_000,modelDailyBudgetMicros:daily,modelCostCurrency:'USD',modelPricingJSON:pricing};
    registerRoutes(app,{config:settings,store,storeKind:kind,provider,objectiveProvider:provider,
      providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
    const user=()=>store.registerDevice({platform:'test',appVersion:'3.0',trialQuestions:30});
    const {token}=await user();
    const post=(url:string,payload:object,t=token)=>app.inject({method:'POST',url,headers:{authorization:`Bearer ${t}`},payload});
    return {app,store,quotes,sent,settings,user,token,post,
      excess:()=>{excessInput=true;},failEstimate:()=>{failEstimate=true;},unknown:(value=true)=>{unknownUsage=value;},wait:(fn:()=>Promise<void>)=>{wait=fn;},
      close:async()=>{await app.close();await store.close();}};
  }
  for (const mode of ['local-request','guarded-request']) test(`${kind}/${mode}: solve, recovery, explanation reserve the exact complete request before dispatch`,async()=>{
    const f=await setup(mode);try{
      const b=body();assert.equal((await f.post('/v1/captures',b)).statusCode,200);
      const recovery_id=randomUUID();assert.equal((await f.post(`/v1/captures/${b.capture_id}/recovery`,{...b,recovery_id})).statusCode,200);
      assert.equal((await f.post(`/v1/captures/${b.capture_id}/explanation`,{...b,explanation_id:randomUUID(),answer_capture_id:recovery_id,final_answer:'B'})).statusCode,200);
      assert.equal(f.sent.length,3);assert.deepEqual(f.quotes,f.sent);
      assert.deepEqual(f.sent.map(x=>x.purpose),[undefined,'recover','explain']);
      assert.ok(f.sent[2]!.task.includes('B'));assert.equal(f.sent[2]!.maxTokens,8192);
      assert.ok(f.sent.every(x=>x.images[0]!.base64===png));
      assert.equal((await f.store.getAccount(f.token))?.totalQuestions,1);
      const dup=await f.post('/v1/captures',b);assert.equal(dup.statusCode,409);assert.equal(f.quotes.length,3);
    }finally{await f.close();}
  });
  test(`${kind}: legacy direct requests use the same reservation path; client prices are ignored`,async()=>{
    const f=await setup();try{
      assert.equal((await f.post('/v1/captures',{capture_id:randomUUID(),system:'full original',task:'all options',image_base64:png,image_media_type:'image/png',reserved_micros:0})).statusCode,200);
      assert.equal(f.sent.length,1);assert.deepEqual(f.sent,f.quotes);
    }finally{await f.close();}
  });
  test(`${kind}: guarded ordinary tutor estimates and dispatches the same negotiated request`, async () => {
    const f = await setup('guarded-request');
    try {
      const response = await f.post('/v1/captures', {
        capture_id: randomUUID(), tutor_result_v1: true,
        system: 'Answer the question as asked', task: 'Read the screenshot',
        image_base64: png, image_media_type: 'image/png',
      });
      assert.equal(response.statusCode, 200);
      assert.equal(f.sent.length, 1);
      assert.equal(f.sent[0]?.tutorResultV1, true);
      assert.deepEqual(f.quotes, f.sent);
      assert.equal((await f.store.getAccount(f.token))?.totalQuestions, 1);
    } finally { await f.close(); }
  });
  test(`${kind}: shared budget limits different users while requests are in flight`,async()=>{
    const f=await setup('local-request',1_800_000);let release!:()=>void;
    const hold=new Promise<void>(r=>{release=r;});f.wait(()=>hold);
    try{
      const users=await Promise.all([f.user(),f.user(),f.user()]);
      const pending=users.map(u=>f.post('/v1/captures',body(),u.token));
      // Start all injected requests before waiting for the two provider dispatches.
      const all=Promise.all(pending);
      for(let n=0;n<200&&f.sent.length<2;n++)await new Promise(r=>setTimeout(r,5));
      assert.equal(f.sent.length,2);release();
      const replies=await all;assert.equal(replies.filter(x=>x.statusCode===200).length,2);
      assert.equal(replies.filter(x=>x.statusCode===503).length,1);
    }finally{release();await f.close();}
  });
  test(`${kind}: unknown metering retains per-request hold; unsupported estimates never dispatch`,async()=>{
    const f=await setup('local-request',1_000_000);try{
      f.failEstimate();assert.equal((await f.post('/v1/captures',body())).statusCode,503);assert.equal(f.sent.length,0);
    }finally{await f.close();}
    const g=await setup('local-request',1_000_000);try{
      g.unknown();await g.post('/v1/captures',body());
      assert.equal((await g.post('/v1/captures',body())).statusCode,503);assert.equal(g.sent.length,1);
    }finally{await g.close();}
  });
  test(`${kind}: valid token estimate deviations within cost hold do not latch`,async()=>{
    const f=await setup('guarded-request',10_000_000);try{
      f.excess();assert.equal((await f.post('/v1/captures',body())).statusCode,200);
      const blocked=await f.post('/v1/captures',body(),(await f.user()).token);
      assert.equal(blocked.statusCode,200);
      assert.equal(f.sent.length,2);
    }finally{await f.close();}
  });
  test(`${kind}: missing usage releases question and allows the next guarded request`,async()=>{
    const f=await setup('guarded-request',10_000_000);try{
      f.unknown();const failed=await f.post('/v1/captures',body());
      assert.match(failed.body,/"questions_charged":0/);
      assert.equal((await f.store.getAccount(f.token))?.balanceQuestions,30);
      f.unknown(false);
      const next=await f.post('/v1/captures',body(),(await f.user()).token);
      assert.equal(next.statusCode,200);assert.match(next.body,/"questions_charged":1/);
      assert.equal(f.sent.length,2);
    }finally{await f.close();}
  });
  test(`${kind}: repeated missing usage still exhausts daily budget`,async()=>{
    const f=await setup('guarded-request',1_500_000);try{
      f.unknown();await f.post('/v1/captures',body());
      const next=await f.post('/v1/captures',body());
      assert.equal(next.statusCode,503);assert.equal(next.json().error.code,'budget_exceeded');
      assert.equal(f.sent.length,1);
    }finally{await f.close();}
  });
  test(`${kind}: 24 capacity leases report busy, then recover when a slot frees`,async()=>{
    const f=await setup('guarded-request',100_000_000);let release!:()=>void;
    const hold=new Promise<void>(r=>{release=r;});f.wait(()=>hold);
    try{
      const users=await Promise.all(Array.from({length:24},()=>f.user()));
      const pending=[];
      for (const [i,u] of users.entries()) {
        pending.push(Promise.resolve(f.post('/v1/captures',body(),u.token)));
        for(let n=0;n<200&&f.sent.length<i+1;n++)await new Promise(r=>setTimeout(r,5));
      }
      const all=Promise.all(pending);
      assert.equal(f.sent.length,24);
      const busy=await f.post('/v1/captures',body());
      assert.equal(busy.statusCode,429);assert.equal(busy.json().error.code,'rate_limited');
      assert.equal(busy.headers['retry-after'],'5');assert.equal(f.sent.length,24);
      release();await all;
      assert.equal((await f.post('/v1/captures',body())).statusCode,200);
      assert.equal(f.sent.length,25);
    }finally{release();await f.close();}
  });
  test(`${kind}: shadow failure keeps fixed hold and never reduces production admission`,async()=>{
    const f=await setup('shadow',900_000);try{
      f.failEstimate();assert.equal((await f.post('/v1/captures',body())).statusCode,503);assert.equal(f.sent.length,0);
    }finally{await f.close();}
  });
}
