import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
import {config,validateTrialPolicy} from '../src/config.ts';
import {OpenAIProvider,TERRA_MODEL} from '../src/providers/openai.ts';
import {makeProvider,makeObjectiveProvider} from '../src/providers/index.ts';
import {composeObjectiveResult} from '../src/objective-result.ts';
import {estimateTerraWire} from '../src/providers/astra-budget.ts';
import {pngBase64} from './helpers/images.ts';
import {randomUUID,randomBytes} from 'node:crypto';
import Fastify from 'fastify';
import {CaptureService} from '../src/capture-service.ts';
import {MemoryStore} from '../src/db-memory.ts';
import {StubPaymentProvider} from '../src/payments.ts';
import {SCREEN_QUERY_VERSION} from '../src/screen-query.ts';

let networkCalls=0;
const deny=()=>{networkCalls++;throw new Error('Real networking forbidden');};
globalThis.fetch=deny;http.request=http.get=https.request=https.get=deny;
net.connect=net.createConnection=net.Socket.prototype.connect=deny;syncBuiltinESMExports();
after(()=>assert.equal(networkCalls,0));
const ready='FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
const settings={...config,provider:'openai' as const,objectiveProvider:'openai' as const,
  providerConfigurationError:null,objectiveProviderConfigurationError:null,
  model:TERRA_MODEL,objectiveModel:TERRA_MODEL,maxTokens:8192,objectiveMaxTokens:8192,
  openaiKey:'offline-fixture',openaiBaseURL:'https://api.openai.com',objectiveAstraFastReview:false};
const image={mediaType:'image/png',base64:pngBase64};
const pricing=JSON.stringify([{model:'openai:'+TERRA_MODEL,input_micros_per_million_tokens:5_000_000,output_micros_per_million_tokens:7_500_000}]);
function stream(options:{model?:string;tier?:string;done?:boolean;usage?:boolean;finish?:string;refusal?:boolean;raw?:string}={}) {
  const identity={model:options.model??TERRA_MODEL,service_tier:options.tier??'default'};
  const frames=[{...identity,choices:[{delta:options.refusal?{refusal:'refused'}:{content:options.raw??ready},finish_reason:options.finish??'stop'}]},
    ...(options.usage===false?[]:[{...identity,choices:[],usage:{prompt_tokens:100,completion_tokens:50}}])];
  return new Response(frames.map(f=>'data: '+JSON.stringify(f)+'\n\n').join('')+(options.done===false?'':'data: [DONE]\n\n'),{headers:{'content-type':'text/event-stream'}});
}

test('three persisted UI slots reach Terra for both provider slots, one/four images and all purposes',async t=>{
  const seen:Record<string,unknown>[]=[];
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    assert.equal(url,'https://api.openai.com/v1/chat/completions');seen.push(JSON.parse(String(init.body)));return stream();
  });
  for(const build of [makeProvider,makeObjectiveProvider])for(const [selection,effort] of [['low','low'],['high','medium'],['max','high']] as const)
    for(const purpose of ['answer','recover','explain'] as const)for(const count of [1,4]) {
      const {provider,degraded}=build(settings,assert.fail);assert.equal(degraded,null);
      const images=Array.from({length:count},()=>({...image}));let shown='';
      const usage=await provider.stream({system:'unchanged business system',task:'unchanged task',images,reasoningEffort:selection,purpose},s=>{shown+=s;},new AbortController().signal);
      const body=seen.at(-1)!;
      assert.deepEqual(body,{model:TERRA_MODEL,max_completion_tokens:8192,reasoning_effort:effort,service_tier:'default',store:false,stream:true,stream_options:{include_usage:true},
        messages:[{role:'developer',content:'unchanged business system'},{role:'user',content:[{type:'text',text:'unchanged task'},...images.map(i=>({type:'image_url',image_url:{url:`data:${i.mediaType};base64,${i.base64}`,detail:'high'}}))]}]});
      assert.equal(shown,ready);assert.equal(composeObjectiveResult(shown,true).result?.answer,'B');
      assert.equal(usage.upstreamModel,TERRA_MODEL);assert.equal(usage.outputTokens,50);
    }
  assert.equal(seen.length,36);
});

test('missing depth explicitly means low; request body and quota preserve the selected output cap',async()=>{
  const provider=new OpenAIProvider('offline','https://api.openai.com',TERRA_MODEL,8192);
  const request={system:'s',task:'t',images:[image]};
  const body=provider.requestBody(request),explanation=provider.requestBody({...request,purpose:'explain',maxTokens:768});
  assert.ok('reasoning_effort' in body);assert.equal(body.reasoning_effort,'low');
  assert.ok('max_completion_tokens' in explanation);assert.equal(explanation.max_completion_tokens,768);
  const quotes=[];
  for(const reasoningEffort of ['low','high','max'] as const)quotes.push(await provider.estimateReservation({...request,reasoningEffort},pricing));
  assert.deepEqual(quotes[0],quotes[1]);assert.deepEqual(quotes[1],quotes[2]);assert.equal(quotes[0]!.outputUpper,8192);
  await assert.rejects(estimateTerraWire(JSON.stringify({...provider.requestBody(request),reasoning_effort:'max'}),pricing));
  await assert.rejects(provider.estimateReservation(request,'[]'));
  await assert.rejects(new OpenAIProvider('offline','https://proxy.invalid',TERRA_MODEL,8192).estimateReservation(request,pricing));
});

test('identity/tier/usage/termination failures never switch to Astra or yield a partial answer',async t=>{
  let current:Parameters<typeof stream>[0]={},calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return stream(current);});
  const provider=makeProvider(settings,assert.fail).provider;
  const req={system:'s',task:'t',images:[image],reasoningEffort:'max' as const};
  for(const invalid of [{model:'gpt-6-astra'},{tier:'fast'},{usage:false},{done:false},{refusal:true}]){
    current=invalid;const before=calls;
    await assert.rejects(provider.stream(req,()=>assert.fail('must not expose failed answer'),new AbortController().signal));
    assert.equal(calls,before+1);
  }
  current={finish:'length'};let text='';const u=await provider.stream(req,s=>{text+=s;},new AbortController().signal);
  assert.equal(u.finishReason,'length');assert.equal(text,'');
});

test('cancellation suppresses a completed buffered answer; later preference change cannot rewrite in-flight request',async t=>{
  const controller=new AbortController(),request={system:'s',task:'t',images:[image],reasoningEffort:'high' as 'low'|'high'|'max'};
  let calls=0;
  t.mock.method(globalThis,'fetch',async(_url:string,init:RequestInit)=>{
    calls++;assert.equal(JSON.parse(String(init.body)).reasoning_effort,'medium');request.reasoningEffort='max';controller.abort();return stream();
  });
  await assert.rejects(makeProvider(settings,assert.fail).provider.stream(request,()=>assert.fail('canceled'),controller.signal));
  assert.equal(calls,1);
});

test('pending Terra configuration boots offline with original ceilings; Astra rollback remains intact',()=>{
  const policy=JSON.parse(readFileSync(new URL('../../deploy/terra-model-budget.candidate.json',import.meta.url),'utf8'));
  const rollback=JSON.parse(readFileSync(new URL('../../deploy/production-model-budget.json',import.meta.url),'utf8'));
  assert.equal(policy.approved_at,null);assert.equal(policy.status,'local_candidate_pending_release_approval');
  for(const key of ['OFFICIAL_MAX_TOKENS','OBJECTIVE_RESULT_V1_MAX_TOKENS','EXPLANATION_MAX_TOKENS','MODEL_DAILY_BUDGET_MICROS','ATTEMPT_BUDGET_UPPER_MICROS','MODEL_BUDGET_WARNING_MICROS'])assert.equal(policy.environment[key],rollback.environment[key]);
  assert.equal(policy.environment.OBJECTIVE_RESULT_V1_ASTRA_FAST_REVIEW,'0');
  const run=spawnSync(process.execPath,['--input-type=module','-e',"import {config,validateTrialPolicy} from './src/config.ts';validateTrialPolicy(config);if(config.model!=='gpt-6.1-terra'||config.objectiveModel!==config.model)process.exit(2)"],{
    cwd:new URL('../',import.meta.url),env:{PATH:process.env.PATH,...policy.environment,REQUIRE_DURABLE_STORAGE:'1'},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.throws(()=>validateTrialPolicy({...settings,objectiveAstraFastReview:true}),/objective slot/);
  assert.throws(()=>validateTrialPolicy({...settings,maxTokens:8193}),/ceiling/);
  const defaulted=spawnSync(process.execPath,['--input-type=module','-e',"import {config} from './src/config.ts';if(config.model!=='gpt-6.1-terra')process.exit(2)"],{
    cwd:new URL('../',import.meta.url),env:{PATH:process.env.PATH,OFFICIAL_PROVIDER:'openai'},encoding:'utf8'});
  assert.equal(defaulted.status,0,defaulted.stderr);
});

test('actual capture, recovery and explanation routes preserve depth; retry is same Terra request with separate accounting',async t=>{
  const store=new MemoryStore(),app=Fastify({logger:false});t.after(async()=>{await app.close();await store.close();});
  const provider=makeProvider(settings,assert.fail).provider;
  const service=new CaptureService({config:{...settings,requestBudgetMode:'guarded-request',screenQueryEnabled:true,explanationEnabled:true,
    enabledSupportProfiles:'reading_practice',requestHmacKeysJSON:JSON.stringify({test:randomBytes(32).toString('base64')}),requestHmacKeyVersion:'test',
    modelCostCurrency:'USD',modelPricingJSON:pricing,attemptBudgetUpperMicros:3_000_000,modelDailyBudgetMicros:100_000_000,explanationMaxTokens:8192},
    store,storeKind:'memory',provider,objectiveProvider:provider,providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
  app.post('/v1/captures',async(req,reply)=>service.solve(req,reply));
  app.post('/v1/captures/:id/explanation',async(req,reply)=>service.auxiliary(req,reply,'explain'));
  app.post('/v1/captures/:id/recovery',async(req,reply)=>service.auxiliary(req,reply,'recover'));
  const {token}=await store.registerDevice({platform:'test',appVersion:'local',trialQuestions:30});
  const sent:Array<Record<string,any>>=[];let transient=true;
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(String(init.body));sent.push(body);
    if(transient){transient=false;return new Response('',{status:503,headers:{'retry-after':'0'}});}
    return stream({raw:body.messages[0].content.includes('consistent (boolean)')?JSON.stringify({consistent:true,explanation:'B follows from the supplied question.'}):ready});
  });
  const post=(url:string,payload:object)=>app.inject({method:'POST',url,headers:{authorization:'Bearer '+token},payload});
  for(const [selection,effort] of [['low','low'],['high','medium'],['max','high']] as const)for(const count of [1,4]){
    const before=sent.length,id=randomUUID();
    const body={capture_id:id,result_protocol:'objective_v1',response_contract:'screen_query_v1',operation:'solve',
      images_base64:Array.from({length:count},()=>pngBase64),image_media_type:'image/png',profile_id:'reading_practice',
      profile_version:SCREEN_QUERY_VERSION,prompt_version:SCREEN_QUERY_VERSION,ui_language:'en',reasoning_effort:selection,
      scope:{target_count:1,question_image_index:count-1,rect:{x:0,y:0,width:1,height:1}}};
    const answer=await post('/v1/captures',body);assert.equal(answer.statusCode,200);assert.match(answer.body,/"questions_charged":1/);
    if(before===0){assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal((await store.billing.attempts(token)).length,2);}
    const recovery=await post(`/v1/captures/${id}/recovery`,{...body,recovery_id:randomUUID()});
    assert.equal(recovery.statusCode,200);assert.match(recovery.body,/FINAL: B/);
    const explanation=await post(`/v1/captures/${id}/explanation`,{...body,explanation_id:randomUUID(),final_answer:'B'});
    assert.equal(explanation.statusCode,200);assert.match(explanation.body,/B follows/);
    for(const request of sent.slice(before)){assert.equal(request.model,TERRA_MODEL);assert.equal(request.reasoning_effort,effort);assert.equal(request.messages[1].content.length,count+1);}
  }
  assert.equal(sent.length,19);
  assert.equal((await store.billing.attempts(token)).length,19);
  // Legacy/personality-style requests omit Objective V1 but select the same configured model.
  const legacy=await post('/v1/captures',{capture_id:randomUUID(),system:'Personality instructions',task:'Choose an option',image_base64:pngBase64,image_media_type:'image/png',reasoning_effort:'max'});
  assert.equal(legacy.statusCode,200);assert.equal(sent.at(-1)!.model,TERRA_MODEL);assert.equal(sent.at(-1)!.reasoning_effort,'high');
});
