#!/usr/bin/env node
// Fixed 16-case campaign. Default dry-run never resolves credentials or a transport.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, lstatSync} from 'node:fs';
import {resolve, relative, dirname, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {MODEL_IDS, buildRequest, pairedSchedule, executeComparison, summarizeComparison} from './lib/model-comparison.mts';
import {ComparisonBudget, modelCallUpperMicros} from './lib/model-comparison-budget.mts';
import {tokenCostUpperMicros} from './lib/evaluation-budget.mts';
import {parseReadingAnswerScoring} from './lib/reading-answer-scoring.mts';
import {createControlledTransport, ENDPOINTS} from './lib/model-comparison-transport.mts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CAMPAIGN = 'spi-screening-20261117';
export const DIRECTORY = `output/${CAMPAIGN}`;
export const CONFIG = `${DIRECTORY}/config.json`;
export const AUTHORIZATION = `${DIRECTORY}/authorization.json`;
export const PAID_DIRECTORY = `output/${CAMPAIGN}-paid`;
export const CONSUMED = `output/${CAMPAIGN}.permit-consumed.json`;
export const DEDICATED_CREDENTIALS = 'output/model-comparison-preflight-20261117/credentials.env';
export const CASE_IDS = ['M02','M03','M04','M05','M08','M09','C01','C05','P01','R01','R02','R03','F01','F02','F03','F04'];
const OLD_SOURCE = 'output/spi-ja-review-20261117/suitability-review/question-review.json';
const NEW_SOURCE = 'output/spi-ja-review-20261117/candidate-update/new-candidates.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function safePath(root, path, mustExist = true) {
  assert.ok(typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\\')
    && !path.split('/').includes('..'), 'Invalid local artifact path');
  assert.ok(!/(?:^|\/)(?:\.git|\.env[^/]*|private|credentials?|secrets?)(?:\/|$)/iu.test(path), 'Sensitive path refused');
  const absolute = resolve(root, path);
  let ancestor = mustExist ? absolute : dirname(absolute);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  assert.equal(realpathSync(ancestor), ancestor, 'Symlinked artifact refused');
  assert.ok(!relative(realpathSync(root), absolute).startsWith('..'), 'Artifact leaves project');
  return absolute;
}
const read = (root, path) => readFileSync(safePath(root, path));
function bound(root, ref) {
  assert.match(ref.sha256, /^[0-9a-f]{64}$/u);
  const bytes = read(root, ref.path);
  assert.equal(sha(bytes), ref.sha256, `Frozen artifact changed: ${ref.path}`);
  return bytes;
}
function writeNew(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag:'wx', mode:0o600});
}

export function budgetQuote(config, cases) {
  const models = config.models.map(model => {
    const means = cases.map(item => config.budget.case_assumptions[item.id]);
    const expected = means.map(mean => tokenCostUpperMicros(mean.input_tokens[model.id], mean.total_output_tokens,
      model.rate.inputMicrosPerMillion, model.rate.outputMicrosPerMillion));
    const rate = model.reserveRate;
    const settlement = means.map(mean => tokenCostUpperMicros(mean.input_tokens[model.id], mean.total_output_tokens,
      rate.inputMicrosPerMillion, rate.outputMicrosPerMillion));
    const total = expected.reduce((a,b) => a+b,0);
    return {model:model.id,questions:cases.length,mean_input_tokens:means.reduce((s,m)=>s+m.input_tokens[model.id],0)/cases.length,
      mean_total_output_tokens:means.reduce((s,m)=>s+m.total_output_tokens,0)/cases.length,
      estimated_initial_micros:total,estimated_mean_per_question_micros:total/cases.length,
      all_once_retry_additional_micros:total,per_physical_reserve_micros:modelCallUpperMicros(model),
      expected_conservative_settlement_micros:settlement.reduce((a,b)=>a+b,0)};
  });
  const sum = key => models.reduce((s,m)=>s+m[key],0);
  return {currency:'USD',status:'estimate_not_authorization_or_invoice',questions:cases.length,
    images:cases.reduce((s,q)=>s+q.images.length,0),initial_calls:cases.length*models.length,
    maximum_physical_calls:cases.length*models.length*(1+config.limits.maxRetries),
    estimated_initial_micros:sum('estimated_initial_micros'),
    ten_percent_retry_scenario_additional_micros:Math.ceil(sum('estimated_initial_micros')*.1),
    all_once_retry_additional_micros:sum('all_once_retry_additional_micros'),
    expected_conservative_settlement_micros:sum('expected_conservative_settlement_micros'),
    all_initial_holds_sum_micros:cases.length*sum('per_physical_reserve_micros'),
    hold_sum_is_not_required_approval:true,proposed_cap_micros:config.budget.proposed_limit_micros,
    empirical_bounds_not_invoice_guarantee:true,actual_cost_micros:null,models};
}

export function materialScope(plan) {
  return plan.cases.map(q=>({case_id:q.id,group:q.group,images:q.images.map(i=>i.sha256),models:[...MODEL_IDS]}));
}

export function selectExecution(plan,selection) {
  assert.equal(selection.schema_version,1);assert.equal(selection.experiment_id,CAMPAIGN);
  assert.deepEqual(selection.approved_full_case_ids,CASE_IDS);
  assert.deepEqual(selection.case_decisions.map(x=>x.case_id),CASE_IDS);
  for(const item of selection.case_decisions){
    assert.ok(['execute','defer'].includes(item.disposition));
    assert.ok(item.reason?.trim()&&item.evidence_reference?.trim());
    if(item.disposition==='execute'){
      assert.equal(item.user_dispatch_authorized,true);
      assert.equal(item.rights_status,'license_basis_sufficient_for_this_use');
    }
  }
  const selected=new Set(selection.case_decisions.filter(x=>x.disposition==='execute').map(x=>x.case_id));
  assert.ok(selected.size>0);
  const preparedCases=plan.preparedCases??plan.cases;
  return {...plan,preparedCases,selection,cases:preparedCases.filter(q=>selected.has(q.id)),
    deferredCases:selection.case_decisions.filter(x=>x.disposition==='defer')};
}

// The user designated this local evaluation-only file. Never resolve production keys.
export function loadDedicatedCredentials(root=ROOT) {
  const file=resolve(root,DEDICATED_CREDENTIALS);
  assert.equal(realpathSync(file),file,'Credential file must not be symlinked');
  const info=lstatSync(file);assert.ok(info.isFile()&&(info.mode&0o077)===0&&info.size<=16384,'Private evaluation credential file required');
  const allowed=['NSPI_EVAL_OPENAI_KEY','NSPI_EVAL_DEEPSEEK_KEY'],keys={};
  for(const line of readFileSync(file,'utf8').split(/\r?\n/u)){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const match=/^(?:export\s+)?(NSPI_EVAL_OPENAI_KEY|NSPI_EVAL_DEEPSEEK_KEY)\s*=\s*(.*?)\s*$/u.exec(line.trim());
    assert.ok(match,'Invalid evaluation credential file format');
    let value=match[2];if(value.startsWith('"')&&value.endsWith('"')||value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
    assert.ok(value.length>=10&&!/[\s\r\n]/u.test(value)&&!keys[match[1]],'Invalid or duplicate evaluation credential');keys[match[1]]=value;
  }
  assert.ok(allowed.every(key=>keys[key]),'Missing dedicated evaluation credential');return keys;
}

export function loadPlan(root = ROOT) {
  root = realpathSync(root);
  const bytes = read(root,CONFIG),config = JSON.parse(bytes);
  assert.equal(config.id,CAMPAIGN); assert.equal(config.schema_version,1);
  assert.equal(config.paid_calls_authorized,0);
  assert.deepEqual(config.models.map(m=>m.id),MODEL_IDS);
  assert.equal(config.budget.maximum_physical_calls,96);
  assert.ok(Number.isSafeInteger(config.budget.proposed_limit_micros)&&config.budget.proposed_limit_micros>0);
  for(const model of config.models){
    assert.equal(model.endpoint,ENDPOINTS[model.id]);
    assert.deepEqual(model.bounds,{inputTokens:16000,outputTokens:8192});
    modelCallUpperMicros(model);
  }
  assert.equal(config.route.result_protocol,'objective_v1'); assert.equal(config.route.response_contract,'legacy');
  assert.deepEqual(config.limits,{firstProgressMs:20000,generationMs:90000,leaseMs:120000,maxRetries:1,maxConsecutiveFailures:3});
  assert.equal(config.recovery_and_fallback.enabled,false);
  for (const ref of config.freeze.sources) bound(root,ref);
  const head = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],env:{PATH:'/usr/bin:/bin'}}).trim();
  assert.equal(head,config.freeze.git_head,'Source identity changed');
  const shared = JSON.parse(read(root,'shared/prompts.json'));
  assert.equal(config.prompts.system,shared.objectiveBriefPrompt.replaceAll('{{objectiveResultClause}}',shared.objectiveResultClause));
  assert.equal(config.prompts.single_task,`Analyze the attached screenshot image, then ${shared.objectiveTask}`);
  assert.equal(config.prompts.multiple_task_template,`Analyze the {{imageCount}} attached screenshot images in order, then ${shared.contextTask}`);
  const dataset = JSON.parse(bound(root,config.cases_manifest));
  const materials = JSON.parse(bound(root,config.materials_manifest));
  const cases = dataset.questions;
  assert.deepEqual(cases.map(q=>q.id),CASE_IDS,'Only the approved preparation scope is supported');
  const old = JSON.parse(read(root,OLD_SOURCE)).questions, fresh = JSON.parse(read(root,NEW_SOURCE)).questions;
  for (const q of cases) {
    const isOld = !['P','R','F'].includes(q.id[0]);
    assert.equal(q.source_record.path,isOld?OLD_SOURCE:NEW_SOURCE);
    const original = (isOld?old:fresh).find(x=>x.id===q.id);
    assert.ok(original); assert.equal(q.source_record.id,q.id);
    assert.equal(q.group,q.id.startsWith('F')?'cab_extension':'spi_direction');
    assert.equal(q.category,q.id.startsWith('F')?'cab_figural':q.id.startsWith('R')?'reading':q.id.startsWith('C')?'statistical_chart':'calculation');
    assert.equal(q.status,'available'); assert.equal(q.language,'ja'); assert.equal(q.kind,'single_choice');
    assert.equal(q.expected.expectation,'answerable'); assert.equal(q.expected.state,'ready'); assert.equal(q.expected.reason,'none');
    assert.deepEqual(q.expected.accepted_answers,[String(isOld?original.gold_choice:original.gold_label)],'Gold differs from reviewed source');
    const labels = ['F03','F04'].includes(q.id)?['A','B','C','D']:q.id.startsWith('F')||q.id==='P01'?['A','B','C','D','E']:['1','2','3','4','5'];
    assert.deepEqual(q.expected.answer_scoring,labels[0]==='1'?{mode:'literal'}:{mode:'label_set',labels});
    parseReadingAnswerScoring(q.expected.answer_scoring,q.kind,q.expected.accepted_answers);
    assert.equal(q.images.length,1);
    if(isOld)assert.deepEqual(q.images.map(i=>i.sha256),original.images.map(i=>i.sha256));
    else assert.equal(q.images[0].path,`${DIRECTORY}/inputs/${q.id}.png`);
    for(const ref of q.images){
      assert.ok(ref.path.startsWith('output/spi-ja-review-20261117/')||ref.path.startsWith(`${DIRECTORY}/inputs/`));
      const image=bound(root,ref); assert.equal(ref.media_type,'image/png');
      assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.equal(image.readUInt32BE(16),ref.width);assert.equal(image.readUInt32BE(20),ref.height);
      assert.ok(image.length<=6*1024*1024 && ref.width*ref.height<=16_000_000);
    }
  }
  const sourceIdentity={head,config_sha256:sha(bytes),cases_sha256:config.cases_manifest.sha256,materials_sha256:config.materials_manifest.sha256,
    execution_selection_sha256:config.execution_selection?.sha256??null};
  let plan={config,cases,materials,sourceIdentity,
    promptFor:q=>({system:config.prompts.system,task:q.images.length===1?config.prompts.single_task:config.prompts.multiple_task_template.replaceAll('{{imageCount}}',String(q.images.length))}),
    imagesFor:q=>q.images.map(ref=>({base64:bound(root,ref).toString('base64'),mediaType:ref.media_type}))};
  assert.deepEqual(materials.scope,materialScope(plan));
  assert.deepEqual(materials.items.map(i=>i.case_id),CASE_IDS);
  if(config.execution_selection)plan=selectExecution(plan,JSON.parse(bound(root,config.execution_selection)));
  plan.quote=budgetQuote(config,plan.cases);
  return plan;
}

export function groupedResults(result,plan) {
  // Deliberately omit pooled accuracy: CAB must never count as SPI-direction accuracy.
  const {summary:discarded,...evidence}=result;
  const schedule=pairedSchedule(plan.cases,MODEL_IDS),groups={};
  for(const group of ['spi_direction','cab_extension']){
    const ids=new Set(plan.cases.filter(q=>q.group===group).map(q=>q.id));
    const planned=schedule.filter(r=>ids.has(r.caseId)),rows=result.rows.filter(r=>ids.has(r.caseId));
    groups[group]=summarizeComparison(rows,planned.length,planned,result.metricsAreModelMeasurements);
  }
  return {...evidence,groups,purpose:'small_sample_screening_not_SPI_population_or_production_acceptance',
    grouping:{spi_direction:plan.cases.filter(q=>q.group==='spi_direction').length,cab_extension:plan.cases.filter(q=>q.group==='cab_extension').length},
    deferred:plan.deferredCases??[]};
}

export function validateAuthorization(record,plan,now=Date.now()) {
  assert.equal(record.status,'approved','This campaign has no paid authorization');
  assert.equal(record.schema_version,1); assert.equal(record.experiment_id,CAMPAIGN);
  assert.equal(plan.config.id,CAMPAIGN);
  for(const key of ['config_sha256','cases_sha256','materials_sha256','execution_selection_sha256'])assert.equal(record[key],plan.sourceIdentity[key]);
  assert.deepEqual(record.material_scope,materialScope(plan));
  assert.deepEqual(record.prepared_material_scope,materialScope({...plan,cases:plan.preparedCases??plan.cases}));
  assert.deepEqual(record.models,MODEL_IDS.map(id=>({id,endpoint:ENDPOINTS[id]})));
  assert.equal(record.budget.currency,'USD');assert.equal(record.budget.hard_cap_micros,plan.config.budget.proposed_limit_micros);
  assert.equal(record.budget.rolling_settlement,true);assert.equal(record.maximum_attempts,plan.quote.maximum_physical_calls);
  assert.ok(record.maximum_attempts<=96);
  assert.equal(record.purpose,'small_sample_screening_separate_spi_cab_no_production_acceptance');
  for(const key of ['budget','exact_materials_and_recipients','empirical_bound_limitation_acknowledged','published_keys_and_profit_cost_denominator_accepted'])assert.equal(record.user_approval[key],true);
  assert.ok(record.user_approval.message_reference?.trim());
  const issued=Date.parse(record.user_approval.approved_at),expiry=Date.parse(record.expires_at);
  assert.ok(Number.isFinite(issued)&&Number.isFinite(expiry)&&issued<=now&&now<expiry&&expiry-issued<=86400_000,'Current approval expires within 24 hours');
  assert.deepEqual(record.rights_clearance.map(i=>i.case_id),CASE_IDS);
  for(const item of record.rights_clearance){
    const decision=plan.selection?.case_decisions.find(x=>x.case_id===item.case_id);
    if(decision)assert.equal(item.status,decision.rights_status);
    if(plan.cases.some(q=>q.id===item.case_id)){
      assert.ok(['cleared_for_named_vendors','license_basis_sufficient_for_this_use'].includes(item.status),`Vendor-processing rights unresolved: ${item.case_id}`);
      assert.ok(item.evidence_reference?.trim(),'Permission evidence required');
    }
  }
  for(const field of ['prices_versions_parameters_reviewed','account_model_visibility_verified','exact_inputs_reviewed','privacy_review_accepted'])assert.equal(record.preflight[field],true);
  assert.equal(record.preflight.billing_validation,'public_tariff_and_request_policy_checked_identity_tier_usage_checked_each_call');
  assert.ok(record.preflight.evidence_reference?.trim());
  assert.equal(record.preflight.billing_catalog_sha256,sha(JSON.stringify(plan.config.models)));
  for(const model of MODEL_IDS)assert.deepEqual(record.expected_returned_models[model],[model]);
  return true;
}

export function claimExecution(root,authDigest,configDigest) {
  const marker=safePath(root,CONSUMED,false),directory=safePath(root,PAID_DIRECTORY,false);
  assert.ok(!existsSync(marker),'Campaign permit consumed; no restart or ledger reset');
  assert.ok(!existsSync(directory),'Existing paid artifacts must not be overwritten');
  mkdirSync(dirname(marker),{recursive:true,mode:0o700});
  writeNew(marker,{campaign:CAMPAIGN,authorization_sha256:authDigest,config_sha256:configDigest,claimed_at:new Date().toISOString()});
  mkdirSync(directory,{mode:0o700});return directory;
}

async function live(plan,root) {
  const authBytes=read(root,AUTHORIZATION),authorization=JSON.parse(authBytes);validateAuthorization(authorization,plan);
  const digest=sha(authBytes);
  const assertAuthorized=()=>{assert.equal(sha(read(root,AUTHORIZATION)),digest);validateAuthorization(authorization,plan);};
  const directory=claimExecution(root,digest,plan.sourceIdentity.config_sha256);
  const budget=new ComparisonBudget(resolve(directory,'budget.sqlite3'),
    {campaignId:CAMPAIGN,limitMicros:authorization.budget.hard_cap_micros,rolling:true},plan.config.models);
  try{
    let credentials;
    const transport=createControlledTransport({assertAuthorized,expectedModels:authorization.expected_returned_models,
      credentialFor:model=>{credentials??=loadDedicatedCredentials(root);return credentials[model==='deepseek-flash'?'NSPI_EVAL_DEEPSEEK_KEY':'NSPI_EVAL_OPENAI_KEY'];}});
    writeNew(resolve(directory,'plan.json'),{source:plan.sourceIdentity,material_scope:materialScope(plan),deferred:plan.deferredCases??[],budget:plan.quote,timing_scope:'evaluator_not_user_end_to_end'});
    const result=await executeComparison({cases:plan.cases,models:plan.config.models,promptFor:plan.promptFor,imagesFor:plan.imagesFor,
      budget,transport,limits:plan.config.limits,maxUnknownAttempts:3,
      onEvidence(kind,row){writeNew(resolve(directory,`${kind}-${kind==='attempt'?row.id:row.caseId+'-'+row.model}.json`),row);}});
    writeNew(resolve(directory,'results.json'),groupedResults(result,plan));
    return {mode:'authorized-live',directory:PAID_DIRECTORY,attempts:result.attempts.length,stopped:result.stopped,budget:budget.snapshot()};
  }finally{budget.close();}
}

export async function main(args=process.argv.slice(2),root=ROOT) {
  const mock=args.length===3&&args[0]==='--mock'&&args[1]==='--out';
  assert.ok(args.length===0||mock||args.length===1&&args[0]==='--live',
    'Use dry-run, --mock --out output/<new-directory>, or --live; no run/cap/ledger/config overrides');
  const plan=loadPlan(root);
  if(args[0]==='--live')return live(plan,root);
  const preview={mode:mock?'offline-mock':'dry-run',paid_calls:0,network_transport:'absent',source:plan.sourceIdentity,
    prepared_questions:(plan.preparedCases??plan.cases).length,questions:plan.cases.length,images:plan.cases.reduce((n,q)=>n+q.images.length,0),
    groups:{spi_direction:plan.cases.filter(q=>q.group==='spi_direction').length,cab_extension:plan.cases.filter(q=>q.group==='cab_extension').length},budget:plan.quote,
    deferred:plan.deferredCases??[],schedule:pairedSchedule(plan.cases,MODEL_IDS),
    live_gate:'separate_exact_scope_authorization_required; dry-run does not read keys or dispatch'};
  if(!mock)return preview;
  assert.match(args[2],/^output\/[A-Za-z0-9/_-]+$/u);
  const directory=safePath(root,args[2],false);assert.ok(!existsSync(directory),'Never overwrite evidence');
  mkdirSync(directory,{recursive:true,mode:0o700});writeNew(resolve(directory,'plan.json'),preview);
  const budget=new ComparisonBudget(resolve(directory,'mock-budget.sqlite3'),{campaignId:`mock-${CAMPAIGN}`,limitMicros:plan.config.budget.proposed_limit_micros,rolling:true},plan.config.models);
  try{
    const result=await executeComparison({cases:plan.cases,models:plan.config.models,promptFor:plan.promptFor,imagesFor:plan.imagesFor,
      budget,limits:plan.config.limits,maxUnknownAttempts:3,transport:{kind:'offline-mock',async invoke({caseId,model,onDelta}){
        const q=plan.cases.find(q=>q.id===caseId),mean=plan.config.budget.case_assumptions[caseId];
        onDelta(`FINAL: ${q.expected.accepted_answers[0]}\nNSPI_RESULT_V1: `+JSON.stringify({v:1,kind:q.kind,state:'ready',answer:q.expected.accepted_answers[0],reason:'none'}));
        return {usage:{inputTokens:mean.input_tokens[model],outputTokens:mean.total_output_tokens},finishReason:'stop',meteringComplete:true};
      }}});
    writeNew(resolve(directory,'results.json'),{...groupedResults(result,plan),evidence_kind:'synthetic_pipeline_not_model_performance',real_model_calls:0});
    return {...preview,output_directory:args[2],mock_attempts:result.attempts.length,stopped:result.stopped,evidence_kind:'synthetic_pipeline_not_model_performance'};
  }finally{budget.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{
  process.stderr.write(`Screening stopped: ${error instanceof assert.AssertionError?error.message.split('\n')[0]:'local preparation or execution check failed'}\n`);process.exitCode=1;
});
