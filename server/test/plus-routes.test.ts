import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import type {PlusStripe} from '../src/plus-stripe.ts';
import type {PlusUpdate} from '../src/plus.ts';
process.env.DB_PATH=':memory:';process.env.OFFICIAL_PROVIDER='mock';process.env.LOG_LEVEL='silent';
process.env.PAYMENT_PROVIDER='stripe';process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';process.env.PLUS_ENABLED='1';
const {buildApp}=await import('../src/index.ts');
const {config}=await import('../src/config.ts');
test('Plus HTTP uses authenticated owner, reuses Checkout, verifies signed payments, and cancels renewal',async()=>{
 let intent='',paid=false,canceled=false,creates=0,subReadFails=false;
 const update=():PlusUpdate=>({subscriptionId:'sub_plus',customerId:'cus_plus',status:'active',cancelAtPeriodEnd:canceled,
   invoiceId:paid?'in_plus':null,paidFrom:paid?new Date(Date.now()-1000).toISOString():null,paidUntil:paid?new Date(Date.now()+30*86400000).toISOString():null});
 const stripe:PlusStripe={
  checkout:async(r)=>{intent=r.intentId;creates++;return {id:'cs_plus',url:'https://checkout.stripe.com/plus'};},
  checkoutState:async()=>({status:paid?'complete':'open',subscriptionId:paid?'sub_plus':null}),
  subscription:async(_id,owner)=>{assert.equal(owner,intent);if(subReadFails)throw new Error('network');return update();},
  intentForSubscription:async()=>intent,
  cancel:async()=>{canceled=true;},portal:async()=> 'https://billing.stripe.com/portal',
 };
 const app=await buildApp({plusStripe:stripe});
 try{
  const register=async()=> (await app.inject({method:'POST',url:'/v1/devices',payload:{platform:'test',app_version:'3.0'}})).json().device_token;
  const token=await register(),other=await register(),headers={authorization:'Bearer '+token};
  const get=()=>app.inject({url:'/v1/plus',headers});
  const post=(path:string)=>app.inject({method:'POST',url:path,headers,payload:{}});
  assert.equal((await app.inject({method:'POST',url:'/v1/plus/checkout'})).statusCode,401);
  assert.equal((await post('/v1/plus/checkout')).statusCode,200);
  assert.equal((await post('/v1/plus/checkout')).statusCode,200);assert.equal(creates,1);
  assert.equal((await get()).json().daily_remaining,0);
  const body=JSON.stringify({id:'evt_plus',type:'invoice.paid',created:Math.floor(Date.now()/1000),data:{object:{id:'in_plus',parent:{subscription_details:{subscription:'sub_plus'}}}}});
  assert.equal((await app.inject({method:'POST',url:'/webhooks/stripe',headers:{'content-type':'application/json'},payload:body})).statusCode,400);
  paid=true;const time=Math.floor(Date.now()/1000),sig=createHmac('sha256','whsec_fixture').update(time+'.'+body).digest('hex');
  for(let i=0;i<2;i++)assert.equal((await app.inject({method:'POST',url:'/webhooks/stripe',headers:{'content-type':'application/json','stripe-signature':`t=${time},v1=${sig}`},payload:body})).statusCode,200);
  const active=(await get()).json();assert.equal(active.status,'active');assert.equal(active.daily_remaining,400);
  assert.equal((await app.inject({url:'/v1/plus',headers:{authorization:'Bearer '+other}})).json().daily_remaining,0);
  assert.equal((await post('/v1/plus/checkout')).statusCode,409);
  assert.equal((await post('/v1/plus/portal')).json().url,'https://billing.stripe.com/portal');
  assert.equal((await post('/v1/plus/cancel')).json().cancel_at_period_end,true);
  assert.equal((await get()).json().daily_remaining,400);
  const retired=JSON.stringify({id:'evt_retired',type:'checkout.session.completed',created:time,data:{object:{id:'cs_retired',metadata:{plus_intent_id:'retired-intent'}}}});
  const retiredSig=createHmac('sha256','whsec_fixture').update(time+'.'+retired).digest('hex');
  assert.equal((await app.inject({method:'POST',url:'/webhooks/stripe',headers:{'content-type':'application/json','stripe-signature':`t=${time},v1=${retiredSig}`},payload:retired})).statusCode,200);
  assert.equal((await get()).json().daily_remaining,400);
  subReadFails=true;assert.equal((await get()).json().sync_failed,true);
  // Feature rollback stops new enrollment, never existing subscriber management.
  (config as {plusEnabled:boolean}).plusEnabled=false;
  assert.equal((await post('/v1/plus/checkout')).statusCode,503);
  assert.equal((await post('/v1/plus/portal')).statusCode,200);
 }finally{(config as {plusEnabled:boolean}).plusEnabled=true;await app.close();}
});
