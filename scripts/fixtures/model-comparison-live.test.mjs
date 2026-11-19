import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import http from 'node:http';import https from 'node:https';import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
let networkAttempts=0;
const denied=()=>{networkAttempts++;throw new Error('Real networking is forbidden');};
globalThis.fetch=denied;http.request=http.get=https.request=https.get=denied;
net.connect=net.createConnection=net.Socket.prototype.connect=denied;syncBuiltinESMExports();
after(()=>assert.equal(networkAttempts,0));
const {createControlledTransport,ENDPOINTS}=await import('../lib/model-comparison-transport.mts');
const {ComparisonBudget,executeComparison,buildRequest}=await import('../lib/model-comparison.mts');
const {validateAuthorization,claimExecution,materialScope,CONSUMED_PATH,PAID_DIRECTORY,AUTHORIZATION_PATH}=await import('../lib/model-comparison-live.mjs');
const {loadComparisonPlan,main}=await import('../run-model-comparison.mjs');
const {joinClientTiming}=await import('../import-model-comparison-latency.mjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
const ids=Object.keys(ENDPOINTS),expectedModels=Object.fromEntries(ids.map(id=>[id,[id]]));
const models=ids.map(id=>({id,rate:{inputMicrosPerMillion:1_000_000,outputMicrosPerMillion:1_000_000},bounds:{inputTokens:100,outputTokens:100}}));
const item={id:'q',status:'available',category:'calculation',kind:'single_choice',language:'ja',origin:'synthetic_regression',previously_seen:true,image_quality:'clear',
  images:[{sha256:'a'.repeat(64)}],expected:{expectation:'answerable',state:'ready',reason:'none',accepted_answers:['B'],answer_scoring:{mode:'label_set',labels:['A','B']}}};
const answer='FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
const input={system:'frozen system',task:'frozen task',images:[{base64:'dGVzdA==',mediaType:'image/png'}]};
function temp(t){const path=realpathSync(mkdtempSync('/tmp/notchspi-eval-final-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function sse(model=ids[0],options={}){
  const metadata={model,...(model!=='deepseek-flash'?{service_tier:options.tier??'default'}:{})};
  const frames=[{...metadata,choices:[{delta:{reasoning_content:'not persisted'},finish_reason:null}]},
    {...metadata,choices:[{delta:{content:answer},finish_reason:'stop'}]}];
  if(options.usage!==false)frames.push({...metadata,choices:[],usage:options.usage??{prompt_tokens:3,completion_tokens:2}});
  let data=frames.map(x=>`data: ${JSON.stringify(x)}\n\n`).join('')+(options.done===false?'':'data: [DONE]\n\n');
  const bytes=new TextEncoder().encode(data);
  return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
}
function transport(fetchImpl,assertAuthorized=()=>{}){return createControlledTransport({fetchImpl,assertAuthorized,credentialFor:()=> 'fake-test-key-not-a-secret',expectedModels});}
function setup(t,override={}){
  const path=join(temp(t),'budget.sqlite3');const selected=override.models??models.slice(0,1);
  const budget=new ComparisonBudget(path,{campaignId:'test',limitMicros:override.cap??1000,rolling:true},selected);t.after(()=>budget.close());
  return {budget,path,run:options=>executeComparison({cases:[item],models:selected,budget,promptFor:()=>input,imagesFor:()=>input.images,
    limits:{firstProgressMs:1000,generationMs:4000,leaseMs:5000,maxRetries:0,maxConsecutiveFailures:3},...options})};
}
test('all three wire adapters stream through injected HTTP, preserve inputs, and reconcile conservatively',async t=>{
  const {run,budget}=setup(t,{models});let reads=0,posts=0;
  const tr=createControlledTransport({assertAuthorized(){},credentialFor(){reads++;return 'fake';},expectedModels,
    async fetchImpl(url,options){posts++;assert.equal(options.redirect,'error');assert.equal(options.method,'POST');
      const body=JSON.parse(options.body);assert.equal(url,ENDPOINTS[body.model]);assert.equal(body.messages[0].content,input.system);
      assert.equal(body.messages[1].content[1].image_url.url,'data:image/png;base64,dGVzdA==');
      assert.equal(JSON.stringify(body).includes('accepted_answers'),false);return sse(body.model);}});
  const result=await run({transport:tr});assert.equal(posts,3);assert.equal(reads,3);
  assert.equal(result.attempts.length,3);assert.equal(result.rows[0].score.correct,true);
  assert.equal(budget.snapshot().settledConservativeMicros,15);assert.equal(budget.snapshot().activeHoldMicros,0);
  assert.equal(budget.snapshot().remainingMicros,985);assert.equal(result.rows[0].timing.uiRenderCompleteMs,null);
  assert.ok(result.attempts[0].usageDigest);assert.equal(JSON.stringify(result).includes('not persisted'),false);
});
test('authorization recheck fails before credential resolution or injected HTTP',async t=>{
  const {run,budget}=setup(t);let reads=0,requests=0,checks=0;
  const tr=createControlledTransport({assertAuthorized(){if(++checks>1)throw new Error('expired');},credentialFor(){reads++;return 'fake';},
    expectedModels,async fetchImpl(){requests++;return sse();}});
  await run({transport:tr});assert.equal(reads,0);assert.equal(requests,0);assert.equal(budget.snapshot().activeHoldMicros,200);
});
test('rolling ledger releases only complete usage and survives reopen without cap/model/campaign changes',t=>{
  const path=join(temp(t),'ledger'),policy={campaignId:'same',limitMicros:250,rolling:true};
  let b=new ComparisonBudget(path,policy,[models[0]]);b.reserve('a','q',ids[0],'answer');b.observe('a',{inputTokens:3,outputTokens:2});
  assert.equal(b.snapshot().remainingMicros,50);b.settleCompleteUsage('a');assert.equal(b.snapshot().remainingMicros,245);b.close();
  b=new ComparisonBudget(path,policy,[models[0]]);b.reserve('b','q2',ids[0],'answer');assert.equal(b.snapshot().remainingMicros,45);b.close();
  assert.throws(()=>new ComparisonBudget(path,{...policy,campaignId:'new'},[models[0]]));
  assert.throws(()=>new ComparisonBudget(path,{...policy,limitMicros:500},[models[0]]));
  assert.throws(()=>new ComparisonBudget(path,{...policy,rolling:false},[models[0]]));
});
test('two ledger connections cannot overspend a last rolling reservation',t=>{
  const path=join(temp(t),'ledger'),policy={campaignId:'same',limitMicros:250,rolling:true};
  const a=new ComparisonBudget(path,policy,[models[0]]),b=new ComparisonBudget(path,policy,[models[0]]);
  try{a.reserve('a','q',ids[0],'answer');assert.throws(()=>b.reserve('b','q2',ids[0],'answer'));assert.equal(b.snapshot().remainingMicros,50);}finally{a.close();b.close();}
});
test('terminal missing usage remains unknown and fully reserved',async t=>{
  const {run,budget}=setup(t);const result=await run({transport:transport(async()=>sse(ids[0],{usage:false}))});
  assert.equal(result.rows[0].costMicros,null);assert.equal(result.summary.overall.costPerCorrectMicros,null);
  assert.equal(budget.snapshot().activeHoldMicros,200);assert.equal(budget.snapshot().unknownAttempts,1);
});
test('lost SSE completion retries once; first physical call remains booked despite early usage',async t=>{
  const {run,budget}=setup(t);let calls=0;
  const result=await run({transport:transport(async()=>sse(ids[0],{done:++calls===2})),limits:{maxRetries:1}});
  assert.equal(calls,2);assert.equal(result.attempts.length,2);assert.equal(result.rows[0].costMicros,10);
  assert.equal(budget.snapshot().activeHoldMicros,200);assert.equal(budget.snapshot().settledConservativeMicros,5);
});
test('retry cannot dispatch when the unknown first attempt exhausted capacity',async t=>{
  const {run,budget}=setup(t,{cap:250});let calls=0;
  const result=await run({transport:transport(async()=>{calls++;return new Response('',{status:503,headers:{'retry-after':'0'}});}),limits:{maxRetries:1}});
  assert.equal(calls,1);assert.equal(result.stopped,'budget_exhausted');assert.equal(budget.snapshot().activeHoldMicros,200);
});
test('third unknown physical charge stops before retry; complete answers retain their score',async t=>{
  for(const transient of [false,true]){
    const {run}=setup(t,{models});let calls=0;
    const result=await run({maxUnknownAttempts:3,transport:transport(async()=>{
      const model=ids[Math.min(calls,2)];calls++;
      return transient?new Response('',{status:503,headers:{'retry-after':'0'}}):sse(model,{usage:false});
    }),limits:{maxRetries:1}});
    assert.equal(calls,3);assert.equal(result.budget.unknownAttempts,3);assert.equal(result.stopped,'unknown_cost_limit');
    if(!transient){assert.equal(result.rows[2].score.correct,true);assert.equal(result.rows[2].failure,null);}
  }
});
test('long retry-after and upstream billing rejection never retry',async t=>{
  for(const billing of [false,true]){
    const {run}=setup(t);let calls=0;const result=await run({transport:transport(async()=>{calls++;
      return new Response(JSON.stringify({error:{code:billing?'insufficient_quota':'rate_limit'}}),{status:429,headers:{'retry-after':'4'}});}),limits:{maxRetries:1}});
    assert.equal(calls,1);if(billing)assert.equal(result.stopped,'billing_quota');
  }
});
test('model identity, service tier and usage bounds stop the campaign without proceeding to another model',async t=>{
  for(const variant of ['model','tier','usage']){
    const {run,budget}=setup(t,{models});let calls=0;
    const result=await run({transport:transport(async()=>{calls++;return variant==='model'?sse(ids[1]):variant==='tier'?sse(ids[0],{tier:'priority'}):sse(ids[0],{usage:{prompt_tokens:101,completion_tokens:2}});})});
    assert.equal(calls,1);assert.ok(result.stopped);assert.equal(budget.snapshot().activeHoldMicros,200);
  }
});
test('one-use fixed permit prevents restart, altered run identity and deleted/emptied ledger reuse',t=>{
  const root=temp(t),dir=claimExecution(root,'auth','config');writeFileSync(join(dir,'budget.sqlite3'),'');
  assert.throws(()=>claimExecution(root,'new-auth','new-config'),/consumed/);
  rmSync(dir,{recursive:true});assert.throws(()=>claimExecution(root,'auth','config'),/consumed/);
  assert.ok(existsSync(join(root,CONSUMED_PATH)));assert.equal(dir,join(root,PAID_DIRECTORY));
});
test('real execution rejects pending approval and forbidden cap/run/ledger flags',async()=>{
  const root=resolve(new URL('../..',import.meta.url).pathname);
  await assert.rejects(main(['--live','--authorization',AUTHORIZATION_PATH],root),/not authorized/);
  for(const arg of ['--run-id','--reset','--resume','--budget','--ledger'])await assert.rejects(main([arg,'new'],root),/no run\/cap\/ledger overrides/);
  assert.equal(existsSync(join(root,CONSUMED_PATH)),false);
});
test('authorization binds the 28 items, exact image order, recipient, budget, freshness and limitations',()=>{
  const plan=loadComparisonPlan(),now=Date.now();
  const record=JSON.parse(readFileSync(AUTHORIZATION_PATH));record.status='approved';record.expires_at=new Date(now+1000).toISOString();
  record.user_approval={budget:true,exact_materials_and_recipients:true,empirical_bound_limitation_acknowledged:true,message_reference:'synthetic-test',approved_at:new Date(now-1000).toISOString()};
  Object.assign(record.preflight,{prices_versions_parameters_reviewed:true,exact_inputs_and_billing_scope_reviewed:true,account_standard_no_region_no_tools:true,privacy_review_accepted:true,evidence_reference:'synthetic-test'});
  assert.equal(validateAuthorization(record,plan,now),true);
  for(const mutate of [r=>r.material_scope.pop(),r=>r.material_scope[0].images.reverse().push('invented'),r=>r.models[0].endpoint='https://other.invalid',
    r=>r.budget.hard_cap_micros++,r=>r.config_sha256='changed',r=>r.preflight.billing_catalog_sha256='changed',r=>r.expires_at=new Date(now-1).toISOString(),r=>r.user_approval.exact_materials_and_recipients=false]){
    const copy=structuredClone(record);mutate(copy);assert.throws(()=>validateAuthorization(copy,plan,now));
  }
  assert.deepEqual(record.material_scope,materialScope(plan));
});
test('84 average-sized mock attempts fit $15 with rolling accounting although their reserve sum exceeds it',async t=>{
  const plan=loadComparisonPlan(),root=temp(t),budget=new ComparisonBudget(join(root,'ledger'),{campaignId:'sensitivity',limitMicros:15_000_000,rolling:true},plan.config.models);
  try{
    const result=await executeComparison({cases:plan.cases,models:plan.config.models,promptFor:plan.promptFor,imagesFor:plan.imagesFor,budget,
      transport:{kind:'offline-mock',async invoke({caseId,onDelta}){
        const c=plan.cases.find(c=>c.id===caseId),a=c.expected.expectation==='answerable'?c.expected.accepted_answers[0]:null;
        onDelta((a===null?'':`FINAL: ${a}\n`)+'NSPI_RESULT_V1: '+JSON.stringify({v:1,kind:c.kind,state:c.expected.state,answer:a,reason:c.expected.reason??(a?'none':'missing_context')}));
        return {usage:{inputTokens:12000,outputTokens:1000},finishReason:'stop',meteringComplete:true};}}});
    assert.equal(result.attempts.length,84);assert.equal(result.stopped,null);
    assert.equal(result.budget.settledConservativeMicros,11_684_400);assert.ok(result.budget.reservedMicros>15_000_000);
    assert.equal(result.summary.overall.costMicros,5_370_400);assert.equal(result.metricsAreModelMeasurements,false);
  }finally{budget.close();}
});
test('native timing import binds output and input; missing final draw stays null and replay is never real E2E',()=>{
  const id='11111111-1111-4111-8111-111111111111',plan={sourceIdentity:{config_sha256:'frozen'},cases:[item]};
  const result={metricsAreModelMeasurements:false,rows:[{caseId:'q',model:ids[0],attemptIds:['a'],score:{valid:true,answer:'B',correct:true},failure:null}],attempts:[{id:'a',outputSHA256:sha(answer)}]};
  const logs=stages=>stages.map(([stage,elapsed_ms])=>'[CaptureLatency] '+JSON.stringify({id,channel:'official',mode:'tutor',entry:'single',stage,elapsed_ms})).join('\n');
  const trace=logs([['triggered',0],['firstDelta',10],['completed',20],['renderStarted',21],['renderCompleted',22]]);
  const map={config_sha256:'frozen',trace_sha256:sha(trace),client_build_sha256:'a'.repeat(64),provenance:'synthetic_replay',entries:[{capture_id:id,case_id:'q',model:ids[0],image_sha256:['a'.repeat(64)],output_sha256:sha(answer)}]};
  const joined=joinClientTiming(result,trace,map,plan);assert.equal(joined.rows[0].native_complete_valid_answer_ms,22);assert.equal(joined.native_model_e2e_measured,false);
  const missing=logs([['triggered',0],['completed',20]]);assert.equal(joinClientTiming(result,missing,{...map,trace_sha256:sha(missing)},plan).rows[0].native_complete_valid_answer_ms,null);
  assert.throws(()=>joinClientTiming(result,trace,{...map,provenance:'native_live_isolated'},plan));
  assert.throws(()=>joinClientTiming(result,trace,{...map,entries:[{...map.entries[0],output_sha256:'different'}]},plan));
});
