import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoSession} from '../core/sessions.mjs';
import {validateProductEvent} from '../../server/src/telemetry.ts';
import {randomUUID} from 'node:crypto';
for(const [reason,code]of Object.entries({userToggled:'user_toggled',captureHotkey:'capture_hotkey',stopButton:'stop_button',runFailed:'run_failed'}))test('auto lifecycle explicit stop '+code,()=>{
 const events=[],auto=new AutoSession((name,metadata)=>events.push({name,...metadata}));
 auto.start(20);auto.stop(reason);auto.stop(reason);
 assert.deepEqual(events,[{name:'auto_session_started',trigger:'auto'},{name:'auto_session_ended',trigger:'auto',error_code:code}]);
 for(const e of events)assert.ok(validateProductEvent({event_id:randomUUID(),occurred_at:new Date().toISOString(),event_name:e.name,trigger:e.trigger,...(e.error_code?{error_code:e.error_code}:{}),consent_epoch:0,event_sequence:0},'3.0',new Date(),2));
});
for(const [reason,run]of [
 ['question_cap',a=>{a.start(1);a.succeeded(100,false,0);}],
 ['quota_exhausted',a=>{a.start(20);a.succeeded(0,false,0);}],
 ['idle_timeout',a=>{a.start(20);a.succeeded(100,false,0);a.tick([0],900000);}],
 ['hash_failures',a=>{a.start(20);a.succeeded(100,false,0);a.tick(null,1);a.tick(null,2);a.tick(null,3);}],
])test('auto internal termination '+reason,()=>{
 const events=[],a=new AutoSession((name,metadata)=>events.push({name,...metadata}));run(a);
 assert.equal(events.length,2);assert.equal(events[1].error_code,reason);assert.equal(a.active,false);
});

test('review pause timeout also emits exactly one end event',()=>{
 const events=[],auto=new AutoSession((name,metadata)=>events.push({name,...metadata}));
 auto.start(20);auto.succeeded(100,false,0);auto.paused(900000);auto.paused(901000);
 assert.equal(events.length,2);assert.equal(events[1].error_code,'idle_timeout');
});
