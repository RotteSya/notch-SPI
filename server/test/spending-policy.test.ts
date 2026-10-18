import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
for(const [name,make] of [['memory',()=>new MemoryStore()],['sqlite',()=>new SqliteStore(':memory:')]] as const) {
 test(`${name}: pack protection is enforced atomically without blocking Plus`,async t=>{
  const now=Date.parse('2026-10-17T12:00:00.000Z');t.mock.timers.enable({apis:['Date'],now});
  const s=make();try {
   const {token}=await s.registerDevice({platform:'test',appVersion:'3.0',trialQuestions:1});
   await s.credit({token,questions:10,amountCents:100,currency:'CNY',provider:'test',reference:randomUUID()});
   const input=()=>({token,captureId:randomUUID(),requestHmac:randomUUID(),allowPurchasedCredits:false});
   const first=input();assert.equal((await s.billing.begin(first)).ok,true);
   await s.billing.finish({...first,charge:true,terminalState:'usable'});
   assert.deepEqual(await s.billing.begin(input()),{ok:false,reason:'paid_credits_disabled'});
   assert.deepEqual((await s.billing.quota(token))!.allowanceSources,{trial:0,plus:0,purchased:10,other:0});
   const r=(await s.plus.reserve(token))!;const ticket=(await s.plus.beginSync(r.intentId))!;
   await s.plus.apply(r.intentId,ticket.generation,{subscriptionId:'sub_policy',customerId:'cus_policy',status:'active',cancelAtPeriodEnd:false,
     paidFrom:new Date(now-1000).toISOString(),paidUntil:new Date(now+86400000).toISOString(),invoiceId:'in_policy'});
   const attempts=Array.from({length:401},input);
   const holds=await Promise.all(attempts.map(x=>s.billing.begin(x)));
   assert.equal(holds.filter(x=>x.ok).length,400);
   assert.deepEqual(holds[400],{ok:false,reason:'paid_credits_disabled'});
   const q=(await s.billing.quota(token))!;
   assert.equal(q.allowanceSources!.purchased,10);assert.equal(q.allowanceSources!.plus,0);
   assert.equal((await s.billing.begin({...input(),allowPurchasedCredits:true})).ok,true);
   assert.equal((await s.billing.quota(token))!.allowanceSources!.purchased,9);
  } finally {await s.close();}
 });
}
