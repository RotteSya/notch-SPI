import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,realpathSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';

let networkAttempts=0,credentialReads=0;
const deny=()=>{networkAttempts++;throw new Error('Offline test attempted networking');};
globalThis.fetch=deny;http.request=http.get=https.request=https.get=deny;
net.connect=net.createConnection=net.Socket.prototype.connect=deny;syncBuiltinESMExports();
const environment=process.env;
process.env=new Proxy(environment,{get(target,key){
  if(typeof key==='string'&&/^NSPI_EVAL_.*KEY$/u.test(key)){credentialReads++;throw new Error('Credential read forbidden');}
  return Reflect.get(target,key);
}});
after(()=>{process.env=environment;assert.equal(networkAttempts,0);assert.equal(credentialReads,0);});

const {loadPlan,main,ROOT,CASE_IDS,AUTHORIZATION,CONSUMED,PAID_DIRECTORY,claimExecution,validateAuthorization,groupedResults,budgetQuote,selectExecution}=await import('../run-spi-screening.mjs');
const {MODEL_IDS,buildRequest,scoreAnswer,executeComparison}=await import('../lib/model-comparison.mts');
const {ComparisonBudget}=await import('../lib/model-comparison-budget.mts');
const executionPlan=loadPlan();
// Retain the earlier full16 grouping regression as a synthetic fixture only.
const plan={...executionPlan,cases:executionPlan.preparedCases};
plan.quote=budgetQuote(plan.config,plan.cases);
const sha=x=>createHash('sha256').update(x).digest('hex');
const answer=label=>`FINAL: ${label}\nNSPI_RESULT_V1: `+JSON.stringify({v:1,kind:'single_choice',state:'ready',answer:label,reason:'none'});
function temporary(t){const path=realpathSync(mkdtempSync('/tmp/notchspi-screening-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function setup(t,cap=plan.config.budget.proposed_limit_micros){
  const path=temporary(t),budget=new ComparisonBudget(join(path,'ledger.sqlite3'),{campaignId:'offline16',limitMicros:cap,rolling:true},plan.config.models);
  t.after(()=>budget.close());
  return {budget,run:overrides=>executeComparison({cases:plan.cases,models:plan.config.models,promptFor:plan.promptFor,imagesFor:plan.imagesFor,
    budget,limits:plan.config.limits,maxUnknownAttempts:3,transport:{kind:'offline-mock',invoke:success},...overrides})};
}
async function success({caseId,model,onDelta}){
  const q=plan.cases.find(q=>q.id===caseId),mean=plan.config.budget.case_assumptions[caseId];
  onDelta(answer(q.expected.accepted_answers[0]));
  return {usage:{inputTokens:mean.input_tokens[model],outputTokens:mean.total_output_tokens},finishReason:'stop',meteringComplete:true};
}

test('exact 16-case mapping, source keys and excluded material are bound',()=>{
  assert.deepEqual(plan.cases.map(q=>q.id),CASE_IDS);
  assert.deepEqual(plan.cases.map(q=>q.expected.accepted_answers[0]),['5','3','2','3','2','1','3','3','D','5','5','1','A','A','B','A']);
  assert.deepEqual(Object.fromEntries(['reading','calculation','statistical_chart','cab_figural'].map(c=>[c,plan.cases.filter(q=>q.category===c).length])),
    {reading:3,calculation:7,statistical_chart:2,cab_figural:4});
  assert.equal(plan.cases.some(q=>['M07','C09'].includes(q.id)),false);
  for(const q of plan.cases){
    assert.equal(q.images.length,1);assert.equal(q.human_key_signoff,'not_provided');
    assert.equal(scoreAnswer(answer(q.expected.accepted_answers[0]),q,'stop').correct,true);
    const wrong=(q.expected.answer_scoring.labels??['1','2','3','4','5']).find(x=>x!==q.expected.accepted_answers[0]);
    assert.equal(scoreAnswer(answer(wrong),q,'stop').correct,false);
    assert.equal(scoreAnswer(answer(q.expected.accepted_answers[0]),q,'length').valid,false);
    assert.equal(sha(Buffer.from(plan.imagesFor(q)[0].base64,'base64')),q.images[0].sha256);
  }
});

test('all models receive identical question bytes and prompts without gold or metadata',()=>{
  for(const q of plan.cases){
    const input={...plan.promptFor(q),images:plan.imagesFor(q)};
    for(const id of MODEL_IDS){
      const {body}=buildRequest(id,input);
      assert.equal(body.messages[0].content,plan.config.prompts.system);
      assert.equal(body.messages[1].content[0].text,plan.config.prompts.single_task);
      assert.equal(body.messages[1].content[1].image_url.url,`data:image/png;base64,${input.images[0].base64}`);
      assert.equal(body.messages.length,2);assert.equal(body.messages[1].content.length,2);
      assert.equal(body.reasoning_effort,'low');
      for(const field of ['accepted_answers','solution_zh','gold_status','source_record','case_id','title_zh'])assert.equal(JSON.stringify(body).includes(field),false);
    }
    if(['P','R','F'].includes(q.id[0])){
      const content=JSON.parse(readFileSync(join(ROOT,`output/spi-screening-20261117/inputs/${q.id}.content.json`)));
      assert.deepEqual(Object.keys(content),['passage','stem','options','figures']);
      const source=JSON.parse(readFileSync(join(ROOT,q.source_record.path))).questions.find(x=>x.id===q.id);
      assert.equal(content.passage,source.passage_ja);assert.equal(content.stem,source.stem_ja);assert.deepEqual(content.options,source.options_ja);
      assert.deepEqual(content.figures.map(f=>f.sha256),source.images.map(f=>f.sha256));
    }
  }
});

test('default uses the authorized common subset; pending approval fails without resolving keys',async()=>{
  const result=await main([]);assert.equal(result.paid_calls,0);assert.equal(result.network_transport,'absent');
  assert.equal(result.schedule.length,24);assert.equal(result.budget.maximum_physical_calls,48);
  assert.deepEqual(result.groups,{spi_direction:8,cab_extension:0});
  const pending=JSON.parse(readFileSync(join(ROOT,AUTHORIZATION)));pending.status='pending';
  assert.throws(()=>validateAuthorization(pending,executionPlan),/no paid authorization/);
  for(const flag of ['--run-id','--reset','--resume','--budget','--ledger','--config'])await assert.rejects(main([flag,'different']),/no run\/cap\/ledger\/config overrides/);
});

test('authorization binds all 16 images, recipients, permission evidence, cap, keys and freshness',()=>{
  const r=JSON.parse(readFileSync(join(ROOT,AUTHORIZATION))),now=Date.now();
  // In-memory fixture only: never write this synthetic approval or invoke live.
  r.status='approved';r.user_approval={budget:true,exact_materials_and_recipients:true,empirical_bound_limitation_acknowledged:true,
    published_keys_and_profit_cost_denominator_accepted:true,message_reference:'synthetic-offline-fixture',approved_at:new Date(now-1000).toISOString()};
  r.expires_at=new Date(now+1000).toISOString();
  Object.assign(r.preflight,{prices_versions_parameters_reviewed:true,account_model_visibility_verified:true,exact_inputs_reviewed:true,
    billing_validation:'public_tariff_and_request_policy_checked_identity_tier_usage_checked_each_call',
    privacy_review_accepted:true,evidence_reference:'synthetic-fixture-only',billing_catalog_sha256:sha(JSON.stringify(plan.config.models))});
  assert.equal(validateAuthorization(r,executionPlan,now),true);
  for(const mutate of [x=>x.material_scope.pop(),x=>x.material_scope[0].images[0]='wrong',x=>x.material_scope[0].group='cab_extension',
    x=>x.models[0].endpoint='https://other.invalid',x=>x.budget.hard_cap_micros++,x=>x.maximum_attempts++,
    x=>x.config_sha256='wrong',x=>x.cases_sha256='wrong',x=>x.materials_sha256='wrong',
    x=>x.rights_clearance[0].status='pending_vendor_processing_rights',x=>x.rights_clearance[0].evidence_reference='',
    x=>x.rights_clearance[8].status='cleared_for_named_vendors',x=>x.execution_selection_sha256='different',
    x=>x.preflight.account_model_visibility_verified=false,x=>x.preflight.billing_catalog_sha256='wrong',
    x=>x.user_approval.published_keys_and_profit_cost_denominator_accepted=false,x=>x.expires_at=new Date(now-1).toISOString(),
    x=>x.expected_returned_models[MODEL_IDS[0]]=['different-model']]){
    const copy=structuredClone(r);mutate(copy);assert.throws(()=>validateAuthorization(copy,executionPlan,now));
  }
});

test('deferred materials cannot reach any model; all three receive the same eight cases',async t=>{
  assert.deepEqual(executionPlan.cases.map(q=>q.id),['M02','M03','M04','M05','M08','M09','C01','C05']);
  assert.deepEqual(executionPlan.deferredCases.map(q=>q.case_id),['P01','R01','R02','R03','F01','F02','F03','F04']);
  const {run}=setup(t),sent=[];
  const result=await run({cases:executionPlan.cases,transport:{kind:'offline-mock',async invoke(args){sent.push([args.caseId,args.model]);return success(args);}}});
  assert.equal(sent.length,24);
  for(const id of MODEL_IDS)assert.deepEqual(sent.filter(x=>x[1]===id).map(x=>x[0]),executionPlan.cases.map(q=>q.id));
  const grouped=groupedResults(result,executionPlan);
  assert.equal(grouped.groups.cab_extension.overall.accuracy,null);assert.equal(grouped.groups.cab_extension.plannedLogicalCalls,0);
  assert.equal(grouped.groups.spi_direction.paired[0].plannedPairs,8);
  const invalid=structuredClone(executionPlan.selection);invalid.case_decisions[8].disposition='execute';
  assert.throws(()=>selectExecution(plan,invalid));
  const outside=structuredClone(executionPlan.selection);outside.case_decisions[0].case_id='unapproved';
  assert.throws(()=>selectExecution(plan,outside));
});

test('fixed campaign cannot be restarted through a changed identity or deleted ledger',t=>{
  const root=temporary(t),directory=claimExecution(root,'offline-fixture','config');
  writeFileSync(join(directory,'budget.sqlite3'),'synthetic');rmSync(join(directory,'budget.sqlite3'));
  assert.throws(()=>claimExecution(root,'different-approval','different-config'),/consumed/);
  rmSync(directory,{recursive:true});assert.throws(()=>claimExecution(root,'same','same'),/consumed/);
  const root2=temporary(t);claimExecution(root2,'offline','fixture');rmSync(join(root2,CONSUMED));
  assert.throws(()=>claimExecution(root2,'offline','fixture'),/Existing paid artifacts/);
});

test('48 mean-usage calls fit the proposed rolling cap despite a larger sum of holds',async t=>{
  const {run,budget}=setup(t);const result=await run();
  assert.equal(result.attempts.length,48);assert.equal(result.stopped,null);assert.equal(result.metricsAreModelMeasurements,false);
  // Planning rounds upward; the reused cost reporter rounds to the nearest micro-dollar.
  const rounding=plan.quote.estimated_initial_micros-result.budget.knownMeteredMicros;
  assert.ok(rounding>=0&&rounding<=48);
  assert.equal(result.budget.settledConservativeMicros,plan.quote.expected_conservative_settlement_micros);
  assert.equal(budget.snapshot().activeHoldMicros,0);assert.ok(plan.quote.all_initial_holds_sum_micros>plan.quote.proposed_cap_micros);
  for(const row of result.rows)assert.equal(row.timing.uiRenderCompleteMs,null);
});

test('CAB failures cannot reduce SPI-direction results or enter its paired denominator',async t=>{
  const {run}=setup(t);const result=await run({transport:{kind:'offline-mock',async invoke(args){
    if(args.caseId.startsWith('F')){
      args.onDelta(answer('D'));const m=plan.config.budget.case_assumptions[args.caseId];
      return {usage:{inputTokens:m.input_tokens[args.model],outputTokens:m.total_output_tokens},finishReason:'stop',meteringComplete:true};
    }
    return success(args);
  }}});
  const grouped=groupedResults(result,plan);assert.equal(grouped.summary,undefined);
  for(const id of MODEL_IDS){
    assert.equal(grouped.groups.spi_direction.strata[`model:${id}`].answerableScored,12);
    assert.equal(grouped.groups.spi_direction.strata[`model:${id}`].accuracy,1);
    assert.equal(grouped.groups.cab_extension.strata[`model:${id}`].answerableScored,4);
    assert.equal(grouped.groups.cab_extension.strata[`model:${id}`].accuracy,0);
    for(const [category,count] of [['reading',3],['calculation',7],['statistical_chart',2]])
      assert.equal(grouped.groups.spi_direction.strata[`model:${id}|category:${category}`].answerableScored,count);
  }
  assert.equal(grouped.groups.spi_direction.paired[0].plannedPairs,12);
  assert.equal(grouped.groups.cab_extension.paired[0].plannedPairs,4);
});

test('insufficient real-size reservation stops before invoking any mock supplier',async t=>{
  const {run,budget}=setup(t,1);let calls=0;
  const result=await run({transport:{kind:'offline-mock',async invoke(){calls++;throw new Error('must not invoke');}}});
  assert.equal(calls,0);assert.equal(result.stopped,'budget_exhausted');assert.equal(budget.snapshot().reservedMicros,0);
});

test('the existing same-model comparator still rejects different models before comparing outcomes',t=>{
  const root=temporary(t),summary=join(root,'summary.json'),baseline=join(root,'baseline.jsonl'),treatment=join(root,'treatment.jsonl');
  writeFileSync(summary,'{}');
  writeFileSync(baseline,Array.from({length:240},()=>JSON.stringify({model:MODEL_IDS[0]})).join('\n'));
  writeFileSync(treatment,Array.from({length:240},()=>JSON.stringify({model:MODEL_IDS[1]})).join('\n'));
  // Explicit fixture-only environment: never copy credentials into the child process.
  const result=spawnSync(process.execPath,[join(ROOT,'scripts/compare-objective-evals.mjs')],{encoding:'utf8',env:{
    NSPI_COMPARE_OBJECTIVE_EVALS:'1',NSPI_BASELINE_SUMMARY:summary,NSPI_TREATMENT_SUMMARY:summary,
    NSPI_BASELINE_JSONL:baseline,NSPI_TREATMENT_JSONL:treatment}});
  assert.equal(result.status,1);assert.match(result.stderr,/baseline and treatment models differ/);
});
