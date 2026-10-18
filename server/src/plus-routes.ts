import type {FastifyInstance} from 'fastify';
import type {AppContext} from './routes.ts';
import {ApiError} from './http.ts';
import {requireAccount} from './auth.ts';
import {PLUS,plusActive,type PlusRecord} from './plus.ts';
import {trialWindow} from './free-trial.ts';
import {LivePlusStripe,type PlusStripe} from './plus-stripe.ts';
import {stripeReference} from './stripe.ts';
export function plusService(ctx:AppContext) {
  const {store,config}=ctx, stripe:PlusStripe=ctx.plusStripe??new LivePlusStripe(config.stripeSecretKey);
  const available=()=>config.plusEnabled&&ctx.payment.name==='stripe'&&!!config.stripeSecretKey&&!!config.stripeWebhookSecret;
  async function sync(record:PlusRecord):Promise<void> {
    const ticket=await store.plus.beginSync(record.intentId);if(!ticket)return;
    let sub=ticket.subscriptionId;
    if(!sub&&ticket.checkoutId){
      const state=await stripe.checkoutState(ticket.checkoutId);
      if(state.status==='expired'){await store.plus.expireCheckout(ticket.intentId);return;}
      sub=state.subscriptionId;
    }
    if(!sub)return;
    const update=await stripe.subscription(sub,ticket.intentId);
    if(!await store.plus.apply(ticket.intentId,ticket.generation,update))throw new Error('Plus changed during synchronization');
  }
  async function wire(token:string,syncFailed=false) {
    await store.billing.quota(token); // expire and materialize daily lots under the device transaction
    const r=await store.plus.get(token),active=plusActive(r),window=trialWindow();
    const usage=await store.plus.usage(token,'plus_daily:'+window.key);
    return {available:available(),status:active?'active':r?.status==='checkout_pending'?'pending':r?.subscriptionId?'expired':'inactive',
      billing_status:r?.status??'none',price_cents:PLUS.priceCents,currency:PLUS.currency,daily_limit:PLUS.dailyLimit,
      paid_until:r?.paidUntil??null,cancel_at_period_end:r?.cancelAtPeriodEnd??false,
      daily_used:active&&usage?usage.granted-usage.remaining:0,daily_held:active&&usage?usage.held:0,
      daily_remaining:active&&usage?usage.remaining-usage.held:0,resets_at:active?window.end:null,
      can_manage:!!r?.subscriptionId,sync_failed:syncFailed,server_time:new Date().toISOString()};
  }
  async function webhook(type:string,raw:unknown):Promise<boolean> {
    const o=raw as Record<string,any>|undefined;if(!o)return false;
    const meta=o.metadata??{};
    let id:string|null=null,intent:string|null=null;
    if(type.startsWith('checkout.session.')&&meta.plus_intent_id){
      intent=meta.plus_intent_id;
      // Terminated enrollments can be replaced. Late deliveries for the old intent are inert.
      const record=await store.plus.byIntent(intent!);if(!record)return true;
      // The signed event can recover an attachment lost after Checkout creation.
      if(record.checkoutId&&record.checkoutId!==o.id)throw new Error('Plus checkout mismatch');
      if(typeof o.id!=='string'||!/^cs_\w+$/.test(o.id))throw new Error('Invalid Plus checkout');
      if(!record.checkoutId)await store.plus.attach(record.intentId,o.id,'');
      const refreshed=await store.plus.byIntent(record.intentId);if(refreshed)await sync(refreshed);
      return true;
    }
    if(type.startsWith('customer.subscription.')) {id=stripeReference(o);intent=typeof meta.plus_intent_id==='string'?meta.plus_intent_id:null;}
    else if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided'].includes(type)) {
      id=stripeReference(o.parent?.subscription_details?.subscription??o.subscription);
    } else return false;
    if(!id)return false;
    intent??=await stripe.intentForSubscription(id);
    if(!intent)return false;
    const record=await store.plus.byIntent(intent);
    // A replaced, fully terminated subscription must never overwrite a newer enrollment.
    if(!record)return true;
    if(record.subscriptionId&&record.subscriptionId!==id)throw new Error('Plus subscription mismatch');
    const ticket=await store.plus.beginSync(intent);if(!ticket)return true;
    if(!await store.plus.apply(intent,ticket.generation,await stripe.subscription(id,intent)))throw new Error('Plus sync superseded');
    return true;
  }
  function register(app:FastifyInstance) {
    async function account(req:Parameters<typeof requireAccount>[0]) {
      const {token}=await requireAccount(req,store);
      if(!await store.billing.rateLimit('plus:'+storeKey(token),30,60000))throw new ApiError(429,'请求过于频繁，请稍后重试','rate_limited');
      return token;
    }
    app.get('/v1/plus',async(req,reply)=>{
      const token=await account(req);let failed=false;const r=await store.plus.get(token);
      if(r&&(r.subscriptionId||r.checkoutId)&&config.stripeSecretKey){try{await sync(r);}catch{failed=true;}}
      return reply.header('Cache-Control','no-store').send(await wire(token,failed));
    });
    app.post('/v1/plus/checkout',async(req,reply)=>{
      const token=await account(req);if(!available())throw new ApiError(503,'Plus 暂未开放','plus_unavailable');
      const previous=await store.plus.get(token);
      if(previous&&(previous.subscriptionId||previous.checkoutId)){
        try{await sync(previous);}catch{throw new ApiError(503,'正在核对原订阅，请稍后重试','plus_pending');}
      }
      const r=await store.plus.reserve(token);if(!r)throw new ApiError(401,'设备令牌无效');
      if(r.subscriptionId)throw new ApiError(409,'已有订阅，请管理原订阅，避免重复付款','plus_exists');
      if(r.checkoutId&&r.checkoutURL)return reply.header('Cache-Control','no-store').send({url:r.checkoutURL});
      try{
        // Checkout language is fixed per intent so retries cannot alter an idempotent request.
        const checkout=await stripe.checkout(r,config.publicBaseURL,'zh');
        if(!await store.plus.attach(r.intentId,checkout.id,checkout.url))throw new Error('Plus checkout attachment failed');
        return reply.header('Cache-Control','no-store').send({url:checkout.url});
      }catch{throw new ApiError(503,'付款入口暂时无法确认，请重试原订阅','plus_pending');}
    });
    app.post('/v1/plus/cancel',async(req,reply)=>{
      const token=await account(req),r=await store.plus.get(token);
      if(!r?.subscriptionId)throw new ApiError(409,'没有可取消的订阅');
      if(!config.stripeSecretKey)throw new ApiError(503,'订阅管理暂时不可用');
      try{await stripe.cancel(r.subscriptionId);await sync(r);}catch{throw new ApiError(503,'取消结果尚未确认，请刷新后重试','plus_pending');}
      return reply.header('Cache-Control','no-store').send(await wire(token));
    });
    app.post('/v1/plus/portal',async(req,reply)=>{
      const token=await account(req),r=await store.plus.get(token);
      if(!r?.customerId||!config.stripeSecretKey)throw new ApiError(409,'尚无订阅账单');
      try{return reply.header('Cache-Control','no-store').send({url:await stripe.portal(r.customerId,config.publicBaseURL)});}
      catch{throw new ApiError(503,'账单管理暂时不可用，请稍后重试','upstream_error');}
    });
  }
  return {register,webhook};
}
import {createHash} from 'node:crypto';
const storeKey=(token:string)=>createHash('sha256').update(token).digest('hex');
