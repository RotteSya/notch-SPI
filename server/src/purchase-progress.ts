import type {Store,StoredPurchaseSession} from './db.ts';
import {checkoutSnapshotHash,type CheckoutCatalog} from './checkout-reconciliation.ts';
import type {CheckoutProgress} from './stripe.ts';

/** Only the authenticated owner can reach this path. Browser redirects never grant quota. */
export async function purchaseProgress(store:Store,purchase:StoredPurchaseSession,catalog:CheckoutCatalog,read:(id:string)=>Promise<CheckoutProgress>) {
  const fields={questions:purchase.questions,amount_minor:purchase.amountCents,currency:purchase.currency,pack_id:purchase.packId};
  const result=(state:string,url:string|null=null)=>({...fields,state,checkout_url:url});
  if(purchase.consumedAt)return result('credited');
  if(!purchase.checkoutSessionId) {
    const pack=catalog.packs.find(p=>p.id===purchase.packId);
    const current=pack&&pack.questions===purchase.questions&&pack.amountCents===purchase.amountCents&&catalog.currency===purchase.currency&&catalog.version===purchase.catalogVersion;
    return result(current&&Date.parse(purchase.expiresAt)>Date.now()?'ready':'expired');
  }
  const {snapshot,status}=await read(purchase.checkoutSessionId);
  // Even a faulty upstream adapter must not redirect ownership or grant a different order.
  if(snapshot.id!==purchase.checkoutSessionId||snapshot.purchaseSessionId!==purchase.sessionId||snapshot.metadataInvalid||
    snapshot.mode!=='payment'||snapshot.packId!==purchase.packId||snapshot.currency!==purchase.currency||snapshot.amountCents!==purchase.amountCents)
    return result('review');
  if(snapshot.paymentStatus!=='paid') {
    if(status==='expired'&&snapshot.paymentStatus==='unpaid')return result('expired');
    if(status==='open'&&snapshot.paymentStatus==='unpaid')return result('unpaid',purchase.checkoutURL);
    return result('pending');
  }
  const queue=store.payments.checkouts;
  if(!await queue.get(snapshot.id)) {
    // A server-to-Stripe read is trusted evidence, explicitly distinct from a signed webhook.
    // Stable event identity and the existing order transaction make polling/webhook races safe.
    const hash=checkoutSnapshotHash(snapshot);
    await queue.receive({id:'evt_local_checkout_'+hash,type:'checkout.recovery.read',resourceId:snapshot.id,
      createdAt:null,payloadHash:hash},snapshot);
  }
  const claim=await queue.claim(snapshot.id);
  if(claim) {
    try{await queue.finish(claim,snapshot,'stripe_api',catalog);}
    catch(error){await queue.defer(claim);throw error;}
  }
  const entry=await queue.get(snapshot.id);
  return result(entry?.state==='credited'?'credited':entry?.state==='review'?'review':'pending');
}
