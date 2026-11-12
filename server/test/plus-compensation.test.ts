import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {config} from '../src/config.ts';
import {registerRoutes} from '../src/routes.ts';
import {MockProvider} from '../src/providers/mock.ts';
import {StubPaymentProvider} from '../src/payments.ts';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import {PLUS_COMPENSATION,compensationInterval,withCompensation,type PlusCompensation} from '../src/plus-compensation.ts';
import type {Store} from '../src/db.ts';
import type {PlusUpdate} from '../src/plus.ts';
const now=Date.parse('2026-11-11T14:00:00.000Z'),hour=3600000,iso=(t:number)=>new Date(t).toISOString();
const empty=():PlusCompensation=>({campaignId:PLUS_COMPENSATION.id,claimedAt:null,startsAt:null,expiresAt:null});
function fixture(name:string){
  const dir=mkdtempSync(join(tmpdir(),'notchspi-compensation-')),path=join(dir,'test.db');
  const store:Store=name==='memory'?new MemoryStore():new SqliteStore(path);
  return {store,path,enroll(id:number){
    if(store instanceof MemoryStore){if(!store.plus.compensations.has(id))store.plus.compensations.set(id,empty());}
    else {const db=new DatabaseSync(path);try{db.prepare('INSERT INTO plus_compensations(campaign_id,device_id,enrolled_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(PLUS_COMPENSATION.id,id,iso(Date.now()));}finally{db.close();}}
  },async close(){await store.close();rmSync(dir,{recursive:true,force:true});}};
}
function appFor(store:Store,name:string){const app=Fastify(),provider=new MockProvider();
 registerRoutes(app,{config:{...config,adminToken:'',plusEnabled:false},store,storeKind:name as 'sqlite'|'memory',provider,objectiveProvider:provider,
 providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});return app;
}
async function pay(store:Store,token:string,from:number,to:number,invoice='first'){
 const r=(await store.plus.reserve(token))!,ticket=(await store.plus.beginSync(r.intentId))!;
 const update:PlusUpdate={subscriptionId:'sub_'+r.deviceId,customerId:'cus_'+r.deviceId,status:'active',cancelAtPeriodEnd:false,
 paidFrom:iso(from),paidUntil:iso(to),invoiceId:'in_'+r.deviceId+'_'+invoice};
 assert.equal(await store.plus.apply(r.intentId,ticket.generation,update),true);return update;
}
for(const name of ['memory','sqlite']){
 test(`${name}: startup automatically claims once; retry, concurrency, account recovery and expiry preserve quota`,async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=fixture(name),s=f.store,app=appFor(s,name);
  try{
   const d=await s.registerDevice({platform:'macos',appVersion:'3.1',trialQuestions:7,freeTrialEligible:true});f.enroll(d.id);
   const other=await s.registerDevice({platform:'macos',appVersion:'3.1',trialQuestions:0});
   assert.equal((await s.plus.compensation(d.token))?.claimedAt,null);
   assert.equal((await s.billing.quota(d.token))!.allowanceSources!.plus,0); // maintenance/read alone doesn't start gift
   t.mock.timers.setTime(now+100*hour);const claimTime=Date.now(),headers={authorization:'Bearer '+d.token};
   assert.equal((await app.inject({url:'/v1/client-config'})).statusCode,401);
   const responses=await Promise.all(Array.from({length:20},()=>app.inject({url:'/v1/client-config',headers})));
   assert.ok(responses.every(r=>r.statusCode===200&&r.headers['cache-control']==='no-store'));
   const receipt=await s.plus.compensation(d.token);assert.equal(receipt?.claimedAt,iso(claimTime));
   assert.equal(Date.parse(receipt!.expiresAt!)-Date.parse(receipt!.startsAt!),48*hour);
   const wire=(await app.inject({url:'/v1/plus',headers})).json();
   assert.equal(wire.status,'active');assert.equal(wire.daily_remaining,400);assert.equal(wire.can_manage,false);
   assert.equal(wire.paid_until,iso(claimTime+48*hour));assert.equal(wire.compensation.duration_hours,48);
   assert.equal((await s.billing.quota(d.token))!.freeTrial!.status,'eligible');
   assert.equal((await s.plus.get(d.token)),null); // no fake Stripe subscription
   const capture={token:d.token,captureId:randomUUID(),requestHmac:randomUUID()};assert.equal((await s.billing.begin(capture)).ok,true);
   await s.billing.finish({...capture,charge:true,terminalState:'usable'});
   const before=(await s.billing.quota(d.token))!.balanceQuestions;
   await app.inject({url:'/v1/account',headers});f.enroll(d.id); // deployment/enrollment retry must not reset SQL receipt
   assert.deepEqual(await s.plus.compensation(d.token),receipt);
   assert.equal((await s.billing.quota(d.token))!.balanceQuestions,before);
   assert.equal(await s.plus.claimCompensation(other.token),null);
   t.mock.timers.setTime(claimTime+48*hour);assert.equal((await s.billing.quota(d.token))!.allowanceSources!.plus,0);
   if(name==='sqlite'){
    const reopened=new SqliteStore(f.path);try{assert.deepEqual(await reopened.plus.claimCompensation(d.token),receipt);assert.equal((await reopened.billing.quota(d.token))!.allowanceSources!.plus,0);}finally{await reopened.close();}
   }
  }finally{await app.close();await f.close();}
 });
 test(`${name}: existing Plus extends 48h, renewals do not swallow gift or refill daily quota`,async t=>{
  t.mock.timers.enable({apis:['Date'],now});const f=fixture(name),s=f.store,app=appFor(s,name);
  try{
   const d=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0});const paidEnd=now+30*24*hour;
   const update=await pay(s,d.token,now-hour,paidEnd);f.enroll(d.id);
   const receipt=await s.plus.claimCompensation(d.token);assert.equal(receipt!.startsAt,iso(paidEnd));assert.equal(receipt!.expiresAt,iso(paidEnd+48*hour));
   assert.equal((await s.plus.get(d.token))!.paidUntil,iso(paidEnd));
   const get=()=>app.inject({url:'/v1/plus',headers:{authorization:'Bearer '+d.token}});
   const initial=(await get()).json();assert.equal(initial.paid_until,iso(paidEnd+48*hour));assert.equal(initial.can_manage,true);
   const c={token:d.token,captureId:randomUUID(),requestHmac:randomUUID()};await s.billing.begin(c);await s.billing.finish({...c,charge:true,terminalState:'usable'});
   await s.plus.claimCompensation(d.token);assert.equal((await s.billing.quota(d.token))!.balanceQuestions,399);
   const r=(await s.plus.get(d.token))!,ticket=(await s.plus.beginSync(r.intentId))!;
   await s.plus.apply(r.intentId,ticket.generation,{...update,paidFrom:iso(paidEnd),paidUntil:iso(paidEnd+30*24*hour),invoiceId:'in_renew'});
   assert.equal((await get()).json().paid_until,iso(paidEnd+30*24*hour+48*hour));
   assert.deepEqual(await s.plus.compensation(d.token),receipt);
   assert.equal((await s.billing.quota(d.token))!.balanceQuestions,399);
   t.mock.timers.setTime(paidEnd+30*24*hour);const cancel=(await s.plus.beginSync(r.intentId))!;
   await s.plus.apply(r.intentId,cancel.generation,{...update,status:'canceled',paidFrom:null,paidUntil:null,invoiceId:null});
   assert.equal((await get()).json().status,'active');assert.equal((await s.billing.quota(d.token))!.balanceQuestions,400);
   t.mock.timers.setTime(paidEnd+30*24*hour+48*hour);
   assert.equal((await get()).json().status,'expired');assert.equal((await s.billing.quota(d.token))!.balanceQuestions,0);
   const failed=(await s.plus.beginSync(r.intentId))!;await s.plus.apply(r.intentId,failed.generation,{...update,status:'unpaid',paidFrom:null,paidUntil:null,invoiceId:null});
   assert.equal((await s.billing.quota(d.token))!.balanceQuestions,0);
  }finally{await app.close();await f.close();}
 });
}
test('canceled future paid period cannot defer compensation for an inactive account',async t=>{
 t.mock.timers.enable({apis:['Date'],now});const f=fixture('sqlite'),s=f.store,app=appFor(s,'sqlite');
 try{
  const d=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0});
  const update=await pay(s,d.token,now-hour,now+30*24*hour),r=(await s.plus.get(d.token))!,ticket=(await s.plus.beginSync(r.intentId))!;
  await s.plus.apply(r.intentId,ticket.generation,{...update,status:'canceled',paidFrom:null,paidUntil:null,invoiceId:null});
  f.enroll(d.id);const result=(await app.inject({url:'/v1/plus',headers:{authorization:'Bearer '+d.token}})).json();
  assert.equal(result.status,'active');assert.equal(result.daily_remaining,400);assert.equal(result.paid_until,iso(now+48*hour));
  assert.equal((await s.plus.compensation(d.token))!.startsAt,iso(now));
 }finally{await app.close();await f.close();}
});
test('gift carries only unconsumed time over a purchase; unrelated future subscriptions never resurrect it',()=>{
 const r={...empty(),claimedAt:iso(now),startsAt:iso(now),expiresAt:iso(now+48*hour)};
 const p={startsAt:iso(now+24*hour),expiresAt:iso(now+31*24*hour)};
 assert.deepEqual(compensationInterval(r,p),{startsAt:p.expiresAt,expiresAt:iso(now+32*24*hour)});
 assert.deepEqual(compensationInterval(r,{startsAt:iso(now+72*hour),expiresAt:iso(now+40*24*hour)}),{startsAt:r.startsAt,expiresAt:r.expiresAt});
 assert.equal(withCompensation({active:false,expiresAt:null},r,null,now+48*hour).active,false);
});
