import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {capsule,compactStatus,quickMenu} from '../ui/notch-controls.mjs';
import {containsSlab,notchGeometry} from '../core/window-behavior.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('../../shared/fixtures/notch-parity.json',import.meta.url)));
for(const c of fixtures.capsules) test(`Mac capsule contract: ${c.mode}, auto=${c.auto}, ${c.name||'empty'}`,()=>{
 const state={mode:c.mode,auto:{active:c.auto},settings:{persona:{name:c.name}}};
 assert.equal(capsule(state).action,c.action);assert.equal(capsule(state).kind,c.kind);
 if(c.kind==='persona') assert.equal(capsule(state).value,'personas');
});
test('closed slab preserves the Mac left extension and expansion axis',()=>{
 const g=fixtures.geometry,c=notchGeometry(false);
 assert.equal(c.width,g.collapsedWidth);assert.equal(c.height,g.collapsedHeight);
 assert.equal(g.screenWidth/2+c.offset-c.width/2,g.collapsedX);
 assert.equal(notchGeometry(true,g.cardWidth,300).offset,0);
 for(const c of fixtures.compact)assert.equal(compactStatus(c.status),c.mark);
});
test('transparent shoulders and lower corners pass through at every morph size',()=>{
 for(const width of [260,400,600])for(const height of [28,100,600]) {
  const r={x:-1200,y:-900,width,height};
  assert.equal(containsSlab(r,{x:r.x+width/2,y:r.y+height/2},8,22),true);
  for(const x of [r.x+.1,r.x+width-.1])for(const y of [r.y+1,r.y+height-1])assert.equal(containsSlab(r,{x,y},8,22),false);
 }
});
test('menu follows mode, official account and capture state without duplicate separators',()=>{
 const base={mode:'tutor',status:'done',auto:{active:false},settings:{channel:'official',personas:[]}};
 const normal=quickMenu(base);
 assert.ok(normal.indexOf('history')<normal.indexOf('balance'));assert.ok(normal.includes('target'));
 assert.ok(normal.includes('low'));assert.ok(!normal.includes('newQuestionnaire'));
 const persona=quickMenu({...base,mode:'personality',settings:{...base.settings,personas:[{id:'p'}]}});
 assert.ok(persona.includes('personas'));assert.ok(persona.includes('newQuestionnaire'));assert.ok(!persona.includes('effort'));
 const failed=quickMenu({...base,status:'error',canCheckSettlement:true,canRecover:true});
 assert.ok(failed.includes('status'));assert.ok(failed.includes('recover'));
 assert.ok(quickMenu({...base,collecting:true}).includes('cancel'));
 assert.ok(!quickMenu({...base,settings:{channel:'api'}}).includes('topUp'));
 for(let i=1;i<normal.length;i++)assert.ok(normal[i]!=='separator'||normal[i-1]!=='separator');
});
