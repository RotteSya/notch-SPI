import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import unzipper from 'unzipper';
import {LocalTestReport,reportZip} from '../core/local-test-report.mjs';
test('report ZIP opens and contains only allowlisted diagnostic fields',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nspi-report-'));
 try{const r=new LocalTestReport(dir,{platform:'win32'});r.record('capture_completed',{mode:'tutor',total_ms:123,usable_result:true,answer:'SECRET',token:'SECRET',windowTitle:'SECRET',action:'SECRET'});r.record('SECRET',{answer:'SECRET'});const file=r.finish();const zip=await unzipper.Open.file(file);assert.deepEqual(zip.files.map(x=>x.path),['report.json']);const text=(await zip.files[0].buffer()).toString();assert.ok(!text.includes('SECRET'));const data=JSON.parse(text);assert.equal(data.termination,'normal');assert.equal(data.summary.capture_completed,1);assert.equal(r.finish(),undefined);assert.equal(fs.existsSync(path.join(dir,'pending.json')),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('interrupted session is recovered on next startup without losing the original events',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nspi-report-'));try{new LocalTestReport(dir,{}).record('action',{action:'preview'});const next=new LocalTestReport(dir,{});const file=fs.readdirSync(dir).find(x=>x.endsWith('.zip'));const zip=await unzipper.Open.file(path.join(dir,file));const data=JSON.parse((await zip.files[0].buffer()).toString());assert.equal(data.termination,'interrupted');assert.equal(data.summary.action,1);next.finish();}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('ZIP supports UTF-8 JSON and CRC validation',async()=>{const zip=await unzipper.Open.buffer(reportZip({message:'测试报告'}));assert.equal(JSON.parse((await zip.files[0].buffer()).toString()).message,'测试报告');});
test('admission failure code and HTTP status survive ZIP export while arbitrary errors do not',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nspi-admission-'));
 try {
  const r=new LocalTestReport(dir,{});
  for(const [error_code,http_status,failure_kind] of [['insufficient_quota',402,'quota'],['service_maintenance',503,'maintenance'],['device_busy',429,'busy'],['capture_in_progress',409,'conflict']])r.record('solve_failed',{error_code,http_status,failure_kind,stage:'request',message:'SECRET'});
  r.record('solve_failed',{error_code:'SECRET',http_status:999,stage:'SECRET'});
  const zip=await unzipper.Open.file(r.finish());const raw=(await zip.files[0].buffer()).toString();assert.ok(!raw.includes('SECRET'));
  const events=JSON.parse(raw).events.filter(e=>e.event==='solve_failed');assert.deepEqual(events.slice(0,4).map(e=>e.http_status),[402,503,429,409]);assert.equal(events[2].error_code,'device_busy');assert.equal(events[4].http_status,undefined);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
