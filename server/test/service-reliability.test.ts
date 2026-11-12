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
  let active=0,peak=0,calls=0;const f=await fixture(async(_r,delta)=>{calls++;active++;peak=Math.max(peak,active);await delay(300);delta(ready);active--;return {inputTokens:50,outputTokens:50};});
  try{
   const responses=await Promise.all(f.users.map((_,i)=>f.call(i)));
   for(const r of responses){assert.equal(r.statusCode,200);assert.match(r.body,/"questions_charged":1/);assert.match(r.body,/"terminal_state":"usable"/);assert.match(r.body,/\[DONE\]/);}
   assert.equal(calls,8);assert.equal(peak,8);
   for(const u of f.users)assert.equal((await f.store.billing.quota(u.token))!.balanceQuestions,99);
   const b=(await f.store.billing.inspectBudget()).windows[0]!;assert.equal(b.held,0);assert.equal(b.spent,8000);
  }finally{await f.close();}
 });
 if(kind==='postgres')test('PostgreSQL: eight slow requests across two services finish beyond the old eight-second queue limit',{timeout:35_000},async()=>{
  let active=0,peak=0,calls=0;const f=await fixture(async(_r,delta)=>{
   calls++;active++;peak=Math.max(peak,active);await delay(12_000);delta(ready);active--;return {inputTokens:50,outputTokens:50};
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
  let calls=0;const f=await fixture(async(_r,delta)=>{if(++calls===1)throw new TransientProviderError(503,1);delta(ready);return {inputTokens:50,outputTokens:50};});
  try{
   const id=randomUUID(),r=await f.call(0,id);assert.match(r.body,/"questions_charged":1/);assert.equal(calls,2);
   const b=await f.store.billing.inspectBudget();assert.equal(b.windows[0]!.spent,1_001_000);assert.equal(b.provisional.length,1);assert.equal(b.provisional[0]!.booked,1_000_000);
   assert.equal((await f.store.billing.attempts(f.users[0]!.token)).length,2);
   const duplicate=await f.call(0,id);assert.equal(duplicate.statusCode,200);assert.match(duplicate.body,/FINAL: B/);assert.match(duplicate.body,/\[DONE\]/);assert.equal(calls,2);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);assert.equal((await f.store.billing.inspectBudget()).windows[0]!.spent,1_001_000);
  }finally{await f.close();}
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
 if(kind==='sqlite')test('SQLite: real startup deadline recovers the same request, charging one question and preserving first cost',{timeout:30_000},async()=>{
  let calls=0;const f=await fixture(async(_r,delta,signal)=>{
   if(++calls===1)await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
   delta(ready);return {inputTokens:50,outputTokens:50};
  });
  try{const recovered=await f.call();assert.match(recovered.body,/"terminal_state":"usable"/);assert.match(recovered.body,/"questions_charged":1/);assert.match(recovered.body,/\[DONE\]/);assert.equal(calls,2);
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
