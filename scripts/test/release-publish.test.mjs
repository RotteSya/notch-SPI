import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {publishRelease,releaseAssets,selectFolder} from '../lib/release-publish.mjs';

function fixture(t, draft=true) {
  const base=path.resolve('output/release-publish-tests');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'case-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
  const names=['NotchSPI3.2.0-mac.dmg','NotchSPI3.2.0-intel.dmg','NotchSPI3.2.0-SHA256SUMS.txt'];
  const bodies=[Buffer.from('arm-signed-fixture'),Buffer.from('intel-signed-fixture')];bodies.push(Buffer.from(bodies.map((b,i)=>`${sha(b)}  ${names[i]}\n`).join('')));
  const release={id:123,tag_name:'v3.2.0',draft,prerelease:false,assets:names.map((name,i)=>({id:i+1,name,size:bodies[i].length,digest:'sha256:'+sha(bodies[i])}))};
  const cli=path.join(root,'qk');fs.writeFileSync(cli,'test adapter');const config={quarkCli:cli,folderName:'NotchSPI Releases',folderPath:'夸克网盘/NotchSPI Releases'};
  const remote=[],events=[],faults={};
  const emit=(type,data,code=0)=>JSON.stringify({type,code,msg:'fixture',data})+'\n';
  const run=(cmd,args)=>{
    if(cmd==='gh') {
      if(args[0]==='api'){events.push('metadata');if(args[1].includes('/git/ref/'))return JSON.stringify({object:{sha:faults.tagMissing?'':'a'.repeat(40)}});
        faults.metadata?.(release);return JSON.stringify(release);}
      if(args[1]==='edit'){events.push('publish');release.draft=false;return '';}
      if(args[1]==='download'){const name=args[args.indexOf('--pattern')+1],dir=args[args.indexOf('--dir')+1];fs.writeFileSync(path.join(dir,name),bodies[names.indexOf(name)]);return '';}
      throw Error('Unexpected GitHub mutation');
    }
    assert.equal(cmd,'bash');const [qk,action,...rest]=args;assert.equal(qk,cli);events.push(action);
    if(action==='search') {
      if(faults.auth) return emit('result',{},-103);
      const files=[{fid:'folder-123',filename:'NotchSPI Releases',file_type:'0'},...remote.map(x=>({fid:x.fid,filename:x.name,file_type:'1'}))];
      const artifact=path.join(root,'search.jsonl');fs.writeFileSync(artifact,files.map(x=>JSON.stringify(x)).join('\n'));
      return emit('result',{total:faults.truncated?100:files.length,file_list:files.slice(0,1)})+emit('artifact',{file_path:artifact});
    }
    if(action==='upload') {
      assert.equal(rest[1],'--parent-fid');assert.equal(rest[2],'folder-123');
      const name=path.basename(rest[0]);if(faults.upload===name)throw Error('upload transport lost');
      const fid='file-'+remote.length;remote.push({fid,name,body:fs.readFileSync(rest[0])});
      return emit('list',{fileId:fid,fileName:name,fileSize:fs.statSync(rest[0]).size})+emit('result',{fullPath:faults.path?'夸克网盘/Other':config.folderPath});
    }
    if(action==='download') {
      const item=remote.find(x=>x.fid===rest[1]);assert.ok(item);const file=path.join(rest[3],item.name);fs.writeFileSync(file,faults.readback?'corrupt':item.body);
      return emit('result',{fileName:item.name,filePath:file});
    }
    throw Error('Unexpected Quark command');
  };
  const go=(mode='publish')=>publishRelease({root,tag:'v3.2.0',mode,config,run});
  return {root,go,release,names,bodies,remote,events,faults};
}

test('one local publish command publishes the prepared draft then uploads and reads back all three files',t=>{
 const f=fixture(t);const result=f.go();assert.equal(result.status,'complete');assert.equal(f.remote.length,3);
 assert.ok(f.events.indexOf('search')<f.events.indexOf('publish'));assert.ok(f.events.indexOf('publish')<f.events.indexOf('upload'));
 assert.equal(f.events.filter(e=>e==='search').length,1);assert.equal(f.events.filter(e=>e==='download').length,3);
});
test('retry verifies existing receipt bytes and never uploads duplicates or republishes',t=>{
 const f=fixture(t);f.go();f.events.length=0;f.go('sync');assert.equal(f.remote.length,3);assert.ok(!f.events.includes('upload'));assert.ok(!f.events.includes('publish'));assert.equal(f.events.filter(e=>e==='download').length,3);
});
test('sync cannot make a draft public',t=>{
 const f=fixture(t);assert.throws(()=>f.go('sync'),/draft/);assert.ok(!f.events.includes('upload'));assert.ok(!f.events.includes('publish'));
});
test('missing Intel or ambiguous canonical assets stop before publishing',t=>{
 const f=fixture(t);f.release.assets.pop();assert.throws(()=>f.go(),/asset/);assert.ok(!f.events.includes('publish'));
 assert.throws(()=>releaseAssets({...f.release,assets:[...f.release.assets,f.release.assets[0]]},'v3.2.0'),/asset/);
});
test('existing same-name file without trusted receipt stops rather than uploading a renamed duplicate',t=>{
 const f=fixture(t);f.remote.push({fid:'foreign',name:f.names[0],body:f.bodies[0]});assert.throws(()=>f.go(),/trusted upload receipt/);assert.ok(!f.events.includes('publish'));assert.equal(f.remote.length,1);
});
test('auth failure or incomplete search stops before publication',t=>{
 const f=fixture(t);f.faults.auth=true;assert.throws(()=>f.go(),/fixture/);assert.ok(!f.events.includes('publish'));
 f.faults.auth=false;f.faults.truncated=true;assert.throws(()=>f.go(),/truncated/);assert.ok(!f.events.includes('publish'));
 assert.throws(()=>selectFolder([{type:'result',code:0,data:{total:0}}],{}),/artifact/);
});
test('wrong bytes or unexpected target directory never report complete',t=>{
 const f=fixture(t,false);f.faults.readback=true;assert.throws(()=>f.go('sync'),/bytes differ/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'output/release-publish/v3.2.0/state.json'))).status,'blocked');
 const second=fixture(t,false);second.faults.path=true;assert.throws(()=>second.go('sync'),/destination mismatch/);
});
test('unknown upload outcome remains blocked on retry instead of duplicating files',t=>{
 const f=fixture(t,false);f.faults.upload=f.names[1];assert.throws(()=>f.go('sync'),/failed/);assert.equal(f.remote.length,1);
 f.events.length=0;delete f.faults.upload;assert.throws(()=>f.go('sync'),/uncertain/);assert.ok(!f.events.includes('upload'));
});
test('changed release digest and concurrent invocation fail closed',t=>{
 const f=fixture(t,false);f.go('sync');f.release.assets[0].digest='sha256:'+'0'.repeat(64);assert.throws(()=>f.go('sync'),/identity changed/);
 const second=fixture(t,false);const directory=path.join(second.root,'output/release-publish/v3.2.0');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'running.lock'),'existing');assert.throws(()=>second.go('sync'),/EEXIST/);assert.equal(fs.readFileSync(path.join(directory,'running.lock'),'utf8'),'existing');
});

test('missing existing tag stops before publication',t=>{
 const f=fixture(t);f.faults.tagMissing=true;assert.throws(()=>f.go(),/Existing release tag/);assert.ok(!f.events.includes('publish'));assert.ok(!f.events.includes('upload'));
});
test('sync does not publish when a public release becomes draft during preflight',t=>{
 const f=fixture(t,false);let reads=0;f.faults.metadata=r=>{if(++reads===2)r.draft=true;};assert.throws(()=>f.go('sync'),/changed back to draft/);assert.ok(!f.events.includes('publish'));assert.ok(!f.events.includes('upload'));
});
test('release mutation during mirror verification prevents completion',t=>{
 const f=fixture(t,false);let reads=0;f.faults.metadata=r=>{if(++reads===4)r.assets[0].id=999;};assert.throws(()=>f.go('sync'),/changed during mirror verification/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'output/release-publish/v3.2.0/state.json'))).status,'blocked');
});
