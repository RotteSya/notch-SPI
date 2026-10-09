import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/db-sqlite.ts';
import { MemoryStore } from '../src/db-memory.ts';
import { FIXED_TRIAL_POLICY, RequestKeys } from '../src/billing.ts';
import type { Store } from '../src/db.ts';
import type { RunTransaction, Transaction, Row } from '../src/billing-sql.ts';

const implementations: Array<[string, () => Store | Promise<Store>]> = [
  ['memory', () => new MemoryStore()], ['sqlite', () => new SqliteStore(':memory:')],
];
if (process.env.TEST_POSTGRES_URL) {
  const url = new URL(process.env.TEST_POSTGRES_URL);
  if (!/test/i.test(url.pathname)) throw new Error('Billing tests require an isolated database named test');
  const { PostgresStore, resolvePostgresSSL } = await import('../src/db-postgres.ts');
  const pg = (await import('pg')).default;
  const admin = new pg.Pool({ connectionString: url.toString(), ssl: resolvePostgresSSL({ connectionString: url.toString() }) });
  const schema = 'billing_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', '-c search_path=' + schema);
  const connection = url.toString(), ssl = resolvePostgresSSL({ connectionString: connection });
  after(async () => { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  implementations.push(['postgres', async () => {
    const store = new PostgresStore(connection, ssl);
    await store.getAccount('__test_schema__');
    await admin.query(`TRUNCATE ${schema}.devices, ${schema}.budget_windows, ${schema}.attempt_budget_holds, ${schema}.rate_limit_buckets RESTART IDENTITY CASCADE`);
    return store;
  }]);
}

for (const [name,make] of implementations) {
  test(`${name}: combined attempt and budget completion is isolated, conservative and idempotent`, async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const other=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      for(const actual of [25,90,null] as const) {
        const captureId=randomUUID(),attemptId=randomUUID(),scope=randomUUID();
        await store.billing.beginWithAttempt({token,captureId,requestHmac:scope},{attemptId,captureId,purpose:'answer',provider:'test',model:'m',policyVersion:'p',currency:'CNY',pricingVersion:'p'});
        assert.equal(await store.billing.reserveBudget(token,attemptId,scope,'CNY',40,100),true);
        const result={status:'succeeded' as const,inputTokens:10,outputTokens:2,costMicros:actual?.toString()??null};
        await store.billing.finishAttemptAndBudget(other.token,attemptId,result,0);
        await store.billing.finishAttemptAndBudget('missing',attemptId,result,0);
        assert.equal((await store.billing.attempts(token)).find(a=>a.attemptId===attemptId)?.status,'running');
        const probe=randomUUID();assert.equal(await store.billing.reserveBudget(token,probe,scope,'CNY',61,100),false);
        await Promise.all(Array.from({length:10},()=>store.billing.finishAttemptAndBudget(token,attemptId,result,actual)));
        await store.billing.finishAttemptAndBudget(token,attemptId,{...result,status:'failed',costMicros:'0'},0);
        await store.billing.releaseBudget(token,attemptId);
        const attempt=(await store.billing.attempts(token)).find(a=>a.attemptId===attemptId)!;
        assert.equal(attempt.status,'succeeded');assert.equal(attempt.costMicros,result.costMicros);assert.equal(attempt.inputTokens,10);
        const remaining=100-(actual??40);
        assert.equal(await store.billing.reserveBudget(token,probe,scope,'CNY',remaining+1,100),false);
        assert.equal(await store.billing.reserveBudget(token,probe,scope,'CNY',remaining,100),true);
        await store.billing.releaseBudget(token,probe);
        await store.billing.finish({token,captureId,charge:false,terminalState:'failed'});
      }
      assert.equal((await store.billing.quota(token))?.balanceQuestions,30);
    }finally{await store.close();}
  });
  if(name!=='memory')test(`${name}: an interrupted budget write rolls back attempt metadata and cost revision`,async()=>{
    const store=await make();
    const billing=store.billing as typeof store.billing & {run:RunTransaction},run=billing.run;
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const captureId=randomUUID(),attemptId=randomUUID(),scope=randomUUID();
      await billing.beginWithAttempt({token,captureId,requestHmac:scope},{attemptId,captureId,purpose:'answer',provider:'test',model:'m',policyVersion:'p',currency:'CNY',pricingVersion:'p'});
      await billing.reserveBudget(token,attemptId,scope,'CNY',40,100);
      let injected=false;
      billing.run=<T>(transaction:Transaction<T>)=>run((function*():Transaction<T>{
        let rows:Row[]=[];
        while(true){
          const step=transaction.next(rows);if(step.done)return step.value;
          if(step.value.sql.startsWith('UPDATE budget_windows SET held_micros=held_micros-?,spent_micros=')){
            injected=true;throw new Error('Injected budget write failure');
          }
          rows=yield step.value;
        }
      })());
      const result={status:'succeeded' as const,inputTokens:10,outputTokens:2,costMicros:'90'};
      await assert.rejects(()=>billing.finishAttemptAndBudget(token,attemptId,result,90),/Injected budget write failure/);
      billing.run=run;assert.equal(injected,true);
      const attempt=(await billing.attempts(token))[0]!;assert.equal(attempt.status,'running');assert.equal(attempt.costMicros,null);
      const probe=randomUUID();assert.equal(await billing.reserveBudget(token,probe,scope,'CNY',61,100),false);
      assert.equal(await billing.reserveBudget(token,probe,scope,'CNY',60,100),true);await billing.releaseBudget(token,probe);
      await billing.finishAttemptAndBudget(token,attemptId,result,90);
      assert.equal((await billing.attempts(token))[0]?.costMicros,'90');
      assert.equal(await billing.reserveBudget(token,randomUUID(),scope,'CNY',11,100),false);
      const last=randomUUID();assert.equal(await billing.reserveBudget(token,last,scope,'CNY',10,100),true);
    }finally{billing.run=run;await store.close();}
  });
  test(`${name}: capture and model attempt are admitted together exactly once`, async () => {
    const store = await make();
    try {
      const {token} = await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30});
      const captureId=randomUUID(),input={token,captureId,requestHmac:'atomic',exclusive:true};
      const attempt={attemptId:randomUUID(),captureId,purpose:'answer' as const,provider:'test',model:'test',policyVersion:'test',currency:'CNY',pricingVersion:'test'};
      const results=await Promise.all(Array.from({length:10},()=>store.billing.beginWithAttempt(input,attempt)));
      assert.equal(results.filter(r=>r.ok).length,1);
      assert.equal(results.filter(r=>!r.ok&&r.reason==='capture_in_progress').length,9);
      const attempts=await store.billing.attempts(token);assert.equal(attempts.length,1);
      assert.equal(attempts[0]?.attemptId,attempt.attemptId);assert.equal(attempts[0]?.status,'running');
      assert.equal((await store.billing.quota(token))?.balanceQuestions,29);
      assert.equal((await store.billing.quota(token))?.heldQuestions,1);
      const invalidId=randomUUID(),before=await store.billing.quota(token);
      await assert.rejects(async()=>store.billing.beginWithAttempt({...input,captureId:invalidId},{...attempt,attemptId:randomUUID()}),/binding mismatch/);
      await assert.rejects(async()=>store.billing.beginWithAttempt({...input,captureId:invalidId},{...attempt,captureId:invalidId,purpose:'recover',attemptId:randomUUID()}),/binding mismatch/);
      assert.equal(await store.billing.capture(token,invalidId),null);assert.deepEqual(await store.billing.quota(token),before);
    } finally {await store.close();}
  });
  test(`${name}: attempt insertion conflict rolls back solve and auxiliary admission`, async () => {
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30});
      const parent=randomUUID(),attempt={attemptId:randomUUID(),captureId:parent,purpose:'answer' as const,provider:'test',model:'test',policyVersion:'test',currency:'CNY',pricingVersion:'test'};
      assert.equal((await store.billing.beginWithAttempt({token,captureId:parent,requestHmac:'parent',inputHmac:'image'},attempt)).ok,true);
      await store.billing.finish({token,captureId:parent,charge:true,terminalState:'usable',answerHmac:'answer'});
      const quota=await store.billing.quota(token),parentBefore=await store.billing.capture(token,parent);
      for(const operation of ['solve','explain','recover'] as const){
        const id=randomUUID(),input={token,captureId:id,requestHmac:id,inputHmac:'image',operation,...(operation==='solve'?{}:{parentCaptureId:parent})};
        await assert.rejects(async()=>store.billing.beginWithAttempt(input,{...attempt,captureId:id,purpose:operation==='solve'?'answer':operation}));
        assert.equal(await store.billing.capture(token,id),null);
        assert.deepEqual(await store.billing.quota(token),quota);
        assert.deepEqual(await store.billing.capture(token,parent),parentBefore);
      }
      assert.equal((await store.billing.attempts(token)).length,1);
    } finally {await store.close();}
  });
  test(`${name}: cross-account attempt ID conflict cannot leave a second quota hold`, async () => {
    const store=await make();
    try {
      const accounts=await Promise.all([0,1].map(()=>store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30})));
      const attemptId=randomUUID(),inputs=accounts.map(a=>({token:a.token,captureId:randomUUID(),requestHmac:randomUUID()}));
      const results=await Promise.allSettled(inputs.map(input=>store.billing.beginWithAttempt(input,{attemptId,captureId:input.captureId,purpose:'answer',provider:'test',model:'test',policyVersion:'test',currency:'CNY',pricingVersion:'test'})));
      assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.ok).length,1);
      assert.equal(results.filter(r=>r.status==='rejected').length,1);
      for(let i=0;i<inputs.length;i++){
        const won=results[i]!.status==='fulfilled',input=inputs[i]!;
        assert.equal((await store.billing.quota(input.token))?.heldQuestions,won?1:0);
        assert.equal((await store.billing.quota(input.token))?.balanceQuestions,won?29:30);
        assert.equal((await store.billing.attempts(input.token)).length,won?1:0);
        assert.equal((await store.billing.capture(input.token,input.captureId))!==null,won);
      }
    } finally {await store.close();}
  });
  test(`${name}: settlement returns a matching immutable capture/account snapshot and charges once`, async () => {
    const store = await make();
    try {
      const {token} = await store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30});
      const captureId = randomUUID();
      await store.billing.begin({token, captureId, requestHmac: 'snapshot'});
      const input = {token, captureId, charge: true, terminalState: 'usable' as const,
        answerHmac: 'answer', inputTokens: 11, outputTokens: 7, resultState: 'ready', questionKind: 'short_fill'};
      const results = await Promise.all(Array.from({length: 10}, () => store.billing.finishWithCapture(input)));
      for (const result of results) {
        assert.ok(result?.capture);
        assert.equal(result.capture.captureId, captureId);
        assert.equal(result.capture.settlementStatus, 'settled');
        assert.equal(result.capture.usableResult, true);
        assert.equal(result.capture.answerHmac, 'answer');
        assert.equal(result.account.balanceQuestions, 29);
        assert.equal(result.account.heldQuestions, 0);
        assert.equal(result.account.totalQuestions, 1);
        assert.equal(result.account.totalInputTokens, 11);
        assert.equal(result.account.totalOutputTokens, 7);
      }
      assert.deepEqual(results[0]?.capture, await store.billing.capture(token, captureId));
      assert.deepEqual(results[0]?.account, await store.billing.accountSnapshot(token));
      results[0]!.capture!.answerHmac = 'mutated';
      results[0]!.account.quotaBreakdown.trial = 999;
      assert.equal((await store.billing.capture(token, captureId))?.answerHmac, 'answer');
      assert.equal((await store.billing.accountSnapshot(token))?.quotaBreakdown.trial, 29);
    } finally { await store.close(); }
  });
  test(`${name}: settlement snapshot preserves account isolation, failure refunds and expired leases`, async () => {
    const store = await make();
    try {
      const a = await store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30});
      const b = await store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30});
      const captureId = randomUUID(), input = {token: a.token, captureId, charge: false, terminalState: 'failed' as const};
      await store.billing.begin({token: a.token, captureId, requestHmac: 'failure'});
      assert.equal(await store.billing.finishWithCapture({...input, token: 'missing'}), null);
      const foreign = await store.billing.finishWithCapture({...input, token: b.token});
      assert.equal(foreign?.capture, null); assert.equal(foreign?.account.balanceQuestions, 30);
      assert.equal((await store.billing.capture(a.token, captureId))?.settlementStatus, 'held');
      const failed = await store.billing.finishWithCapture(input);
      assert.equal(failed?.capture?.settlementStatus, 'released');
      assert.equal(failed?.account.balanceQuestions, 30);
      const duplicate = await store.billing.finishWithCapture({...input, charge: true, terminalState: 'usable'});
      assert.deepEqual(duplicate, failed);
      const expiredId = randomUUID();
      await store.billing.begin({token: a.token, captureId: expiredId, requestHmac: 'expired', leaseMs: -1});
      const expired = await store.billing.finishWithCapture({...input, captureId: expiredId, charge: true, terminalState: 'usable'});
      assert.equal(expired?.capture?.terminalState, 'failed');
      assert.equal(expired?.capture?.usableResult, false);
      assert.equal(expired?.account.balanceQuestions, 30);
      assert.equal(expired?.account.totalQuestions, 0);
    } finally { await store.close(); }
  });
  test(`${name}: settlement snapshot expires answer metadata just like capture lookup`, async () => {
    const store = await make(), realNow = Date.now;
    try {
      const {token} = await store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30});
      const captureId = randomUUID(), input = {token, captureId, charge: true, terminalState: 'usable' as const, answerHmac: 'answer'};
      await store.billing.begin({token, captureId, requestHmac: 'expiry'});
      const settled = await store.billing.finishWithCapture(input);
      assert.equal(settled?.capture?.answerHmac, 'answer');
      const later = realNow() + 900_001; Date.now = () => later;
      const expired = await store.billing.finishWithCapture(input);
      assert.equal(expired?.capture?.answerHmac, null);
      assert.equal((await store.billing.capture(token, captureId))?.answerHmac, null);
      assert.equal(expired?.account.totalQuestions, 1);
    } finally { Date.now = realNow; await store.close(); }
  });
  test(`${name}: CNY cap is shared across devices and resets only at Shanghai midnight`, async () => {
    const store = await make();
    try {
      const accounts = await Promise.all(Array.from({length: 4}, () => store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30})));
      const midnight = Date.parse('2026-09-08T16:00:00.000Z');
      const reserve = (token: string, now: number, amount = 1_000_000) => store.billing.reserveBudget(token,
        randomUUID(), 'official', 'CNY', amount, 20_000_000, 86_400_000, now, 480);
      const holds = await Promise.all(Array.from({length: 25}, (_, i) => reserve(accounts[i % 4]!.token, midnight - 1)));
      assert.equal(holds.filter(Boolean).length, 20);
      assert.equal(await reserve(accounts[0]!.token, midnight - 1, 1), false);
      assert.equal(await reserve(accounts[0]!.token, midnight, 20_000_000), true);
      assert.equal(await reserve(accounts[1]!.token, midnight + 1, 1), false);
    } finally { await store.close(); }
  });
  test(`${name}: original and recovered answers share one transactional explanation slot`, async () => {
    const store = await make();
    try {
      const {token} = await store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30});
      const parent = randomUUID(), recovery = randomUUID();
      await store.billing.begin({token, captureId: parent, requestHmac: 'parent', inputHmac: 'same-material'});
      await store.billing.finish({token, captureId: parent, charge: true, terminalState: 'usable', answerHmac: 'answer-b'});
      await store.billing.begin({token, captureId: recovery, parentCaptureId: parent, operation: 'recover', requestHmac: 'recovery', inputHmac: 'same-material'});
      await store.billing.finish({token, captureId: recovery, charge: false, terminalState: 'usable', answerHmac: 'answer-c'});
      const requests = Array.from({length: 20}, (_, i) => ({token, captureId: randomUUID(), parentCaptureId: parent,
        operation: 'explain' as const, requestHmac: 'explanation-' + i, answerCaptureId: i % 2 ? parent : recovery}));
      const results = await Promise.all(requests.map(request => store.billing.begin(request)));
      assert.equal(results.filter(result => result.ok).length, 1);
      const winner = results.findIndex(result => result.ok), chosen = requests[winner]!;
      const explanation = await store.billing.capture(token, chosen.captureId);
      assert.equal(explanation?.parentCaptureId, parent); assert.equal(explanation?.answerCaptureId, chosen.answerCaptureId);
      assert.equal((await store.billing.capture(token, parent))?.explanationCaptureId, chosen.captureId);
      const changedAnswer = await store.billing.begin({...chosen, answerCaptureId: chosen.answerCaptureId === parent ? recovery : parent});
      assert.equal(!changedAnswer.ok && changedAnswer.reason, 'idempotency_conflict');
      await store.billing.finish({token, captureId: chosen.captureId, charge: false, terminalState: 'failed'});
      for (const answerCaptureId of [parent, recovery]) {
        const retry = await store.billing.begin({...chosen, captureId: randomUUID(), answerCaptureId});
        assert.equal(!retry.ok && retry.reason, 'capture_already_finalized');
      }
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 29);
      assert.equal((await store.getAccount(token))?.totalQuestions, 1);
    } finally { await store.close(); }
  });

  test(`${name}: failed pending unrelated or mismatched recovery cannot select an explanation answer`, async () => {
    const store = await make();
    try {
      const {token} = await store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30});
      for (const kind of ['pending', 'failed', 'mismatched', 'unrelated']) {
        const parent = randomUUID(), recovery = randomUUID(), other = randomUUID();
        for (const captureId of [parent, other]) {
          await store.billing.begin({token, captureId, requestHmac: captureId, inputHmac: 'material'});
          await store.billing.finish({token, captureId, charge: true, terminalState: 'usable', answerHmac: 'answer-b'});
        }
        await store.billing.begin({token, captureId: recovery, parentCaptureId: kind === 'unrelated' ? other : parent,
          operation: 'recover', requestHmac: recovery, inputHmac: kind === 'mismatched' ? 'wrong-material' : 'material'});
        if (kind !== 'pending') await store.billing.finish({token, captureId: recovery, charge: false,
          terminalState: kind === 'failed' ? 'failed' : 'usable', answerHmac: 'answer-c'});
        const denied = await store.billing.begin({token, captureId: randomUUID(), parentCaptureId: parent,
          operation: 'explain', requestHmac: 'denied', answerCaptureId: recovery});
        assert.equal(!denied.ok && denied.reason, 'idempotency_conflict', kind);
        assert.equal((await store.billing.capture(token, parent))?.explanationCaptureId, undefined);
      }
    } finally { await store.close(); }
  });

  test(`${name}: recovery never extends the billed parent's explanation deadline`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-08-01T00:00:00Z')});
    const store = await make();
    try {
      const {token} = await store.registerDevice({platform: 'macos', appVersion: 'test', trialQuestions: 30});
      const parent = randomUUID(), recovery = randomUUID();
      await store.billing.begin({token, captureId: parent, requestHmac: 'parent', inputHmac: 'material'});
      await store.billing.finish({token, captureId: parent, charge: true, terminalState: 'usable', answerHmac: 'answer-b'});
      t.mock.timers.tick(899_000);
      await store.billing.begin({token, captureId: recovery, parentCaptureId: parent, operation: 'recover', requestHmac: 'recover', inputHmac: 'material'});
      await store.billing.finish({token, captureId: recovery, charge: false, terminalState: 'usable', answerHmac: 'answer-c'});
      t.mock.timers.tick(1_000);
      const result = await store.billing.begin({token, captureId: randomUUID(), parentCaptureId: parent,
        operation: 'explain', requestHmac: 'too-late', answerCaptureId: recovery});
      assert.equal(!result.ok && result.reason, 'idempotency_conflict');
      assert.equal((await store.billing.capture(token, parent))?.explanationCaptureId, undefined);
      assert.equal((await store.billing.quota(token))?.balanceQuestions, 29);
    } finally { await store.close(); }
  });

  test(`${name}: registration response loss reuses identity and preserves current balance`,async()=>{
    const store:Store=await make();
    try {
      const keys=new RequestKeys(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1',false);
      for (let round=0;round<16;round++) {
        const identity=keys.registration(randomBytes(32).toString('base64url'));
        const register=()=>store.registerDevice({platform:'macos',appVersion:'test',trialQuestions:30,policyVersion:FIXED_TRIAL_POLICY.version,...identity});
        const devices=await Promise.all(Array.from({length:8},register));
        assert.equal(new Set(devices.map(d=>d.id)).size,1);
        const d=devices[0]!;
        const id=randomUUID();await store.billing.begin({token:d.token,captureId:id,requestHmac:'same'});
        await store.billing.finish({token:d.token,captureId:id,charge:true,terminalState:'usable'});
        assert.equal((await register()).balanceQuestions,29);
        assert.equal((await store.billing.quota(d.token))?.initialGrantQuestions,30);
      }
    }finally{await store.close();}
  });
  test(`${name}: a registration conflict cannot rebind credentials or grant another trial`,async()=>{
    const store=await make();
    try {
      const keys=new RequestKeys(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1',false);
      const first=keys.registration(randomBytes(32).toString('base64url')),second=keys.registration(randomBytes(32).toString('base64url'));
      const base={platform:'macos',appVersion:'test',trialQuestions:30,policyVersion:FIXED_TRIAL_POLICY.version};
      const original=await store.registerDevice({...base,...first});
      await assert.rejects(store.registerDevice({...base,...first,token:second.token}),/Registration identity conflict/);
      await assert.rejects(store.registerDevice({...base,...second,token:first.token}),/Registration identity conflict/);
      assert.equal(await store.getAccount(second.token),null);
      assert.deepEqual(await store.registerDevice({...base,...first}),original);
      assert.equal((await store.billing.quota(first.token))?.initialGrantQuestions,30);
    }finally{await store.close();}
  });
  test(`${name}: one final question, duplicate IDs, conflicting bodies and idempotent terminal states`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:1});
      const id=randomUUID();
      const holds=await Promise.all(Array.from({length:12},()=>store.billing.begin({token,captureId:id,requestHmac:'a'})));
      assert.equal(holds.filter(h=>h.ok).length,1);
      assert.deepEqual((await store.billing.quota(token))?.quotaBreakdown,{trial:0,paid:0,goodwill:0,legacy_unknown:0});
      const conflict=await store.billing.begin({token,captureId:id,requestHmac:'b'});assert.equal(!conflict.ok&&conflict.reason,'idempotency_conflict');
      await store.billing.finish({token,captureId:id,charge:true,terminalState:'usable',inputTokens:20,outputTokens:5});
      await Promise.all(Array.from({length:5},()=>store.billing.finish({token,captureId:id,charge:false,terminalState:'failed'})));
      assert.equal((await store.getAccount(token))?.totalQuestions,1);
      assert.equal((await store.billing.quota(token))?.balanceQuestions,0);
      assert.equal((await store.billing.quota(token))?.balanceVersion,'3');
      const again=await store.billing.begin({token,captureId:id,requestHmac:'a'});assert.equal(!again.ok&&again.reason,'capture_already_finalized');
      assert.equal(await store.billing.capture('dev_unknown',id),null);
    }finally{await store.close();}
  });
  test(`${name}: expired holds converge and a delayed callback cannot charge them`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const id=randomUUID();await store.billing.begin({token,captureId:id,requestHmac:'a',leaseMs:1});
      assert.equal(await store.billing.reap(new Date(Date.now()+1000).toISOString()),1);
      assert.equal(await store.billing.reap(new Date(Date.now()+1000).toISOString()),0);
      await store.billing.finish({token,captureId:id,charge:true,terminalState:'usable'});
      assert.equal((await store.getAccount(token))?.balanceQuestions,30);
      assert.equal((await store.getAccount(token))?.totalQuestions,0);
    }finally{await store.close();}
  });
  test(`${name}: failed attempts persist unknown usage and cost independently of billing`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const captureId=randomUUID(),attemptId=randomUUID();await store.billing.begin({token,captureId,requestHmac:'a'});
      assert.equal(await store.billing.startAttempt(token,{attemptId,captureId,purpose:'answer',provider:'test',model:'m',policyVersion:'p',currency:'USD',pricingVersion:'unknown'}),true);
      assert.equal(await store.billing.startAttempt(token,{attemptId:randomUUID(),captureId,purpose:'answer',provider:'test',model:'m',policyVersion:'p',currency:'USD',pricingVersion:'unknown'}),false);
      await store.billing.finishAttempt(token,attemptId,{status:'failed',inputTokens:null,outputTokens:null,costMicros:null});
      await store.billing.finish({token,captureId,charge:false,terminalState:'failed'});
      const attempts=await store.billing.attempts(token);
      assert.equal(attempts.length,1);assert.equal(attempts[0]?.costMicros,null);assert.equal(attempts[0]?.inputTokens,null);
      assert.equal((await store.getAccount(token))?.balanceQuestions,30);
    }finally{await store.close();}
  });
  test(`${name}: trial and paid lots remain distinct; a duplicate payment never credits twice`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const purchase={token,questions:100,amountCents:300,currency:'JPY',provider:'stripe',reference:'cs_unique'};
      await Promise.all([store.credit(purchase),store.credit(purchase)]);
      const id=randomUUID();await store.billing.begin({token,captureId:id,requestHmac:'a'});
      await store.billing.finish({token,captureId:id,charge:true,terminalState:'usable'});
      assert.deepEqual((await store.billing.quota(token))?.quotaBreakdown,{trial:29,paid:100,goodwill:0,legacy_unknown:0});
      assert.equal((await store.billing.quota(token))?.balanceQuestions,129);
      assert.equal((await store.listRecentTopups(10)).length,1);
    }finally{await store.close();}
  });
  test(`${name}: daily budget reservations are atomic and unknown cost consumes the reserved upper bound`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const first=randomUUID(), second=randomUUID();
      assert.equal(await store.billing.reserveBudget(token,first,'mock:m','USD',80,100),true);
      assert.equal(await store.billing.reserveBudget(token,second,'mock:m','USD',30,100),false);
      await store.billing.settleBudget(token,first,null);
      assert.equal(await store.billing.reserveBudget(token,second,'mock:m','USD',30,100),false);
      await store.billing.releaseBudget(token,first);
      assert.equal(await store.billing.reserveBudget(token,second,'mock:m','USD',30,100),false);
    }finally{await store.close();}
  });
  test(`${name}: actual budget overruns remain accounted and terminal callbacks cannot free them`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const id=randomUUID();
      assert.equal(await store.billing.reserveBudget(token,id,'overrun','CNY',40,100),true);
      await store.billing.settleBudget(token,id,90);
      await store.billing.settleBudget(token,id,0);
      await store.billing.releaseBudget(token,id);
      assert.equal(await store.billing.reserveBudget(token,randomUUID(),'overrun','CNY',11,100),false);
      assert.equal(await store.billing.reserveBudget(token,randomUUID(),'overrun','CNY',10,100),true);
      assert.equal((await store.billing.quota(token))?.balanceQuestions,30);
    }finally{await store.close();}
  });
  test(`${name}: an overrun past the entire budget stops further attempts`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const id=randomUUID();
      assert.equal(await store.billing.reserveBudget(token,id,'exhausted','CNY',40,100),true);
      await store.billing.settleBudget(token,id,150);
      assert.equal(await store.billing.reserveBudget(token,randomUUID(),'exhausted','CNY',1,100),false);
    }finally{await store.close();}
  });
  test(`${name}: recovery worker death grants one compensation; a late callback cannot remove it`,async()=>{
    const store=await make();
    try {
      const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const parent=randomUUID(), child=randomUUID(), attemptId=randomUUID();
      await store.billing.begin({token,captureId:parent,requestHmac:'parent'});
      await store.billing.finish({token,captureId:parent,charge:true,terminalState:'usable',answerHmac:'parent-answer'});
      await store.billing.begin({token,captureId:child,parentCaptureId:parent,operation:'recover',requestHmac:'child',leaseMs:1});
      await store.billing.startAttempt(token,{attemptId,captureId:child,purpose:'recover',provider:'test',model:'m',policyVersion:'p',currency:'CNY',pricingVersion:'p'});
      assert.equal(await store.billing.reap(new Date(Date.now()+1000).toISOString()),1);
      assert.equal(await store.billing.reap(new Date(Date.now()+1000).toISOString()),0);
      await store.billing.finish({token,captureId:child,charge:false,terminalState:'usable',answerHmac:'late'});
      await store.billing.finish({token,captureId:child,charge:false,terminalState:'failed',compensateGoodwill:true});
      assert.equal((await store.billing.quota(token))?.balanceQuestions,30);
      assert.equal((await store.billing.quota(token))?.quotaBreakdown.goodwill,1);
      assert.equal((await store.getAccount(token))?.totalQuestions,1);
      assert.equal((await store.billing.capture(token,child))?.terminalReason,'lease_expired');
      assert.equal((await store.billing.capture(token,child))?.usableResult,false);
      assert.equal((await store.billing.attempts(token))[0]?.status,'unknown');
      assert.equal((await store.billing.attempts(token))[0]?.costMicros,null);
      const retry=await store.billing.begin({token,captureId:randomUUID(),parentCaptureId:parent,operation:'recover',requestHmac:'retry'});
      assert.equal(!retry.ok&&retry.reason,'capture_already_finalized');
    }finally{await store.close();}
  });
  test(`${name}: one device cannot free or settle another device's budget hold`,async()=>{
    const store=await make();
    try {
      const owner=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const other=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
      const id=randomUUID();
      assert.equal(await store.billing.reserveBudget(owner.token,id,'official','CNY',100,100),true);
      assert.equal(await store.billing.reserveBudget(other.token,id,'official','CNY',100,100),false);
      await store.billing.releaseBudget(other.token,id);
      await store.billing.settleBudget(other.token,id,0);
      assert.equal(await store.billing.reserveBudget(other.token,randomUUID(),'official','CNY',1,100),false);
      await store.billing.releaseBudget(owner.token,id);
      assert.equal(await store.billing.reserveBudget(other.token,randomUUID(),'official','CNY',100,100),true);
    }finally{await store.close();}
  });
}

test('sqlite: a transaction failure rolls back the request, hold, lot and ledger together',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nspi-billing-test-')),path=join(dir,'test.db');
  const store=new SqliteStore(path),probe=new DatabaseSync(path);
  try {
    const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
    probe.exec("CREATE TRIGGER inject_hold_failure BEFORE INSERT ON quota_ledger WHEN NEW.event='hold' BEGIN SELECT RAISE(ABORT,'injected'); END");
    const id=randomUUID();await assert.rejects(store.billing.begin({token,captureId:id,requestHmac:'a'}),/injected/);
    assert.equal((await store.getAccount(token))?.balanceQuestions,30);
    assert.equal(await store.billing.capture(token,id),null);
    assert.equal((await store.billing.quota(token))?.heldQuestions,0);
  }finally{probe.close();await store.close();rmSync(dir,{recursive:true,force:true});}
});

test('sqlite: restart releases old holds and migration preserves unclassified historical balances',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nspi-migrate-test-')),path=join(dir,'test.db');
  let store=new SqliteStore(path);const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:147});
  const id=randomUUID();await store.billing.begin({token,captureId:id,requestHmac:'a',leaseMs:1});await store.close();
  store=new SqliteStore(path);
  try {
    await store.billing.reap(new Date(Date.now()+1000).toISOString());
    assert.equal((await store.getAccount(token))?.balanceQuestions,147);
    const probe=new DatabaseSync(path);
    probe.exec('PRAGMA foreign_keys=ON');
    // An actual pre-migration row has no lots or registration policy, regardless of its balance.
    probe.prepare("INSERT INTO devices(token_hash,balance_questions,created_at,updated_at) VALUES (?,147,?,?)").run('legacy-hash',new Date().toISOString(),new Date().toISOString());
    const original=probe.prepare("SELECT balance_questions FROM devices WHERE token_hash='legacy-hash'").get();
    assert.equal(original?.balance_questions,147);probe.close();
  }finally{await store.close();rmSync(dir,{recursive:true,force:true});}
});

test('sqlite: balance versions round-trip beyond JavaScript safe integers',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nspi-version-test-')),path=join(dir,'test.db');
  const store=new SqliteStore(path),probe=new DatabaseSync(path);
  try {
    const {token}=await store.registerDevice({platform:'m',appVersion:'t',trialQuestions:30});
    probe.exec('UPDATE devices SET balance_version=9007199254740993');
    assert.equal((await store.billing.quota(token))?.balanceVersion,'9007199254740993');
    await store.billing.begin({token,captureId:randomUUID(),requestHmac:'version'});
    assert.equal((await store.billing.quota(token))?.balanceVersion,'9007199254740994');
  }finally{probe.close();await store.close();rmSync(dir,{recursive:true,force:true});}
});
