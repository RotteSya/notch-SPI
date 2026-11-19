#!/usr/bin/env node
// Authorized completion of the same campaign. No new ledger, cap, run ID or model input.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync,mkdirSync,realpathSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {loadPlan,loadDedicatedCredentials,ROOT,CAMPAIGN,PAID_DIRECTORY,CONSUMED,budgetQuote} from './run-spi-screening.mjs';
import {executeComparison,pairedSchedule} from './lib/model-comparison.mts';
import {ComparisonBudget} from './lib/model-comparison-budget.mts';
import {createControlledTransport} from './lib/model-comparison-transport.mts';
import {assessAnswer,validateRules} from './lib/spi-screening-score.mjs';

export const IDS=['P01','R01','R02','R03','F01','F02','F03','F04'];
export const MODELS=['gpt-6-astra','gpt-6.1-terra'];
export const PREP='output/spi-screening-20261117/supplement-openai';
export const EVIDENCE=`${PAID_DIRECTORY}/supplement-openai`;
const MARKER='output/spi-screening-20261117.supplement-permit-consumed.json';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=(root,path)=>readFileSync(resolve(root,path));
const json=(root,path)=>JSON.parse(read(root,path));
const write=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const pairKey=x=>`${x.caseId}-${x.model}`;

export function inspectLedger(root=ROOT) {
  const path=resolve(root,PAID_DIRECTORY,'budget.sqlite3');
  assert.ok(existsSync(path),'Existing cumulative ledger required');assert.equal(realpathSync(path),path);
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const campaigns=db.prepare('SELECT * FROM comparison_campaigns').all();
    assert.equal(campaigns.length,1);assert.equal(campaigns[0].id,CAMPAIGN);assert.equal(campaigns[0].limit_micros,10_000_000);
    const attempts=db.prepare('SELECT * FROM comparison_attempts ORDER BY rowid').all().map(row=>({...row}));
    const settlements=db.prepare('SELECT * FROM comparison_settlements').all().map(row=>({...row}));
    const charged=new Map(settlements.map(x=>[x.attempt_id,Number(x.charged_upper_micros)]));
    const occupied=attempts.reduce((s,a)=>s+(charged.get(a.id)??Number(a.reserved_micros)),0);
    return {campaign:campaigns[0],attempts,settlements,budget:{limitMicros:10_000_000,occupiedMicros:occupied,
      remainingMicros:campaigns[0].halted?0:Math.max(0,10_000_000-occupied),
      activeHoldMicros:attempts.filter(a=>!charged.has(a.id)).reduce((s,a)=>s+Number(a.reserved_micros),0),
      knownMeteredMicros:attempts.reduce((s,a)=>s+Number(a.metered_micros??0),0),
      unknownAttempts:attempts.filter(a=>a.metered_micros===null).length,halted:!!campaigns[0].halted}};
  }finally{db.close();}
}

export function loadContinuation(root=ROOT) {
  const plan=loadPlan(root),freeze=json(root,`${PREP}/freeze.json`),rules=json(root,`${PREP}/scoring-rules.json`);
  assert.equal(freeze.campaign_id,CAMPAIGN);assert.equal(freeze.same_ledger,`${PAID_DIRECTORY}/budget.sqlite3`);
  assert.deepEqual(freeze.models,MODELS);assert.deepEqual(freeze.case_ids,IDS);
  assert.equal(freeze.new_budget,false);assert.equal(freeze.total_cap_micros,10_000_000);
  for(const ref of freeze.files)assert.equal(sha(read(root,ref.path)),ref.sha256,`Frozen file changed: ${ref.path}`);
  assert.deepEqual(freeze.base_source,plan.sourceIdentity);validateRules(rules);
  const cases=IDS.map(id=>plan.preparedCases.find(q=>q.id===id));assert.ok(cases.every(Boolean));
  const models=plan.config.models.filter(m=>MODELS.includes(m.id));
  return {...plan,cases,models,freeze,rules,quote:budgetQuote({...plan.config,models},cases)};
}

export function inspectEvidence(root,plan) {
  const ledger=inspectLedger(root),dirs=[resolve(root,PAID_DIRECTORY),resolve(root,EVIDENCE)];
  const attempts=[],rows=[];
  for(const dir of dirs)if(existsSync(dir))for(const name of readdirSync(dir)){
    if(!/^(?:attempt-|logical-).*\.json$/u.test(name))continue;
    const value=JSON.parse(readFileSync(resolve(dir,name)));
    if(dir===resolve(root,EVIDENCE))assert.equal(value.freeze_sha256,sha(read(root,`${PREP}/freeze.json`)),'Receipt configuration changed');
    if(name.startsWith('attempt-'))attempts.push(value);else rows.push(value);
  }
  const byId=new Map(attempts.map(a=>[a.id,a]));assert.equal(byId.size,attempts.length);
  assert.equal(ledger.attempts.length,attempts.length,'Unreconciled dispatch: preserve holds; do not redispatch');
  for(const entry of ledger.attempts){
    const a=byId.get(entry.id);assert.ok(a,'Missing physical receipt');
    assert.equal(a.model,entry.model);assert.equal(a.logicalId,entry.logical_id);
    assert.equal(a.costMicros,entry.metered_micros);assert.equal(a.outputSHA256,sha(a.outputText));
  }
  const unique=new Map();for(const row of rows){assert.ok(!unique.has(pairKey(row)),'Duplicate logical result');unique.set(pairKey(row),row);}
  const prior=plan.freeze.prior_attempt_ids;assert.ok(prior.every(id=>byId.has(id)),'Prior ledger history cannot be deleted');
  assert.deepEqual(ledger.attempts.filter(a=>prior.includes(a.id)),plan.freeze.prior_ledger_rows,'Prior billed rows changed');
  assert.deepEqual(ledger.settlements.filter(s=>prior.includes(s.attempt_id)),plan.freeze.prior_settlements,'Prior settlements changed');
  assert.equal(ledger.campaign.catalog_sha256,plan.freeze.catalog_sha256,'Budget catalog changed');
  const newAttempts=attempts.filter(a=>!prior.includes(a.id));
  assert.ok(newAttempts.every(a=>IDS.includes(a.caseId)&&MODELS.includes(a.model)),'Out-of-scope physical call');
  assert.ok(newAttempts.length<=32,'Supplement request ceiling exceeded');
  let consecutiveFailures=0;
  for(const entry of ledger.attempts){const a=byId.get(entry.id);consecutiveFailures=a.failure||a.continuation_failure?consecutiveFailures+1:0;}
  const schedule=pairedSchedule(plan.cases,MODELS),completed=schedule.filter(x=>unique.has(pairKey(x)));
  const missing=schedule.filter(x=>!unique.has(pairKey(x)));
  // A crashed request without its logical receipt must be reconciled, never silently paid again.
  for(const x of missing)assert.ok(!newAttempts.some(a=>pairKey(a)===pairKey(x)),'Incomplete logical receipt; no automatic replay');
  return {ledger,attempts,rows,completed,missing,newAttempts,consecutiveFailures};
}

export function validateApproval(record,plan,root=ROOT,now=Date.now()) {
  assert.equal(record.status,'approved');assert.equal(record.campaign_id,CAMPAIGN);
  assert.equal(record.freeze_sha256,sha(read(root,`${PREP}/freeze.json`)));
  assert.deepEqual(record.case_ids,IDS);assert.deepEqual(record.models,MODELS);
  assert.equal(record.total_cap_micros,10_000_000);assert.equal(record.use_existing_ledger,true);
  assert.equal(record.rights_status,'用户明确确认');assert.equal(record.publisher_documents_independently_verified,false);
  assert.equal(record.dispatch_to,'OpenAI only');assert.ok(record.user_message_reference?.trim());
  assert.ok(Date.parse(record.recorded_at)<=now&&now<Date.parse(record.expires_at));
  assert.ok(Date.parse(record.expires_at)-Date.parse(record.recorded_at)<=86400_000);
  assert.equal(record.preflight.prices_and_ids_checked,true);assert.equal(record.preflight.account_available,true);
  assert.equal(record.preflight.account_evidence_sha256,sha(read(root,`${PREP}/account-check.json`)));
  return true;
}

// The same budget object includes all previous models and charges. Only execution narrows to OpenAI.
export async function completeMissing({plan,state,budget,transport,onEvidence,claimPair=()=>{},clock=()=>new Date().toISOString()}) {
  const rows=[],attempts=[];let stopped=null,consecutive=state.consecutiveFailures,count=state.newAttempts.length;
  const gate=()=>{
    const s=budget.snapshot();
    if(s.halted)return 'budget_halted';
    if(s.unknownAttempts>=3)return 'unknown_cost_limit';
    if(consecutive>=3)return 'consecutive_failures';
    if(count>=32)return 'physical_request_limit';
    return null;
  };
  const guarded={snapshot:()=>budget.snapshot(),assertModel:m=>budget.assertModel(m),
    reserve(...args){const reason=gate();if(reason){stopped=reason;throw new Error(reason);}return budget.reserve(...args);},
    observe:(...a)=>budget.observe(...a),attemptEvidence:(...a)=>budget.attemptEvidence(...a),settleCompleteUsage:(...a)=>budget.settleCompleteUsage(...a)};
  for(const pair of state.missing){
    stopped=gate();if(stopped)break;
    claimPair(pair);
    const q=plan.cases.find(q=>q.id===pair.caseId),model=plan.models.find(m=>m.id===pair.model);
    const result=await executeComparison({cases:[q],models:[model],promptFor:plan.promptFor,imagesFor:plan.imagesFor,
      budget:guarded,transport,limits:plan.config.limits,maxUnknownAttempts:3,
      onEvidence(kind,row){
        const value={...row,recorded_at:clock()};
        if(kind==='attempt'){
          const valid=assessAnswer(row.outputText,q,row.finishReason,plan.rules).protocol_valid;
          value.continuation_failure=row.failure??(valid?null:'invalid_complete_answer');
          count++;consecutive=value.continuation_failure?consecutive+1:0;attempts.push(value);
        }
        if(kind==='logical'){
          const a=attempts.find(a=>a.id===row.attemptIds.at(-1));
          value.content_score=assessAnswer(a?.outputText??'',q,a?.finishReason??null,plan.rules);rows.push(value);
        }
        onEvidence(kind,value);
      }});
    if(stopped||result.stopped){stopped=stopped??result.stopped;break;}
  }
  return {rows,attempts,stopped,budget:budget.snapshot(),completed_before:state.completed,
    unattempted:state.missing.filter(x=>!rows.some(row=>pairKey(x)===pairKey(row)))};
}

async function live(root,plan) {
  const authPath=`${PREP}/authorization.json`,authBytes=read(root,authPath),record=JSON.parse(authBytes),digest=sha(authBytes);
  validateApproval(record,plan,root);
  const assertAuthorized=()=>{assert.equal(sha(read(root,authPath)),digest);validateApproval(record,plan,root);};
  const state=inspectEvidence(root,plan);
  if(!state.missing.length)return {mode:'reuse-completed',new_calls:0,budget:state.ledger.budget};
  assert.ok(!existsSync(resolve(root,EVIDENCE,'results.json')),'This supplement already stopped; no automatic extension');
  assert.ok(existsSync(resolve(root,CONSUMED)),'Original campaign marker must remain');
  const marker=resolve(root,MARKER),directory=resolve(root,EVIDENCE);
  if(existsSync(marker))assert.deepEqual(JSON.parse(readFileSync(marker)),{campaign_id:CAMPAIGN,authorization_sha256:digest,freeze_sha256:record.freeze_sha256});
  else{assert.ok(!existsSync(directory),'Orphan supplement artifacts');write(marker,{campaign_id:CAMPAIGN,authorization_sha256:digest,freeze_sha256:record.freeze_sha256});}
  mkdirSync(directory,{recursive:true,mode:0o700});assert.equal(realpathSync(directory),directory);
  const lock=resolve(directory,'active.lock');write(lock,{pid:process.pid,authorization_sha256:digest});
  let budget;
  try{
    // Reconcile after acquiring the lock, before allowing any reservation.
    const latest=inspectEvidence(root,plan);
    budget=new ComparisonBudget(resolve(root,PAID_DIRECTORY,'budget.sqlite3'),{campaignId:CAMPAIGN,limitMicros:10_000_000,rolling:true},plan.config.models);
    let credentials;
    const transport=createControlledTransport({assertAuthorized,
      expectedModels:Object.fromEntries(MODELS.map(m=>[m,[m]])),
      credentialFor:m=>{assert.ok(MODELS.includes(m),'DeepSeek excluded');credentials??=loadDedicatedCredentials(root);return credentials.NSPI_EVAL_OPENAI_KEY;}});
    if(!existsSync(resolve(directory,'plan.json')))write(resolve(directory,'plan.json'),{campaign_id:CAMPAIGN,
      freeze_sha256:record.freeze_sha256,source:plan.sourceIdentity,models:MODELS,case_ids:IDS,
      same_ledger:`${PAID_DIRECTORY}/budget.sqlite3`,budget_before:budget.snapshot(),quote:plan.quote,started_at:new Date().toISOString()});
    const result=await completeMissing({plan,state:latest,budget,transport,
      claimPair:pair=>write(resolve(directory,`claim-${pairKey(pair)}.json`),{...pair,freeze_sha256:record.freeze_sha256}),
      onEvidence:(kind,row)=>write(resolve(directory,`${kind}-${kind==='attempt'?row.id:pairKey(row)}.json`),{...row,freeze_sha256:record.freeze_sha256})});
    write(resolve(directory,'results.json'),{...result,mode:'authorized-live',campaign_id:CAMPAIGN,finished_at:new Date().toISOString()});
    return {mode:'authorized-live',new_calls:result.attempts.length,stopped:result.stopped,budget:result.budget};
  }finally{budget?.close();unlinkSync(lock);}
}

export async function main(args=process.argv.slice(2),root=ROOT) {
  assert.ok(args.length===0||args.length===1&&args[0]==='--live','Only dry-run or --live; no ledger/cap/run/model overrides');
  const plan=loadContinuation(root),state=inspectEvidence(root,plan);
  if(args[0]==='--live')return live(root,plan);
  return {mode:'dry-run',paid_calls:0,campaign_id:CAMPAIGN,existing_budget:state.ledger.budget,
    reused:state.completed,missing:state.missing,quote:plan.quote,rights_status:'用户明确确认',transport:'absent'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(x=>console.log(JSON.stringify(x,null,2))).catch(()=>{
  process.stderr.write('Supplement stopped: validation or execution failure; inspect local evidence. No automatic restart.\n');process.exitCode=1;
});
