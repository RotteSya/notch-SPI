import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import unzipper from 'unzipper';
import {createWaitTiming} from '../core/wait-timing.mjs';
import {LocalTestReport} from '../core/local-test-report.mjs';
test('per-request timing preserves the first milestone and separates overlapping requests', () => {
  let now=100;const events=[];const record=(name,data)=>events.push(data);
  const a=createWaitTiming(record,()=>now);
  now=120;a.mark('request_sent');now=300;a.mark('response_headers');
  now=450;a.mark('first_delta');now=480;a.mark('first_content');
  now=490;a.mark('first_content');now=520;a.mark('content_frame');
  const b=createWaitTiming(record,()=>now);now=540;b.mark('request_sent');
  assert.notEqual(a.id,b.id);
  assert.deepEqual(events.map(e=>e.total_ms),[20,200,350,380,420,20]);
  assert.equal(events.filter(e=>e.phase==='first_content').length,1);
});
test('export accepts fixed timing fields but rejects content and forged identifiers', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nspi-timing-'));
  try {
    const r=new LocalTestReport(dir,{});let now=0;
    const timer=createWaitTiming((name,data)=>r.record(name,data),()=>now);
    now=400;timer.mark('response_headers');
    r.record('wait_timing',{phase:'SECRET',timing_id:'SECRET',total_ms:-1,answer:'SECRET'});
    const zip=await unzipper.Open.file(r.finish());const raw=(await zip.files[0].buffer()).toString();
    assert.ok(!raw.includes('SECRET'));const events=JSON.parse(raw).events.filter(e=>e.event==='wait_timing');
    assert.equal(events[0].timing_id,timer.id);assert.equal(events[0].total_ms,400);
    assert.equal(events[1].phase,undefined);assert.equal(events[1].total_ms,undefined);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
