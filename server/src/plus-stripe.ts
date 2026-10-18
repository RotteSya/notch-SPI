import {PLUS,type PlusRecord,type PlusUpdate} from './plus.ts';
import {stripeReference} from './stripe.ts';
export interface PlusStripe {
  checkout(record:PlusRecord,base:string,lang:string):Promise<{id:string;url:string}>;
  checkoutState(id:string):Promise<{status:string;subscriptionId:string|null}>;
  subscription(id:string,intent:string):Promise<PlusUpdate>;
  intentForSubscription(id:string):Promise<string|null>;
  cancel(id:string):Promise<void>;
  portal(customer:string,base:string):Promise<string>;
}
const object=(value:unknown):Record<string,any> => value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
export function parsePlusSubscription(raw:unknown,intent:string):PlusUpdate {
  const sub=object(raw), items=object(sub.items).data;
  const item=Array.isArray(items)&&items.length===1?object(items[0]):{};
  const price=object(item.price), recurring=object(price.recurring), invoice=object(sub.latest_invoice);
  if(object(sub.metadata).plus_intent_id!==intent || price.unit_amount!==PLUS.priceCents || price.currency!=='cny'
    || recurring.interval!=='month'||recurring.interval_count!==1||item.quantity!==1
    || !/^sub_\w+$/.test(sub.id)||!/^cus_\w+$/.test(stripeReference(sub.customer)??'')) throw new Error('Plus subscription contract mismatch');
  if(!['incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused'].includes(sub.status))throw new Error('Unknown subscription status');
  let paidFrom:string|null=null,paidUntil:string|null=null,invoiceId:string|null=null;
  if(invoice.status==='paid'&&invoice.amount_paid===PLUS.priceCents&&invoice.currency==='cny') {
    const lines=object(invoice.lines).data;
    const line=Array.isArray(lines)&&lines.length===1?object(lines[0]):{};
    const period=object(line.period);
    const parent=object(object(invoice.parent).subscription_details);
    if(!/^in_\w+$/.test(invoice.id)||stripeReference(parent.subscription??invoice.subscription)!==sub.id
      ||!Number.isSafeInteger(period.start)||!Number.isSafeInteger(period.end)||period.end<=period.start
      ||period.end-period.start>32*86400||period.end-period.start<27*86400)throw new Error('Invalid paid Plus invoice');
    paidFrom=new Date(period.start*1000).toISOString();paidUntil=new Date(period.end*1000).toISOString();invoiceId=invoice.id;
  }
  return {subscriptionId:sub.id,customerId:stripeReference(sub.customer)!,status:sub.status,
    cancelAtPeriodEnd:sub.cancel_at_period_end===true,paidFrom,paidUntil,invoiceId};
}
export function plusCheckoutParams(record:PlusRecord,base:string,lang:string):URLSearchParams {
  const p=new URLSearchParams({mode:'subscription',client_reference_id:record.intentId,
    integration_identifier:'notchspi-plus-'+record.intentId.replace(/[^a-f]/g,'').padEnd(8,'a').slice(0,8),
    'metadata[plus_intent_id]':record.intentId,'subscription_data[metadata][plus_intent_id]':record.intentId,
    'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'cny',
    'line_items[0][price_data][unit_amount]':'6900','line_items[0][price_data][recurring][interval]':'month',
    'line_items[0][price_data][product_data][name]':'NotchSPI Plus · 400/day',
    success_url:base+'/purchase/complete?product=plus&lang='+lang+'&paid=1',cancel_url:base+'/purchase/complete?product=plus&lang='+lang+'&canceled=1'});
  return p;
}
export class LivePlusStripe implements PlusStripe {
  private key:string;
  constructor(key:string){this.key=key;}
  private async request(path:string,body?:URLSearchParams,idempotency?:string):Promise<Record<string,any>> {
    const response=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+this.key,'Stripe-Version':'2026-08-26.dahlia',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},body:body?.toString()});
    if(!response.ok){await response.body?.cancel();throw new Error('Plus payment service unavailable');}
    if(!response.body)throw new Error('Missing Stripe body');
    const chunks:Uint8Array[]=[];let length=0;
    for await(const c of response.body){length+=c.length;if(length>512*1024)throw new Error('Stripe response too large');chunks.push(c);}
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
  async checkout(r:PlusRecord,base:string,lang:string){
    // Stripe retains idempotency keys for at least 24h. An uncertain older attempt requires reconciliation, never another charge.
    if(Date.now()-Date.parse(r.createdAt)>23*3600000)throw new Error('Checkout needs manual reconciliation');
    const raw=await this.request('checkout/sessions',plusCheckoutParams(r,base,lang),'plus:'+r.intentId);
    if(!/^cs_\w+$/.test(raw.id)||!safeStripeURL(raw.url))throw new Error('Invalid checkout destination');
    return {id:raw.id as string,url:raw.url as string};
  }
  async checkoutState(id:string){
    if(!/^cs_\w+$/.test(id))throw new Error('Invalid checkout id');
    const r=await this.request('checkout/sessions/'+id);return {status:String(r.status),subscriptionId:stripeReference(r.subscription)};
  }
  private rawSubscription(id:string){if(!/^sub_\w+$/.test(id))throw new Error('Invalid subscription id');return this.request('subscriptions/'+id+'?expand[]=latest_invoice');}
  async subscription(id:string,intent:string){return parsePlusSubscription(await this.rawSubscription(id),intent);}
  async intentForSubscription(id:string){const r=await this.rawSubscription(id);const intent=object(r.metadata).plus_intent_id;return typeof intent==='string'?intent:null;}
  async cancel(id:string){if(!/^sub_\w+$/.test(id))throw new Error('Invalid subscription id');await this.request('subscriptions/'+id,new URLSearchParams({cancel_at_period_end:'true'}));}
  async portal(customer:string,base:string){
    if(!/^cus_\w+$/.test(customer))throw new Error('Invalid customer');
    const r=await this.request('billing_portal/sessions',new URLSearchParams({customer,return_url:base+'/purchase/complete?product=plus'}));
    if(!safeStripeURL(r.url))throw new Error('Invalid portal URL');return r.url as string;
  }
}
export function safeStripeURL(value:unknown):value is string {
  if(typeof value!=='string')return false;
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['checkout.stripe.com','billing.stripe.com'].includes(u.hostname);}catch{return false;}
}
