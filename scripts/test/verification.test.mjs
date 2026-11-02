import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runCheck} from '../lib/run-check.mjs';
import {testSummary} from '../lib/verification-report.mjs';

test('verification preserves failures and missing commands',async()=>{
  assert.equal(await runCheck(process.execPath,['-e','process.exit(7)'],{timeoutMs:1000,stdio:'ignore'}),7);
  assert.equal(await runCheck('/missing/notchspi-check',[],{timeoutMs:1000,stdio:'ignore'}),127);
});

test('timeout terminates its process group without stopping another process',{skip:process.platform==='win32'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nspi-check-timeout-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const pidFile=path.join(dir,'child.pid');
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  t.after(()=>unrelated.kill());
  const script=`const {spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
  assert.equal(await runCheck(process.execPath,['-e',script,pidFile],{timeoutMs:400,graceMs:100,stdio:'ignore'}),124);
  assert.doesNotThrow(()=>process.kill(unrelated.pid,0));
  const pid=Number(fs.readFileSync(pidFile,'utf8'));
  for(let i=0;i<50;i++) {
    try{process.kill(pid,0);}catch(error){assert.equal(error.code,'ESRCH');return;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('owned descendant survived the timeout');
});

test('summaries preserve skips and report the final aggregate',()=>{
  assert.deepEqual(testSummary('Executed 2 tests, with 0 failures\nExecuted 616 tests, with 6 tests skipped and 1 failure\nTest skipped - opt-in capture\n'),{
    tests:{total:616,passed:609,failed:1,skipped:6},skip_reasons:['opt-in capture']});
  assert.deepEqual(testSummary('ℹ tests 29\nℹ pass 28\nℹ fail 0\nℹ skipped 1\n').tests,{total:29,passed:28,failed:0,skipped:1});
  assert.equal(testSummary('build passed').tests.total,null);
});
