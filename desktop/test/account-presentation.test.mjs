import test from 'node:test';
import assert from 'node:assert/strict';
import {accountPresentation} from '../ui/account.mjs';
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
