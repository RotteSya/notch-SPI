import {test,after} from 'node:test';
import type {Store} from '../src/db.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import {parsePlusSubscription,plusCheckoutParams} from '../src/plus-stripe.ts';
import {newPlus,type PlusUpdate} from '../src/plus.ts';
const start=Date.parse('2026-10-17T12:00:00.000Z'),end=Date.parse('2026-11-17T12:00:00.000Z');
const update:PlusUpdate={subscriptionId:'sub_test',customerId:'cus_test',status:'active',cancelAtPeriodEnd:false,
  paidFrom:new Date(start).toISOString(),paidUntil:new Date(end).toISOString(),invoiceId:'in_test'};
const implementations:Array<[string,()=>Store|Promise<Store>]>=[['memory',()=>new MemoryStore()],['sqlite',()=>new SqliteStore(':memory:')]];
if(process.env.TEST_POSTGRES_URL){
 const url=new URL(process.env.TEST_POSTGRES_URL);if(!/test/i.test(url.pathname))throw new Error('Isolated test database required');
 const {PostgresStore,resolvePostgresSSL}=await import('../src/db-postgres.ts');
 const pg=(await import('pg')).default;
 const admin=new pg.Pool({connectionString:url.toString(),ssl:resolvePostgresSSL({connectionString:url.toString()})});
 const schema='plus_test_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 url.searchParams.set('options','-c search_path='+schema);
 after(async()=>{await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 implementations.push(['postgres',()=>new PostgresStore(url.toString(),resolvePostgresSSL({connectionString:url.toString()}))]);
}
for(const [name,make] of implementations){
 test(`${name}: Plus paid periods, daily concurrency, failure release, renewal and cancellation`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:start});const s=await make();
  try{
   const {token}=await s.registerDevice({platform:'test',appVersion:'3.0',trialQuestions:0});
   const intents=await Promise.all(Array.from({length:10},()=>s.plus.reserve(token)));
   assert.equal(new Set(intents.map(r=>r!.intentId)).size,1);
   const r=intents[0]!;await s.plus.attach(r.intentId,'cs_test','https://checkout.stripe.com/test');
   assert.equal((await s.billing.quota(token))!.balanceQuestions,0);
   const a=await s.plus.beginSync(r.intentId),b=await s.plus.beginSync(r.intentId);
   assert.equal(await s.plus.apply(r.intentId,a!.generation,update),false);
   assert.equal(await s.plus.apply(r.intentId,b!.generation,update),true);
   assert.equal((await s.billing.quota(token))!.balanceQuestions,400);
   const inputs=Array.from({length:401},()=>({token,captureId:randomUUID(),requestHmac:randomUUID()}));
   const held=await Promise.all(inputs.map(i=>s.billing.begin(i)));assert.equal(held.filter(r=>r.ok).length,400);
   for(const i of inputs.slice(0,399))await s.billing.finish({...i,charge:true,terminalState:'usable'});
   await s.billing.finish({...inputs[399]!,charge:false,terminalState:'failed'});
   assert.equal((await s.billing.quota(token))!.balanceQuestions,1);
   // Re-delivery cannot regrant today's used slots.
   const retry=await s.plus.beginSync(r.intentId);await s.plus.apply(r.intentId,retry!.generation,update);
   assert.equal((await s.billing.quota(token))!.balanceQuestions,1);
   t.mock.timers.setTime(start+86400000);assert.equal((await s.billing.quota(token))!.balanceQuestions,400);
   const late={token,captureId:randomUUID(),requestHmac:randomUUID()};await s.billing.begin(late);
   t.mock.timers.setTime(start+2*86400000);assert.equal((await s.billing.quota(token))!.balanceQuestions,400);
   await s.billing.finish({...late,charge:false,terminalState:'failed'});
   assert.equal((await s.billing.quota(token))!.balanceQuestions,400);
   // Existing purchased credit survives expiry; Plus is consumed before the purchased lot.
   await s.credit({token,questions:10,amountCents:100,currency:'CNY',provider:'test',reference:randomUUID()});
   const last={token,captureId:randomUUID(),requestHmac:randomUUID()};await s.billing.begin(last);await s.billing.finish({...last,charge:true,terminalState:'usable'});
   const cancel=await s.plus.beginSync(r.intentId);await s.plus.apply(r.intentId,cancel!.generation,{...update,cancelAtPeriodEnd:true});
   assert.equal((await s.billing.quota(token))!.balanceQuestions,409);
   t.mock.timers.setTime(end);assert.equal((await s.billing.quota(token))!.balanceQuestions,10);
   // Late successful renewal restores only unused slots from this Beijing day, not a fresh 400.
   const renew=await s.plus.beginSync(r.intentId);await s.plus.apply(r.intentId,renew!.generation,{...update,paidFrom:new Date(end).toISOString(),paidUntil:'2026-12-17T12:00:00.000Z',invoiceId:'in_renew'});
   assert.equal((await s.billing.quota(token))!.balanceQuestions,410);
   const failed=await s.plus.beginSync(r.intentId);await s.plus.apply(r.intentId,failed!.generation,{...update,status:'past_due',paidFrom:null,paidUntil:null,invoiceId:null});
   assert.equal((await s.plus.get(token))!.paidUntil,'2026-12-17T12:00:00.000Z');
   t.mock.timers.setTime(Date.parse('2026-12-17T12:00:00.000Z'));assert.equal((await s.billing.quota(token))!.balanceQuestions,10);
  }finally{await s.close();}
 });
 test(`${name}: postpone trial for months; independent paid plan never starts or consumes eligibility`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:start});const s=await make();
  try{
   const {token}=await s.registerDevice({platform:'test',appVersion:'3.0',trialQuestions:30,freeTrialEligible:true});
   t.mock.timers.setTime(start+90*86400000);
   assert.equal((await s.billing.quota(token))!.freeTrial!.status,'eligible');
   assert.equal((await s.billing.quota(token))!.freeTrial!.activated_at,null);
   const receipt=await s.billing.claimFreeTrial(token);
   assert.equal(receipt!.freeTrial!.activated_at,new Date(start+90*86400000).toISOString());
   assert.equal(Date.parse(receipt!.freeTrial!.expires_at!)-Date.parse(receipt!.freeTrial!.activated_at!),72*3600000);
  }finally{await s.close();}
 });
}
function fixture(){return {id:'sub_test',customer:'cus_test',status:'active',cancel_at_period_end:true,metadata:{plus_intent_id:'intent'},
 items:{data:[{quantity:1,price:{unit_amount:6900,currency:'cny',recurring:{interval:'month',interval_count:1}}}]},
 latest_invoice:{id:'in_test',status:'paid',amount_paid:6900,currency:'cny',parent:{subscription_details:{subscription:'sub_test'}},lines:{data:[{period:{start:start/1000,end:end/1000}}]}}};}
test('Plus validates actual paid invoices, catalog, ownership and monthly periods',()=>{
 assert.equal(parsePlusSubscription(fixture(),'intent').paidUntil,update.paidUntil);
 const unpaid=fixture();unpaid.latest_invoice.status='open';assert.equal(parsePlusSubscription(unpaid,'intent').paidUntil,null);
 assert.throws(()=>parsePlusSubscription(fixture(),'other'));
 const wrong=fixture();wrong.items.data[0]!.price.unit_amount=1;assert.throws(()=>parsePlusSubscription(wrong,'intent'));
 const foreign=fixture();foreign.latest_invoice.parent.subscription_details.subscription='sub_other';assert.throws(()=>parsePlusSubscription(foreign,'intent'));
 const params=plusCheckoutParams(newPlus(1),'https://example.com','zh');
 assert.equal(params.get('mode'),'subscription');assert.equal(params.get('line_items[0][price_data][recurring][interval]'),'month');
 assert.equal(params.get('line_items[0][price_data][unit_amount]'),'6900');assert.equal(params.has('payment_method_types'),false);
});
