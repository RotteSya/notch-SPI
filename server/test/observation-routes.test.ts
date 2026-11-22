import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

process.env.DB_PATH=':memory:';
process.env.OFFICIAL_PROVIDER='mock';
process.env.LOG_LEVEL='silent';
process.env.CRON_SECRET='observation-test-cron';
process.env.TELEMETRY_ENABLED='1';
const {buildApp}=await import('../src/index.ts');
const {coverageDeferralSeconds}=await import('../src/observation.ts');
let app:FastifyInstance;
before(async()=>{app=await buildApp();});
after(async()=>{await app.close();});

test('observation HTTP contract acknowledges only valid schema-2 events and preserves opt-out',async()=>{
  const registration=await app.inject({method:'POST',url:'/v1/devices',payload:{platform:'macos',app_version:'2.12'}});
  const token=registration.json().device_token as string;
  const headers={authorization:'Bearer '+token};
  const state=await app.inject({url:'/v1/device-observation',headers});
  assert.equal(state.statusCode,200);assert.equal(state.headers['cache-control'],'no-store');
  assert.equal(state.json().preference,null);
  const from=new Date(Date.now()-1000).toISOString();
  const pref={consent_epoch:0,sharing_enabled:true,valid_from:from};
  assert.equal((await app.inject({method:'POST',url:'/v1/device-observation',headers,payload:{schema_version:1,preference:pref}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/v1/device-observation',headers,payload:{schema_version:1,preference:{...pref,sharing_enabled:false}}})).statusCode,409);
  const event={event_id:randomUUID(),capture_id:randomUUID(),occurred_at:from,event_name:'capture_completed',channel:'official',
    mode:'tutor',depth:'brief',result_state:'ready',parser_path:'v1',consent_epoch:0,event_sequence:0,
    usable_result:true,completion_kind:'usable',operation:'solve'};
  const batch=async(events:unknown[])=>app.inject({method:'POST',url:'/v1/events/batch',headers,payload:{schema_version:2,events}});
  assert.deepEqual((await batch([event,{...event,event_id:randomUUID(),event_sequence:1,depth:'hint'}])).json(),{accepted:1,duplicate:0,rejected:1});
  assert.deepEqual((await batch([event])).json(),{accepted:0,duplicate:1,rejected:0});
  assert.deepEqual((await batch([{...event,event_id:event.event_id.toUpperCase(),capture_id:event.capture_id.toUpperCase()}])).json(),{accepted:0,duplicate:1,rejected:0});
  const coverage={observation_id:randomUUID(),consent_epoch:0,valid_from:from,valid_to:new Date().toISOString(),
    sequence_from:0,sequence_to:2,queue_drop_count:0,coverage_status:'complete',gap_reason:'none'};
  const proof=await app.inject({method:'POST',url:'/v1/device-observation',headers,payload:{schema_version:1,coverage}});
  assert.equal(proof.statusCode,200);assert.equal(proof.json().coverage.coverage_status,'partial');
  assert.equal(proof.json().coverage.gap_reason,'sequence_gap');
  const off={consent_epoch:1,sharing_enabled:false,valid_from:new Date().toISOString()};
  assert.equal((await app.inject({method:'POST',url:'/v1/device-observation',headers,payload:{schema_version:1,preference:off}})).statusCode,200);
  assert.deepEqual((await batch([{...event,event_id:randomUUID(),event_sequence:1}])).json(),{accepted:0,duplicate:0,rejected:1});
  assert.equal((await app.inject({url:'/v1/device-observation',headers})).json().preference.sharing_enabled,false);
  assert.equal((await app.inject({method:'POST',url:'/v1/device-observation',headers,payload:{schema_version:1,preference:off,answer:'secret'}})).statusCode,400);
});

test('idle coverage is deferred before authentication and admitted once it spans or outlives the window',async()=>{
  const registration=await app.inject({method:'POST',url:'/v1/devices',payload:{platform:'macos',app_version:'3.2'}});
  const headers={authorization:'Bearer '+registration.json().device_token as string};
  const post=(coverage:unknown,h:Record<string,string>=headers)=>app.inject({method:'POST',url:'/v1/device-observation',headers:h,payload:{schema_version:1,coverage}});
  const summary=(fromAgoMs:number,toAgoMs:number,extra:Record<string,unknown>={})=>({observation_id:randomUUID(),consent_epoch:0,
    valid_from:new Date(Date.now()-fromAgoMs).toISOString(),valid_to:new Date(Date.now()-toAgoMs).toISOString(),
    sequence_from:0,sequence_to:0,queue_drop_count:0,coverage_status:'complete',gap_reason:'none',...extra});
  const window=21_600_000;
  // A fresh 30-second heartbeat with no events: answered without looking the device up, so an
  // unknown token receives the same 429 instead of the 401 an account lookup would produce.
  const heartbeat=summary(30_000,0);
  for(const h of [headers,{authorization:'Bearer not-a-device-token'}]) {
    const deferred=await post(heartbeat,h);
    assert.equal(deferred.statusCode,429);assert.equal(deferred.headers['cache-control'],'no-store');
    const retry=Number(deferred.headers['retry-after']);assert.ok(retry>window/1000-60&&retry<=window/1000);
  }
  assert.equal((await app.inject({method:'POST',url:'/v1/device-observation',payload:{schema_version:1,coverage:heartbeat}})).statusCode,401);
  // The identical pending summary, resent after the window has passed, is recorded exactly once.
  const aged=summary(window+60_000,window+30_000);
  const first=await post(aged);assert.equal(first.statusCode,200);assert.equal(first.json().accepted,true);
  assert.deepEqual((await post(aged)).json(),first.json());
  assert.equal((await post(aged,{authorization:'Bearer not-a-device-token'})).statusCode,401);
  // A summary spanning the whole window, or one that carries events or a gap, is admitted immediately.
  assert.equal((await post(summary(window,0))).statusCode,200);
  assert.equal((await post(summary(30_000,0,{sequence_to:1}))).statusCode,200);
  assert.equal((await post(summary(30_000,0,{coverage_status:'partial',gap_reason:'client_restart'}))).statusCode,200);
  // Malformed or mixed bodies keep their existing answers.
  assert.equal((await post({...heartbeat,answer:'secret'})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/v1/device-observation',headers,payload:{schema_version:1,coverage:heartbeat,extra:1}})).statusCode,400);
});

test('coverage deferral is a pure function of the summary, the window and the clock',()=>{
  const now=Date.parse('2026-11-22T12:00:00.000Z'),at=(ms:number)=>new Date(now-ms).toISOString();
  const base={observationId:randomUUID(),consentEpoch:0,validFrom:at(30_000),validTo:at(0),sequenceFrom:5,sequenceTo:5,
    queueDropCount:0,coverageStatus:'complete' as const,gapReason:'none' as const};
  assert.equal(coverageDeferralSeconds(base,21_600,now),21_600);
  assert.equal(coverageDeferralSeconds(base,0,now),0);
  assert.equal(coverageDeferralSeconds({...base,sequenceTo:6},21_600,now),0);
  assert.equal(coverageDeferralSeconds({...base,coverageStatus:'partial',gapReason:'client_restart'},21_600,now),0);
  assert.equal(coverageDeferralSeconds({...base,queueDropCount:1},21_600,now),0);
  assert.equal(coverageDeferralSeconds({...base,validFrom:at(21_600_000)},21_600,now),0);
  assert.equal(coverageDeferralSeconds({...base,validFrom:at(21_600_000-1)},21_600,now),21_600);
  assert.equal(coverageDeferralSeconds({...base,validFrom:at(3_630_000),validTo:at(3_600_000)},21_600,now),18_000);
  assert.equal(coverageDeferralSeconds({...base,validFrom:at(21_630_000),validTo:at(21_600_000)},21_600,now),0);
});

test('observation routes require authentication and retention runs through the independent scheduler',async()=>{
  assert.equal((await app.inject({url:'/v1/device-observation'})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/v1/device-observation',payload:{}})).statusCode,401);
  assert.equal((await app.inject({url:'/api/internal/reap'})).statusCode,401);
  const sweep=await app.inject({url:'/api/internal/reap',headers:{authorization:'Bearer observation-test-cron'}});
  assert.equal(sweep.statusCode,200);assert.equal(sweep.headers['cache-control'],'no-store');
  assert.equal(sweep.json().events_pruned,0);
});
