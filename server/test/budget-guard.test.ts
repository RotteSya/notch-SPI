import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BudgetAdmissionError} from '../src/billing.ts';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';

for(const kind of ['memory','sqlite']){
  test(`${kind}: guarded global slots, 20% headroom, settlement and cross-day latch`,async()=>{
    const store=kind==='memory'?new MemoryStore():new SqliteStore(':memory:');
    try{
      const users=await Promise.all(Array.from({length:6},()=>store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30})));
      const ids=users.map(()=>randomUUID()),now=Date.now();
      const reserve=(i:number,currency='USD',time=now,amount=100)=>store.billing.reserveBudget(users[i]!.token,ids[i]!, 'official',currency,amount,1000,86400000,time,480,true);
      assert.deepEqual(await Promise.all([0,1,2,3].map(i=>reserve(i))),[true,true,true,true]);
      await assert.rejects(reserve(4), {name:'BudgetAdmissionError',reason:'busy'});
      // Unknown user cannot release another user's hold; a repeated ID adds no slot.
      await store.billing.releaseBudget(users[5]!.token,ids[0]!);
      await assert.rejects(reserve(4), {name:'BudgetAdmissionError',reason:'busy'});assert.equal(await reserve(0),true);
      await store.billing.settleBudget(users[0]!.token,ids[0]!,10);
      assert.equal(await reserve(4),true);
      await store.billing.settleBudget(users[1]!.token,ids[1]!,101);
      await store.billing.settleBudget(users[1]!.token,ids[1]!,0); // Cannot clear a latched fault.
      await assert.rejects(reserve(5), {name:'BudgetAdmissionError',reason:'guard_tripped'});
      await assert.rejects(reserve(5,'USD',now+86400000), {name:'BudgetAdmissionError',reason:'guard_tripped'});
      assert.equal(await reserve(5,'CNY'),true); // Currency isolation.
    }finally{await store.close();}
  });
  test(`${kind}: reserve headroom inside unchanged budget and account full overrun`,async()=>{
    const store=kind==='memory'?new MemoryStore():new SqliteStore(':memory:');
    try{
      const {token}=await store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30});
      const id=randomUUID();
      const reserve=(id:string,n:number,guard=true)=>store.billing.reserveBudget(token,id,'official','USD',n,1000,86400000,Date.now(),0,guard);
      assert.equal(await reserve(id,801),false);assert.equal(await reserve(id,800),true);
      await store.billing.settleBudget(token,id,1100);
      // Even fixed mode sees the complete overrun, not a capped or erased cost.
      assert.equal(await reserve(randomUUID(),1,false),false);
    }finally{await store.close();}
  });
}

test('SQLite observed overrun latch survives closing/reopening',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'notch-budget-'));
  const path=join(dir,'budget.sqlite');let store=new SqliteStore(path);
  try{
    const {token}=await store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30}),id=randomUUID();
    assert.equal(await store.billing.reserveBudget(token,id,'official','USD',100,10000,86400000,Date.now(),0,true),true);
    await store.billing.settleBudget(token,id,101);await store.close();store=new SqliteStore(path);
    await assert.rejects(store.billing.reserveBudget(token,randomUUID(),'official','USD',100,10000,86400000,Date.now()+86400000,0,true), BudgetAdmissionError);
  }finally{await store.close();rmSync(dir,{recursive:true,force:true});}
});

for (const kind of ['memory','sqlite']) {
  test(`${kind}: missing usage spends the complete hold without a permanent lock`, async()=>{
    const store=kind==='memory'?new MemoryStore():new SqliteStore(':memory:');
    try {
      const {token}=await store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30});
      const now=Date.now(), id=randomUUID();
      const reserve=(amount:number,time=now)=>store.billing.reserveBudget(token,randomUUID(),'official','USD',amount,1000,86400000,time,480,true);
      assert.equal(await store.billing.reserveBudget(token,id,'official','USD',100,1000,86400000,now,480,true),true);
      await store.billing.settleBudget(token,id,null);
      await store.billing.settleBudget(token,id,0); // Idempotency must not erase unknown cost.
      assert.equal(await reserve(701),false); // 100 charged + 200 headroom.
      assert.equal(await reserve(700),true);
      assert.equal(await reserve(800,now+86400000),true);
    } finally { await store.close(); }
  });
}
