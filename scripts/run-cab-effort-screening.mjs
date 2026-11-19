#!/usr/bin/env node
// Fixed four-image, four-configuration experiment. No credentials or transport in dry-run.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ROOT,CAMPAIGN,PAID_DIRECTORY,loadDedicatedCredentials} from './run-spi-screening.mjs';
import {ComparisonBudget} from './lib/model-comparison-budget.mts';
import {executeComparison,buildCABEffortRequest,CAB_EFFORT_CONFIGURATIONS} from './lib/model-comparison.mts';
import {createControlledTransport} from './lib/model-comparison-transport.mts';
import {assessAnswer,validateRules} from './lib/spi-screening-score.mjs';

export const DIRECTORY='output/cab-effort-screening-20261118';
export const PHASE='cab-effort-screening-20261118';
export const IDS=['F01','F02','F03','F04'];
export const CONFIGURATIONS=Object.keys(CAB_EFFORT_CONFIGURATIONS);
const RULES='output/spi-screening-20261117/supplement-openai/scoring-rules.json';
const CONFIG='output/spi-screening-20261117/config.json';
const CASES='output/spi-screening-20261117/cases.json';
const PLAN='output/terra-effort-screening-plan-20261118/budget.json';
const SOURCES=['scripts/run-cab-effort-screening.mjs','scripts/lib/model-comparison.mts','scripts/lib/model-comparison-budget.mts',
  'scripts/lib/model-comparison-transport.mts','scripts/lib/spi-screening-score.mjs','scripts/lib/evaluation-budget.mts',
  'scripts/run-spi-screening.mjs','server/src/objective-result.ts','server/src/providers/types.ts',
  'server/src/screen-query.ts','server/src/http.ts','server/src/telemetry.ts','scripts/lib/reading-answer-scoring.mts',
  'scripts/fixtures/cab-effort-screening.test.mjs'];
export const sha=x=>createHash('sha256').update(x).digest('hex');
const read=(root,p)=>{const path=resolve(root,p);assert.equal(realpathSync(path),path);return readFileSync(path);};
const json=(root,p)=>JSON.parse(read(root,p));
const write=(p,x)=>writeFileSync(p,JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});
export function readLedger(root=ROOT){
  const p=resolve(root,PAID_DIRECTORY,'budget.sqlite3');assert.equal(realpathSync(p),p);
  const db=new DatabaseSync(p,{readOnly:true});
  try{return JSON.parse(JSON.stringify({campaigns:db.prepare('SELECT * FROM comparison_campaigns').all(),
    attempts:db.prepare('SELECT * FROM comparison_attempts ORDER BY rowid').all(),
    settlements:db.prepare('SELECT * FROM comparison_settlements ORDER BY rowid').all(),
    phases:db.prepare("SELECT name FROM sqlite_master WHERE name='comparison_phases'").get()
      ?db.prepare('SELECT * FROM comparison_phases').all():[]}));}finally{db.close();}
}
export function scheduleFromQuote(quote){
  const trials=quote.schedule.flatMap(b=>b.configuration_order.map(configuration=>({
    key:`r${b.round}-${b.question}-${configuration}`,caseId:b.question,round:b.round,configuration,
    ...CAB_EFFORT_CONFIGURATIONS[configuration]})));
  assert.equal(trials.length,32);assert.equal(new Set(trials.map(t=>t.key)).size,32);
  for(const id of IDS)for(const c of CONFIGURATIONS)assert.equal(trials.filter(t=>t.caseId===id&&t.configuration===c).length,2);
  return trials;
}
export function loadEffortPlan(root=ROOT){
  const prior=json(root,'output/terra-effort-screening-plan-20261118/evidence.json');
  for(const [p,h] of Object.entries(prior.frozen_refs))assert.equal(sha(read(root,p)),h,`Original frozen reference changed: ${p}`);
  const config=json(root,CONFIG),manifest=json(root,CASES),rules=json(root,RULES);validateRules(rules);
  const cases=IDS.map(id=>manifest.questions.find(q=>q.id===id));assert.ok(cases.every(Boolean));
  for(const item of cases){assert.equal(item.images.length,1);for(const im of item.images)assert.equal(sha(read(root,im.path)),im.sha256);}
  assert.deepEqual(config.limits,{firstProgressMs:20000,generationMs:90000,leaseMs:120000,maxRetries:1,maxConsecutiveFailures:3});
  const trials=scheduleFromQuote(json(root,PLAN));
  const inputFor=q=>({system:config.prompts.system,task:config.prompts.single_task,images:q.images.map(im=>({base64:read(root,im.path).toString('base64'),mediaType:im.media_type}))});
  return {root,config,cases,rules,trials,inputFor};
}
export function prepare(root=ROOT){
  const plan=loadEffortPlan(root),ledger=readLedger(root);assert.equal(ledger.phases.length,0);
  assert.equal(ledger.campaigns.length,1);assert.equal(ledger.campaigns[0].id,CAMPAIGN);assert.equal(ledger.campaigns[0].limit_micros,10000000);
  assert.equal(ledger.campaigns[0].halted,0);assert.equal(ledger.attempts.length,40);
  assert.ok(ledger.attempts.every(a=>a.metered_micros!==null&&ledger.settlements.some(s=>s.attempt_id===a.id)));
  const files=[...SOURCES,CONFIG,CASES,RULES,PLAN,...plan.cases.flatMap(q=>q.images.map(i=>i.path))];
  const freeze={phase:PHASE,campaign:CAMPAIGN,created_at:new Date().toISOString(),scope_limit_micros:3000000,
    initial_calls:32,maximum_physical_calls:64,trials:plan.trials,files:files.map(path=>({path,sha256:sha(read(root,path))})),ledger,
    historicalDigest:sha(JSON.stringify({attempts:ledger.attempts,settlements:ledger.settlements})),
    baseOccupiedMicros:ledger.settlements.reduce((s,x)=>s+Number(x.charged_upper_micros),0),
    criteria:{content_correct:8,protocol_valid:8,cancel_reorder_correct:2,median_ms:5000,max_ms:10000},
    mappings:CONFIGURATIONS.map(configuration=>({configuration,...CAB_EFFORT_CONFIGURATIONS[configuration]}))};
  write(resolve(root,DIRECTORY,'freeze.json'),freeze);return {mode:'prepared',freeze_sha256:sha(read(root,`${DIRECTORY}/freeze.json`)),paid_calls:0};
}
export function loadFrozen(root=ROOT){
  const plan=loadEffortPlan(root),freeze=json(root,`${DIRECTORY}/freeze.json`);
  assert.equal(freeze.phase,PHASE);assert.equal(freeze.scope_limit_micros,3000000);assert.equal(freeze.maximum_physical_calls,64);
  assert.deepEqual(freeze.trials,plan.trials);
  for(const ref of freeze.files)assert.equal(sha(read(root,ref.path)),ref.sha256,`Frozen code or data changed: ${ref.path}`);
  const ledger=readLedger(root);assert.deepEqual(ledger.campaigns,freeze.ledger.campaigns);
  assert.deepEqual(ledger.attempts.slice(0,40),freeze.ledger.attempts);
  assert.deepEqual(ledger.settlements.filter(x=>freeze.ledger.attempts.some(a=>a.id===x.attempt_id)),freeze.ledger.settlements);
  return {...plan,freeze,freezeSHA256:sha(read(root,`${DIRECTORY}/freeze.json`))};
}
export function validateAuthorization(auth,plan,now=Date.now()){
  assert.equal(auth.status,'approved');assert.equal(auth.phase,PHASE);assert.equal(auth.freeze_sha256,plan.freezeSHA256);
  assert.equal(auth.cap_micros,3000000);assert.equal(auth.initial_calls,32);assert.equal(auth.max_retries,32);
  assert.deepEqual(auth.configurations,CONFIGURATIONS);assert.deepEqual(auth.case_ids,IDS);
  assert.equal(auth.use_same_ledger,true);assert.equal(auth.rights_status,'用户明确确认');
  assert.equal(auth.criteria,'strict_correctness_short_wait');assert.equal(auth.recipient,'OpenAI');
  assert.ok(Date.parse(auth.recorded_at)<=now&&now<Date.parse(auth.expires_at));
  assert.equal(auth.preflight.public_prices_verified,true);assert.equal(auth.preflight.efforts_verified,true);
}
export function phasePolicy(plan,authDigest){return {id:PHASE,limitMicros:3000000,freezeSHA256:plan.freezeSHA256,
  authorizationSHA256:authDigest,baseOccupiedMicros:plan.freeze.baseOccupiedMicros,historicalDigest:plan.freeze.historicalDigest,
  maxPhysicalCalls:64,trials:plan.trials.map(t=>({key:t.key,model:t.model}))};}

export async function runEffortPhase({plan,budget,transportForTrial,onEvidence=()=>{},limits=plan.config.limits}){
  const phase=()=>budget.phaseSnapshot(PHASE);
  const existing=budget.phaseRecords(PHASE),rows=existing.trials.filter(x=>x.result_json).map(x=>JSON.parse(x.result_json));
  const attempts=existing.attempts.filter(x=>x.receipt_json).map(x=>JSON.parse(x.receipt_json));
  let stopped=phase().stopped;
  if(!stopped&&existing.trials.some(x=>x.result_json===null)){stopped='unresolved_prior_trial';budget.stopPhase(PHASE,stopped);}
  const gate=()=>{const p=phase();return p.stopped||(p.unknownAttempts>=3?'unknown_cost_limit':p.consecutiveFailures>=3?'consecutive_failures':
    p.physicalCalls>=64?'physical_request_limit':budget.snapshot().halted?'budget_halted':null);};
  for(const trial of plan.trials){
    if(rows.some(r=>r.trialKey===trial.key))continue;
    stopped=stopped??gate();if(stopped)break;
    const item=plan.cases.find(q=>q.id===trial.caseId),model=plan.config.models.find(m=>m.id===trial.model);
    const reserve=model.id==='gpt-6-astra'?1014400:101440;
    if(phase().remainingMicros<reserve){stopped='phase_budget_exhausted';break;}
    budget.claimPhaseTrial(PHASE,trial.key);
    const decorate=row=>({...row,trialKey:trial.key,configuration:trial.configuration,reasoningEffort:trial.effort,
      round:trial.round,freezeSHA256:plan.freezeSHA256,recorded_at:new Date().toISOString()});
    const settled=new Set();
    const scoped={snapshot:()=>({...budget.snapshot(),unknownAttempts:phase().unknownAttempts}),assertModel:m=>budget.assertModel(m),
      reserve(...args){const why=gate();if(why)throw new Error(why);return budget.reserve(...args,{phaseId:PHASE,trialKey:trial.key});},
      observe:(...a)=>budget.observe(...a),attemptEvidence:(...a)=>budget.attemptEvidence(...a),
      settleCompleteUsage(id){budget.settleCompleteUsage(id);settled.add(id);}};
    const result=await executeComparison({cases:[item],models:[model],promptFor:()=>({system:plan.config.prompts.system,task:plan.config.prompts.single_task}),
      imagesFor:q=>plan.inputFor(q).images,budget:scoped,transport:transportForTrial(trial),limits,maxUnknownAttempts:3,
      effortExperiment:{kind:'cab_effort_screening_v1',configuration:trial.configuration,round:trial.round},
      onEvidence(kind,row){
        const record=decorate(row);
        if(kind==='attempt'){
          record.meteringComplete=settled.has(row.id);
          record.content_score=assessAnswer(row.outputText,item,row.finishReason,plan.rules);
          record.phaseFailure=row.failure??(record.content_score.protocol_valid?null:'invalid_complete_answer');
          record.requestSHA256=sha(JSON.stringify(buildCABEffortRequest({kind:'cab_effort_screening_v1',configuration:trial.configuration,round:trial.round},plan.inputFor(item))));
          budget.recordPhaseAttempt(row.id,record);attempts.push(record);
        }else{
          const last=attempts.find(a=>a.id===row.attemptIds.at(-1));record.content_score=last?.content_score??null;
          record.first_attempt_content_score=attempts.find(a=>a.id===row.attemptIds[0])?.content_score??null;
          // Same complete-response clock, separately gated by the already-frozen content/protocol scorer.
          record.protocolCompleteMs=record.content_score?.protocol_valid&&!row.failure?row.timing.totalMs:null;
          record.correctCompleteMs=record.content_score?.fully_valid_correct&&!row.failure?row.timing.totalMs:null;
          budget.completePhaseTrial(PHASE,trial.key,record);rows.push(record);
        }
        onEvidence(kind,record);
      }});
    stopped=result.stopped??gate();if(stopped)break;
  }
  if(!stopped&&rows.length===32)stopped='completed';
  if(stopped)budget.stopPhase(PHASE,stopped);
  return {rows,attempts,stopped,phase:phase(),cumulative:budget.snapshot(),
    unattempted:plan.trials.filter(t=>!rows.some(r=>r.trialKey===t.key)),finished_at:new Date().toISOString()};
}

async function accountCheck(root,plan,auth){
  validateAuthorization(auth,plan);const key=loadDedicatedCredentials(root).NSPI_EVAL_OPENAI_KEY;
  const checks=[];
  for(const id of ['gpt-6-astra','gpt-6.1-terra']){
    const r=await fetch(`https://api.openai.com/v1/models/${id}`,{headers:{authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await r.json().catch(()=>null);checks.push({model:id,http_status:r.status,returned_id:data?.id===id?id:null,available:r.ok&&data?.id===id});
  }
  const record={checked_at:new Date().toISOString(),method:'GET model metadata; no inference or images',billable_inference_calls:0,
    authorization_sha256:sha(read(root,`${DIRECTORY}/authorization.json`)),checks,visibility_not_inference_guarantee:true};
  write(resolve(root,DIRECTORY,'account-check.json'),record);assert.ok(checks.every(x=>x.available));return record;
}

export async function main(args=process.argv.slice(2),root=ROOT){
  assert.ok(args.length===0||args.length===1&&['--prepare','--account-check','--live'].includes(args[0]),'No model, ledger, cap or run-ID overrides');
  if(args[0]==='--prepare')return prepare(root);
  const plan=existsSync(resolve(root,DIRECTORY,'freeze.json'))?loadFrozen(root):loadEffortPlan(root);
  if(!args.length)return {mode:'dry-run',paid_calls:0,configurations:CONFIGURATIONS,trials:plan.trials,source_frozen:!!plan.freeze};
  const auth=json(root,`${DIRECTORY}/authorization.json`),authDigest=sha(read(root,`${DIRECTORY}/authorization.json`));
  validateAuthorization(auth,plan);
  if(args[0]==='--account-check')return accountCheck(root,plan,auth);
  const account=json(root,`${DIRECTORY}/account-check.json`);assert.equal(account.authorization_sha256,authDigest);
  assert.ok(account.checks.length===2&&account.checks.every(x=>x.available));assert.ok(Date.now()-Date.parse(account.checked_at)<86400000);
  const dir=resolve(root,DIRECTORY,'paid');mkdirSync(dir,{recursive:true,mode:0o700});assert.equal(realpathSync(dir),dir);
  const lock=resolve(dir,'active.lock');write(lock,{pid:process.pid,authorization_sha256:authDigest});
  let budget;
  try{
    loadFrozen(root);
    budget=new ComparisonBudget(resolve(root,PAID_DIRECTORY,'budget.sqlite3'),{campaignId:CAMPAIGN,limitMicros:10000000,rolling:true},plan.config.models);
    budget.registerPhase(phasePolicy(plan,authDigest));
    if(existsSync(resolve(dir,'results.json')))return {mode:'reuse-finished',phase:budget.phaseSnapshot(PHASE),new_calls:0};
    let credentials;
    const assertAuthorized=()=>{assert.equal(sha(read(root,`${DIRECTORY}/authorization.json`)),authDigest);validateAuthorization(auth,loadFrozen(root));};
    const result=await runEffortPhase({plan,budget,transportForTrial:trial=>createControlledTransport({assertAuthorized,
      expectedModels:{'gpt-6-astra':['gpt-6-astra'],'gpt-6.1-terra':['gpt-6.1-terra'],'deepseek-flash':[]},
      credentialFor:model=>{assert.ok(model==='gpt-6-astra'||model==='gpt-6.1-terra');credentials??=loadDedicatedCredentials(root);return credentials.NSPI_EVAL_OPENAI_KEY;},
      effortExperiment:{kind:'cab_effort_screening_v1',assertRequest(args){
        assert.equal(args.model,trial.model);assert.equal(args.caseId,trial.caseId);
        assert.deepEqual(args.request,buildCABEffortRequest({kind:'cab_effort_screening_v1',configuration:trial.configuration,round:trial.round},plan.inputFor(plan.cases.find(q=>q.id===trial.caseId))));
      }}}),onEvidence:(kind,row)=>{
        write(resolve(dir,`${kind}-${kind==='attempt'?row.id:row.trialKey}.json`),row);
        console.log(JSON.stringify({event:kind,trial:row.trialKey,model:row.model,effort:row.reasoningEffort,
          ...(kind==='logical'?{answer:row.content_score?.answer,correct:row.content_score?.content_correct,total_ms:row.timing.totalMs}:{}),cost_micros:row.costMicros,failure:row.failure}));
      }});
    write(resolve(dir,'results.json'),result);return {mode:'authorized-live',stopped:result.stopped,logical:result.rows.length,physical:result.attempts.length,
      phase:result.phase,cumulative:result.cumulative};
  }finally{budget?.close();unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(x=>console.log(JSON.stringify(x,null,2))).catch(()=>{
  process.stderr.write('CAB effort experiment stopped: validation or execution error; preserve receipts and ledger. No automatic redispatch.\n');process.exitCode=1;
});
