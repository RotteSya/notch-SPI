import {CAPTURE_DEADLINE} from '../src/capture-deadline.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import Fastify from 'fastify';
import {config} from '../src/config.ts';
import {registerRoutes} from '../src/routes.ts';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import type {Store} from '../src/db.ts';
import {StubPaymentProvider} from '../src/payments.ts';
import {TransientProviderError,type Provider} from '../src/providers/types.ts';
import {pngBase64} from './helpers/images.ts';
const ready='FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
for(const kind of ['memory','sqlite',...(process.env.TEST_POSTGRES_URL?['postgres']:[])]){
 async function fixture(stream:Provider['stream'],budget=10_000_000){
  let stores:Store[],cleanup=async()=>{};
  if(kind==='postgres'){
   const url=new URL(process.env.TEST_POSTGRES_URL!);
   if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/i.test(url.pathname))throw new Error('Local throwaway test database required');
   const {PostgresStore}=await import('../src/db-postgres.ts'),pg=(await import('pg')).default;
   const admin=new pg.Pool({connectionString:url.toString(),ssl:false}),schema='reliability_'+randomUUID().replaceAll('-','');
   await admin.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options','-c search_path='+schema);
   stores=[new PostgresStore(url.toString(),false),new PostgresStore(url.toString(),false)];
   for(const s of stores)await s.getAccount('schema-warmup');
   cleanup=async()=>{await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};
  }else stores=[kind==='memory'?new MemoryStore():new SqliteStore(':memory:')];
  const store=stores[0]!,apps=stores.map(()=>Fastify());
  const provider:Provider={name:'openai',stream,estimateReservation:async()=>({micros:1_000_000,inputUpper:100,outputUpper:100})};
  for(const [index,app] of apps.entries())registerRoutes(app,{config:{...config,provider:'mock',objectiveProvider:'mock',model:'fixture',objectiveModel:'fixture',adminToken:'',
   requestBudgetMode:'guarded-request',captureConcurrencyPerToken:4,modelCostCurrency:'USD',modelDailyBudgetMicros:budget,attemptBudgetUpperMicros:1_000_000,
   modelPricingJSON:JSON.stringify([{model:'openai:fixture',input_micros_per_million_tokens:10_000_000,output_micros_per_million_tokens:10_000_000}])},
   store:stores[index]!,storeKind:kind as 'memory'|'sqlite'|'postgres',provider,objectiveProvider:provider,providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
  const users=await Promise.all(Array.from({length:8},()=>store.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:100})));
  function call(i=0,id=randomUUID()){return apps[i%apps.length]!.inject({method:'POST',url:'/v1/captures',headers:{authorization:'Bearer '+users[i]!.token},payload:{capture_id:id,
   images_base64:[pngBase64],image_media_type:'image/png',system:'Answer correctly',task:'Choose B',result_protocol:'objective_v1'}});}
  return {store,users,call,async close(){await Promise.all(apps.map(a=>a.close()));await Promise.all(stores.map(s=>s.close()));await cleanup();}};
 }
 test(`${kind}: eight simultaneous users finish, eight independently admitted calls, one charge each`,async()=>{
  let active=0,peak=0,calls=0;const f=await fixture(async(_r,delta,_signal,onProgress)=>{onProgress?.();calls++;active++;peak=Math.max(peak,active);await delay(300);delta(ready);active--;return {inputTokens:50,outputTokens:50};});
  try{
   const responses=await Promise.all(f.users.map((_,i)=>f.call(i)));
   for(const r of responses){assert.equal(r.statusCode,200);assert.match(r.body,/"questions_charged":1/);assert.match(r.body,/"terminal_state":"usable"/);assert.match(r.body,/\[DONE\]/);}
   assert.equal(calls,8);assert.equal(peak,8);
   for(const u of f.users)assert.equal((await f.store.billing.quota(u.token))!.balanceQuestions,99);
   const b=(await f.store.billing.inspectBudget()).windows[0]!;assert.equal(b.held,0);assert.equal(b.spent,8000);
  }finally{await f.close();}
 });
 if(kind==='postgres')test('PostgreSQL: eight slow requests across two services finish beyond the old eight-second queue limit',{timeout:35_000},async()=>{
  let active=0,peak=0,calls=0;const f=await fixture(async(_r,delta,_signal,onProgress)=>{
   onProgress?.();calls++;active++;peak=Math.max(peak,active);await delay(12_000);delta(ready);active--;return {inputTokens:50,outputTokens:50};
  });
  try{
   const responses=await Promise.all(f.users.map((_,i)=>f.call(i)));
   for(const r of responses){assert.equal(r.statusCode,200);assert.match(r.body,/"questions_charged":1/);assert.match(r.body,/"terminal_state":"usable"/);}
   assert.equal(calls,8);assert.equal(peak,8);
   for(const u of f.users)assert.equal((await f.store.billing.quota(u.token))!.balanceQuestions,99);
   const b=(await f.store.billing.inspectBudget()).windows[0]!;assert.equal(b.held,0);assert.equal(b.spent,8000);
  }finally{await f.close();}
 });
 test(`${kind}: transient upstream retries once, preserves unknown first cost, duplicate never calls or charges again`,async()=>{
  let calls=0;const ids:string[]=[];const f=await fixture(async(r,delta)=>{
   ids.push(r.clientRequestId!);r.onTiming?.('upstreamRequest');
   r.onHeaders?.({'x-request-id':'req_fixture_'+calls},calls===0?503:200);
   if(++calls===1)throw new TransientProviderError(503,1);
   r.onTiming?.('upstreamFirstAnswer');r.onUsage?.({inputTokens:50,outputTokens:50});
   delta(ready);return {inputTokens:50,outputTokens:50};});
  try{
   const id=randomUUID(),r=await f.call(0,id);assert.match(r.body,/"questions_charged":1/);assert.equal(calls,2);
   const b=await f.store.billing.inspectBudget();assert.equal(b.windows[0]!.spent,1_001_000);assert.equal(b.provisional.length,1);assert.equal(b.provisional[0]!.booked,1_000_000);
   const attempts=await f.store.billing.attempts(f.users[0]!.token);
   assert.equal(attempts.length,2);assert.equal(new Set(ids).size,2);
   assert.equal('recordAttemptDiagnostics' in f.store.billing,false,'diagnostics add no standalone database transaction');
   for(const a of attempts){assert.ok(a.diagnostics?.startedAt);assert.ok(Date.parse(a.diagnostics!.endedAt)>=Date.parse(a.diagnostics!.startedAt));}
   const first=attempts.find(a=>a.attemptId===ids[0])!,second=attempts.find(a=>a.attemptId===ids[1])!;
   assert.equal(first.diagnostics?.outcome,'supplier_rejection');assert.equal(first.diagnostics?.httpStatus,503);
   assert.equal(first.diagnostics?.usageReceived,false);assert.equal(first.diagnostics?.stages.upstreamFirstAnswer,undefined);
   assert.equal(second.diagnostics?.outcome,'completed');assert.equal(second.diagnostics?.usageReceived,true);
   assert.equal(second.diagnostics?.upstreamRequestId,'req_fixture_1');assert.ok(second.usageEvidence);assert.equal(second.diagnostics?.usageValidated,true);assert.equal(first.diagnostics?.usageValidated,false);
   assert.ok(second.diagnostics?.stages.upstreamFirstAnswer!==undefined);
   const duplicate=await f.call(0,id);assert.equal(duplicate.statusCode,200);assert.match(duplicate.body,/FINAL: B/);assert.match(duplicate.body,/\[DONE\]/);assert.equal(calls,2);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);assert.equal((await f.store.billing.inspectBudget()).windows[0]!.spent,1_001_000);
  }finally{await f.close();}
 });
 test(`${kind}: late usage during retry belongs to the original attempt and is reconciled once`,async()=>{
  let firstUsage:NonNullable<Parameters<Provider['stream']>[0]['onUsage']>=()=>{};
  let calls=0;const ids:string[]=[];const f=await fixture(async(r,delta)=>{
   ids.push(r.clientRequestId!);
   if(++calls===1){firstUsage=r.onUsage!;throw new TransientProviderError(503,1);}
   firstUsage({inputTokens:20,outputTokens:10});
   firstUsage({inputTokens:20,outputTokens:10}); // identical duplicate is harmless
   firstUsage({inputTokens:999,outputTokens:999}); // conflicting evidence cannot overwrite
   r.onUsage?.({inputTokens:50,outputTokens:50});delta(ready);
   return {inputTokens:50,outputTokens:50};
  });
  try{
   assert.match((await f.call()).body,/"questions_charged":1/);
   const attempts=await f.store.billing.attempts(f.users[0]!.token);
   const first=attempts.find(a=>a.attemptId===ids[0])!,second=attempts.find(a=>a.attemptId===ids[1])!;
   assert.equal(first.usageEvidence?.source,'upstream_usage:'+ids[0]);assert.equal(first.usageEvidence?.costMicros,300);
   assert.equal(second.usageEvidence?.costMicros,1000);
   for(const a of [first,second]){assert.equal(a.diagnostics?.usageReceived,true);assert.equal(a.diagnostics?.usageValidated,true);assert.equal(a.diagnostics?.usageEvidencePersisted,true);}
   await f.store.billing.reap();await f.store.billing.reap();
   const budget=await f.store.billing.inspectBudget();assert.equal(budget.provisional.length,0);assert.equal(budget.windows[0]!.spent,1300);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);
   firstUsage({inputTokens:200,outputTokens:100});
   await delay(0);assert.deepEqual(await f.store.billing.attempts(f.users[0]!.token),attempts);
  }finally{await f.close();}
 });
 test(`${kind}: failed usage persistence stays distinct from received and validated`,async()=>{
  let calls=0,firstId='',writes=0;
  const f=await fixture(async(r,delta)=>{
   if(++calls===1){firstId=r.clientRequestId!;r.onUsage?.({inputTokens:20,outputTokens:10});throw new TransientProviderError(503,1);}
   r.onUsage?.({inputTokens:50,outputTokens:50});delta(ready);return {inputTokens:50,outputTokens:50};
  });
  const original=f.store.billing.recordAttemptUsage.bind(f.store.billing);
  f.store.billing.recordAttemptUsage=async(...args)=>{if(args[1]===firstId){writes++;throw new Error('synthetic database unavailable');}return original(...args);};
  try{
   assert.match((await f.call()).body,/"questions_charged":1/);assert.equal(writes,3);
   const first=(await f.store.billing.attempts(f.users[0]!.token)).find(a=>a.attemptId===firstId)!;
   assert.equal(first.diagnostics?.usageReceived,true);assert.equal(first.diagnostics?.usageValidated,true);
   assert.equal(first.diagnostics?.usageEvidencePersisted,false);assert.equal(first.usageEvidence,undefined);
   await f.store.billing.reap();assert.equal((await f.store.billing.inspectBudget()).provisional.length,1);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);
  }finally{await f.close();}
 });
 test(`${kind}: network failure remains distinct from HTTP rejection and keeps unknown cost`,async()=>{
  let calls=0;const f=await fixture(async(r,delta)=>{
   r.onTiming?.('upstreamRequest');if(++calls===1)throw new TransientProviderError(0,1,'network');
   delta(ready);return {inputTokens:50,outputTokens:50};
  });
  try{await f.call();const attempts=await f.store.billing.attempts(f.users[0]!.token);
   const first=attempts.find(a=>a.status==='failed')!;assert.equal(first.diagnostics?.outcome,'network_error');
   assert.equal(first.diagnostics?.httpStatus,undefined);assert.equal(first.costMicros,null);
  }finally{await f.close();}
 });
 if(kind==='sqlite')test('SQLite: overall deadline closes diagnostics even when provider ignores abort',async()=>{
  const limits=CAPTURE_DEADLINE as {generationMs:number};const before=limits.generationMs;limits.generationMs=100;
  const f=await fixture(async(_r,_delta,_signal,progress)=>{progress?.();return new Promise(()=>{});});
  try{const result=await f.call();assert.match(result.body,/"questions_charged":0/);
   const attempts=await f.store.billing.attempts(f.users[0]!.token);
   assert.equal(attempts.length,1);assert.equal(attempts[0]!.diagnostics?.outcome,'generation_timeout');
   assert.ok(attempts[0]!.diagnostics?.stages.firstProgress!==undefined);
   assert.equal(attempts[0]!.diagnostics?.usageValidated,false);
  }finally{limits.generationMs=before;await f.close();}
 });
 test(`${kind}: retry admission acknowledgement loss releases only the uninvoked second hold`,async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;throw new TransientProviderError(503,1);});
  const original=f.store.billing.startAttempt.bind(f.store.billing);
  f.store.billing.startAttempt=async(...args)=>{await original(...args);throw new Error('commit acknowledgement lost');};
  try{
   assert.match((await f.call()).body,/"questions_charged":0/);assert.equal(calls,1);
   const b=await f.store.billing.inspectBudget();assert.equal(b.windows[0]!.spent,1_000_000);assert.equal(b.windows[0]!.held,0);
   assert.equal(b.provisional.length,1);assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,100);
   const attempts=await f.store.billing.attempts(f.users[0]!.token);assert.equal(attempts.length,2);
   assert.equal(attempts.filter(a=>a.costMicros==='0'&&a.status==='failed').length,1);
  }finally{await f.close();}
 });
 test(`${kind}: three missing-usage failures do not shut out the fourth healthy request`,async()=>{
  let calls=0;const f=await fixture(async(_r,delta)=>{if(++calls<=3)throw new Error('connection lost, usage unknown');delta(ready);return {inputTokens:50,outputTokens:50};});
  try{
   for(let i=0;i<3;i++)assert.match((await f.call()).body,/"questions_charged":0/);
   assert.match((await f.call()).body,/"questions_charged":1/);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);
   const b=await f.store.billing.inspectBudget();assert.equal(b.provisional.length,3);assert.equal(b.windows[0]!.spent,3_001_000);assert.equal(b.controls[0]!.blockedUntil,0);
  }finally{await f.close();}
 });
 if(kind==='sqlite')test('SQLite: a healthy ten-second silent startup succeeds once near the budget limit',{timeout:15000},async()=>{
  let calls=0;const f=await fixture(async(_r,delta,signal)=>{
   calls++;await delay(10000,undefined,{signal});delta(ready);return {inputTokens:50,outputTokens:50};
  },1_260_000);
  try{const r=await f.call();assert.match(r.body,/"terminal_state":"usable"/);assert.match(r.body,/"questions_charged":1/);
   assert.equal(calls,1);const b=await f.store.billing.inspectBudget();assert.equal(b.windows[0]!.spent,1000);assert.equal(b.windows[0]!.held,0);assert.equal(b.provisional.length,0);
  }finally{await f.close();}
 });
 if(kind==='sqlite')test('SQLite: real startup deadline recovers the same request, charging one question and preserving first cost',{timeout:30_000},async()=>{
  let calls=0;const f=await fixture(async(_r,delta,signal)=>{
   if(++calls===1)await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
   delta(ready);return {inputTokens:50,outputTokens:50};
  });
  try{const started=performance.now(),recovered=await f.call();assert.ok(performance.now()-started<23000);assert.match(recovered.body,/"terminal_state":"usable"/);assert.match(recovered.body,/"questions_charged":1/);assert.match(recovered.body,/\[DONE\]/);assert.equal(calls,2);
   const attempts=await f.store.billing.attempts(f.users[0]!.token);
   const failed=attempts.find(a=>a.status==='failed')!;
   assert.equal(failed.diagnostics?.outcome,'startup_timeout');
   assert.equal(failed.diagnostics?.httpStatus,undefined);
   assert.equal(failed.diagnostics?.usageReceived,false);
   assert.ok(failed.diagnostics!.durationMs>=20000);
   const b=await f.store.billing.inspectBudget();assert.equal(b.windows[0]!.spent,1_001_000);assert.equal(b.windows[0]!.held,0);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);
  }finally{await f.close();}
 });
 test(`${kind}: persistent HTTP failure stops after two attempts and refunds the question`,async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;throw new TransientProviderError(502,1);});
  try{assert.match((await f.call()).body,/"questions_charged":0/);assert.equal(calls,2);assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,100);
   const b=await f.store.billing.inspectBudget();assert.equal(b.windows[0]!.spent,2_000_000);assert.equal(b.windows[0]!.held,0);assert.equal(b.provisional.length,2);
  }finally{await f.close();}
 });
 test(`${kind}: near limit, an in-flight hold is waited out; spent capacity is never fabricated`,async()=>{
  const f=await fixture(async(_r,delta)=>{await delay(200);delta(ready);return {inputTokens:50,outputTokens:50};},1_260_000);
  try{
   // Usable capacity 1,008,000: the second request fits after first settles, not while held.
   const pair=await Promise.all([f.call(0),f.call(1)]);for(const r of pair)assert.match(r.body,/"questions_charged":1/);
   for(let i=0;i<6;i++)assert.match((await f.call(0)).body,/"questions_charged":1/);
   assert.match((await f.call(0)).body,/"questions_charged":1/); // spent 9,000, so another 1,000,000 no longer fits
   const denied=await f.call(0);assert.equal(denied.statusCode,503);assert.match(denied.body,/budget_exceeded/);
   assert.equal((await f.store.billing.inspectBudget()).windows[0]!.spent,9000);
  }finally{await f.close();}
 });
}
test('adapter classifies only explicit transient HTTP responses and respects retry-after',async t=>{
 const {OpenAIProvider}=await import('../src/providers/openai.ts');
 t.mock.method(globalThis,'fetch',async()=>new Response('temporarily unavailable',{status:503,headers:{'retry-after':'2'}}));
 const p=new OpenAIProvider('test','https://invalid.test','fixture',8192);
 await assert.rejects(p.stream({system:'test',task:'test',images:[]},()=>{},new AbortController().signal),e=>e instanceof TransientProviderError&&e.status===503&&e.retryAfterMs===2000);
});
test('budget runway projects conservative hourly bookings and warns before the fixed threshold',async()=>{
 const {budgetStatus}=await import('../src/budget-policy.ts'),now=Date.now(),offset=480*60000,start=Math.floor((now+offset)/86400000)*86400000-offset;
 const status=budgetStatus({controls:[],provisional:[],recentSpend:[{currency:'USD',micros:90_000_000}],windows:[{scope:'official',currency:'USD',start:new Date(start).toISOString(),expiresAt:new Date(start+86400000).toISOString(),limit:100_000_000,spent:1_000_000,held:0}]},
 {modelCostCurrency:'USD',modelDailyBudgetMicros:100_000_000,modelBudgetWarningMicros:15_000_000,modelBudgetUtcOffsetMinutes:480,attemptBudgetUpperMicros:3_000_000,requestBudgetMode:'guarded-request'},now);
 assert.equal(status.level,2);assert.ok(status.runway_seconds!<3600);assert.equal(status.max_request_admissible,true);
});
