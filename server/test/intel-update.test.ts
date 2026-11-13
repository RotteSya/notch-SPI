import {test,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH=':memory:';
process.env.OFFICIAL_PROVIDER='mock';
process.env.LOG_LEVEL='silent';
process.env.DMG_URL='data:application/octet-stream,arm64-fixture';
process.env.INTEL_DMG_URL='data:application/octet-stream,intel-fixture';
const data=(body:unknown)=>`data:application/json,${encodeURIComponent(JSON.stringify(body))}`;
process.env.RELEASE_API_URL=data({tag_name:'v9.0',body:'ARM release',assets:[{browser_download_url:process.env.DMG_URL}]});
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
 assert.equal(download.headers['content-disposition'],'attachment; filename="NotchSPI3.1.0-intel.dmg"');
 assert.equal((await app.inject('/dl')).headers['content-disposition'],'attachment; filename="NotchSPI9.0.0-mac.dmg"');
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

test('download pins bytes to the same metadata snapshot used for the public filename',async(t)=>{
 const seen:string[]=[];
 const pinned='https://github.com/RotteSya/notch-SPI/releases/download/v9.0/NotchSPI9.0.0-mac.dmg';
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
  const url=String(input);seen.push(url);
  if(url===config.releaseApiUrl)return Response.json({tag_name:'v9.0',assets:[{name:'NotchSPI9.0.0-mac.dmg',browser_download_url:pinned}]});
  assert.equal(url,pinned);return new Response('pinned-release-bytes');
 });
 const isolated=await buildApp();t.after(()=>isolated.close());
 const r=await isolated.inject('/dl');assert.equal(r.statusCode,200);assert.equal(r.body,'pinned-release-bytes');
 assert.equal(r.headers['content-disposition'],'attachment; filename="NotchSPI9.0.0-mac.dmg"');
 assert.deepEqual(seen,[config.releaseApiUrl,pinned]);
});
test('download refuses missing metadata or assets instead of mislabelling bytes',async(t)=>{
 for(const response of [new Response('',{status:503}),Response.json({tag_name:'v3.1',assets:[]})]){
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response;});
  const isolated=await buildApp();
  const r=await isolated.inject('/dl/intel');await isolated.close();assert.equal(r.statusCode,502);assert.equal(calls,1);
  assert.equal(r.headers['content-disposition'],undefined);t.mock.restoreAll();
 }
});


test('download caches each channel identity for ten minutes without caching an expired failure',async(t)=>{
 const isolated=await buildApp();t.after(()=>isolated.close());
 let clock=Date.now(),metadataCalls=0,unavailable=false;
 t.mock.method(Date,'now',()=>clock);
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
  const url=String(input);
  if(url===config.intelReleaseApiUrl){metadataCalls++;return unavailable?new Response('',{status:503}):Response.json({tag_name:'v3.1',assets:[{browser_download_url:config.intelDmgUrl}]});}
  assert.equal(url,config.intelDmgUrl);return new Response('intel-fixture');
 });
 for(let i=0;i<2;i++)assert.equal((await isolated.inject('/dl/intel')).statusCode,200);
 assert.equal(metadataCalls,1);
 clock+=600_001;unavailable=true;
 assert.equal((await isolated.inject('/dl/intel')).statusCode,502);assert.equal(metadataCalls,2);
 unavailable=false;
 assert.equal((await isolated.inject('/dl/intel')).statusCode,200);assert.equal(metadataCalls,3);
});
