import {test,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH=':memory:';
process.env.OFFICIAL_PROVIDER='mock';
process.env.LOG_LEVEL='silent';
process.env.DMG_URL='data:application/octet-stream,arm64-fixture';
process.env.INTEL_DMG_URL='data:application/octet-stream,intel-fixture';
const data=(body:unknown)=>`data:application/json,${encodeURIComponent(JSON.stringify(body))}`;
process.env.RELEASE_API_URL=data({tag_name:'v9.0',body:'ARM release'});
process.env.INTEL_RELEASE_API_URL=data({tag_name:'v3.1',body:'Intel release',assets:[{browser_download_url:process.env.INTEL_DMG_URL}]});
const {buildApp}=await import('../src/index.ts');
const {config}=await import('../src/config.ts');
const app=await buildApp();after(()=>app.close());
test('Intel metadata and bytes stay independent of the latest arm64 release',async()=>{
 const arm=await app.inject('/update');const intel=await app.inject('/update/intel');
 assert.equal(arm.statusCode,200);assert.equal(arm.json().version,'9.0');
 assert.equal(intel.statusCode,200);assert.deepEqual(intel.json(),{version:'3.1',tag:'v3.1',notes:'Intel release'});
 assert.equal((await app.inject('/dl')).body,'arm64-fixture');
 const download=await app.inject('/dl/intel');assert.equal(download.statusCode,200);assert.equal(download.body,'intel-fixture');
 assert.equal(download.headers.location,undefined);
});
test('Intel updates fail closed when the pinned asset or stable release is missing',async(t)=>{
 let releaseBody:unknown;const original=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>String(input)===config.intelReleaseApiUrl?Response.json(releaseBody):original(input,init));
  for(const body of [
   {tag_name:'v9.0',assets:[{browser_download_url:process.env.DMG_URL}]},
   {tag_name:'v3.1',assets:[]}, {tag_name:'v3.1',assets:[null]},
   {tag_name:'v3.1',draft:true,assets:[{browser_download_url:process.env.INTEL_DMG_URL}]},
   {tag_name:'v3.1',prerelease:true,assets:[{browser_download_url:process.env.INTEL_DMG_URL}]},
   {tag_name:'v3.1-intel',assets:[{browser_download_url:process.env.INTEL_DMG_URL}]},
  ]){
   releaseBody=body;const r=await app.inject('/update/intel');assert.equal(r.statusCode,502,JSON.stringify(body));
   assert.equal((await app.inject('/update')).json().version,'9.0');
  }

});
