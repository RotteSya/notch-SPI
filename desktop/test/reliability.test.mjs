import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Reliability,captureObservation} from '../core/reliability.mjs';
import {validateProductEvent} from '../../server/src/telemetry.ts';
import {parseObservationCoverage} from '../../server/src/observation.ts';
function fixture(options={}) {
 let disk=null,remote=null;const calls=[];
 const client={base:'https://example.invalid',token:'test-only',async request(route,body){
  calls.push({route,body:structuredClone(body)});
  if(body?.preference)remote=structuredClone(body.preference);
  if(body?.events)return {accepted:body.events.length,duplicate:0,rejected:0};
  return {accepted:true,server_time:new Date().toISOString(),preference:remote,coverage:body?.coverage,telemetry_enabled:true};
 }};
 const store={read:()=>disk,write:(_key,v)=>{disk=structuredClone(v);}};
 const journal=new Reliability({store,client,...options});
 return {journal,client,calls,store,get disk(){return disk;}};
}
test('diagnostics schema is accepted by the same server validator; raw content is discarded',async()=>{
 const f=fixture();const id=randomUUID();
 f.journal.record('capture_started',{capture_id:id,mode:'tutor',channel:'official',answer:'PRIVATE',token:'SECRET'});
 f.journal.record('capture_completed',{capture_id:id,mode:'tutor',operation:'solve',usable_result:true,completion_kind:'usable',parser_path:'legacy_fallback',total_ms:12,description:'PRIVATE'});
 for(const event of f.journal.data.queue)assert.ok(validateProductEvent(event,"3.0",new Date(),2));
 assert.doesNotMatch(JSON.stringify(f.disk),/PRIVATE|SECRET/);
 await f.journal.flush();assert.equal(f.journal.data.queue.length,0);
 const coverage=f.calls.find(x=>x.body?.coverage).body.coverage;
 assert.ok(parseObservationCoverage(coverage));assert.equal(coverage.coverage_status,'complete');
});
test('opt out clears persisted queue, sends only preference, and never registers',async()=>{
 const f=fixture();f.journal.record('capture_started');f.journal.setEnabled(false);
 assert.equal(f.disk.queue.length,0);f.journal.record('capture_started');await f.journal.flush();
 assert.equal(f.journal.data.queue.length,0);assert.ok(f.calls.every(x=>x.route==='/v1/device-observation'&&!x.body?.coverage));
 assert.equal(f.calls.at(-1).body.preference.sharing_enabled,false);
});
test('missing token and QA never register or send',async()=>{
 for(const disabled of [false,true]) {const f=fixture({disabled});if(!disabled)f.client.token=null;f.journal.record('capture_started');await f.journal.flush();assert.equal(f.calls.length,0);}
});
test('network error and partial acknowledgement retain events for retry',async()=>{
 const f=fixture();f.journal.record('capture_started');f.journal.record('capture_started');const request=f.client.request;
 f.client.request=async()=>{throw new Error('offline');};await f.journal.flush();assert.equal(f.journal.data.queue.length,2);
 f.client.request=async(route,body)=>body?.events?{accepted:1,duplicate:0,rejected:0}:request(route,body);
 await f.journal.flush();assert.equal(f.journal.data.queue.length,2);
 f.client.request=request;await f.journal.flush();assert.equal(f.journal.data.queue.length,0);
});
test('account changes discard previous account queue and bind only a hash',async()=>{
 const f=fixture();f.journal.record('capture_started');f.client.token='second-test-token';await f.journal.flush();
 assert.equal(f.journal.data.queue.length,0);assert.doesNotMatch(JSON.stringify(f.disk),/second-test-token/);
 assert.equal(f.calls.some(x=>x.body?.events),false);
});
test('remote opt out clears pending events before upload',async()=>{
 const f=fixture();f.journal.record('capture_started');const request=f.client.request;
 f.client.request=async(route,body)=>body===undefined?{server_time:new Date().toISOString(),preference:{consent_epoch:9,sharing_enabled:false,valid_from:new Date().toISOString()}}:request(route,body);
 await f.journal.flush();assert.equal(f.journal.data.preference.sharing_enabled,false);assert.equal(f.journal.data.queue.length,0);
 assert.equal(f.calls.some(x=>x.body?.events),false);
});
test('opt out aborts pending upload and ignores stale receipt',async()=>{
 const f=fixture();f.journal.record('capture_started');let release;
 f.client.request=()=>new Promise(resolve=>{release=resolve;});
 const pending=f.journal.flush();const signal=f.journal.controller.signal;
 f.journal.setEnabled(false);assert.equal(signal.aborted,true);release({server_time:new Date().toISOString()});await pending;
 assert.equal(f.disk.preference.sharing_enabled,false);assert.equal(f.disk.queue.length,0);
});
test('bounded queue reports drops',()=>{
 const f=fixture();for(let i=0;i<205;i++)f.journal.record('capture_started');
 assert.equal(f.disk.queue.length,100);assert.equal(f.disk.drops,105);assert.equal(f.disk.gap,'queue_drop');
});
test('lost coverage response retries identical persisted proof after restart',async()=>{
 const f=fixture();f.journal.record('answer_action',{action:'copy'});const request=f.client.request;
 let original;
 f.client.request=async(route,body)=>{if(body?.coverage){original??=structuredClone(body.coverage);throw new Error('lost response');}return request(route,body);};
 await f.journal.flush();assert.equal(f.disk.pendingCoverage.observation_id,original.observation_id);
 const restarted=new Reliability({store:f.store,client:f.client});f.client.request=request;
 await restarted.flush();
 const sent=f.calls.filter(x=>x.body?.coverage).at(-1).body.coverage;
 assert.deepEqual(sent,original);assert.equal(restarted.data.pendingCoverage,null);
 assert.equal(restarted.data.gap,'client_restart','old receipt must not erase restart gap');
 await restarted.flush();assert.equal(f.calls.filter(x=>x.body?.coverage).at(-1).body.coverage.coverage_status,'partial');
 await restarted.flush();assert.equal(f.calls.filter(x=>x.body?.coverage).at(-1).body.coverage.coverage_status,'complete');
});
test('zero receipt follows Mac server-disabled loss accounting; partial receipt does not',async()=>{
 const f=fixture();f.journal.record('answer_action',{action:'copy'});const request=f.client.request;
 f.client.request=async(route,body)=>body?.events?{accepted:0,duplicate:0,rejected:0}:request(route,body);
 await f.journal.flush();assert.equal(f.journal.data.queue.length,0);assert.equal(f.journal.data.drops,1);
 const coverage=f.calls.find(x=>x.body?.coverage).body.coverage;
 assert.equal(coverage.gap_reason,'server_disabled');assert.equal(coverage.coverage_status,'partial');assert.equal(coverage.queue_drop_count,1);
});
test('batch limits cannot produce coverage while any events remain',async()=>{
 const f=fixture();f.client.config={telemetry:{enabled:true,max_batch_size:1}};
 f.journal.record('answer_action',{action:'copy'});f.journal.record('answer_action',{action:'retry'});
 await f.journal.flush();assert.equal(f.calls.some(x=>x.body?.coverage),false);assert.equal(f.journal.data.queue.length,1);
 await f.journal.flush();assert.equal(f.calls.find(x=>x.body?.coverage).body.coverage.sequence_to,2);
});
test('clock skew creates invalid-time gap and backs off without sending events',async()=>{
 const f=fixture();const delays=[];f.journal.schedule=delay=>delays.push(delay);
 f.client.request=async()=>({server_time:new Date(Date.now()+600000).toISOString()});
 for(let i=0;i<4;i++)await f.journal.flush();
 assert.deepEqual(delays,[60000,300000,1800000,1800000]);assert.equal(f.disk.gap,'invalid_time');
});
test('corrupt legacy journal cannot claim a complete interval',async()=>{
 const f=fixture();f.store.write('reliability',{queue:[{answer:'private'}],sequence:2,preference:{sharing_enabled:true}});
 const journal=new Reliability({store:f.store,client:f.client});await journal.flush();
 const proof=f.calls.find(x=>x.body?.coverage).body.coverage;
 assert.equal(proof.gap_reason,'client_restart');assert.equal(proof.coverage_status,'partial');assert.doesNotMatch(JSON.stringify(f.disk),/private/);
});
test('off then on rejects completion from the earlier consent epoch',()=>{
 const f=fixture(),epoch=f.journal.data.preference.consent_epoch,id=randomUUID();
 f.journal.record('capture_started',{capture_id:id,consent_epoch:epoch});
 f.journal.setEnabled(false);f.journal.setEnabled(true);
 f.journal.record('capture_completed',{capture_id:id,consent_epoch:epoch,operation:'solve',usable_result:false,completion_kind:'canceled'});
 assert.equal(f.journal.data.queue.length,0);assert.equal(f.journal.data.openCaptures.length,0);
});
test('clean shutdown and open captures preserve different restart evidence',()=>{
 for(const open of [false,true]){
  const f=fixture();if(open)f.journal.record('capture_started',{capture_id:randomUUID()});f.journal.stop();
  const restarted=new Reliability({store:f.store,client:f.client});
  assert.equal(restarted.data.gap,open?'client_restart':'none');assert.equal(restarted.data.openCaptures.length,0);
 }
});
test('storage failure is recorded and newer gap survives coverage acknowledgement',async()=>{
 const f=fixture();const write=f.store.write;let fail=true;
 f.store.write=(...args)=>{if(fail)throw new Error('disk full');return write(...args);};
 f.journal.record('answer_action',{action:'copy'});assert.equal(f.journal.data.gap,'storage_failure');fail=false;
 await f.journal.flush();assert.equal(f.calls.find(x=>x.body?.coverage).body.coverage.gap_reason,'storage_failure');
});

test('usable-result statistics match native predicate instead of treating every displayed answer as usable',()=>{
 for(const parserPath of ['v1','legacy_fallback','legacy','none'])for(const resultState of ['ready','review','retake',null]){
  const value=captureObservation({mode:'tutor',operation:'solve',parserPath,resultState});
  assert.equal(value.usable_result,parserPath==='legacy_fallback'||(parserPath==='v1'&&['ready','review'].includes(resultState)));
 }
 assert.equal(captureObservation({mode:'personality',operation:'solve',parserPath:'legacy_fallback'}).usable_result,false);
 assert.equal(captureObservation({mode:'tutor',operation:'explain',parserPath:'legacy_fallback'}).usable_result,false);
 assert.equal(captureObservation({mode:'tutor',operation:'solve',parserPath:'v1',resultState:'ready',errorCode:'upstream_error'}).completion_kind,'failed');
});
test('account replacement aborts old observation flight without consuming the new journal',async()=>{
 const f=fixture();f.journal.record('answer_action',{action:'copy'});const request=f.client.request;
 let release,first=true;
 f.client.request=async(...args)=>{if(first){first=false;return new Promise(resolve=>{release=resolve;});}return request(...args);};
 const old=f.journal.flush();const signal=f.journal.controller.signal;
 f.client.token='replacement';await f.journal.flush();assert.equal(signal.aborted,true);
 const scope=f.journal.data.scope;release({server_time:new Date().toISOString(),preference:null});await old;
 assert.equal(f.journal.data.scope,scope);assert.equal(f.journal.data.queue.length,0);assert.equal(f.calls.some(x=>x.body?.events),false);
});
test('diagnostic transport requires the native receipt HTTP status',async()=>{
 const {OfficialClient}=await import('../core/official.mjs');
 const client=new OfficialClient({base:'https://example.invalid',store:{},fetchImpl:async()=>new Response(JSON.stringify({accepted:1}),{status:200,headers:{"Content-Type":"application/json"}})});
 await assert.rejects(()=>client.request('/v1/events/batch',{}, {expectedStatus:202}),/Unexpected response status/);
});
