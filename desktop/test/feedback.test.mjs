import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { feedbackSnapshot, authorizeFeedback, writeFeedback } from '../core/feedback.mjs';
const now=1800000000000;
const images=Array.from({length:4},(_,i)=>({id:`asset-${i}`,base64:Buffer.from(`image-${i}`).toString('base64'),width:640,height:400}));
const make=()=>feedbackSnapshot({images,answer:'B. 60 km/h',captureID:'capture',sessionID:'session',expiresAt:now+900000},()=>({width:640,height:400,extension:'png'}));
const selection=(s,extra={})=>({session:s.id,rightsConfirmed:true,purpose:'support_review',assetIDs:['asset-1','asset-3'],standardAnswer:'  B  ',...extra});
test('feedback authorization pins scope, requires fresh consent, and limits rights to 90 days',()=>{
 const s=make(),v=authorizeFeedback(s,selection(s),now);
 assert.equal(v.standardAnswer,'B');assert.equal(v.authorization.version,'feedback-v2');
 assert.equal(Date.parse(v.authorization.expires_at)-Date.parse(v.authorization.authorized_at),90*86400000);
 assert.equal(v.authorization.external_processing,'requires_separate_permission');
 for(const extra of [{rightsConfirmed:false},{session:'another'},{purpose:'training'},{assetIDs:['unknown']},{assetIDs:['asset-1','asset-1']},{standardAnswer:'字'.repeat(16384)}])assert.throws(()=>authorizeFeedback(s,selection(s,extra),now));
 assert.throws(()=>authorizeFeedback(s,selection(s),s.expiresAt),/expired/);
});
test('feedback saves only selected frozen images, current answer and optional standard; role follows original order',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notchspi-feedback-test-'));
 try{
  const s=make(),v=authorizeFeedback(s,selection(s),now),destination=path.join(dir,'feedback.json');
  const id=await writeFeedback(s,v,destination,now);
  const manifest=JSON.parse(await fs.readFile(destination,'utf8'));
  assert.equal(manifest.submission_id,id);assert.equal(manifest.answer,'B. 60 km/h');assert.equal(manifest.standard_answer,'B');
  assert.equal(manifest.retention,'local_until_user_deletes');assert.deepEqual(manifest.assets.map(x=>[x.role,x.ordinal]),[['reference',0],['question',1]]);
  assert.deepEqual(manifest.assets.map(x=>[x.widthPx,x.heightPx]),[[640,400],[640,400]]);
  assert.deepEqual(await Promise.all(manifest.assets.map(x=>fs.readFile(path.join(dir,x.file),'utf8'))),['image-1','image-3']);
  assert.equal((await fs.readdir(path.join(dir,`notchspi-feedback-${id}-assets`))).length,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('expired, altered, oversized or invalid feedback never leaves a partial package',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notchspi-feedback-test-'));
 try{
  const s=make(),v=authorizeFeedback(s,selection(s),now),destination=path.join(dir,'feedback.json');
  await assert.rejects(writeFeedback(s,v,destination,s.expiresAt),/expired/);
  s.assets[1].data[0]^=1;
  await assert.rejects(writeFeedback(s,v,destination,now),/changedMaterial/);
  assert.deepEqual(await fs.readdir(dir),[]);
  const fresh=make(),permission=authorizeFeedback(fresh,selection(fresh),now);
  permission.authorization.external_processing='allowed';
  await assert.rejects(writeFeedback(fresh,permission,destination,now),/unauthorized/);
  assert.deepEqual(await fs.readdir(dir),[]);
  assert.throws(()=>feedbackSnapshot({images,answer:'x'.repeat(65537)},()=>({width:640,height:400,extension:'png'})),/invalidSelection/);
  assert.throws(()=>feedbackSnapshot({images,answer:'B'},()=>({width:639,height:400,extension:'png'})),/changedMaterial/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('answer-only selection is allowed, while canceled preview cannot create authorization',async()=>{
 const s=make();assert.throws(()=>authorizeFeedback(s,selection(s,{rightsConfirmed:false}),now),/unauthorized/);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notchspi-feedback-test-'));
 try{await writeFeedback(s,authorizeFeedback(s,selection(s,{assetIDs:[],standardAnswer:''}),now),path.join(dir,'feedback.json'),now);
 const value=JSON.parse(await fs.readFile(path.join(dir,'feedback.json'),'utf8'));assert.deepEqual(value.assets,[]);assert.equal('standard_answer' in value,false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('both platforms enforce the shared feedback permission contract',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('../../shared/fixtures/feedback-parity.json',import.meta.url),'utf8'));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notchspi-feedback-contract-'));
 try{
  for(const [i,c] of fixture.cases.entries()){
   const s=make(),at=now-c.ageDays*86400000;
   if(!c.rightsConfirmed){assert.throws(()=>authorizeFeedback(s,selection(s,c),at),/unauthorized/);continue;}
   const authorization=authorizeFeedback({...s,expiresAt:at+900000},selection(s,c),at);
   assert.equal(authorization.authorization.version,fixture.version);assert.equal(authorization.authorization.withdrawal_contact,fixture.contact);
   assert.equal(authorization.authorization.external_processing,fixture.externalProcessing);
   assert.equal(Date.parse(authorization.authorization.expires_at)-Date.parse(authorization.authorization.authorized_at),fixture.days*86400000);
   const result=writeFeedback(s,authorization,path.join(dir,`${i}.json`),now);
   if(c.valid)await result;else await assert.rejects(result,/unauthorized/);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
