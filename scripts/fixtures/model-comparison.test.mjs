import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';

// Apply before importing the evaluation code. The parent check also denies networking
// with a process sandbox; this guard turns accidental attempts into explicit failures.
let networkAttempts = 0;
const noNetwork = () => { networkAttempts++; throw new Error('Offline comparison test attempted network access'); };
globalThis.fetch = noNetwork;
http.request = http.get = https.request = https.get = noNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = noNetwork;
syncBuiltinESMExports();
after(() => assert.equal(networkAttempts, 0, 'no network API was invoked'));

const {MODEL_IDS, buildRequest, pairedSchedule, scoreAnswer, executeComparison, ComparisonFailure} =
  await import('../lib/model-comparison.mts');
const {ComparisonBudget} = await import('../lib/model-comparison-budget.mts');
const {loadComparisonPlan, main, DEFAULT_CONFIG} = await import('../run-model-comparison.mjs');

function temporary(t) {
  const directory = mkdtempSync('/tmp/notchspi-model-comparison-test-');
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  return directory;
}
const model = id => ({id, rate:{inputMicrosPerMillion:1_000_000,outputMicrosPerMillion:1_000_000},
  bounds:{inputTokens:100,outputTokens:100}});
const models = MODEL_IDS.map(model);
function item(id='one', overrides={}) {
  return {id,category:'calculation',status:'available',language:'ja',kind:'single_choice',
    image_quality:'synthetic_clear',origin:'synthetic_regression',previously_seen:true,
    gold_reliability:'synthetic_test_only',images:[],
    expected:{expectation:'answerable',state:'ready',reason:'none',accepted_answers:['B'],
      answer_scoring:{mode:'label_set',labels:['A','B','C']}}, ...overrides};
}
function output(answer='B', kind='single_choice', state='ready', reason='none') {
  return (state === 'retake' ? '' : `FINAL: ${answer}\n`) + 'NSPI_RESULT_V1: ' +
    JSON.stringify({v:1,kind,state,answer:state === 'retake' ? null : answer,reason});
}
const usage = {inputTokens:3,outputTokens:2};
const successful = async ({onDelta}) => {onDelta(output());return {usage,finishReason:'stop'};};
function setup(t, options={}) {
  const directory = temporary(t);
  const selectedModels = options.models ?? models;
  const budget = new ComparisonBudget(join(directory,'budget.sqlite3'),
    {campaignId:'offline-comparison-test',limitMicros:options.limitMicros ?? 100_000}, selectedModels);
  t.after(() => budget.close());
  return {directory,budget,run:overrides => executeComparison({cases:[item()],models:selectedModels,
    promptFor:() => ({system:'Frozen system',task:'Frozen task'}),
    imagesFor:() => [{base64:Buffer.from('synthetic bytes').toString('base64'),mediaType:'image/png'}],
    budget,transport:{kind:'offline-mock',invoke:successful},
    limits:{firstProgressMs:100,generationMs:200,leaseMs:400,maxRetries:0,maxConsecutiveFailures:10},
    ...overrides})};
}

test('paired schedule rotates model order for the same cases and excludes missing slots', () => {
  const rows = pairedSchedule([item('a'),item('b'),item('c'),item('absent',{status:'missing'})]);
  assert.equal(rows.length, 9);
  for (const [index,id] of ['a','b','c'].entries()) {
    const expected = [...MODEL_IDS.slice(index),...MODEL_IDS.slice(0,index)];
    assert.deepEqual(rows.filter(row => row.caseId === id).map(row => row.model), expected);
  }
  assert.equal(rows.some(row => row.caseId === 'absent'), false);
});

test('adapters preserve system, task, byte order and output cap while declaring provider mapping', () => {
  const input = {system:'Frozen Japanese problem rules',task:'Use the final image as the target',images:[
    {base64:'cmVmZXJlbmNl',mediaType:'image/png'}, {base64:'dGFyZ2V0',mediaType:'image/jpeg'}]};
  const before = JSON.stringify(input);
  for (const id of MODEL_IDS) {
    const request = buildRequest(id, input);
    assert.equal(request.body.model,id);
    assert.equal(request.body.messages[0].content,input.system);
    assert.equal(request.body.messages[1].content[0].text,input.task);
    assert.deepEqual(request.body.messages[1].content.slice(1).map(block => block.image_url.url),[
      'data:image/png;base64,cmVmZXJlbmNl','data:image/jpeg;base64,dGFyZ2V0']);
    assert.equal(request.body.stream,true);
    assert.deepEqual(request.body.stream_options,{include_usage:true});
    assert.equal(request.body.reasoning_effort,'low');
    assert.ok(request.parameterMapping);
    if (id === 'deepseek-flash') {
      assert.equal(request.body.max_tokens,8192);
      assert.deepEqual(request.body.thinking,{type:'enabled'});
      assert.equal(request.body.messages[1].content[1].image_url.detail,undefined);
    } else {
      assert.equal(request.body.max_completion_tokens,8192);
      assert.equal(request.body.messages[0].role,'developer');
      assert.equal(request.body.service_tier,'default');
      assert.equal(request.body.store,false);
      assert.equal(request.body.messages[1].content[1].image_url.detail,'high');
    }
    assert.equal(request.body.temperature,undefined);
  }
  assert.equal(JSON.stringify(input),before);
  assert.throws(() => buildRequest('unapproved-model',input));
});

test('answer scoring reuses set and ordered-answer semantics and rejects incomplete output', () => {
  const multiple = item('multi',{kind:'multiple_choice',expected:{expectation:'answerable',state:'ready',reason:'none',
    accepted_answers:['A,C'],answer_scoring:{mode:'label_set',labels:['A','B','C']}}});
  assert.equal(scoreAnswer(output('C,A','multiple_choice'),multiple,'stop').correct,true);
  assert.equal(scoreAnswer(output('A','multiple_choice'),multiple,'stop').correct,false);
  const ordering = item('order',{kind:'ordering',expected:{expectation:'answerable',state:'ready',reason:'none',
    accepted_answers:['B,A,C'],answer_scoring:{mode:'label_sequence',labels:['A','B','C'],prefilled:[]}}});
  assert.equal(scoreAnswer(output('B,A,C','ordering'),ordering,'stop').correct,true);
  assert.equal(scoreAnswer(output('C,A,B','ordering'),ordering,'stop').correct,false);
  assert.equal(scoreAnswer(output(),item(),'length').valid,false);
  assert.equal(scoreAnswer('FINAL: B',item(),'stop').valid,false);
  assert.equal(scoreAnswer(output(),item('unknown',{expected:null}),'stop').correct,null);
  const reviewed=scoreAnswer(output('B','single_choice','review','ambiguous_question'),item(),'stop');
  assert.equal(reviewed.correct,true,'answer accuracy is distinct from result-state agreement');
  assert.equal(reviewed.stateCorrect,false);
});

test('retake is a boundary decision; screen-query no-result is outside this frozen contract', () => {
  const cropped = item('crop',{category:'boundary',kind:'other',expected:{expectation:'retake',state:'retake',
    reason:'cropped',accepted_answers:[],answer_scoring:null}});
  const score = scoreAnswer(output(null,'other','retake','cropped'),cropped,'stop');
  assert.equal(score.correct,null);
  assert.equal(score.boundaryCorrect,true);
  assert.equal(scoreAnswer(output(),cropped,'stop').boundaryCorrect,false);
  const outside = item('outside',{category:'boundary',expected:{expectation:'out_of_scope',state:null,
    reason:'unsupported_scope',accepted_answers:[],answer_scoring:null}});
  const noResult=scoreAnswer('NSPI_NO_RESULT_V1: {"v":1,"reason":"unsupported_scope"}',outside,'stop');
  assert.equal(noResult.boundaryCorrect,false);
  assert.equal(noResult.valid,false);
  assert.equal(noResult.failure,'unsupported_protocol');
});

test('no-result on an answerable item is a failure; valid boundary decisions have a separate completion time', async t => {
  const {run}=setup(t,{models:[models[0]]});
  const boundary=item('boundary',{category:'boundary',kind:'other',expected:{expectation:'retake',state:'retake',
    reason:'cropped',accepted_answers:[],answer_scoring:null}});
  const unsupported=item('unsupported',{category:'boundary',expected:{expectation:'out_of_scope',state:null,
    reason:'unsupported_scope',accepted_answers:[],answer_scoring:null}});
  const result=await run({cases:[item('answerable'),boundary,unsupported],transport:{kind:'offline-mock',async invoke({caseId,onDelta}) {
    onDelta(caseId!=='boundary'?'NSPI_NO_RESULT_V1: {"v":1,"reason":"unsupported_scope"}':output(null,'other','retake','cropped'));
    return {usage,finishReason:'stop'};
  }}});
  assert.equal(result.rows[0].score.correct,false);
  assert.equal(result.rows[0].failure,'unsupported_protocol');
  assert.equal(result.rows[0].timing.evaluatorValidCompleteMs,null);
  assert.equal(result.rows[1].score.boundaryCorrect,true);
  assert.equal(result.rows[1].timing.evaluatorValidCompleteMs,null);
  assert.ok(result.rows[1].timing.evaluatorBoundaryCompleteMs>=0);
  assert.equal(result.rows[2].score.valid,false);
  assert.equal(result.rows[2].timing.evaluatorBoundaryCompleteMs,null);
});

test('an invented answer to a retake case cannot inflate valid-answer completion rate or contaminate latency', async t => {
  const {run}=setup(t,{models:[models[0]]});
  const boundary=id=>item(id,{category:'boundary',kind:'other',expected:{expectation:'retake',state:'retake',
    reason:'cropped',accepted_answers:[],answer_scoring:null}});
  const result=await run({cases:[item('answerable'),boundary('invented'),boundary('retake')],
    transport:{kind:'offline-mock',async invoke({caseId,onDelta}) {
      onDelta(caseId==='retake'?output(null,'other','retake','cropped'):output());
      return {usage,finishReason:'stop'};
    }}});
  const [answerable,invented,retake]=result.rows;
  assert.equal(invented.score.boundaryCorrect,false);
  assert.equal(invented.timing.evaluatorValidCompleteMs,null);
  assert.equal(invented.timing.evaluatorBoundaryCompleteMs,null);
  assert.equal(retake.score.boundaryCorrect,true);
  assert.equal(retake.timing.evaluatorValidCompleteMs,null);
  assert.ok(retake.timing.evaluatorBoundaryCompleteMs>=0);
  assert.equal(result.summary.overall.validCompletions,1);
  assert.equal(result.summary.overall.validCompletionRate,1);
  assert.equal(result.summary.overall.evaluatorValidCompleteP50Ms,answerable.timing.evaluatorValidCompleteMs);
  assert.equal(result.summary.overall.boundaryCompletions,1);
  assert.equal(result.summary.strata['category:boundary'].evaluatorValidCompleteP50Ms,null);
  assert.equal(result.summary.strata['category:boundary'].validCompletionRate,null);
});

test('mock reports preserve failure denominators and do not claim upstream identity or UI timing', async t => {
  const {run} = setup(t,{models:[models[0]]});
  const cases = [item('correct'),item('wrong'),item('refusal'),item('format'),item('timeout'),item('unlabelled',{expected:null})];
  const result = await run({cases,transport:{kind:'offline-mock',async invoke({caseId,onDelta}) {
    if (caseId === 'timeout') throw new ComparisonFailure('timeout');
    onDelta(caseId === 'format' ? 'FINAL: B' : caseId === 'refusal' ? 'I cannot answer this question.'
      : output(caseId === 'wrong' ? 'A' : 'B'));
    return {usage,finishReason:'stop'};
  }}});
  assert.equal(result.mode,'offline-mock');
  assert.equal(result.rows.length,6);
  assert.equal(result.rows.filter(row => row.score.correct !== null).length,5);
  assert.equal(result.rows.filter(row => row.score.correct === true).length,1);
  assert.equal(result.summary.overall.answerableScored,5);
  assert.equal(result.summary.overall.accuracy,1/5);
  assert.equal(result.summary.strata['language:ja'].answerableScored,5);
  assert.equal(result.summary.overall.evaluatorValidCompleteP95Ms,null,'fewer than 20 completions cannot establish P95');
  assert.equal(result.metricsAreModelMeasurements,false);
  for (const row of result.rows) assert.equal(row.timing.uiRenderCompleteMs,null);
  for (const attempt of result.attempts) assert.equal(attempt.returnedModel,null);
});

test('a real timer aborts an unresponsive mock; late callbacks cannot change settled evidence', async t => {
  const {run,budget} = setup(t,{models:[models[0]]});
  let signal, late;
  const result = await run({limits:{firstProgressMs:10,generationMs:40,leaseMs:80,maxRetries:0,maxConsecutiveFailures:10},
    transport:{kind:'offline-mock',invoke(request) {
      signal=request.signal;late=()=>{request.onDelta(output());request.onUsage(usage);};
      return new Promise(() => {});
    }}});
  assert.equal(signal.aborted,true);
  assert.equal(result.rows[0].score.correct,false);
  assert.equal(result.rows[0].timing.evaluatorValidCompleteMs,null);
  const before=JSON.stringify(result), reserved=budget.snapshot();
  late();await delay(1);
  assert.equal(JSON.stringify(result),before);
  assert.deepEqual(budget.snapshot(),reserved);
  assert.equal(result.rows[0].costMicros,null);
});

test('reasoning progress is not the first answer and generation still has an absolute deadline', async t => {
  const {run} = setup(t,{models:[models[0]]});
  const result = await run({limits:{firstProgressMs:10,generationMs:25,leaseMs:60,maxRetries:0,maxConsecutiveFailures:10},
    transport:{kind:'offline-mock',invoke({onProgress}) {onProgress();return new Promise(() => {});}}});
  assert.equal(result.rows[0].timing.upstreamFirstAnswerMs,null);
  assert.equal(result.rows[0].timing.evaluatorValidCompleteMs,null);
  assert.equal(result.rows[0].score.correct,false);
});

test('one retry has its own reservation and preserves unknown first-attempt cost', async t => {
  const {run,budget} = setup(t,{models:[models[0]]});let calls=0;
  const result = await run({limits:{firstProgressMs:100,generationMs:200,leaseMs:400,maxRetries:1,maxConsecutiveFailures:10},
    transport:{kind:'offline-mock',async invoke(request) {
      calls++;if(calls===1)throw new ComparisonFailure('upstream_error',true,0);
      return successful(request);
    }}});
  assert.equal(calls,2);
  assert.equal(result.attempts.length,2);
  assert.equal(result.rows[0].score.correct,true);
  assert.equal(result.rows[0].costMicros,null);
  assert.equal(result.rows[0].unknownCostAttempts,1);
  assert.equal(result.rows[0].knownCostMicros,5);
  assert.equal(budget.snapshot().reservedMicros,400);
  assert.equal(budget.snapshot().unknownAttempts,1);
});

test('retry bound is one and refusal or format failures do not get selective reruns', async t => {
  const {run} = setup(t,{models:[models[0]]});let calls=0;
  const result = await run({limits:{firstProgressMs:100,generationMs:200,leaseMs:400,maxRetries:1,maxConsecutiveFailures:10},
    transport:{kind:'offline-mock',async invoke() {calls++;throw new ComparisonFailure('upstream_error',true,0);}}});
  assert.equal(calls,2);
  assert.equal(result.rows[0].score.correct,false);
  const second = setup(t,{models:[models[0]]});let badCalls=0;
  await second.run({limits:{firstProgressMs:100,generationMs:200,leaseMs:400,maxRetries:1,maxConsecutiveFailures:10},
    transport:{kind:'offline-mock',async invoke({onDelta}) {badCalls++;onDelta('FINAL: B');return {usage,finishReason:'stop'};}}});
  assert.equal(badCalls,1);
});

test('budget exhaustion stops before dispatch and observed usage does not replenish the cap', async t => {
  const {run,budget} = setup(t,{limitMicros:250});let calls=0;
  const result = await run({transport:{kind:'offline-mock',async invoke(request) {calls++;return successful(request);}}});
  assert.equal(calls,1);
  assert.equal(result.attempts.length,1);
  assert.ok(result.stopped);
  assert.equal(budget.snapshot().remainingMicros,50);
  assert.equal(budget.snapshot().knownMeteredMicros,5);
});

test('paired outcomes preserve discordant answers and explicitly expose a budget-truncated pair', async t => {
  const {run}=setup(t,{models:models.slice(0,2),limitMicros:1000});
  const result=await run({cases:[item('a'),item('b'),item('c')],transport:{kind:'offline-mock',async invoke({caseId,model,onDelta}) {
    const wrong=caseId==='a'&&model===models[1].id || caseId==='b'&&model===models[0].id;
    onDelta(output(wrong?'A':'B'));return {usage,finishReason:'stop'};
  }}});
  assert.equal(result.attempts.length,5);
  assert.deepEqual(result.unattempted,[{caseId:'c',model:models[1].id,status:'unattempted',reason:'budget_exhausted'}]);
  const paired=result.summary.paired.find(row=>row.candidate===models[1].id);
  assert.equal(paired.plannedPairs,3);
  assert.equal(paired.completePairs,2);
  assert.equal(paired.incompletePairs,1);
  assert.equal(paired.scoredPairs,2);
  assert.equal(paired.candidateOnlyCorrect,1);
  assert.equal(paired.baselineOnlyCorrect,1);
  assert.equal(paired.accuracyDifference,0);
  assert.equal(paired.statisticalClaim,'screening_only_no_noninferiority_claim');
  assert.equal(result.summary.plannedCompletionRate,5/6);
  assert.equal(result.summary.fullPlanValidAnswerRate,5/6);
  assert.equal(result.summary.strata[`model:${models[0].id}|language:ja`].accuracy,2/3);
});

test('execution model rates must match the ledger; a provider refusal remains a scored failure without retry', async t => {
  const {run,budget}=setup(t,{models:[models[0]]});
  const changed={...models[0],rate:{...models[0].rate,inputMicrosPerMillion:2_000_000}};
  await assert.rejects(run({models:[changed]}));
  assert.equal(budget.snapshot().reservedMicros,0);
  let calls=0;
  const result=await run({limits:{maxRetries:1},transport:{kind:'offline-mock',async invoke() {
    calls++;return {usage,finishReason:'content_filter'};
  }}});
  assert.equal(calls,1);
  assert.equal(result.rows[0].score.correct,false);
  assert.equal(result.rows[0].failure,'refusal');
  assert.equal(result.rows[0].timing.evaluatorValidCompleteMs,null);
  assert.equal(result.summary.overall.answerableScored,1);
  assert.equal(result.summary.overall.failureReasons.refusal,1);
});

test('persistent ledger cannot reset its cap or reuse a physical attempt', t => {
  const path=join(temporary(t),'persistent.sqlite3'), policy={campaignId:'persist',limitMicros:450};
  const first=new ComparisonBudget(path,policy,[models[0]]);
  assert.equal(first.reserve('attempt-1','question',models[0].id,'answer'),200);
  first.close();
  const reopened=new ComparisonBudget(path,policy,[models[0]]);
  try {
    assert.equal(reopened.snapshot().reservedMicros,200);
    assert.throws(()=>reopened.reserve('attempt-1','question',models[0].id,'retry'));
    reopened.reserve('attempt-2','question',models[0].id,'retry');
    assert.throws(()=>reopened.reserve('attempt-3','question',models[0].id,'retry'));
  } finally {reopened.close();}
  assert.throws(()=>new ComparisonBudget(path,{...policy,limitMicros:900},[models[0]]));
});

test('missing and malformed usage remain unknown; over-bound usage halts later dispatch', t => {
  const {budget}=setup(t,{models:[models[0]]});
  for (const [index,value] of [null,{inputTokens:-1,outputTokens:2},{inputTokens:2.5,outputTokens:1},
    {inputTokens:1,outputTokens:null}].entries()) {
    const id=`unknown-${index}`;budget.reserve(id,id,models[0].id,'answer');
    assert.equal(budget.observe(id,value),null);
  }
  assert.equal(budget.snapshot().unknownAttempts,4);
  assert.equal(budget.snapshot().reservedMicros,800);
  budget.reserve('too-many','question',models[0].id,'answer');
  assert.throws(()=>budget.observe('too-many',{inputTokens:101,outputTokens:1}));
  assert.equal(budget.snapshot().halted,true);
  assert.throws(()=>budget.reserve('later','question',models[0].id,'answer'));
});

test('estimated token cost, conservative reservation, and unmeasured invoice cost remain distinct', async t => {
  const conservative={...models[0],reserveRate:{inputMicrosPerMillion:2_000_000,outputMicrosPerMillion:3_000_000}};
  const {run,budget}=setup(t,{models:[conservative]});
  const result=await run();
  assert.equal(budget.snapshot().reservedMicros,500);
  assert.equal(budget.snapshot().knownMeteredMicros,5);
  assert.equal(result.rows[0].costMicros,5);
  assert.equal(result.rows[0].costBasis,'pricing_estimate');
  assert.equal(result.rows[0].actualInvoiceCostMicros,null);
  assert.equal(result.summary.overall.costPer1000Micros,5000);
  assert.equal(result.summary.overall.costPerCorrectMicros,5);
});

test('declared recovery and fallback physical calls aggregate under the original logical question', async t => {
  const {run}=setup(t);const purposes=[];
  const result=await run({cases:[item()],models:models.slice(0,2),auxiliary:{recover:true,fallbackModel:models[1].id},
    transport:{kind:'offline-mock',async invoke(request) {
      purposes.push(request.purpose);
      if(request.model===models[0].id)throw new ComparisonFailure('upstream_error');
      return successful(request);
    }}});
  assert.deepEqual(purposes,['answer','recover','fallback','answer']);
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].attemptIds.length,3);
  assert.equal(result.rows[0].unknownCostAttempts,2);
  assert.equal(result.rows[0].costMicros,null);
  assert.equal(result.rows[0].knownCostMicros,5);
});

test('undeclared fallback is rejected without expanding the planned model pool', async t => {
  const {run,budget}=setup(t,{models:[models[0]]});
  await assert.rejects(run({auxiliary:{fallbackModel:models[1].id}}),/explicitly planned/);
  assert.equal(budget.snapshot().reservedMicros,0);
});

test('usage before a lost response is retained; a later different usage record halts the campaign', async t => {
  const {run,budget}=setup(t,{models:[models[0]]});
  const result=await run({transport:{kind:'offline-mock',async invoke({onUsage}) {
    onUsage(usage);throw new ComparisonFailure('network_error');
  }}});
  assert.equal(result.rows[0].score.correct,false);
  assert.equal(result.rows[0].costMicros,5);
  assert.equal(result.rows[0].unknownCostAttempts,0);
  assert.equal(budget.snapshot().reservedMicros,200);
  const attempt=result.attempts[0].id;
  assert.throws(()=>budget.observe(attempt,{inputTokens:4,outputTokens:2}),/Conflicting/);
  assert.equal(budget.snapshot().halted,true);
  assert.equal(budget.snapshot().knownMeteredMicros,5);
});

test('non-mock transport is rejected before any invocation or budget reservation', async t => {
  const {run,budget}=setup(t);let invoked=false;
  await assert.rejects(run({transport:{kind:'live',async invoke(){invoked=true;return {usage,finishReason:'stop'};}}}));
  assert.equal(invoked,false);
  assert.equal(budget.snapshot().reservedMicros,0);
});

const repository = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function copyFrozenPlan(t) {
  const root=temporary(t), config=JSON.parse(readFileSync(join(repository,DEFAULT_CONFIG),'utf8'));
  const corpus=JSON.parse(readFileSync(join(repository,config.cases_manifest.path),'utf8'));
  const files=new Set([DEFAULT_CONFIG,config.cases_manifest.path,config.materials_manifest.path,'shared/prompts.json',...config.freeze.sources.map(ref=>ref.path)]);
  for(const row of corpus.slots.filter(row=>row.status==='available')) {
    files.add(row.source_manifest);
    for(const image of row.images) files.add(image.path);
  }
  for(const file of files) {
    const target=join(root,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(repository,file),target);
  }
  return {root,config,corpus};
}

test('default entry is read-only with 28 × 3 execution and 40 retained inventory slots', async t => {
  const {root}=copyFrozenPlan(t);
  const result=await main([],root);
  assert.equal(result.mode,'dry-run');
  assert.equal(result.paid_calls,0);
  assert.equal(result.network_transport,'absent');
  assert.equal(result.available_cases+result.missing_slots.length,40);
  assert.equal(result.schedule.length,result.available_cases*3);
  assert.equal(result.budget.initial_physical_calls,84);
  assert.equal(result.budget.maximum_physical_calls,168);
  assert.equal(result.budget.bounds_verified,false);
  assert.ok(result.paid_execution_blockers.includes('external_processing_not_approved'));
  assert.ok(result.paid_execution_blockers.includes('paid_budget_not_approved'));
  assert.equal(existsSync(join(root,'output')),false);
});

test('paid flags are rejected before even attempting to load plan or credentials', async t => {
  const absentRoot=join(temporary(t),'not-created');
  for(const flag of ['--live','--execute','--paid','--allow-network']) {
    await assert.rejects(main([flag],absentRoot),/no run\/cap\/ledger overrides/);
  }
  assert.equal(existsSync(absentRoot),false);
});

test('frozen source and image byte drift fail closed; image order follows the manifest', t => {
  const {root,config}=copyFrozenPlan(t);
  const before=loadComparisonPlan(root);
  const source=join(root,config.freeze.sources[0].path), original=readFileSync(source);
  writeFileSync(source,Buffer.concat([original,Buffer.from('\n')]));
  assert.throws(()=>loadComparisonPlan(root),/Artifact drift/);
  writeFileSync(source,original);
  const first=before.cases[0], image=join(root,first.images[0].path), bytes=readFileSync(image);
  writeFileSync(image,Buffer.concat([bytes,Buffer.from([0])]));
  assert.throws(()=>loadComparisonPlan(root),/Artifact drift/);
  assert.throws(()=>before.imagesFor(first),/Artifact drift/,'bytes must be rechecked immediately before execution');
  writeFileSync(image,bytes);
  const after=loadComparisonPlan(root);
  for(const row of after.cases) {
    const encoded=after.imagesFor(row);
    assert.equal(encoded.length,row.images.length);
    row.images.forEach((reference,index)=>assert.deepEqual(Buffer.from(encoded[index].base64,'base64'),readFileSync(join(root,reference.path))));
  }
});
