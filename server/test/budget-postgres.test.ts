import {test,after} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresStore} from '../src/db-postgres.ts';
import {BUDGET_POLICY} from '../src/budget-policy.ts';
import type {BudgetControl} from '../src/budget-policy.ts';
import type {RunTransaction,Transaction,Row} from '../src/billing-sql.ts';

const raw=process.env.TEST_POSTGRES_URL;
if(!raw) test('PostgreSQL budget cross-pool integration requires TEST_POSTGRES_URL',{skip:true},()=>{});
else {
  const url=new URL(raw);
  // This stress/connection-fault suite must never target a hosted or production database.
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/i.test(url.pathname))throw new Error('Local throwaway test database required');
  const schema='budget_concurrency_'+randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:raw,ssl:false});
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options',`-c search_path=${schema} -c statement_timeout=15000 -c lock_timeout=5000`);
  const stores=[new PostgresStore(url.toString(),false),new PostgresStore(url.toString(),false)];
  const inspect=new pg.Pool({connectionString:url.toString(),ssl:false});
  after(async()=>{await Promise.all(stores.map(s=>s.close()));await inspect.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  await Promise.all(stores.map(s=>s.getAccount('schema-warmup')));
  const users=await Promise.all(Array.from({length:32},(_,i)=>stores[i%2]!.registerDevice({platform:'test',appVersion:'3',trialQuestions:30})));
  const reserve=(i:number,id:string,scope:string,channel='model-a',now=Date.now(),amount=100,limit=10000,guarded=true)=>
    stores[i%2]!.billing.reserveBudget(users[i]!.token,id,scope,'USD',amount,limit,86400000,now,0,guarded,channel);
  const settled=(results:PromiseSettledResult<boolean>[])=>results.flatMap((r,i)=>r.status==='fulfilled'&&r.value?[i]:[]);
  const control=async(scope:string)=>JSON.parse((await inspect.query('SELECT metadata FROM budget_controls WHERE channel=$1',[JSON.stringify([scope,'USD','model-a'])])).rows[0].metadata) as BudgetControl;
  const window=async(scope:string)=>(await inspect.query('SELECT spent_micros,held_micros FROM budget_windows WHERE scope=$1',[scope])).rows[0];

  test('PostgreSQL: two independent pools use distinct backend connections',async()=>{
    const clients=await Promise.all(stores.map(s=>(s as unknown as {pool:pg.Pool}).pool.connect()));
    try {const rows=await Promise.all(clients.map(c=>c.query('SELECT pg_backend_pid() AS pid')));assert.notEqual(rows[0]!.rows[0].pid,rows[1]!.rows[0].pid);}
    finally{clients.forEach(c=>c.release());}
  });
  test('PostgreSQL: 20 rounds of 32 budget admissions are independent of throughput across pools',async()=>{
    for(let round=0;round<20;round++){
      const scope=randomUUID(),ids=users.map(()=>randomUUID());
      const results=await Promise.allSettled(users.map((_,i)=>reserve(i,ids[i]!,scope)));
      const accepted=settled(results);assert.equal(accepted.length,32);
      for(const r of results)if(r.status==='rejected')assert.equal(r.reason.reason,'busy');
      assert.equal(Number((await window(scope)).held_micros),3200);
      await Promise.all(accepted.map(i=>stores[(i+1)%2]!.billing.settleBudget(users[i]!.token,ids[i]!,20)));
      assert.equal(Number((await window(scope)).spent_micros),640);assert.equal(Number((await window(scope)).held_micros),0);
    }
  });
  test('PostgreSQL: shared daily balance rejects oversubscription before concurrency limit',async()=>{
    const scope=randomUUID(),ids=users.map(()=>randomUUID());
    const results=await Promise.allSettled(users.map((_,i)=>reserve(i,ids[i]!,scope,'model-a',Date.now(),100,350)));
    const accepted=settled(results);assert.equal(accepted.length,2);
    assert.ok(results.every(r=>r.status==='fulfilled'));assert.equal(Number((await window(scope)).held_micros),200);
    await Promise.all(accepted.map(i=>stores[i%2]!.billing.releaseBudget(users[i]!.token,ids[i]!)));
  });
  test('PostgreSQL: fixed-mode admission also atomically enforces budget',async()=>{
    const scope=randomUUID(),ids=users.map(()=>randomUUID());
    const results=await Promise.allSettled(users.map((_,i)=>reserve(i,ids[i]!,scope,'model-a',Date.now(),100,350,false)));
    const accepted=settled(results);assert.equal(accepted.length,3);
    assert.ok(results.every(r=>r.status==='fulfilled'));
    await Promise.all(accepted.map(i=>stores[i%2]!.billing.releaseBudget(users[i]!.token,ids[i]!)));
  });
  test('PostgreSQL: concurrent settlement, release and reconciliation never double-book',async()=>{
    const scope=randomUUID(),id=randomUUID();await reserve(0,id,scope);
    await Promise.all(Array.from({length:32},(_,i)=>stores[i%2]!.billing.settleBudget(users[0]!.token,id,null)));
    assert.equal(Number((await window(scope)).spent_micros),100);
    await Promise.all(Array.from({length:32},(_,i)=>stores[i%2]!.billing.releaseBudget(users[0]!.token,id)));
    const results=await Promise.all(Array.from({length:32},(_,i)=>stores[i%2]!.billing.reconcileBudget(id,25,'vendor:'+id)));
    assert.ok(results.every(Boolean));assert.equal(Number((await window(scope)).spent_micros),25);
    assert.equal(Number((await window(scope)).held_micros),0);
    assert.equal(await stores[1]!.billing.reconcileBudget(id,0,'conflict:'+id),false);
  });
  test('PostgreSQL: unknown costs remain booked while healthy requests are not blocked by throughput accounting',async()=>{
    const scope=randomUUID();
    for(let i=0;i<3;i++){const id=randomUUID();await reserve(i,id,scope);await stores[i%2]!.billing.settleBudget(users[i]!.token,id,null);}
    const c=await control(scope),ids=users.map(()=>randomUUID());assert.equal(c.blockedUntil,0);assert.equal(c.failures,3);
    const results=await Promise.allSettled(users.map((_,i)=>reserve(i,ids[i]!,scope)));
    const accepted=settled(results);assert.equal(accepted.length,32);
    for(const r of results)if(r.status==='rejected')assert.equal(r.reason.reason,'busy');
    await Promise.all(accepted.map(i=>stores[(i+1)%2]!.billing.settleBudget(users[i]!.token,ids[i]!,20)));
    assert.equal(Number((await window(scope)).spent_micros),940);assert.equal(Number((await window(scope)).held_micros),0);
    assert.equal((await control(scope)).blockedUntil,0);
    const next=randomUUID();assert.equal(await reserve(0,next,scope),true);await stores[0]!.billing.releaseBudget(users[0]!.token,next);
  });
  test('PostgreSQL: cost protection isolates model channel; repeated reset does not clear new incident',async()=>{
    const scope=randomUUID(),id=randomUUID();await reserve(0,id,scope);await stores[0]!.billing.settleBudget(users[0]!.token,id,150);
    await assert.rejects(reserve(1,randomUUID(),scope),{reason:'guard_tripped'});
    const other=randomUUID();assert.equal(await reserve(1,other,scope,'model-b'),true);await stores[1]!.billing.releaseBudget(users[1]!.token,other);
    const c=await control(scope),evidence='review:'+id;
    await Promise.all(stores.map(s=>s.billing.resetBudgetControl(c.channel,evidence)));
    const again=randomUUID();await reserve(0,again,scope);await stores[0]!.billing.settleBudget(users[0]!.token,again,150);
    await stores[1]!.billing.resetBudgetControl(c.channel,evidence);
    await assert.rejects(reserve(1,randomUUID(),scope),{reason:'guard_tripped'});
  });
  test('PostgreSQL: 20 overlapping reaper/settlement/admission rounds do not deadlock or lose holds',async()=>{
    for(let round=0;round<20;round++){
      const scope=randomUUID(),ids=Array.from({length:4},()=>randomUUID());
      for(let i=0;i<4;i++){
        await reserve(i,ids[i]!,scope,'model-a',Date.now()-BUDGET_POLICY.orphanMs-1);
        const captureId=randomUUID();await stores[i%2]!.billing.beginWithAttempt({token:users[i]!.token,captureId,requestHmac:randomUUID(),leaseMs:-1},
          {attemptId:ids[i]!,captureId,purpose:'answer',provider:'test',model:'a',policyVersion:'p',currency:'USD',pricingVersion:'p'});
      }
      const next=randomUUID();
      const results=await Promise.allSettled([
        stores[0]!.billing.reap(),stores[1]!.billing.reap(),
        ...ids.map((id,i)=>stores[i%2]!.billing.finishAttemptAndBudget(users[i]!.token,id,{status:'failed',inputTokens:null,outputTokens:null,costMicros:null},null)),
        reserve(5,next,scope,'model-b'),
      ]);
      for(const [i,r] of results.entries()) if(r.status==='rejected'){
        assert.equal(i,6);assert.equal(r.reason.reason,'busy');
      }
      await stores[1]!.billing.releaseBudget(users[5]!.token,next);
      const w=await window(scope);assert.equal(Number(w.spent_micros),400);assert.equal(Number(w.held_micros),0);
      for(let i=0;i<4;i++)assert.equal((await stores[i%2]!.getAccount(users[i]!.token))!.balanceQuestions,30);
    }
  });
  test('PostgreSQL: cold instances reuse the applied schema without requesting table DDL locks',async()=>{
    const reader=await inspect.connect(),cold=new PostgresStore(url.toString(),false);
    try{await reader.query('BEGIN');await reader.query('SELECT id FROM devices LIMIT 1');
      const start=Date.now();const account=await cold.getAccount(users[0]!.token);
      assert.equal(account!.balanceQuestions,30);assert.ok(Date.now()-start<2000);
    }finally{await reader.query('ROLLBACK');reader.release();await cold.close();}
  });
  test('PostgreSQL: transaction-local deadlines release an abandoned worker lock without clearing its ledger',{timeout:22000},async()=>{
    const run=(stores[0] as unknown as {tx:<T>(f:(c:pg.PoolClient)=>Promise<T>)=>Promise<T>}).tx.bind(stores[0]);
    await assert.rejects(run(async client=>{
      const settings=(await client.query("SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock,current_setting('idle_in_transaction_session_timeout') AS idle")).rows[0];
      assert.deepEqual(settings,{statement:'15s',lock:'5s',idle:'15s'});
      await client.query('SELECT id FROM devices WHERE id=$1 FOR UPDATE',[users[0]!.id]);
      await delay(16000);await client.query('SELECT 1');
    }));
    assert.equal((await stores[1]!.getAccount(users[0]!.token))!.balanceQuestions,30);
  });
  test('PostgreSQL: idle backend loss is handled and the pool replaces its connection',async()=>{
    const pool=(stores[0] as unknown as {pool:pg.Pool}).pool;
    const client=await pool.connect();const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const lost=new Promise<void>(resolve=>pool.once('error',()=>resolve()));
    client.release();await inspect.query('SELECT pg_terminate_backend($1)',[pid]);await lost;
    assert.equal((await stores[0]!.getAccount(users[0]!.token))!.balanceQuestions,30);
  });
  test('PostgreSQL: transaction backend termination rolls back both accounting and attempt metadata',async()=>{
    const scope=randomUUID(),id=randomUUID(),captureId=randomUUID(),billing=stores[0]!.billing;
    await reserve(0,id,scope);await billing.beginWithAttempt({token:users[0]!.token,captureId,requestHmac:'terminate'},
      {attemptId:id,captureId,purpose:'answer',provider:'test',model:'a',policyVersion:'p',currency:'USD',pricingVersion:'p'});
    const internal=billing as unknown as {run:RunTransaction},run=internal.run;
    internal.run=<T>(tx:Transaction<T>)=>run((function*():Transaction<T>{
      let rows:Row[]=[];
      while(true){const step=tx.next(rows);if(step.done)return step.value;
        rows=yield step.value;
        if(step.value.sql.startsWith('UPDATE budget_windows SET held_micros=held_micros-?,spent_micros=')){
          // Terminate this real backend after its writes but before COMMIT.
          yield {sql:'SELECT pg_terminate_backend(pg_backend_pid())',args:[]};
        }
      }
    })());
    try{await assert.rejects(billing.finishAttemptAndBudget(users[0]!.token,id,{status:'failed',inputTokens:null,outputTokens:null,costMicros:null},null));}
    finally{internal.run=run;}
    assert.equal(Number((await window(scope)).spent_micros),0);assert.equal(Number((await window(scope)).held_micros),100);
    assert.equal((await stores[1]!.billing.attempts(users[0]!.token)).find(a=>a.attemptId===id)!.status,'running');
    await stores[1]!.billing.finishAttemptAndBudget(users[0]!.token,id,{status:'failed',inputTokens:null,outputTokens:null,costMicros:null},null);
    assert.equal(Number((await window(scope)).spent_micros),100);
    await stores[1]!.billing.finish({token:users[0]!.token,captureId,charge:false,terminalState:'failed'});
  });
}
