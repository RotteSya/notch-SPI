import {test} from 'node:test';
import {serveRequest} from '../src/request-lifecycle.ts';
import {createServer} from 'node:http';
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
 async function fixture(stream:Provider['stream'],budget=100_000_000){
  let stores:Store[],connectionURL:string|undefined,cleanup=async()=>{};
  if(kind==='postgres'){
   const url=new URL(process.env.TEST_POSTGRES_URL!);
   if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/i.test(url.pathname))throw new Error('Local throwaway test database required');
   const {PostgresStore}=await import('../src/db-postgres.ts'),pg=(await import('pg')).default;
   const admin=new pg.Pool({connectionString:url.toString(),ssl:false}),schema='reliability_'+randomUUID().replaceAll('-','');
   await admin.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options','-c search_path='+schema);
   connectionURL=url.toString();
   stores=[new PostgresStore(url.toString(),false),new PostgresStore(url.toString(),false)];
   for(const s of stores)await s.getAccount('schema-warmup');
   cleanup=async()=>{await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};
  }else stores=[kind==='memory'?new MemoryStore():new SqliteStore(':memory:')];
  const store=stores[0]!,apps=stores.map(()=>Fastify());
  const provider:Provider={name:'openai',stream,estimateReservation:async()=>({micros:1_000_000,inputUpper:9640,outputUpper:8192})};
  for(const [index,app] of apps.entries())registerRoutes(app,{config:{...config,provider:'mock',objectiveProvider:'mock',model:'fixture',objectiveModel:'fixture',adminToken:'',requestHmacKeyVersion:'test',requestHmacKeysJSON:JSON.stringify({test:Buffer.alloc(32,1).toString('base64')}),
   requestBudgetMode:'guarded-request',captureConcurrencyPerToken:4,modelCostCurrency:'USD',modelDailyBudgetMicros:budget,attemptBudgetUpperMicros:1_000_000,
   modelPricingJSON:JSON.stringify([{model:'openai:fixture',input_micros_per_million_tokens:10_000_000,output_micros_per_million_tokens:10_000_000}])},
   store:stores[index]!,storeKind:kind as 'memory'|'sqlite'|'postgres',provider,objectiveProvider:provider,providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
  const users=await Promise.all(Array.from({length:24},()=>store.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:100})));
  function call(i=0,id=randomUUID()){return apps[i%apps.length]!.inject({method:'POST',url:'/v1/captures',headers:{authorization:'Bearer '+users[i]!.token},payload:{capture_id:id,
   images_base64:[pngBase64],image_media_type:'image/png',system:'Answer correctly',task:'Choose B',result_protocol:'objective_v1'}});}
  return {store,users,call,apps,stores,connectionURL,async close(){await Promise.all(apps.map(a=>a.close()));await Promise.all(stores.map(s=>s.close()));await cleanup();}};
 }

 test(`${kind}: 24 active users complete three rounds including a concentrated slow wave`,{timeout:45_000},async()=>{
  let active=0,peak=0,calls=0;const latencies:number[]=[];
  const f=await fixture(async(_r,delta)=>{calls++;active++;peak=Math.max(peak,active);await delay(kind==='postgres'?12000:150);delta(ready);active--;return {inputTokens:50,outputTokens:50};});
  try{
   for(let round=0;round<3;round++)await Promise.all(f.users.map(async(_,i)=>{
    const start=performance.now(),r=await f.call(i);latencies.push(performance.now()-start);
    assert.equal(r.statusCode,200,r.body);assert.match(r.body,/"terminal_state":"usable"/);assert.match(r.body,/"questions_charged":1/);assert.match(r.body,/\[DONE\]/);
   }));
   assert.equal(calls,72);assert.equal(peak,24);
   for(const u of f.users)assert.equal((await f.store.billing.quota(u.token))!.balanceQuestions,97);
   const b=(await f.store.billing.inspectBudget()).windows[0]!;assert.equal(b.held,0);assert.equal(b.spent,72000);
   latencies.sort((a,b)=>a-b);console.log(JSON.stringify({scenario:'24 users x 3 waves',store:kind,success:72,manualInterventions:0,peak,p95ms:latencies[68],maxMs:latencies.at(-1)}));
   assert.ok(latencies.at(-1)!<(kind==='postgres'?15000:3000));
  }finally{await f.close();}
 });
 test(`${kind}: committed answer survives lost DB acknowledgement and is delivered without new model calls or charges`,async()=>{
  let calls=0;const f=await fixture(async(_r,delta)=>{calls++;delta(ready);return {inputTokens:50,outputTokens:50};});
  const original=f.store.billing.finishWithCapture.bind(f.store.billing);let fault=true;
  f.store.billing.finishWithCapture=async input=>{const result=await original(input);if(fault){fault=false;throw Error('COMMIT ack lost');}return result;};
  try{
   const id=randomUUID(),r=await f.call(0,id);assert.match(r.body,/\[DONE\]/);assert.match(r.body,/"questions_charged":1/);
   const capture=await f.store.billing.capture(f.users[0]!.token,id);assert.ok(capture!.sealedAnswer);assert.ok(!JSON.stringify(capture).includes('FINAL: B'));
   for(let n=0;n<3;n++){
    const replay=await f.apps[n%f.apps.length]!.inject({url:`/v1/captures/${id}/delivery`,headers:{authorization:'Bearer '+f.users[0]!.token}});
    assert.equal(replay.statusCode,200);assert.match(replay.body,/FINAL: B/);assert.match(replay.body,/\[DONE\]/);
   }
   const unauthorized=await f.apps[0]!.inject({url:`/v1/captures/${id}/delivery`,headers:{authorization:'Bearer '+f.users[1]!.token}});assert.equal(unauthorized.statusCode,404);
   assert.equal(calls,1);assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);
   assert.equal((await f.store.billing.inspectBudget()).windows[0]!.spent,1000);
  }finally{await f.close();}
 });

 test(`${kind}: real HTTP disconnect completes the same durable answer and recovers across instances`,async()=>{
  let calls=0,invocationFinished=false;let closeAdapter=async()=>{};const f=await fixture(async(_r,delta)=>{calls++;delta('FINAL: ');await delay(250);delta(ready.slice(7));return {inputTokens:50,outputTokens:50};});
  try{
   await f.apps[0]!.ready();
   const adapter=createServer((req,res)=>{void serveRequest(req,res,()=>{f.apps[0]!.server.emit('request',req,res);}).finally(()=>{invocationFinished=true;});});
   await new Promise<void>(resolve=>adapter.listen(0,'127.0.0.1',resolve));
   const address=adapter.address() as {port:number};
   closeAdapter=()=>new Promise<void>(resolve=>adapter.close(()=>resolve()));
   const id=randomUUID(),auth={authorization:'Bearer '+f.users[0]!.token};
   const r=await fetch(`http://127.0.0.1:${address.port}/v1/captures`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({capture_id:id,delivery_recovery_v1:true,images_base64:[pngBase64],image_media_type:'image/png',system:'Answer correctly',task:'Choose B',result_protocol:'objective_v1'})});
   await r.body!.cancel();await delay(25);assert.equal(invocationFinished,false,'Invocation must stay alive after the transport disconnect');
   let replay;for(let i=0;i<20;i++){
    replay=await f.apps.at(-1)!.inject({url:`/v1/captures/${id}/delivery`,headers:auth});if(replay.statusCode!==202)break;await delay(50);
   }
   assert.equal(replay!.statusCode,200);assert.match(replay!.body,/FINAL: B/);assert.match(replay!.body,/\[DONE\]/);assert.equal(calls,1);assert.equal(invocationFinished,true);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);
   assert.equal((await f.store.billing.inspectBudget()).windows[0]!.spent,1000);
  }finally{await closeAdapter();await f.close();}
 });

 if(kind==='postgres')test('PostgreSQL: killed worker is automatically replaced once, unknown cost retained and late owner fenced',{timeout:25000},async()=>{
  const {spawn}=await import('node:child_process');let calls=0;
  const f=await fixture(async(_r,delta)=>{calls++;delta(ready);return {inputTokens:50,outputTokens:50};});
  const child=spawn(process.execPath,[new URL('./helpers/crash-worker.ts',import.meta.url).pathname],{env:{PATH:process.env.PATH!,USER:process.env.USER!,TEST_POSTGRES_URL:f.connectionURL!},stdio:['ignore','pipe','pipe']});
  let workerError=''; child.stderr.on('data',d=>{workerError+=String(d);});
  try{
   const port=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker failed to start')),10000);
    child.stdout.once('data',d=>{clearTimeout(timer);resolve(Number(String(d).trim()));});child.once('error',reject);});
   const id=randomUUID(),token=f.users[0]!.token,headers={authorization:'Bearer '+token,'content-type':'application/json'},payload={capture_id:id,delivery_recovery_v1:true,images_base64:[pngBase64],image_media_type:'image/png',system:'Answer correctly',task:'Choose B',result_protocol:'objective_v1'};
   const original=await fetch(`http://127.0.0.1:${port}/v1/captures`,{method:'POST',headers,body:JSON.stringify(payload)});
   assert.equal(original.status,200,original.status===200?'':(await original.text())+workerError);
   const body=original.text().catch(()=>null),old=(await f.store.billing.capture(token,id))!;
   assert.ok(old.deliveryOwner);child.kill('SIGKILL');await body;await delay(8500);
   const pending=await f.apps[1]!.inject({url:`/v1/captures/${id}/delivery`,headers});assert.equal(pending.json().can_resume,true);
   const recovered=await f.apps[1]!.inject({method:'POST',url:'/v1/captures',headers,payload});
   assert.equal(recovered.statusCode,200,recovered.body);assert.match(recovered.body,/FINAL: B/);assert.match(recovered.body,/"questions_charged":1/);assert.match(recovered.body,/\[DONE\]/);
   const committed=(await f.store.billing.capture(token,id))!;assert.notEqual(committed.deliveryOwner,old.deliveryOwner);
   assert.equal(await f.store.billing.heartbeat(token,id,old.deliveryOwner!),false);
   await f.store.billing.finishWithCapture({token,captureId:id,owner:old.deliveryOwner,charge:true,terminalState:'usable',sealedAnswer:'stale-worker-answer'});
   assert.equal((await f.store.billing.capture(token,id))!.sealedAnswer,committed.sealedAnswer);
   const duplicate=await f.apps[0]!.inject({method:'POST',url:'/v1/captures',headers,payload});assert.match(duplicate.body,/FINAL: B/);assert.equal(calls,1);
   const a=await f.store.billing.attempts(token),b=await f.store.billing.inspectBudget();assert.equal(a.length,2);assert.equal(a.filter(x=>x.status==='unknown').length,1);
   assert.equal(b.windows[0]!.spent,1001000);assert.equal(b.windows[0]!.held,0);assert.equal((await f.store.billing.quota(token))!.balanceQuestions,99);
  }finally{child.kill('SIGKILL');await f.close();}
 });
 test(`${kind}: a broken upstream stream before durable delivery recovers without mixing answers`,async()=>{
  let calls=0;const f=await fixture(async(_r,delta)=>{if(++calls===1){delta('unfinished wrong answer');throw new TransientProviderError(0,1);}delta(ready);return {inputTokens:50,outputTokens:50};});
  try{const id=randomUUID(),r=await f.apps[0]!.inject({method:'POST',url:'/v1/captures',headers:{authorization:'Bearer '+f.users[0]!.token},payload:{capture_id:id,delivery_recovery_v1:true,images_base64:[pngBase64],image_media_type:'image/png',system:'Answer correctly',task:'Choose B',result_protocol:'objective_v1'}});
   assert.equal(r.statusCode,200);assert.match(r.body,/FINAL: B/);assert.doesNotMatch(r.body,/unfinished wrong answer/);assert.match(r.body,/\[DONE\]/);assert.equal(calls,2);
   assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,99);
   assert.equal((await f.store.billing.inspectBudget()).windows[0]!.spent,1001000);
  }finally{await f.close();}
 });
 test(`${kind}: explicit cancellation arriving before submission prevents late model invocation`,async()=>{
  let calls=0;const f=await fixture(async(_r,delta)=>{calls++;delta(ready);return {inputTokens:50,outputTokens:50};});
  try{const id=randomUUID(),headers={authorization:'Bearer '+f.users[0]!.token};
   assert.equal((await f.apps[0]!.inject({method:'POST',url:`/v1/captures/${id}/cancel`,headers})).statusCode,200);
   const r=await f.apps.at(-1)!.inject({method:'POST',url:'/v1/captures',headers,payload:{capture_id:id,delivery_recovery_v1:true,images_base64:[pngBase64],image_media_type:'image/png',system:'Answer correctly',task:'Choose B',result_protocol:'objective_v1'}});
   assert.equal(r.statusCode,409);assert.equal(calls,0);assert.equal((await f.store.billing.quota(f.users[0]!.token))!.balanceQuestions,100);
   const b=await f.store.billing.inspectBudget();assert.equal(b.windows[0]!.spent,0);assert.equal(b.windows[0]!.held,0);
  }finally{await f.close();}
 });
 test(`${kind}: throughput has a bounded independent ceiling, expired leases recover, costs are unchanged`,async()=>{
  const f=await fixture(async()=>({inputTokens:0,outputTokens:0}));
  try{
   const ids=f.users.map(()=>randomUUID()),now=Date.now();
   const admitted=await Promise.all(f.users.map((u,i)=>f.stores[i%f.stores.length]!.billing.acquireCapacity(u.token,ids[i]!,20000,now)));
   assert.equal(admitted.filter(Boolean).length,24);
   assert.equal(await f.store.billing.acquireCapacity(f.users[0]!.token,randomUUID(),20000,now),false);
   assert.equal(await f.store.billing.acquireCapacity(f.users[0]!.token,randomUUID(),20000,now+120001),true);
   assert.equal((await f.store.billing.inspectBudget()).windows.length,0);
   assert.equal(await f.store.billing.acquireCapacity(f.users[0]!.token,randomUUID(),800001,now+120002),false);
  }finally{await f.close();}
 });
}
