import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import http from 'node:http';import https from 'node:https';import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
let externalCalls=0;const deny=()=>{externalCalls++;throw new Error('Network forbidden in offline tests');};
globalThis.fetch=deny;http.get=http.request=https.get=https.request=deny;
net.connect=net.createConnection=net.Socket.prototype.connect=deny;syncBuiltinESMExports();
after(()=>assert.equal(externalCalls,0));
const {loadEffortPlan,runEffortPhase,readLedger,PHASE,CONFIGURATIONS,main}=await import('../run-cab-effort-screening.mjs');
const {ComparisonBudget}=await import('../lib/model-comparison-budget.mts');
const {buildRequest,buildCABEffortRequest,pairedSchedule,ComparisonFailure}=await import('../lib/model-comparison.mts');
const {createControlledTransport}=await import('../lib/model-comparison-transport.mts');
const {stats,summarize}=await import('../report-cab-effort-screening.mjs');
const {loadComparisonPlan}=await import('../run-model-comparison.mjs');
const frozen=loadEffortPlan();
test('read-only historical ledger checkpoint compares identically after JSON serialization',()=>{
  const ledger=readLedger();assert.deepEqual(ledger,JSON.parse(JSON.stringify(ledger)));
});
function setup(t,limit=3000000){
  const dir=mkdtempSync('/tmp/notchspi-cab-effort-');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'budget.sqlite3'),parent={campaignId:'offline-effort-test',limitMicros:10000000,rolling:true};
  const budget=new ComparisonBudget(path,parent,frozen.config.models);t.after(()=>budget.close());
  const policy={id:PHASE,limitMicros:limit,freezeSHA256:'a'.repeat(64),authorizationSHA256:'b'.repeat(64),
    baseOccupiedMicros:0,historicalDigest:budget.historyDigest(),maxPhysicalCalls:64,trials:frozen.trials.map(t=>({key:t.key,model:t.model}))};
  budget.registerPhase(policy);
  return {budget,policy,path,parent,plan:{...frozen,freezeSHA256:'a'.repeat(64)}};
}
const answer=label=>`FINAL: ${label}\nNSPI_RESULT_V1: ${JSON.stringify({v:1,kind:'single_choice',state:'ready',answer:label,reason:'none'})}`;
const succeed=async args=>{args.onDelta(answer(frozen.cases.find(q=>q.id===args.caseId).expected.accepted_answers[0]));return {usage:{inputTokens:100,outputTokens:50},finishReason:'stop',meteringComplete:true};};
test('default dry run has no transport; exact 32 balanced configuration trials',async()=>{
  const d=await main([]);assert.equal(d.paid_calls,0);assert.equal(d.trials.length,32);
  for(const id of ['F01','F02','F03','F04'])for(const c of CONFIGURATIONS)assert.equal(d.trials.filter(t=>t.caseId===id&&t.configuration===c).length,2);
  await assert.rejects(main(['--run-id','bypass']));
});
test('historical frozen runner fails closed after evaluation source changes; old freeze is not rewritten',()=>{
  assert.throws(()=>loadComparisonPlan(),/Artifact drift: scripts\/lib\/model-comparison\.mts/);
});
test('wire messages remain identical; only model and effort change; legacy duplicate guard survives',()=>{
  const input=frozen.inputFor(frozen.cases[3]),base=buildRequest('gpt-6-astra',input);
  for(const c of CONFIGURATIONS){
    const r=buildCABEffortRequest({kind:'cab_effort_screening_v1',configuration:c,round:1},input);
    assert.deepEqual({...r.body,model:null,reasoning_effort:null},{...base.body,model:null,reasoning_effort:null});
  }
  assert.throws(()=>buildCABEffortRequest({kind:'general',configuration:'terra-high',round:1},input));
  assert.throws(()=>buildCABEffortRequest({kind:'cab_effort_screening_v1',configuration:'terra-max',round:1},input));
  assert.throws(()=>pairedSchedule(frozen.cases,['gpt-6.1-terra','gpt-6.1-terra']));
});
test('non-low requests cannot use the legacy transport or resolve a credential',async()=>{
  let keys=0;const tr=createControlledTransport({assertAuthorized(){},credentialFor(){keys++;return 'not-a-real-key';},expectedModels:{}});
  const request=buildCABEffortRequest({kind:'cab_effort_screening_v1',configuration:'terra-high',round:1},frozen.inputFor(frozen.cases[0]));
  await assert.rejects(tr.invoke({model:'gpt-6.1-terra',request,signal:new AbortController().signal,onDelta(){},onUsage(){},onProgress(){}}),/effort_scope_mismatch/);
  assert.equal(keys,0);
});
test('all four controlled HTTP mappings stream through mocks only and retain reasoning as output subset',async t=>{
  const s=setup(t);let posts=0;
  const r=await runEffortPhase({...s,transportForTrial:trial=>createControlledTransport({assertAuthorized(){},credentialFor:()=> 'mock-only',
    expectedModels:{'gpt-6-astra':['gpt-6-astra'],'gpt-6.1-terra':['gpt-6.1-terra'],'deepseek-flash':[]},
    effortExperiment:{kind:'cab_effort_screening_v1',assertRequest(args){assert.equal(args.request.body.reasoning_effort,trial.effort);}},
    async fetchImpl(url,options){
      posts++;const body=JSON.parse(options.body);assert.equal(body.model,trial.model);assert.equal(body.reasoning_effort,trial.effort);
      const meta={model:trial.model,service_tier:'default'};
      const frames=[{...meta,choices:[{delta:{content:answer('A')},finish_reason:'stop'}]},
        {...meta,choices:[],usage:{prompt_tokens:100,completion_tokens:50,completion_tokens_details:{reasoning_tokens:10}}}];
      return new Response(frames.map(x=>`data: ${JSON.stringify(x)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    }})});
  assert.equal(posts,32);assert.equal(r.phase.unknownAttempts,0);
  assert.ok(r.attempts.every(a=>a.meteringComplete&&a.usage.outputTokens===50&&a.usage.details.reasoningOutputTokens===10));
});
test('new phase preserves existing paid history and cannot extend its checkpoint allowance',t=>{
  const dir=mkdtempSync('/tmp/notchspi-cab-history-');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const b=new ComparisonBudget(join(dir,'ledger'),{campaignId:'history',limitMicros:10000000,rolling:true},frozen.config.models);t.after(()=>b.close());
  b.reserve('old-call','old-question','gpt-6-astra','answer');b.observe('old-call',{inputTokens:2000,outputTokens:60});b.settleCompleteUsage('old-call');
  const prior=b.snapshot(),digest=b.historyDigest();
  const policy={id:PHASE,limitMicros:3000000,freezeSHA256:'a'.repeat(64),authorizationSHA256:'b'.repeat(64),baseOccupiedMicros:prior.occupiedMicros,
    historicalDigest:digest,maxPhysicalCalls:64,trials:frozen.trials.map(t=>({key:t.key,model:t.model}))};
  b.registerPhase(policy);assert.equal(b.historyDigest(),digest);assert.deepEqual(b.snapshot(),prior);
  assert.equal(b.phaseSnapshot(PHASE).remainingMicros,3000000);
  assert.throws(()=>b.registerPhase({...policy,baseOccupiedMicros:prior.occupiedMicros+1000000}));
});
test('mock 32-trial run separates three Terra efforts and completed restart dispatches zero',async t=>{
  const s=setup(t);let calls=0;
  const r=await runEffortPhase({...s,transportForTrial:trial=>({kind:'offline-mock',async invoke(args){calls++;assert.equal(args.request.body.reasoning_effort,trial.effort);return succeed(args);}})});
  assert.equal(calls,32);assert.equal(r.stopped,'completed');assert.equal(r.rows.length,32);assert.equal(r.attempts.length,32);
  assert.ok(r.rows.every(x=>x.content_score.content_correct&&x.protocolCompleteMs!==null&&x.correctCompleteMs!==null));
  for(const c of CONFIGURATIONS)assert.equal(r.rows.filter(x=>x.configuration===c).length,8);
  const summary=summarize(r);assert.equal(summary.byConfig.length,4);assert.equal(summary.paired.length,5);
  assert.ok(summary.byConfig.every(x=>x.strict_correctness_met&&x.cost_per_correct_complete_usd>0));
  const resumed=await runEffortPhase({...s,transportForTrial:()=>{throw new Error('Must not dispatch completed trial');}});
  assert.equal(resumed.rows.length,32);assert.equal(resumed.attempts.length,32);
});
test('reporting excludes null timings, retains unknown fees, and does not label wrong fast answers correct',async t=>{
  assert.deepEqual(stats([null,100,300]).median_ms,200);
  const s=setup(t);const r=await runEffortPhase({...s,transportForTrial:()=>({kind:'offline-mock',async invoke(a){
    a.onDelta(answer('D'));return {usage:{inputTokens:100,outputTokens:50},finishReason:'stop',meteringComplete:true};}})});
  const summary=summarize(r);assert.ok(summary.byConfig.every(x=>x.content_correct===0&&x.protocol_timing.n===8&&x.correct_timing.n===0&&x.cost_per_correct_complete_usd===null));
});
test('original same-model comparator still rejects mismatched models',t=>{
  const dir=mkdtempSync('/tmp/notchspi-cab-comparator-');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const summary=join(dir,'summary.json'),a=join(dir,'a.jsonl'),b=join(dir,'b.jsonl');writeFileSync(summary,'{}');
  writeFileSync(a,Array.from({length:240},()=>JSON.stringify({model:'gpt-6-astra'})).join('\n'));
  writeFileSync(b,Array.from({length:240},()=>JSON.stringify({model:'gpt-6.1-terra'})).join('\n'));
  const r=spawnSync(process.execPath,['scripts/compare-objective-evals.mjs'],{encoding:'utf8',env:{
    NSPI_COMPARE_OBJECTIVE_EVALS:'1',NSPI_BASELINE_SUMMARY:summary,NSPI_TREATMENT_SUMMARY:summary,NSPI_BASELINE_JSONL:a,NSPI_TREATMENT_JSONL:b}});
  assert.equal(r.status,1);assert.match(r.stderr,/baseline and treatment models differ/);
});
test('insufficient phase funds dispatch zero; parent funds cannot bypass phase',async t=>{
  const s=setup(t,100000);let calls=0;
  const r=await runEffortPhase({...s,transportForTrial:()=>({kind:'offline-mock',async invoke(a){calls++;return succeed(a);}})});
  assert.equal(calls,0);assert.equal(r.stopped,'phase_budget_exhausted');assert.equal(r.phase.occupiedMicros,0);
});
test('unknown usage retains full reserves and stops at three attempts',async t=>{
  const s=setup(t);let calls=0;
  const r=await runEffortPhase({...s,transportForTrial:()=>({kind:'offline-mock',async invoke(a){calls++;await succeed(a);return {usage:null,finishReason:'stop'};}})});
  assert.equal(calls,3);assert.equal(r.stopped,'unknown_cost_limit');assert.equal(r.phase.unknownAttempts,3);
  assert.equal(r.phase.occupiedMicros,1014400+101440*2);assert.ok(r.attempts.every(x=>x.costMicros===null));
});
test('one permitted retry is separately billed and included in logical time',async t=>{
  const s=setup(t);let calls=0;
  const r=await runEffortPhase({...s,transportForTrial:()=>({kind:'offline-mock',async invoke(a){calls++;if(calls===1)throw new ComparisonFailure('network_error',true,10);return succeed(a);}})});
  assert.equal(calls,33);assert.equal(r.rows[0].attemptIds.length,2);assert.ok(r.rows[0].timing.totalMs>=10);
  assert.equal(r.phase.unknownAttempts,1);assert.equal(r.attempts[1].purpose,'retry');
});
test('startup timeouts preserve unknown cost and cannot retry past unknown-cost stop',async t=>{
  const s=setup(t);let calls=0;
  const r=await runEffortPhase({...s,limits:{firstProgressMs:5,generationMs:30,leaseMs:40,maxRetries:1,maxConsecutiveFailures:3},
    transportForTrial:()=>({kind:'offline-mock',invoke(){calls++;return new Promise(()=>{});}})});
  assert.equal(calls,3);assert.ok(r.attempts.every(a=>a.failure==='startup_timeout'));assert.equal(r.phase.unknownAttempts,3);
});
test('three complete but malformed responses stop, with all usage billed',async t=>{
  const s=setup(t);let calls=0;
  const r=await runEffortPhase({...s,transportForTrial:()=>({kind:'offline-mock',async invoke(a){calls++;a.onDelta('unstructured');return {usage:{inputTokens:100,outputTokens:5},finishReason:'stop',meteringComplete:true};}})});
  assert.equal(calls,3);assert.equal(r.stopped,'consecutive_failures');assert.equal(r.phase.unknownAttempts,0);assert.ok(r.phase.knownMeteredMicros>0);
});
test('phase identity, cap, duplicate trial, unscoped reserve and interrupted claims cannot reset budget',async t=>{
  const s=setup(t),trial=s.plan.trials[0];
  assert.throws(()=>s.budget.registerPhase({...s.policy,id:'new-run'}));
  assert.throws(()=>s.budget.registerPhase({...s.policy,limitMicros:6000000}));
  assert.throws(()=>s.budget.reserve('illegal','logical','gpt-6-astra','answer'));
  s.budget.claimPhaseTrial(PHASE,trial.key);assert.throws(()=>s.budget.claimPhaseTrial(PHASE,trial.key));
  const r=await runEffortPhase({...s,transportForTrial:()=>{throw new Error('Interrupted trial must not be resent');}});
  assert.equal(r.stopped,'unresolved_prior_trial');
  const reopened=new ComparisonBudget(s.path,s.parent,s.plan.config.models);
  try{reopened.registerPhase(s.policy);assert.equal(reopened.phaseSnapshot(PHASE).stopped,'unresolved_prior_trial');}finally{reopened.close();}
});
