import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {upstreamCadence, assess, execute, claimPermit, remainingPlan, completenessPlan, assessDaily, completedFinal, pairedDailyPlan, productionComparison, groundedCompletenessPlan, assessLegacy, legacyRemainingPlan, legacyProtocolPlan, legacyBaselineBoundaryPlan, legacyDailyPairedPlan, assessLegacyDaily} from '../run-latency-prompt-quality.mjs';

const legacyOutput = (answer, state='ready', reason='none', kind='single_choice', final=answer) =>
  (state === 'retake' ? '' : `FINAL: ${final}\n`) + 'NSPI_RESULT_V1: ' +
  JSON.stringify({v:1,kind,state,answer,reason});
test('legacy gate accepts visible option text but rejects actual conflicts and invented annotations', () => {
  const expected={state:'ready',reason:'none',kind:'single_choice',answers:['B','B. イだけ']};
  assert.ok(assessLegacy(legacyOutput('B','ready','none','single_choice','B. イだけ'),expected));
  assert.ok(!assessLegacy(legacyOutput('B','ready','none','single_choice','C'),expected));
  assert.ok(!assessLegacy(legacyOutput('B','ready','none','single_choice','B. アだけ'),expected));
  assert.ok(!assessLegacy(legacyOutput('B','review','ambiguous_question'),expected));
});
test('legacy gate preserves retake, unsupported review and all required subparts', () => {
  const missing={state:'retake',reason:'missing_context'};
  assert.ok(assessLegacy(legacyOutput(null,'retake','missing_context','other'),missing));
  assert.ok(!assessLegacy('FINAL: B\n'+legacyOutput(null,'retake','missing_context','other'),missing));
  const unsupported={state:'review',reason:'unsupported',kind:'other'};
  assert.ok(assessLegacy(legacyOutput('説明が必要','review','unsupported','other'),unsupported));
  assert.ok(!assessLegacy('NSPI_NO_RESULT_V1: {"v":1,"reason":"unsupported_scope"}',unsupported));
  const parts={state:'ready',reason:'none',kind:'short_fill',answers:['(1) 3; (2) 48 km/h']};
  assert.ok(assessLegacy(legacyOutput(parts.answers[0],'ready','none','short_fill'),parts));
  assert.ok(!assessLegacy(legacyOutput('(1) 3','ready','none','short_fill'),parts));
});

test('legacy execution rejects truncation and stops before second dispatch', async t => {
  const item={id:'Q11',variants:['A','B'],base64:'offline-fixture',legacy_expected:{state:'ready',reason:'none',kind:'single_choice',answers:['B']}};
  const legacy={bundle:{baseline:{system_template:'actual legacy',task:'task'},candidate:{system_template:'candidate',task:'task'}},
    cases:[item],bindings:{scope:'legacy-objective-grounding-screening-only',approved_calls:2,profile:'general',language:'zh',max_tokens:32768}};
  let calls=0;
  const result=await execute(legacy,legacy.bindings,join(temporary(t),'run'),{async stream(request,delta){
    calls++; assert.equal(request.system,'actual legacy');assert.equal(request.maxTokens,32768);
    delta(legacyOutput('B')); return {inputTokens:1,outputTokens:1,finishReason:'length'};
  }});
  assert.equal(result.stopped,'quality_gate');assert.equal(calls,1);
});

test('production comparison uses numeric budget values, not a stale revision label', () => {
  const bytes = Buffer.from(JSON.stringify({environment: {
    OFFICIAL_MODEL: 'deepseek-flash', OFFICIAL_DEEPSEEK_REASONING_EFFORT: 'low',
    OFFICIAL_MAX_TOKENS: '4096', OBJECTIVE_RESULT_V1_MAX_TOKENS: '32768',
    CLIENT_CONFIG_REVISION: 'production-low-2048',
  }}));
  const experiment = {model: 'deepseek-flash', reasoning_effort: 'low', max_tokens: 2048};
  const comparison = productionComparison(experiment, bytes);
  assert.deepEqual(comparison.mismatches, ['max_tokens']);
  assert.equal(comparison.expected.max_tokens, 32768);
  assert.equal(experiment.max_tokens, 2048, 'reporting must not expand paid request scope');
  assert.equal(comparison.live_parameters_verified, false);
  assert.equal(comparison.end_to_end_equivalence, false);
  const changed = productionComparison(experiment, Buffer.from(bytes.toString().replace('32768', '16384')));
  assert.notEqual(changed.profile_sha256, comparison.profile_sha256);
});

const bundle = JSON.parse(readFileSync(new URL('../../docs/experiments/latency-prompt-decision-order-v1.json', import.meta.url)));
const reasons = ['multiple_targets', 'missing_context', 'cropped', 'unsupported_scope'];
const answer = reason => ['multiple_targets','unsupported_scope'].includes(reason)
  ? `NSPI_NO_RESULT_V1: {"v":1,"reason":"${reason}"}`
  : `NSPI_RESULT_V1: {"v":1,"kind":"other","state":"retake","answer":null,"reason":"${reason}"}`;
const plan = {bundle, bindings:{max_tokens:2048,profile:'reading_practice',language:'zh',scope:'prompt-quality-only',approved_calls:8}, cases: reasons.map((reason,i) => ({
  id:`case-${i}`, expected_reason:reason, variants:i%2 ? ['B','A']:['A','B'], base64:'offline-fixture'
}))};
function temporary(t) {
  const dir=mkdtempSync('/tmp/notchspi-quality-test-');
  t.after(()=>rmSync(dir,{recursive:true,force:true})); return dir;
}

test('quality gates reject plausible answers and protocol mixing',()=>{
  for(const reason of reasons) {
    assert.equal(assess(answer(reason),reason),true);
    assert.equal(assess('FINAL: B\n'+answer(reason),reason),false);
    assert.equal(assess(answer(reason),'unreadable'),false);
  }
});
test('eight mock calls retain input, low, and frozen A/B order; no ninth dispatch',async t=>{
  const dir=temporary(t);let calls=0;
  const provider={async stream(request,delta){
    const row=plan.cases[Math.floor(calls/2)],variant=row.variants[calls%2];calls++;
    const expected=variant==='A'?bundle.baseline:bundle.candidate;
    assert.equal(request.system,expected.system_template.replaceAll('${profile}','reading_practice').replaceAll('${language}','zh'));
    assert.equal(request.task,expected.task);assert.equal(request.reasoningEffort,'low');
    assert.equal(request.images[0].base64,'offline-fixture');
    delta(answer(row.expected_reason));return {inputTokens:1,outputTokens:1,finishReason:'stop'};
  }};
  const result=await execute(plan,plan.bindings,join(dir,'run'),provider);
  assert.equal(result.calls,8);assert.equal(result.passed,true);assert.equal(calls,8);
  assert.equal(readFileSync(join(dir,'run/dispatches.jsonl'),'utf8').trim().split('\n').length,8);
  await assert.rejects(execute(plan,plan.bindings,join(dir,'run'),provider));assert.equal(calls,8);
});
test('request error is reserved once and never retried',async t=>{
  const dir=temporary(t);let calls=0;
  const result=await execute(plan,plan.bindings,join(dir,'run'),{async stream(){calls++;throw new Error('do not log private content');}});
  assert.equal(calls,1);assert.equal(result.stopped,'request_error_no_retry');
  assert.equal(readFileSync(join(dir,'run/dispatches.jsonl'),'utf8').trim().split('\n').length,1);
  assert.ok(!readFileSync(join(dir,'run/1-error.json'),'utf8').includes('private content'));
});
test('quality failure stops before another paid sample',async t=>{
  const dir=temporary(t);let calls=0;
  const result=await execute(plan,plan.bindings,join(dir,'run'),{async stream(_request,delta){calls++;delta('FINAL: B');return {finishReason:'stop'};}});
  assert.equal(calls,1);assert.equal(result.stopped,'quality_gate');
});
test('permit mismatch refuses before output creation or dispatch',async t=>{
  const dir=temporary(t);let calls=0;
  await assert.rejects(execute(plan,{approved_calls:9},join(dir,'run'),{async stream(){calls++;}}));
  assert.equal(calls,0);assert.equal(existsSync(join(dir,'run')),false);
});
test('same permit cannot be reused even with a new output path',t=>{
  const dir=temporary(t),permit=join(dir,'approval.json');
  claimPermit(permit,join(dir,'one'));
  assert.throws(()=>claimPermit(permit,join(dir,'two')),/EEXIST/u);
});
test('missing metering stops even when the answer passes its quality gate',async t=>{
  const dir=temporary(t);let calls=0;
  const result=await execute(plan,plan.bindings,join(dir,'run'),{async stream(_request,delta){
    calls++;delta(answer('multiple_targets'));return {inputTokens:null,outputTokens:null,finishReason:'stop'};
  }});
  assert.equal(calls,1);assert.equal(result.passed,false);
});
test('remaining batch excludes both previous inputs and requires its own four-call permit',async t=>{
  const dir=temporary(t),remaining=remainingPlan(plan);let calls=0;
  assert.deepEqual(remaining.cases.map(c=>c.expected_reason),['cropped','unsupported_scope']);
  assert.deepEqual(remaining.cases.map(c=>c.variants),[['A','B'],['B','A']]);
  assert.equal(remaining.bindings.approved_calls,4);
  await assert.rejects(execute(remaining,plan.bindings,join(dir,'old-permit'),{async stream(){calls++;}}));
  assert.equal(calls,0);
  const result=await execute(remaining,remaining.bindings,join(dir,'new-batch'),{async stream(_request,delta){
    delta(answer(remaining.cases[Math.floor(calls++/2)].expected_reason));
    return {inputTokens:1,outputTokens:1,finishReason:'stop'};
  }});
  assert.equal(result.calls,4);assert.equal(result.passed,true);
});
test('undersized but internally matching permit is rejected before the first request',async t=>{
  const dir=temporary(t),bad={...plan,bindings:{...plan.bindings,approved_calls:4}};let calls=0;
  await assert.rejects(execute(bad,bad.bindings,join(dir,'run'),{async stream(){calls++;}}));
  assert.equal(calls,0);assert.equal(existsSync(join(dir,'run')),false);
});
test('v2 runs only the new candidate on all four gates and refuses old permits',async t=>{
  const dir=temporary(t),candidate=completenessPlan(plan);let calls=0;
  assert.deepEqual(candidate.cases.map(c=>c.variants),[['B'],['B'],['B'],['B']]);
  assert.equal(candidate.bindings.approved_calls,4);
  await assert.rejects(execute(candidate,plan.bindings,join(dir,'old'),{async stream(){calls++;}}));
  assert.equal(calls,0);
  const result=await execute(candidate,candidate.bindings,join(dir,'v2'),{async stream(request,delta){
    assert.ok(request.system.includes(candidate.bundle.completeness_gate));
    delta(answer(candidate.cases[calls++].expected_reason));
    return {inputTokens:1,outputTokens:1,finishReason:'stop'};
  }});
  assert.equal(result.calls,4);assert.equal(result.passed,true);
});

const dailyAnswer = label => `FINAL: ${label}\nNSPI_RESULT_V1: ${JSON.stringify({v:1,kind:'single_choice',state:'ready',answer:label,reason:'none'})}`;
test('daily screening rejects wrong labels, missing protocol, refusal and FINAL mismatch',()=>{
  assert.equal(assessDaily(dailyAnswer('B'),{expected_label:'B'}),true);
  assert.equal(assessDaily(dailyAnswer('A'),{expected_label:'B'}),false);
  assert.equal(assessDaily('FINAL: B',{expected_label:'B'}),false);
  assert.equal(assessDaily(answer('missing_context'),{expected_label:'B'}),false);
  assert.equal(assessDaily(dailyAnswer('B').replace('FINAL: B','FINAL: A'),{expected_label:'B'}),false);
});
test('timing does not accept incomplete FINAL chunks as a completed line',()=>{
  for (const text of ['F','FINAL:','FINAL: B']) assert.equal(completedFinal(text),false);
  assert.equal(completedFinal('FINAL: B\n'),true);
  assert.equal(completedFinal('FINAL: B',true),true);
});
test('daily output retains manual review requirement, JPEG and bounded timing',async t=>{
  const dir=temporary(t),daily={bundle:completenessPlan(plan).bundle,
    bindings:{max_tokens:2048,profile:'reading_practice',language:'zh',scope:'daily-v2-provider-quality-and-timing-only',approved_calls:1},
    cases:[{id:'Q1',expected_label:null,variants:['B'],base64:'frozen',mediaType:'image/jpeg'}]};
  const result=await execute(daily,daily.bindings,join(dir,'daily'),{async stream(request,delta){
    assert.equal(request.images[0].mediaType,'image/jpeg');
    delta('FINAL:');delta(' B\n');delta(dailyAnswer('B').split('\n')[1]);
    return {inputTokens:100,outputTokens:50,finishReason:'stop'};
  }});
  assert.equal(result.passed,true);
  const stored=JSON.parse(readFileSync(join(dir,'daily/1.json')));
  assert.equal(stored.manual_quality_review_required,true);
  assert.ok(stored.timing.first_content_ms <= stored.timing.completed_final_line_ms);
  assert.ok(stored.timing.completed_final_line_ms <= stored.timing.response_complete_ms);
  assert.equal(result.end_to_end_acceptance,false);
});

test('paired daily uses balanced frozen order and cannot reuse six-call approval',async t=>{
  const dir=temporary(t),daily={bundle:completenessPlan(plan).bundle,
    bindings:{max_tokens:2048,profile:'reading_practice',language:'zh',scope:'daily-v2-provider-quality-and-timing-only',approved_calls:6},
    cases:['Q1','Q2','Q8','Q9','Q10','Q11'].map(id=>({id,expected_label:'B',variants:['B'],base64:id,mediaType:'image/jpeg'}))};
  const paired=pairedDailyPlan(daily);let calls=0;
  assert.deepEqual(paired.cases.map(c=>c.variants.join('')),['AB','BA','AB','BA','AB','BA']);
  await assert.rejects(execute(paired,daily.bindings,join(dir,'old'),{async stream(){calls++;}}));
  assert.equal(calls,0);
  const result=await execute(paired,paired.bindings,join(dir,'paired'),{async stream(request,delta){
    const item=paired.cases[Math.floor(calls/2)],variant=item.variants[calls%2];
    assert.equal(request.images[0].base64,item.base64);
    const expected=variant==='A'?paired.bundle.baseline:paired.bundle.candidate;
    assert.equal(request.system,expected.system_template.replaceAll('${profile}','reading_practice').replaceAll('${language}','zh'));
    calls++;delta(dailyAnswer('B'));return {inputTokens:10,outputTokens:10,finishReason:'stop'};
  }});
  assert.equal(calls,12);assert.equal(result.passed,true);
  assert.equal(result.end_to_end_acceptance,false);
});

// Profile and language change the actual prompt even when model and image match.
test('profile and language are permit-bound and applied to the request', async t => {
  const dir=temporary(t); let calls=0;
  const changed={...plan, bindings:{...plan.bindings,profile:'general',language:'ja'}};
  const provider={async stream(request,delta){
    assert.ok(request.system.includes('Profile: general. Reply language: ja.'));
    delta(answer(changed.cases[Math.floor(calls++/2)].expected_reason));
    return {inputTokens:1,outputTokens:1,finishReason:'stop'};
  }};
  await assert.rejects(execute(changed,plan.bindings,join(dir,'old'),provider));
  assert.equal(calls,0);
  for(const binding of [{...changed.bindings,profile:undefined},{...changed.bindings,language:'unknown'}]) {
    await assert.rejects(execute({...changed,bindings:binding},binding,join(dir,'invalid'),provider));
  }
  assert.equal(calls,0);
  assert.equal(existsSync(join(dir,'invalid')),false);
  assert.equal((await execute(changed,changed.bindings,join(dir,'valid'),provider)).passed,true);
  assert.equal(calls,8);
});

test('grounded screening uses the approved production cap and stops on failed Q11 quality', async t => {
  const dir=temporary(t);
  const bundle=JSON.parse(readFileSync(new URL('../../docs/experiments/latency-prompt-grounded-v3.json',import.meta.url)));
  const grounded={bundle,bindings:{scope:'grounded-v3-screening-only',approved_calls:4,profile:'general',language:'zh',max_tokens:32768},
    cases:[{id:'Q11',expected_label:'B',variants:['A','B'],base64:'frozen',mediaType:'image/jpeg'},
      ...['missing_context','cropped'].map(reason=>({id:reason,expected_reason:reason,variants:['B'],base64:'boundary'}))]};
  let calls=0;
  await assert.rejects(execute(grounded,{...grounded.bindings,max_tokens:2048},join(dir,'old'),{async stream(){calls++;}}));
  assert.equal(calls,0);
  const result=await execute(grounded,grounded.bindings,join(dir,'valid'),{async stream(request,delta){
    assert.equal(request.maxTokens,32768);
    assert.equal(request.reasoningEffort,'low');
    assert.ok(request.system.includes('Profile: general. Reply language: zh.'));
    const index=calls++;
    delta(index<2?dailyAnswer('B'):answer(index===2?'missing_context':'cropped'));
    return {inputTokens:1338,outputTokens:8388,finishReason:'stop'};
  }});
  assert.equal(result.calls,4);assert.equal(result.passed,true);
  calls=0;
  const failed=await execute(grounded,grounded.bindings,join(dir,'wrong'),{async stream(_request,delta){
    calls++;delta(dailyAnswer('D'));return {inputTokens:1338,outputTokens:8388,finishReason:'stop'};
  }});
  assert.equal(calls,1);assert.equal(failed.stopped,'quality_gate');
});

test('v4 preserves baseline and grounding, freezes four boundaries, rejects old approval', async t => {
  const dir=temporary(t);
  const base={...plan,bindings:{...plan.bindings,model:'deepseek-flash',reasoning_effort:'low'}};
  const candidate=groundedCompletenessPlan(base);
  assert.equal(candidate.bindings.approved_calls,4);
  assert.equal(candidate.bindings.max_tokens,32768);
  assert.equal(candidate.bindings.profile,'general');
  assert.deepEqual(candidate.cases.map(c=>c.variants),[['B'],['B'],['B'],['B']]);
  assert.ok(candidate.bundle.candidate.system_template.startsWith(candidate.bundle.completeness_gate+'\n'));
  let calls=0;
  const provider={async stream(request,delta){
    assert.equal(request.maxTokens,32768);
    assert.ok(request.system.includes('Profile: general.'));
    delta(answer(candidate.cases[calls++].expected_reason));
    return {inputTokens:1000,outputTokens:500,finishReason:'stop'};
  }};
  await assert.rejects(execute(candidate,base.bindings,join(dir,'old'),provider));
  assert.equal(calls,0);
  assert.equal((await execute(candidate,candidate.bindings,join(dir,'new'),provider)).passed,true);
  assert.equal(calls,4);
});

test('provider timing retains first allowlisted marks and no arbitrary keys',async t=>{
  const dir=temporary(t);
  const single={...plan,bindings:{...plan.bindings,approved_calls:1},cases:[{...plan.cases[0],variants:['B']}]};
  await execute(single,single.bindings,join(dir,'timed'),{async stream(request,delta){
    request.onTiming('upstreamRequest'); request.onTiming('private-content');
    request.onTiming('upstreamFirstAnswer'); delta(answer('multiple_targets'));
    request.onTiming('upstreamRequest');
    return {inputTokens:1,outputTokens:1,finishReason:'stop'};
  }});
  const r=JSON.parse(readFileSync(join(dir,'timed/1.json')));
  assert.deepEqual(Object.keys(r.provider_timing_ms),['upstreamRequest','upstreamFirstAnswer']);
  assert.ok(r.provider_timing_ms.upstreamRequest<=r.provider_timing_ms.upstreamFirstAnswer);
  assert.equal(r.upstream_cadence.answer_observed, true);
  assert.equal(JSON.stringify(r.upstream_cadence).includes('private-content'), false);
});

test('legacy remaining plan binds stopped evidence and excludes already dispatched cases', t => {
  const dir=temporary(t);
  const cases=[{id:'Q11',variants:['A','B']},{id:'missing-context',variants:['B']},
    {id:'cropped-options',variants:['B']},{id:'unsupported-essay',variants:['B']}];
  const plan={cases,bindings:{scope:'legacy-objective-grounding-screening-only',approved_calls:5}};
  writeFileSync(join(dir,'permit.json'),JSON.stringify(plan.bindings));
  const sent=cases.flatMap(c=>c.variants.map(variant=>({id:c.id,variant}))).slice(0,4).map((r,i)=>({ordinal:i+1,...r}));
  writeFileSync(join(dir,'dispatches.jsonl'),sent.map(r=>JSON.stringify(r)).join('\n'));
  sent.forEach((r,i)=>writeFileSync(join(dir,(i+1)+'.json'),JSON.stringify({...r,passed:i<3})));
  const remaining=legacyRemainingPlan(plan,dir);
  assert.equal(remaining.bindings.approved_calls,1);
  assert.deepEqual(remaining.cases,[cases[3]]);
  assert.notDeepEqual(remaining.bindings,plan.bindings);
  writeFileSync(join(dir,'4.json'),JSON.stringify({...sent[3],passed:true}));
  assert.throws(()=>legacyRemainingPlan(plan,dir));
  writeFileSync(join(dir,'dispatches.jsonl'),JSON.stringify(sent[0]));
  assert.throws(()=>legacyRemainingPlan(plan,dir));
});

test('legacy protocol candidate repeats original rules, prioritizes failed boundary and rejects baseline drift',()=>{
  const v1=JSON.parse(readFileSync(new URL('../../docs/experiments/latency-legacy-objective-grounding-v1.json',import.meta.url)));
  const convert=p=>({system_template:p.system,task:p.task});
  const plan={bundle:{baseline:convert(v1.baseline),candidate:convert(v1.candidate)},
    bindings:{scope:'legacy-objective-grounding-screening-only',approved_calls:5},
    cases:[{id:'Q11',variants:['A','B']},{id:'unsupported-essay',variants:['B']}]};
  const candidate=legacyProtocolPlan(plan);
  assert.equal(candidate.bindings.approved_calls,3);
  assert.equal(candidate.cases[0].id,'unsupported-essay');
  assert.equal(candidate.cases[1].id,'Q11');
  assert.ok(candidate.bundle.candidate.system_template.endsWith(v1.candidate.system));
  assert.equal(candidate.bundle.candidate.task,v1.baseline.task);
  assert.notDeepEqual(candidate.bindings,plan.bindings);
  plan.bundle.baseline.task+=' changed';
  assert.throws(()=>legacyProtocolPlan(plan));
});

test('baseline attribution dispatches only original prompt once and retains protocol failure',async t=>{
  const plan={bundle:{baseline:{system_template:'original',task:'original task'},candidate:{system_template:'never use candidate',task:'candidate task'}},
    bindings:{scope:'legacy-objective-grounding-screening-only',approved_calls:5,profile:'general',language:'zh',max_tokens:32768},
    cases:[{id:'unsupported-essay',variants:['B'],base64:'frozen',legacy_expected:{state:'review',reason:'unsupported',kind:'other'}}]};
  const baseline=legacyBaselineBoundaryPlan(plan);
  assert.equal(baseline.bindings.approved_calls,1);
  assert.deepEqual(baseline.cases[0].variants,['A']);
  let calls=0;
  const result=await execute(baseline,baseline.bindings,join(temporary(t),'run'),{async stream(req,delta){
    calls++;assert.equal(req.system,'original');assert.equal(req.task,'original task');
    assert.equal(req.reasoningEffort,'low');assert.equal(req.maxTokens,32768);
    delta(legacyOutput('essay','ready','none','other'));
    return {inputTokens:1,outputTokens:1,finishReason:'stop'};
  }});
  assert.equal(calls,1);assert.equal(result.stopped,'quality_gate');
  assert.throws(()=>legacyBaselineBoundaryPlan({...plan,bindings:{...plan.bindings,approved_calls:3}}));
});

test('legacy daily paired plan freezes twelve AB/BA calls and uses actual legacy prompts',async t=>{
  const ids=['Q1','Q2','Q8','Q9','Q10','Q11'];const labels=[null,'B','A','D','D','B'];
  const legacy={bundle:{baseline:{system_template:'legacy system',task:'legacy task'},candidate:{system_template:'grounded legacy system',task:'legacy task'}},
    bindings:{scope:'legacy-objective-grounding-screening-only',approved_calls:5,profile:'general',language:'zh',max_tokens:32768}};
  const daily={bindings:{scope:'daily-v2-provider-quality-and-timing-only',fixture_manifest_sha256:'offline'},cases:ids.map((id,i)=>({id,expected_label:labels[i],base64:'offline',variants:['B']}))};
  const plan=legacyDailyPairedPlan(legacy,daily);let count=0;
  const result=await execute(plan,plan.bindings,join(temporary(t),'run'),{async stream(req,delta){
    const item=plan.cases[Math.floor(count/2)];const variant=item.variants[count%2];count++;
    assert.equal(req.system,variant==='A'?'legacy system':'grounded legacy system');
    assert.equal(req.task,'legacy task');assert.equal(req.reasoningEffort,'low');assert.equal(req.maxTokens,32768);
    delta(legacyOutput(item.expected_label));return {inputTokens:1,outputTokens:1,finishReason:'stop'};
  }});
  assert.equal(count,12);assert.equal(result.passed,true);
  assert.equal(plan.cases[0].reference_status,'manual_synonym_reference_not_official_key');
  assert.ok(!assessLegacyDaily(legacyOutput('B','review','ambiguous_question'),{expected_label:'B'}));
  assert.ok(!assessLegacyDaily(legacyOutput('C'),{expected_label:'B'}));
  assert.ok(assessLegacyDaily(legacyOutput('B. イだけ'),{expected_label:'B'}));
});


test('cadence counts parsed events, pauses and freezes at first answer without content', () => {
  let now = 0;
  const c = upstreamCadence(() => now);
  c.mark('private-content');
  c.mark('upstreamFirstEvent');
  now = 100; c.mark('upstreamFirstEvent'); c.mark('upstreamFirstReasoning');
  now = 500; c.mark('upstreamFirstEvent'); c.mark('upstreamFirstReasoning');
  now = 2500; c.mark('upstreamFirstEvent'); c.mark('upstreamFirstAnswer');
  now = 9000; c.mark('upstreamFirstEvent'); c.mark('upstreamFirstReasoning');
  assert.deepEqual(c.snapshot(), {
    answer_observed:true, parsed_events_before_answer:4, reasoning_events_before_answer:2,
    first_event_to_end_ms:2500, max_inter_event_gap_ms:2000,
    gaps_over_250ms:2, gaps_over_1000ms:1, last_event_to_end_ms:0,
  });
});

test('cadence distinguishes missing events from zero gaps and retains failure silence', () => {
  let now = 0;
  const c = upstreamCadence(() => now);
  assert.equal(c.snapshot().max_inter_event_gap_ms, null);
  assert.equal(c.snapshot().last_event_to_end_ms, null);
  c.mark('upstreamFirstEvent');
  now = 12000;
  assert.equal(c.snapshot().last_event_to_end_ms, 12000);
  assert.equal(c.snapshot().answer_observed, false);
  assert.equal(c.snapshot().max_inter_event_gap_ms, null);
});


test('runner retains cadence on stream failure and never retries or dispatches next case', async t => {
  const dir = temporary(t);
  let calls = 0;
  const result = await execute(plan, plan.bindings, join(dir, 'cadence-error'), {
    async stream(req) {
      calls++;
      req.onTiming('upstreamFirstEvent');
      req.onTiming('upstreamFirstReasoning');
      throw new Error('private error');
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stopped, 'request_error_no_retry');
  const saved = JSON.parse(readFileSync(join(dir, 'cadence-error/1-error.json')));
  assert.equal(saved.upstream_cadence.answer_observed, false);
  assert.equal(saved.upstream_cadence.reasoning_events_before_answer, 1);
  assert.equal(JSON.stringify(saved).includes('private error'), false);
});
