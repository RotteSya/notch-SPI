import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import {BUDGET_POLICY} from '../src/budget-policy.ts';

for (const kind of ['memory','sqlite']) {
  const setup=async()=>{
    const store=kind==='memory'?new MemoryStore():new SqliteStore(':memory:');
    const {token}=await store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30});
    const reserve=(id=randomUUID(),channel='model-a',now=Date.now(),amount=100,limit=10000)=>
      store.billing.reserveBudget(token,id,'official','USD',amount,limit,86400000,now,0,true,channel);
    return {store,token,reserve};
  };
  test(`${kind}: provisional reconciliation is explicit, idempotent and keeps original day`,async()=>{
    const {store,token,reserve}=await setup();try{
      const id=randomUUID();await reserve(id,'model-a',Date.now()-86400000);
      await store.billing.settleBudget(token,id,null);
      const a=(await store.billing.inspectBudget()).provisional[0]!;
      assert.equal(a.actual,null);assert.equal(a.booked,100);assert.equal(a.state,'provisional');
      await store.billing.settleBudget(token,id,0); // ordinary callback cannot erase the estimate
      assert.equal((await store.billing.inspectBudget()).provisional[0]!.booked,100);
      assert.equal(await store.billing.reconcileBudget(id,20,'vendor:request-1'),true);
      assert.equal(await store.billing.reconcileBudget(id,20,'vendor:request-1'),true);
      assert.equal(await store.billing.reconcileBudget(id,0,'vendor:request-2'),false);
      assert.equal((await store.billing.inspectBudget()).provisional.length,0);
      assert.equal(await reserve(randomUUID(),'model-a',Date.now(),8000),true);
      await assert.rejects(async()=>store.billing.reconcileBudget(id,-1,'vendor:request-1'));
    }finally{await store.close();}
  });
  test(`${kind}: three unmetered outcomes cool only their channel; one probe then recover`,async()=>{
    const {store,token,reserve}=await setup();try{
      for(let i=0;i<3;i++){const id=randomUUID();await reserve(id);await store.billing.settleBudget(token,id,null);}
      const c=(await store.billing.inspectBudget()).controls[0]!;
      assert.equal(c.failures,3);assert.equal(c.reason,'metering_unavailable');
      await assert.rejects(reserve(),{reason:'cooldown'});
      const other=randomUUID();assert.equal(await reserve(other,'model-b'),true);await store.billing.releaseBudget(token,other);
      const probe=randomUUID();assert.equal(await reserve(probe,'model-a',c.blockedUntil+1),true);
      await assert.rejects(reserve(randomUUID(),'model-a',c.blockedUntil+2),{reason:'cooldown'});
      await store.billing.settleBudget(token,probe,20);
      assert.equal(await reserve(),true);
    }finally{await store.close();}
  });
  test(`${kind}: failed probe reopens cooldown; abandoned probe expires`,async()=>{
    const {store,token,reserve}=await setup();try{
      for(let i=0;i<3;i++){const id=randomUUID();await reserve(id);await store.billing.settleBudget(token,id,null);}
      let c=(await store.billing.inspectBudget()).controls[0]!;
      const probe=randomUUID();await reserve(probe,'model-a',c.blockedUntil+1);
      await store.billing.settleBudget(token,probe,null);
      await assert.rejects(reserve(),{reason:'cooldown'});
      c=(await store.billing.inspectBudget()).controls[0]!;
      const orphan=randomUUID();await reserve(orphan,'model-a',c.blockedUntil+1);
      assert.equal(await reserve(randomUUID(),'model-a',c.blockedUntil+BUDGET_POLICY.probeMs+2),true);
    }finally{await store.close();}
  });
  test(`${kind}: small overrun books full expense; repeated or major deviations isolate channel`,async()=>{
    const {store,token,reserve}=await setup();try{
      for(let i=0;i<3;i++){
        const id=randomUUID();assert.equal(await reserve(id),true);await store.billing.settleBudget(token,id,101);
      }
      await assert.rejects(reserve(),{reason:'guard_tripped'});
      assert.equal(await reserve(randomUUID(),'model-b'),true);
      const c=(await store.billing.inspectBudget()).controls.find(c=>c.reason==='estimate_overrun')!;
      assert.equal(await store.billing.resetBudgetControl(c.channel,'review:case-1'),true);
      const id=randomUUID();assert.equal(await reserve(id),true);await store.billing.settleBudget(token,id,121);
      // Retrying an old reset must not clear a new incident.
      assert.equal(await store.billing.resetBudgetControl(c.channel,'review:case-1'),true);
      await assert.rejects(reserve(),{reason:'guard_tripped'});
    }finally{await store.close();}
  });
  test(`${kind}: invalid usage remains provisional and requires review`,async()=>{
    const {store,token,reserve}=await setup();try{
      const id=randomUUID();await reserve(id);await store.billing.settleBudget(token,id,NaN);
      const state=await store.billing.inspectBudget();assert.equal(state.provisional[0]!.actual,null);
      assert.equal(state.controls[0]!.reason,'invalid_usage');await assert.rejects(reserve(),{reason:'guard_tripped'});
      assert.equal(await reserve(randomUUID(),'model-b'),true);
    }finally{await store.close();}
  });
  test(`${kind}: orphan holds free slots while retaining costs and cannot double settle`,async()=>{
    const {store,token,reserve}=await setup();try{
      const old=Date.now()-BUDGET_POLICY.orphanMs-1,ids=Array.from({length:4},()=>randomUUID());
      for(const id of ids)await reserve(id,'model-a',old);
      await assert.rejects(reserve(randomUUID(),'model-b'),{reason:'busy'});
      await store.billing.reap();await store.billing.reap();
      assert.equal((await store.billing.inspectBudget()).provisional.length,4);
      assert.equal(await reserve(randomUUID(),'model-b'),true);
      for(const id of ids)await store.billing.settleBudget(token,id,0);
      assert.equal((await store.billing.inspectBudget()).provisional.reduce((n,a)=>n+a.booked,0),400);
    }finally{await store.close();}
  });
  test(`${kind}: capture lease recovery refunds question and settles associated budget once`,async()=>{
    const {store,token,reserve}=await setup();try{
      const captureId=randomUUID(),attemptId=randomUUID();await reserve(attemptId);
      const begun=await store.billing.beginWithAttempt({token,captureId,requestHmac:'lease',leaseMs:1},
        {attemptId,captureId,purpose:'answer',provider:'test',model:'a',policyVersion:'p',currency:'USD',pricingVersion:'p'});
      assert.equal(begun.ok,true);
      await store.billing.reap(new Date(Date.now()+1000).toISOString());
      assert.equal((await store.billing.inspectBudget()).provisional.length,1);
      assert.equal((await store.getAccount(token))?.balanceQuestions,30);
      await store.billing.finishAttemptAndBudget(token,attemptId,{status:'succeeded',inputTokens:1,outputTokens:1,costMicros:'1'},1);
      assert.equal((await store.billing.inspectBudget()).provisional[0]!.booked,100);
    }finally{await store.close();}
  });
  test(`${kind}: concurrent admissions cannot overspend or occupy more than four slots`,async()=>{
    const {store,reserve}=await setup();try{
      const results=await Promise.allSettled(Array.from({length:10},()=>reserve(randomUUID(),'model-a',Date.now(),100,500)));
      assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value).length,4);
    }finally{await store.close();}
  });
}

test('SQLite persists provisional accounting, rolls back failed settlement, and audits legacy unlock',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {DatabaseSync}=await import('node:sqlite');
  const dir=mkdtempSync(join(tmpdir(),'budget-recovery-')),path=join(dir,'test.sqlite');
  let store=new SqliteStore(path);const db=new DatabaseSync(path);
  try{
    const {token}=await store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30});
    const id=randomUUID(),captureId=randomUUID();
    await store.billing.reserveBudget(token,id,'official','USD',100,10000,86400000,Date.now(),0,true);
    await store.billing.beginWithAttempt({token,captureId,requestHmac:'persist'},
      {attemptId:id,captureId,purpose:'answer',provider:'test',model:'a',policyVersion:'p',currency:'USD',pricingVersion:'p'});
    db.exec("CREATE TRIGGER fail_budget BEFORE UPDATE ON budget_windows BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
    await assert.rejects(store.billing.finishAttemptAndBudget(token,id,{status:'failed',inputTokens:null,outputTokens:null,costMicros:null},null));
    assert.equal((await store.billing.inspectBudget()).provisional.length,0);
    assert.equal((await store.billing.attempts(token))[0]!.status,'running');
    db.exec('DROP TRIGGER fail_budget');
    await store.billing.finishAttemptAndBudget(token,id,{status:'failed',inputTokens:null,outputTokens:null,costMicros:null},null);
    await store.close();store=new SqliteStore(path);
    assert.equal((await store.billing.inspectBudget()).provisional[0]!.actual,null);
    await store.billing.reconcileBudget(id,25,'vendor:confirmed-25');
    const cost=db.prepare('SELECT revision,cost_micros,source FROM attempt_costs WHERE attempt_id=? ORDER BY revision DESC LIMIT 1').get(id)!;
    assert.equal(cost.revision,3);assert.equal(cost.cost_micros,'25');assert.equal(cost.source,'reconciled');
    db.exec('UPDATE request_budget_guards SET tripped=1');
    const legacy=(await store.billing.inspectBudget()).controls.find(c=>c.reason==='legacy_global_guard')!;
    assert.ok(legacy);await store.billing.resetBudgetControl(legacy.channel,'review:legacy-1');
    assert.equal((await store.billing.inspectBudget()).controls.some(c=>c.reason==='legacy_global_guard'),false);
    db.exec('UPDATE request_budget_guards SET tripped=1');
    await store.billing.resetBudgetControl(legacy.channel,'review:legacy-1');
    assert.equal((await store.billing.inspectBudget()).controls.some(c=>c.reason==='legacy_global_guard'),true);
  }finally{db.close();await store.close();rmSync(dir,{recursive:true,force:true});}
});
