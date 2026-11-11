import test from 'node:test';
import assert from 'node:assert/strict';
import {accountPresentation,accountHTML} from '../ui/account.mjs';
const base={settings:{channel:'official'}};
test('billing ownership, not only entitlement status, selects subscribe versus manage',()=>{
 for(const status of ['active','expired','pending','inactive']) {
  const p=accountPresentation({...base,plus:{status,can_manage:true,billing_status:'past_due',available:true}});
  assert.equal(p.buy,false);assert.equal(p.manage,true);assert.equal(p.attention,true);
 }
 for(const billing_status of ['canceled','incomplete_expired','checkout_expired'])assert.equal(accountPresentation({...base,plus:{can_manage:true,billing_status,available:true}}).canBuy,true);
});
test('unavailable or syncing accounts cannot purchase; canceled renewal cannot be canceled twice',()=>{
 assert.equal(accountPresentation(base).canBuy,false);
 assert.equal(accountPresentation({...base,accountBusy:true,plus:{available:true}}).canBuy,false);
 assert.equal(accountPresentation({...base,accountSync:{status:'loading'},plus:{available:true}}).canBuy,false);
 assert.equal(accountPresentation({...base,plus:{can_manage:true,cancel_at_period_end:true}}).cancel,false);
});

test('manual Plus shows access expiry without promising a renewal or fabricating billing ownership',()=>{
 const state={settings:{channel:'official',language:'zh'},plus:{status:'active',server_time:'2026-11-11T00:00:00Z',manual_until:'2026-12-01T00:00:00Z',paid_until:'2026-12-01T00:00:00Z',can_manage:false,daily_remaining:400,daily_limit:400}};
 const html=accountHTML(state,{button:()=>'',escape:String,check:()=>'',t:()=>''});
 assert.match(html,/含人工权益 · 可用至/);assert.doesNotMatch(html,/预计续费日/);assert.match(html,/人工赠送不收费/);
 assert.equal(accountPresentation(state).manage,false);assert.equal(accountPresentation(state).cancel,false);
});
