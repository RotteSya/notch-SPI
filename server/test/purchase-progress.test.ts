import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import {purchaseProgress} from '../src/purchase-progress.ts';
import {checkoutSnapshot,checkoutSnapshotHash} from '../src/checkout-reconciliation.ts';
import {DEFAULT_PACKS_JSON,parsePacks,packNames} from '../src/pricing.ts';
import {buildCheckoutParams} from '../src/stripe.ts';
import {renderPurchase} from '../src/purchase-page.ts';
import {RequestKeys,FIXED_TRIAL_POLICY} from '../src/billing.ts';
import type {Store} from '../src/db.ts';
const catalog={currency:'JPY',version:'pricing-v1',packs:[{id:'pack100',questions:100,amountCents:300}]};
const stores:Array<[string,()=>Store|Promise<Store>]>=[['memory',()=>new MemoryStore()],['sqlite',()=>new SqliteStore(':memory:')]];
if(process.env.TEST_POSTGRES_URL){
  const url=new URL(process.env.TEST_POSTGRES_URL);if(!/test/i.test(url.pathname))throw new Error('Isolated test database required');
  const {PostgresStore,resolvePostgresSSL}=await import('../src/db-postgres.ts');
  const pg=(await import('pg')).default;
  stores.push(['postgres',async()=>{
    const admin=new pg.Pool({connectionString:url.toString(),ssl:resolvePostgresSSL({connectionString:url.toString()})});
    const schema='purchase_test_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped=new URL(url);scoped.searchParams.set('options','-c search_path='+schema);
    const store=new PostgresStore(scoped.toString(),resolvePostgresSSL({connectionString:scoped.toString()})),close=store.close.bind(store);
    store.close=async()=>{await close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};return store;
  }]);
}
for(const [name,make] of stores){
  test(`${name}: all published packs keep their names, JPY prices and fulfilled quantities through Checkout`,async()=>{
    const store=await make();try{
      const packs=parsePacks(DEFAULT_PACKS_JSON),active={...catalog,packs};
      assert.deepEqual(packs.map(p=>[p.questions,p.amountCents]),[[100,300],[300,800],[1000,2200]]);
      const device=await store.registerDevice({platform:'test',appVersion:'test',trialQuestions:30});
      for(const pack of packs){
        const input={token:device.token,purchaseId:randomUUID(),packId:pack.id,questions:pack.questions,amountCents:pack.amountCents,currency:'JPY',catalogVersion:active.version,lang:'zh'};
        const session=await store.createPurchaseSession(input);assert.ok(session);
        const params=buildCheckoutParams({pack,purchaseSessionId:session.sessionId,currency:'JPY',publicBaseURL:'https://test.invalid',lang:'zh'});
        assert.equal(params.get('mode'),'payment');assert.equal(params.get('line_items[0][price_data][unit_amount]'),String(pack.amountCents));
        assert.equal(params.get('line_items[0][price_data][currency]'),'jpy');assert.equal(params.get('metadata[questions]'),String(pack.questions));
        const id='cs_'+pack.id;await store.attachPurchaseCheckout(session.sessionId,id);
        const stored=(await store.getPurchaseSessionForAccount(device.token,input.purchaseId))!;
        const html=renderPurchase(stored,session.secret,packNames(packs,pack.id).zh);
        assert.ok(html.includes(packNames(packs,pack.id).zh));assert.ok(html.includes(pack.questions+' 题'));assert.ok(html.includes('不自动续费'));
        const snapshot=checkoutSnapshot({id,mode:'payment',payment_status:'paid',amount_total:pack.amountCents,currency:'jpy',payment_intent:'pi_'+pack.id,metadata:{purchase_session_id:session.sessionId,pack_id:pack.id}});
        assert.equal((await purchaseProgress(store,stored,active,async()=>({snapshot,status:'complete'}))).state,'credited');
      }
      assert.equal((await store.billing.quota(device.token))?.balanceQuestions,1430);
    }finally{await store.close();}
  });

  test(`${name}: purchase recovery preserves ownership through cancellation, delay, outage and duplicate paid delivery`,async()=>{
    const store=await make();try{
      const device=await store.registerDevice({platform:'test',appVersion:'test',trialQuestions:30,policyVersion:FIXED_TRIAL_POLICY.version});
      const other=await store.registerDevice({platform:'test',appVersion:'test',trialQuestions:30});
      const input={token:device.token,purchaseId:randomUUID(),packId:'pack100',questions:100,amountCents:300,currency:'JPY',catalogVersion:'pricing-v1',lang:'en'};
      const session=await store.createPurchaseSession(input);assert.ok(session);
      const current=async()=>{const p=await store.getPurchaseSessionForAccount(device.token,input.purchaseId);assert.ok(p);return p;};
      assert.equal(await store.getPurchaseSessionForAccount(other.token,input.purchaseId),null);
      assert.equal((await purchaseProgress(store,await current(),catalog,async()=>{throw new Error('must not read');})).state,'ready');
      assert.equal((await purchaseProgress(store,{...await current(),expiresAt:'2000-01-01T00:00:00Z'},catalog,async()=>{throw new Error();})).state,'expired');
      assert.equal((await purchaseProgress(store,await current(),{...catalog,version:'changed'},async()=>{throw new Error();})).state,'expired');
      const id='cs_'+randomUUID().replaceAll('-',''),url='https://checkout.stripe.com/c/pay/'+id;
      await store.attachPurchaseCheckout(session.sessionId,id,url);
      const snapshot=checkoutSnapshot({id,mode:'payment',payment_status:'unpaid',amount_total:300,currency:'jpy',payment_intent:'pi_test',metadata:{purchase_session_id:session.sessionId,pack_id:'pack100'}});
      const check=async(status:'open'|'complete'|'expired')=>purchaseProgress(store,await current(),catalog,async()=>({snapshot,status}));
      assert.equal((await check('open')).checkout_url,url,'cancel/failure reuses one Checkout');
      assert.equal((await check('complete')).state,'pending');assert.equal((await check('complete')).checkout_url,null,'delay does not invite repurchase');
      await assert.rejects(purchaseProgress(store,await current(),catalog,async()=>{throw new Error('network');}));
      assert.equal((await store.billing.quota(device.token))?.balanceQuestions,30);
      assert.equal((await check('expired')).state,'expired');
      snapshot.paymentStatus='paid';
      // An expired browser handoff cannot prevent delayed payment fulfilment.
      const expired={...await current(),expiresAt:'2000-01-01T00:00:00Z'};
      const responses=await Promise.all(Array.from({length:6},()=>purchaseProgress(store,expired,catalog,async()=>({snapshot,status:'complete'}))));
      assert.ok(responses.some(r=>r.state==='credited'));
      const hash=checkoutSnapshotHash(snapshot);
      await store.payments.checkouts.receive({id:'evt_late_webhook',type:'checkout.session.async_payment_succeeded',resourceId:id,createdAt:null,payloadHash:hash},snapshot);
      assert.equal((await check('complete')).state,'credited');
      assert.equal((await store.listRecentTopups(10)).length,1);
      assert.equal((await store.billing.quota(device.token))?.balanceQuestions,130);
      const captureId=randomUUID();assert.ok((await store.billing.begin({token:device.token,captureId,requestHmac:'use-after-payment'})).ok);
      await store.billing.finish({token:device.token,captureId,charge:true,terminalState:'usable'});
      const quota=await store.billing.quota(device.token);assert.equal(quota?.balanceQuestions,129);assert.equal(quota?.quotaBreakdown.trial,29);assert.equal(quota?.quotaBreakdown.paid,100);
      assert.equal((await store.billing.quota(other.token))?.balanceQuestions,30);
    }finally{await store.close();}
  });
  test(`${name}: inconsistent paid proof never grants or exposes a resume URL`,async()=>{
    const store=await make();try{
      const device=await store.registerDevice({platform:'test',appVersion:'test',trialQuestions:0});
      const input={token:device.token,purchaseId:randomUUID(),packId:'pack100',questions:100,amountCents:300,currency:'JPY',catalogVersion:'pricing-v1',lang:'en'};
      const p=await store.createPurchaseSession(input);assert.ok(p);await store.attachPurchaseCheckout(p.sessionId,'cs_conflict');
      const stored=await store.getPurchaseSessionForAccount(device.token,input.purchaseId);assert.ok(stored);
      const snapshot=checkoutSnapshot({id:'cs_conflict',mode:'payment',payment_status:'paid',amount_total:300,currency:'jpy',metadata:{purchase_session_id:p.sessionId,pack_id:'pack100'}});
      for(const mutation of [{id:'cs_other'},{amountCents:1},{purchaseSessionId:randomUUID()},{packId:'pack1000'},{currency:'USD'},{mode:'subscription' as const}]){
        const result=await purchaseProgress(store,stored,catalog,async()=>({snapshot:{...snapshot,...mutation},status:'complete'}));
        assert.equal(result.state,'review');assert.equal(result.checkout_url,null);
      }
      assert.equal((await store.billing.quota(device.token))?.balanceQuestions,0);
    }finally{await store.close();}
  });
  test(`${name}: free grant retry, exhaustion and a paid pack share accurate deduction rules`,async()=>{
    const store=await make();try{
      const keys=new RequestKeys(JSON.stringify({v1:Buffer.alloc(32,1).toString('base64')}),'v1',false),identity=keys.registration(Buffer.alloc(32,2).toString('base64url'));
      const input={platform:'test',appVersion:'test',trialQuestions:30,policyVersion:FIXED_TRIAL_POLICY.version,...identity};
      const registrations=await Promise.all(Array.from({length:5},()=>store.registerDevice(input)));
      const token=registrations[0]!.token;assert.ok(registrations.every(d=>d.token===token));
      for(let i=0;i<30;i++){
        const captureId=randomUUID();assert.ok((await store.billing.begin({token,captureId,requestHmac:captureId})).ok);
        await store.billing.finish({token,captureId,charge:true,terminalState:'usable'});
        await store.billing.finish({token,captureId,charge:true,terminalState:'usable'});
      }
      assert.equal((await store.registerDevice(input)).token,token);assert.equal((await store.billing.quota(token))?.balanceQuestions,0);
      const denied=await store.billing.begin({token,captureId:randomUUID(),requestHmac:'empty'});assert.equal(denied.ok,false);
      await store.credit({token,questions:100,amountCents:300,currency:'JPY',provider:'stripe',reference:'cs_paid_after_free'});
      const captureId=randomUUID();await store.billing.begin({token,captureId,requestHmac:'failed'});
      await store.billing.finish({token,captureId,charge:false,terminalState:'failed'});
      assert.equal((await store.billing.quota(token))?.balanceQuestions,100);assert.equal((await store.billing.quota(token))?.initialGrantQuestions,30);
    }finally{await store.close();}
  });
}

test('sqlite: restarting retains one free grant and a recoverable order, including fulfilment after handoff expiry',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {DatabaseSync}=await import('node:sqlite');
  const directory=mkdtempSync(join(tmpdir(),'purchase-restart-')),path=join(directory,'test.sqlite');
  let store=new SqliteStore(path);
  try{
    const keys=new RequestKeys(JSON.stringify({v1:Buffer.alloc(32,7).toString('base64')}),'v1',false);
    const registration={platform:'test',appVersion:'test',trialQuestions:30,...keys.registration(Buffer.alloc(32,8).toString('base64url'))};
    const device=await store.registerDevice(registration),purchaseId=randomUUID();
    const purchase=await store.createPurchaseSession({token:device.token,purchaseId,packId:'pack100',questions:100,amountCents:300,currency:'JPY',catalogVersion:'pricing-v1',lang:'zh'});assert.ok(purchase);
    await store.attachPurchaseCheckout(purchase.sessionId,'cs_restart','https://checkout.stripe.com/c/pay/cs_restart');
    const raw=new DatabaseSync(path);raw.prepare("UPDATE purchase_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();raw.close();
    await store.close();store=new SqliteStore(path);
    assert.equal((await store.registerDevice(registration)).token,device.token);
    const stored=await store.getPurchaseSessionForAccount(device.token,purchaseId);assert.ok(stored);
    assert.equal(await store.getPurchaseSession(purchase.sessionId,purchase.secret),null);
    const snapshot=checkoutSnapshot({id:'cs_restart',mode:'payment',payment_status:'paid',amount_total:300,currency:'JPY',payment_intent:'pi_restart',metadata:{purchase_session_id:purchase.sessionId,pack_id:'pack100'}});
    assert.equal((await purchaseProgress(store,stored,catalog,async()=>({snapshot,status:'complete'}))).state,'credited');
    await store.close();store=new SqliteStore(path);
    const restored=await store.getPurchaseSessionForAccount(device.token,purchaseId);assert.ok(restored?.consumedAt);
    assert.equal((await purchaseProgress(store,restored!,catalog,async()=>{throw Error('already durable');})).state,'credited');
    assert.equal((await store.billing.quota(device.token))?.balanceQuestions,130);
  }finally{await store.close();rmSync(directory,{recursive:true,force:true});}
});
