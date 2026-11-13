import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {runCheck} from '../lib/run-check.mjs';
import {testSummary, sourceEntries, sourceSnapshot} from '../lib/verification-report.mjs';

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

function repositoryFixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nspi-snapshot-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',env:{...process.env,
    GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
    GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}});
  git('init','-q');
  fs.writeFileSync(path.join(dir,'source.txt'),'original');
  fs.writeFileSync(path.join(dir,'.gitignore'),'cache/\n');
  git('add','.'); git('commit','-qm','fixture');
  return {dir,git};
}

test('nested linked worktree state is included without treating it as a source file',t=>{
  const {dir,git}=repositoryFixture(t);
  const nested=path.join(dir,'tmp','intel candidate');
  git('worktree','add','-q','--detach',nested,'HEAD');
  const entries=sourceEntries(dir);
  assert.deepEqual(entries.filter(e=>e.kind==='repository'),[{name:'tmp/intel candidate/',kind:'repository'}]);
  assert(entries.some(e=>e.name==='source.txt' && e.kind==='file'));
  const before=sourceSnapshot(dir);
  assert.equal(before.nested_repositories.length,1);
  assert.equal(before.nested_repositories[0].dirty,false);
  const source=path.join(nested,'source.txt');
  fs.writeFileSync(source,'first edit');
  const dirty=sourceSnapshot(dir);
  assert.notEqual(dirty.source_sha256,before.source_sha256);
  assert.equal(dirty.nested_repositories[0].dirty,true);
  fs.writeFileSync(source,'second edit');
  assert.notEqual(sourceSnapshot(dir).source_sha256,dirty.source_sha256);
  fs.writeFileSync(source,'original');
  fs.writeFileSync(path.join(nested,'new.txt'),'untracked');
  assert.notEqual(sourceSnapshot(dir).source_sha256,before.source_sha256);
  fs.unlinkSync(path.join(nested,'new.txt'));
  fs.unlinkSync(source);
  assert.notEqual(sourceSnapshot(dir).source_sha256,before.source_sha256);
  fs.writeFileSync(source,'original');
  fs.mkdirSync(path.join(nested,'cache'));
  fs.writeFileSync(path.join(nested,'cache','build.bin'),'rebuildable');
  assert.equal(sourceSnapshot(dir).source_sha256,before.source_sha256);
  git('-C',nested,'commit','--allow-empty','-qm','new nested HEAD');
  assert.notEqual(sourceSnapshot(dir).source_sha256,before.source_sha256);
  assert.equal(fs.readFileSync(source,'utf8'),'original');
});

test('owning repository untracked files and dangling symlinks remain in identity',t=>{
  const {dir}=repositoryFixture(t);
  const before=sourceSnapshot(dir);
  fs.writeFileSync(path.join(dir,'new.txt'),'new source');
  assert.notEqual(sourceSnapshot(dir).source_sha256,before.source_sha256);
  fs.symlinkSync('missing-target',path.join(dir,'dangling'));
  assert.equal(sourceEntries(dir).find(e=>e.name==='dangling').kind,'symlink');
  const dangling=sourceSnapshot(dir);
  fs.unlinkSync(path.join(dir,'dangling'));
  fs.symlinkSync('other-target',path.join(dir,'dangling'));
  assert.notEqual(sourceSnapshot(dir).source_sha256,dangling.source_sha256);
});

test('unexpected directory replacing tracked source fails closed',t=>{
  const {dir}=repositoryFixture(t);
  fs.unlinkSync(path.join(dir,'source.txt'));
  fs.mkdirSync(path.join(dir,'source.txt'));
  assert.throws(()=>sourceSnapshot(dir),/Unexpected source directory: source.txt/);
});
