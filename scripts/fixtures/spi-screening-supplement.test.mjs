import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,copyFileSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';

let network=0;const deny=()=>{network++;throw new Error('Network forbidden in offline tests');};
globalThis.fetch=deny;http.get=http.request=https.get=https.request=net.connect=net.createConnection=net.Socket.prototype.connect=deny;
syncBuiltinESMExports();after(()=>assert.equal(network,0));
const {loadPlan,ROOT,CAMPAIGN,PAID_DIRECTORY}=await import('../run-spi-screening.mjs');
const {completeMissing,inspectEvidence,IDS,MODELS,PREP,EVIDENCE,loadContinuation,validateApproval,main,sha}=await import('../continue-spi-screening.mjs');
const {assessAnswer,judgeChoice,validateRules}=await import('../lib/spi-screening-score.mjs');
const {ComparisonBudget}=await import('../lib/model-comparison-budget.mts');
const {ComparisonFailure,pairedSchedule,buildRequest}=await import('../lib/model-comparison.mts');
const original=loadPlan(),rules=JSON.parse(readFileSync(join(ROOT,PREP,'scoring-rules.json')));
const plan={...original,rules,cases:IDS.map(id=>original.preparedCases.find(q=>q.id===id)),models:original.config.models.filter(m=>MODELS.includes(m.id))};
const old=JSON.parse(readFileSync(join(ROOT,PAID_DIRECTORY,'results.json')));
const final=(answer,state='ready')=>`FINAL: ${answer}\nNSPI_RESULT_V1: `+JSON.stringify({v:1,kind:'single_choice',state,answer,reason:state==='review'?'ambiguous_question':'none'});
const q=id=>original.preparedCases.find(q=>q.id===id);
const score=(id,answer)=>assessAnswer(final(answer),q(id),'stop',rules);
function setup(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'notchspi-supplement-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,PAID_DIRECTORY),{recursive:true});
 mkdirSync(join(root,PREP),{recursive:true});
 copyFileSync(join(ROOT,PREP,'freeze.json'),join(root,PREP,'freeze.json'));
 copyFileSync(join(ROOT,PREP,'budget-before.sqlite3'),join(root,PAID_DIRECTORY,'budget.sqlite3'));
 for(const a of old.attempts)writeFileSync(join(root,PAID_DIRECTORY,`attempt-${a.id}.json`),JSON.stringify(a));
 for(const row of old.rows)writeFileSync(join(root,PAID_DIRECTORY,`logical-${row.caseId}-${row.model}.json`),JSON.stringify(row));
 const budget=new ComparisonBudget(join(root,PAID_DIRECTORY,'budget.sqlite3'),{campaignId:CAMPAIGN,limitMicros:10_000_000,rolling:true},original.config.models);
 t.after(()=>budget.close());
 const state={missing:pairedSchedule(plan.cases,MODELS),completed:[],consecutiveFailures:0,newAttempts:[]};
 return {root,budget,state,run:args=>completeMissing({plan,state,budget,transport:{kind:'offline-mock',invoke:success},onEvidence:()=>{},...args})};
}
async function success({caseId,onDelta}){
 onDelta(final(q(caseId).expected.accepted_answers[0]));
 return {usage:{inputTokens:1000,outputTokens:100},finishReason:'stop',meteringComplete:true};
}

test('all sixteen common rules use the unchanged gold; single labels are deterministic',()=>{
 assert.equal(validateRules(rules),true);
 for(const rule of rules.questions){assert.equal(score(rule.id,rule.gold).content_correct,true);
  assert.equal(score(rule.id,rule.labels.find(l=>l!==rule.gold)).content_correct,false);}
});
test('choice plus matching content and exact source option text are correct',()=>{
 for(const [id,a] of [['M02','5. 分速56 m'],['M03','3（5/9）'],['M04','2（4日目）'],['M09','1. 100枚'],
  ['P01','D、44%'],['P01','Ｄ（４４％）'],['P01','44%'],['F01','A（右下に黒丸、下向きの矢印）'],['F02','A（5時、グレー）']]){
  assert.equal(score(id,a).fully_valid_correct,true,`${id} ${a}`);
 }
 for(const id of ['R01','R02','R03']){const rule=rules.questions.find(q=>q.id===id),text=rule.content_by_label[rule.gold][0];
  assert.equal(score(id,`${rule.gold}. ${text}`).content_correct,true);}
});
test('conflicting options/values, decimal mistakes and mutually exclusive answers never auto-pass',()=>{
 for(const a of ['D（42%）','C（44%）','D or E','D/E','D、E','D（4.4%）','D（4,4%）','D（44%ではない）','D（不明）','D（44% or 30.56%）']){
  assert.notEqual(score('P01',a).content_correct,true,a);
 }
 assert.equal(score('P01','D（42%）').content_status,'choice_content_conflict');
 assert.equal(score('P01','D（説明未登録）').content_correct,null);
 assert.notEqual(score('R01','5. '+rules.questions.find(q=>q.id==='R01').content_by_label['1'][0]).content_correct,true);
});
test('content and protocol are independent; conflicting FINAL and structured answers are not accepted',()=>{
 const plain=assessAnswer('FINAL: D（44%）',q('P01'),'stop',rules);
 assert.equal(plain.content_correct,true);assert.equal(plain.protocol_valid,false);assert.equal(plain.fully_valid_correct,false);
 const conflict=assessAnswer(final('D').replace('FINAL: D','FINAL: C'),q('P01'),'stop',rules);
 assert.equal(conflict.content_correct,false);
 assert.equal(assessAnswer(final('D'),q('P01'),'length',rules).protocol_valid,false);
 const reviewed=assessAnswer(final('D（44%）','review'),q('P01'),'stop',rules);
 assert.equal(reviewed.content_correct,true);assert.equal(reviewed.protocol_valid,true);assert.equal(reviewed.state_matches_frozen,false);
});
test('historical answers are rescored offline without overwriting their original scores or re-requesting',()=>{
 const priorHash=createHash('sha256').update(JSON.stringify(old)).digest('hex');
 for(const a of old.attempts)assert.equal(assessAnswer(a.outputText,q(a.caseId),a.finishReason,rules).fully_valid_correct,true);
 assert.equal(old.rows.filter(r=>r.score.correct).length,10);
 assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'),priorHash);
});
test('new requests retain identical input bytes, prompt and low/default mapping without score metadata',()=>{
 for(const item of plan.cases){const requests=MODELS.map(m=>buildRequest(m,{...plan.promptFor(item),images:plan.imagesFor(item)}));
  assert.deepEqual(requests[0].body.messages,requests[1].body.messages);
  for(const r of requests){assert.equal(r.body.service_tier,'default');assert.equal(r.body.reasoning_effort,'low');
   assert.equal(JSON.stringify(r.body).includes('content_by_label'),false);assert.equal(JSON.stringify(r.body).includes('gold'),false);}
 }
});
test('only missing pairs run in alternating model order; prior spend and the fixed cap remain in the ledger',async t=>{
 const {run,budget,state}=setup(t),sent=[];state.completed=[state.missing.shift()];
 const before=budget.snapshot();assert.equal(before.knownMeteredMicros,267928);
 const result=await run({transport:{kind:'offline-mock',async invoke(a){sent.push([a.caseId,a.model]);return success(a);}}});
 assert.deepEqual(sent,state.missing.map(p=>[p.caseId,p.model]));assert.equal(sent.length,15);assert.ok(sent.every(x=>MODELS.includes(x[1])));
 assert.equal(result.budget.limitMicros,10_000_000);assert.ok(result.budget.knownMeteredMicros>267928);assert.equal(result.stopped,null);
 assert.equal(result.rows.filter(r=>r.category==='cab_figural').length,8);
});
test('a retry is separately reserved and charged under the same logical answer',async t=>{
 const {run,state}=setup(t);state.missing=state.missing.slice(0,1);let n=0;
 const r=await run({transport:{kind:'offline-mock',async invoke(a){n++;if(n===1){a.onUsage({inputTokens:100,outputTokens:10});throw new ComparisonFailure('http_transient',true,0);}return success(a);}}});
 assert.equal(r.attempts.length,2);assert.deepEqual(r.attempts.map(a=>a.purpose),['answer','retry']);assert.equal(r.rows[0].attemptIds.length,2);
 assert.equal(r.rows[0].knownCostMicros,r.attempts.reduce((s,a)=>s+a.costMicros,0));
 assert.ok(r.budget.activeHoldMicros>0,'Failed attempt retains hold even if partial usage arrived');
});
test('three unknown-cost attempts stop and retain all holds; unknown is not free',async t=>{
 const {run}=setup(t);const r=await run({transport:{kind:'offline-mock',async invoke(a){a.onDelta(final(q(a.caseId).expected.accepted_answers[0]));return {usage:null,finishReason:'stop'};}}});
 assert.equal(r.attempts.length,3);assert.equal(r.stopped,'unknown_cost_limit');assert.equal(r.budget.unknownAttempts,3);assert.ok(r.budget.activeHoldMicros>0);
 assert.ok(r.attempts.every(a=>a.costMicros===null));
});
test('three consecutive physical failures halt even across retry and logical boundaries',async t=>{
 const {run}=setup(t);let called=0;
 const r=await run({transport:{kind:'offline-mock',async invoke(a){called++;a.onUsage({inputTokens:10,outputTokens:10});throw new ComparisonFailure('http_transient',true,0);}}});
 assert.equal(called,3);assert.equal(r.attempts.length,3);assert.equal(r.stopped,'consecutive_failures');
});
test('three invalid complete answers also stop, while wrong content alone does not change the schedule',async t=>{
 const {run}=setup(t);const r=await run({transport:{kind:'offline-mock',async invoke(a){a.onDelta('not a valid protocol');return {usage:{inputTokens:10,outputTokens:10},finishReason:'stop',meteringComplete:true};}}});
 assert.equal(r.attempts.length,3);assert.equal(r.stopped,'consecutive_failures');
});
test('insufficient next reservation stops before a mock supplier is invoked',async t=>{
 const {run,budget}=setup(t);let n=0;while(budget.snapshot().remainingMicros>=1_014_400){const id=`filled-${n++}`;budget.reserve(id,id,'gpt-6-astra','answer');budget.observe(id,{inputTokens:10,outputTokens:10});}
 const r=await run({transport:{kind:'offline-mock',async invoke(){assert.fail('Must not dispatch');}}});
 assert.equal(r.attempts.length,0);assert.equal(r.stopped,'budget_exhausted');
});
test('startup timeout follows the frozen retry limit and both attempts keep unknown costs',async t=>{
 const {run,state}=setup(t);state.missing=state.missing.slice(0,1);
 const p={...plan,config:{...plan.config,limits:{...plan.config.limits,firstProgressMs:5,generationMs:100,leaseMs:120}}};
 const r=await run({plan:p,transport:{kind:'offline-mock',invoke:()=>new Promise(()=>{})}});
 assert.equal(r.attempts.length,2);assert.ok(r.attempts.every(a=>a.failure==='startup_timeout'));assert.equal(r.budget.unknownAttempts,2);
});
test('reconciliation rejects a deleted ledger or missing physical receipt',t=>{
 const {root}=setup(t),p={...plan,freeze:JSON.parse(readFileSync(join(ROOT,PREP,'freeze.json')))};
 const first=inspectEvidence(root,p);assert.equal(first.missing.length,16);assert.equal(first.ledger.budget.knownMeteredMicros,267928);
 rmSync(join(root,PAID_DIRECTORY,`attempt-${old.attempts[0].id}.json`));assert.throws(()=>inspectEvidence(root,p),/Unreconciled/);
 rmSync(join(root,PAID_DIRECTORY,'budget.sqlite3'));assert.throws(()=>inspectEvidence(root,p),/Existing cumulative/);
});
test('completed same-configuration pair is reused after reopening the evidence',async t=>{
 const {root,run,state}=setup(t),p={...plan,freeze:JSON.parse(readFileSync(join(ROOT,PREP,'freeze.json')))};
 state.missing=state.missing.slice(0,1);mkdirSync(join(root,EVIDENCE),{recursive:true});
 const digest=sha(readFileSync(join(root,PREP,'freeze.json')));
 await run({onEvidence:(kind,row)=>writeFileSync(join(root,EVIDENCE,`${kind}-${kind==='attempt'?row.id:row.caseId+'-'+row.model}.json`),JSON.stringify({...row,freeze_sha256:digest}))});
 const next=inspectEvidence(root,p);assert.equal(next.completed.length,1);assert.equal(next.missing.length,15);
 assert.ok(!next.missing.some(x=>x.caseId==='P01'&&x.model==='gpt-6-astra'));
});
test('continuation authorization binds confirmed rights, exact subset, scoring, same cap and OpenAI only',async()=>{
 const p=loadContinuation(),a=JSON.parse(readFileSync(join(ROOT,PREP,'authorization.json')));
 assert.equal(validateApproval(a,p),true);
 for(const mutate of [x=>x.case_ids.pop(),x=>x.models.push('deepseek-flash'),x=>x.total_cap_micros++,
  x=>x.use_existing_ledger=false,x=>x.rights_status='independently_verified',x=>x.publisher_documents_independently_verified=true,
  x=>x.freeze_sha256='changed',x=>x.preflight.account_available=false]){
  const copy=structuredClone(a);mutate(copy);assert.throws(()=>validateApproval(copy,p));
 }
 const preview=await main([]);assert.equal(preview.paid_calls,0);assert.equal(preview.missing.length,16);
 for(const flag of ['--run-id','--cap','--ledger','--model','--reset'])await assert.rejects(main([flag,'other']));
});
