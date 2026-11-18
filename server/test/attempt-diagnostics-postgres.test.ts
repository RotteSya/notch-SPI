import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresStore} from '../src/db-postgres.ts';
import {AttemptTrace} from '../src/attempt-diagnostics.ts';

test('PostgreSQL: diagnostic settlement, usage and reaper preserve evidence across pools',
 {skip:!process.env.TEST_POSTGRES_URL},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/test/i.test(url.pathname))throw new Error('Local throwaway test database required');
  const admin=new pg.Pool({connectionString:url.toString(),ssl:false});
  const schema='diagnostics_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options','-c search_path='+schema);
  const stores=[new PostgresStore(url.toString(),false),new PostgresStore(url.toString(),false)];
  try{
   for(const s of stores)await s.getAccount('schema-warmup');
   for(let round=0;round<12;round++){
    const {token}=await stores[0]!.registerDevice({platform:'test',appVersion:'test',trialQuestions:3});
    const id=randomUUID(),captureId=randomUUID(),scope=randomUUID();
    const billing=stores[0]!.billing,other=stores[1]!.billing;
    await billing.reserveBudget(token,id,scope,'USD',100,10000);
    assert.equal((await billing.beginWithAttempt({token,captureId,requestHmac:'synthetic'},
     {attemptId:id,captureId,purpose:'answer',provider:'test',model:'fixture',policyVersion:'test',currency:'USD',pricingVersion:'test'})).ok,true);
    const proof={inputTokens:10,outputTokens:5,costMicros:25,source:'upstream_usage:'+id};
    const diagnostics=new AttemptTrace().finish('completed',20000);
    const completion={token,captureId,charge:true,terminalState:'usable' as const,
     attemptSettlement:{id,result:{status:'succeeded' as const,inputTokens:null,outputTokens:null,costMicros:null,diagnostics},actual:null,anomaly:false}};
    // Exercise both arrival orders, plus actual concurrent transactions on independent pools.
    if(round%3===0)await other.recordAttemptUsage(token,id,proof);
    if(round%3===1)await billing.finishWithCapture(completion);
    await Promise.all([billing.finishWithCapture(completion),other.recordAttemptUsage(token,id,proof),other.reap()]);
    await Promise.all([billing.reap(),other.reap(),other.finishWithCapture(completion)]);
    const attempt=(await billing.attempts(token))[0]!;
    assert.deepEqual(attempt.usageEvidence,proof);assert.equal(attempt.diagnostics?.outcome,'completed');
    assert.equal(attempt.diagnostics?.usageEvidencePersisted,true);
    assert.equal((await billing.quota(token))!.balanceQuestions,2);
    const w=(await billing.inspectBudget()).windows.find(w=>w.scope===scope)!;
    assert.equal(w.spent,25);assert.equal(w.held,0);
    await assert.rejects(other.recordAttemptUsage(token,id,{...proof,costMicros:999}));
    assert.deepEqual((await billing.attempts(token))[0]!.usageEvidence,proof);
   }
  }finally{
   await Promise.all(stores.map(s=>s.close()));await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
 });
