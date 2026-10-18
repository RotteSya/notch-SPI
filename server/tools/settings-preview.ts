// Local-only, in-memory product exercise. No external payment or model calls.
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:43182';
Object.assign(process.env,{DB_PATH:':memory:',OFFICIAL_PROVIDER:'mock',PAYMENT_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_local_fixture',STRIPE_WEBHOOK_SECRET:'whsec_local_fixture',PLUS_ENABLED:'1',FREE_TRIAL_ENABLED:'1',PUBLIC_BASE_URL:base,LOG_LEVEL:'silent'});
globalThis.fetch=async()=>{throw new Error('External requests are disabled in the local settings preview');};
const [{default:Fastify},{registerRoutes},{config},{MemoryStore},{MockProvider},{StubPaymentProvider}]=await Promise.all([
 import('fastify'),import('../src/routes.ts'),import('../src/config.ts'),import('../src/db-memory.ts'),import('../src/providers/mock.ts'),import('../src/payments.ts')]);
const store=new MemoryStore(),app=Fastify({logger:false}),provider=new MockProvider();
let token='';const register=store.registerDevice.bind(store);
store.registerDevice=async input=>{const d=await register(input);token=d.token;return d;};
const plans=new Map<string,{paid:boolean;canceled:boolean;failed:boolean}>();
const plan=(id:string)=>{if(!plans.has(id))plans.set(id,{paid:false,canceled:false,failed:false});return plans.get(id)!;};
const stripe={
 checkout:async(r:any)=>{plan(r.intentId);return{id:'cs_'+r.intentId.replaceAll('-',''),url:base+'/preview/checkout?id='+r.intentId};},
 checkoutState:async(id:string)=>{const entry=[...plans].find(([k])=>'cs_'+k.replaceAll('-','')===id);return{status:entry?.[1].paid?'complete':'open',subscriptionId:entry?.[1].paid?'sub_'+entry[0].replaceAll('-',''):null};},
 subscription:async(_id:string,intent:string)=>{const p=plan(intent);return{subscriptionId:'sub_'+intent.replaceAll('-',''),customerId:'cus_'+intent.replaceAll('-',''),status:p.failed?'past_due':'active',cancelAtPeriodEnd:p.canceled,paidFrom:p.paid?new Date(Date.now()-1000).toISOString():null,paidUntil:p.paid?new Date(Date.now()+30*86400000).toISOString():null,invoiceId:p.paid?'in_preview':null};},
 intentForSubscription:async(id:string)=>[...plans.keys()].find(k=>'sub_'+k.replaceAll('-','')===id)??null,
 cancel:async(id:string)=>{const key=[...plans.keys()].find(k=>'sub_'+k.replaceAll('-','')===id);if(key)plan(key).canceled=true;},
 portal:async(customer:string)=>base+'/preview/portal?id='+([...plans.keys()].find(k=>'cus_'+k.replaceAll('-','')===customer)??'')
};
const stub=new StubPaymentProvider();
registerRoutes(app,{config:{...config,deviceRegPerHour:1000},store,storeKind:'memory',provider,objectiveProvider:provider,providerDegraded:null,objectiveProviderDegraded:null,payment:{name:'stripe',renderTopUpPage:input=>stub.renderTopUpPage({...input,mode:'disabled'})},plusStripe:stripe});
const nonce=randomUUID();
const form=(action:string,label:string,id='')=>`<form method="post" action="/preview/action"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="action" value="${action}"><input type="hidden" name="id" value="${id}"><button>${label}</button></form>`;
const page=(body:string)=>`<!doctype html><meta charset="utf-8"><title>NotchSPI 本机产品体验</title><style>body{font:16px system-ui;max-width:760px;margin:60px auto;background:#f5f5f8;color:#25252c}h1{font-size:30px}form{display:inline-block;margin:8px}button{padding:14px 20px;border:1px solid #ddd;border-radius:12px;background:white;cursor:pointer}pre{background:white;padding:20px;border-radius:16px;overflow:auto}p{line-height:1.8;color:#62626d}</style><h1>NotchSPI 本机产品体验</h1><p>完全本机模拟，不收费、不连接 Stripe 或模型服务。操作后返回 App，点击刷新查看真实接口与账本变化。</p>${body}<p><a href="/preview">返回体验控制台</a></p>`;
app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_req,body,done)=>done(null,Object.fromEntries(new URLSearchParams(String(body)))));
app.get('/preview',async(_req,reply)=>{const q=token?await store.billing.quota(token):null;return reply.type('text/html').send(page(
 '<h2>体验场景</h2>'+form('credits','增加 10 题长期题包')+form('exhaust','用完免费 / Plus 每日额度')+form('failed','模拟续费失败')+form('resume','恢复自动续费 / 修复付款')+'<pre>'+JSON.stringify(q?.allowanceSources??'请先在 App 打开账户页面',null,2)+'</pre><p>可测试领取体验 → 开通 Plus → 取消续费 → 题包保护 → 恢复账户。购买题包使用此控制台增加测试题数。</p>'));});
for(const route of ['checkout','portal'])app.get('/preview/'+route,async(req,reply)=>{const id=String((req.query as any).id??'');if(!plans.has(id))return reply.code(404).send('Unknown local session');return reply.type('text/html').send(page(route==='checkout'?'<h2>Plus · ¥69 / 月（模拟）</h2>'+form('pay','模拟付款成功',id):'<h2>账单管理（模拟）</h2>'+form('resume','恢复续费 / 更新支付方式',id)));});
app.post('/preview/action',async(req,reply)=>{
 const body=req.body as Record<string,string>;if(body.nonce!==nonce)return reply.code(403).send('Invalid preview form');
 if(!token)return reply.code(409).send('Open Account in the app first');
 const r=await store.plus.get(token),id=body.id||r?.intentId;
 if(body.action==='credits')await store.credit({token,questions:10,amountCents:100,currency:'CNY',provider:'local-preview',reference:randomUUID()});
 if(body.action==='exhaust')for(let i=0;i<850;i++){const captureId=randomUUID();const held=await store.billing.begin({token,captureId,requestHmac:captureId,allowPurchasedCredits:false});if(!held.ok)break;await store.billing.finish({token,captureId,charge:true,terminalState:'usable'});}
 if(id&&plans.has(id)){if(body.action==='pay')plan(id).paid=true;if(body.action==='failed')plan(id).failed=true;if(body.action==='resume'){plan(id).failed=false;plan(id).canceled=false;}}
 return reply.type('text/html').send(page('<h2>已更新本机测试状态</h2><p>返回 App 即会核对；也可以点击刷新。</p>'));
});
app.get('/preview/health',async()=>({fixture:'settings-product-preview',externalNetwork:false,persistent:false}));
await app.listen({host:'127.0.0.1',port:43182});
console.log('Local settings preview ready: '+base+'/preview');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
