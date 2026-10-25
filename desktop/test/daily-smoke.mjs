import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function verifyDaily({win,root,setFixture,snapshot,cancel,toggleAuto,openPreview,getPreview,intake}) {
 const out=path.join(root,'test-output','daily-parity');await fs.mkdir(out,{recursive:true});
 const run=code=>win.webContents.executeJavaScript(code);
 const settle=()=>new Promise(resolve=>setTimeout(resolve,180));
 for(const focus of [{action:'preview',value:'daily-1'},{action:'capture',value:'single'}]){
  await setFixture({status:'error',count:2,message:'Focus refresh fixture'});await settle();
  await run(`document.querySelector('[data-action="${focus.action}"][data-value="${focus.value}"]').focus()`);
  await setFixture({status:'error',count:2,message:'Focus refresh fixture updated'});await settle();
  assert.deepEqual(await run('({action:document.activeElement.dataset.action,value:document.activeElement.dataset.value})'),focus,'state refresh must preserve the exact control, not just its action');
 }
 const cases=[
  {name:'answer'}, {name:'working',status:'running',answer:''},
  {name:'streaming',status:'streaming',answer:'',working:'Reading the question…'},
  {name:'review',resultState:'review'},
  {name:'error',status:'error',answer:'STALE',message:'Connection interrupted'},
  {name:'canceled',status:'canceled',answer:'STALE'},
  {name:'retake',status:'retake',answer:'STALE',message:'Capture the full question'},
  {name:'explanation-failed',operation:'explain',message:'Explanation failed'},
  {name:'auto',autoActive:true},
  ...[0,1,2,4].map(count=>({name:`collecting-${count}`,status:'collecting',collecting:true,count,remaining:count>=2?3:null,answer:''})),
  {name:'capturing',status:'collecting',collecting:true,capturing:true,count:2,remaining:null,answer:''},
 ];
 const records=[];
 for(const language of ['zh','ja','en']) for(const fixture of cases){
  const message = fixture.name === 'error' ? ({zh:'网络连接中断，未能完成本次查题。请检查网络后重新查题。',ja:'接続が切れました。接続を確認して再度お試しください。',en:'The connection was interrupted. Check your network and try again.'})[language] : fixture.message;
  await setFixture({...fixture,message,language});await new Promise(resolve=>setTimeout(resolve,420));
  const view=await win.webContents.executeJavaScript(`(() => {
   const r=document.querySelector('.slab').getBoundingClientRect();
   const controls=[...document.querySelectorAll('.slab-content button')].map(n=>{const b=n.getBoundingClientRect();return {action:n.dataset.action,value:n.dataset.value,disabled:n.disabled,hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest("[data-action]")===n,x:b.x,y:b.y,w:b.width,h:b.height};});
   return {surface:{light:document.querySelector(".light-field")?.dataset.renderer,noiseOpacity:getComputedStyle(document.querySelector('.slab-background'),'::after').opacity,noiseBlend:getComputedStyle(document.querySelector('.slab-background'),'::after').mixBlendMode,background:getComputedStyle(document.querySelector('.slab-background')).backgroundImage,filter:getComputedStyle(document.querySelector('.slab')).filter,hit:getComputedStyle(document.querySelector('.slab-background')).pointerEvents},statusShelf:document.querySelector('.shelf > p[role="status"]')?document.querySelector('.shelf').getBoundingClientRect().height:null,actionsOutside:!!document.querySelector(".slab-content > .daily-actions"),text:document.querySelector('.shelf').innerText,controls,slab:{x:r.x,y:r.y,w:r.width,h:r.height},next:!!document.querySelector('.next-capture')};
  })()`);
  assert.equal(view.surface.light,'webgl','light shader must compile and render on the validation host');
  assert.equal(view.surface.hit,'none','decorative material must not intercept pointer input');
  assert.notEqual(view.surface.background,'none','material must survive repeated geometry transitions');
  assert.equal(view.surface.noiseOpacity,'0.025');
  if(['error','canceled','retake'].includes(fixture.name)) assert.ok(!view.text.includes('STALE'),fixture.name);
  if(fixture.name==='error'&&language==='zh') assert.ok(view.statusShelf<=92,`native one-line error shelf should be compact: ${view.statusShelf}`);
  if(['error','retake'].includes(fixture.name)) assert.equal(view.actionsOutside,true);
  if(['error','retake'].includes(fixture.name)) assert.deepEqual(view.controls.filter(c=>c.action==='capture').map(c=>c.value),['multiple','single']);
  if(fixture.collecting){
   assert.equal(view.next,fixture.count<4);
   assert.equal(view.controls.find(c=>c.action==='submit').disabled,!!fixture.capturing||fixture.count<2);
   assert.ok(view.controls.filter(c=>c.action==='remove').every(c=>c.disabled===!!fixture.capturing));
  }
  if(fixture.autoActive){assert.equal(view.controls.filter(c=>c.action==='auto').length,1);assert.equal(view.controls.some(c=>c.action==='cycleEffort'),false);}
  if(fixture.name==='answer')assert.equal(view.controls.some(c=>c.action==='copy'),false);
  for(const c of view.controls) if(!c.disabled)assert.equal(c.hit,true,`${language}/${fixture.name}: material or another layer blocks ${c.action}/${c.value}`);
  for(const c of view.controls) assert.ok(c.y+c.h<=view.slab.y+view.slab.h+1,`${language}/${fixture.name}: clipped ${c.action}`);
  if(language==='zh')await fs.writeFile(path.join(out,fixture.name+'.png'),(await win.webContents.capturePage({x:Math.floor(view.slab.x),y:0,width:Math.ceil(view.slab.w),height:Math.ceil(view.slab.h+28)})).toPNG());
  records.push({language,name:fixture.name,...view});
 }
 await setFixture({autoActive:true,status:'done',answer:'B'});await toggleAuto();
 assert.equal(snapshot().auto.active,false);assert.equal(snapshot().answer,'B');assert.equal(snapshot().status,'done');
 await setFixture({collecting:true,count:2,status:'collecting'});cancel();
 assert.equal(snapshot().images.length,0);assert.equal(snapshot().answer,'');assert.equal(snapshot().collecting,false);
 // Exercise the real BrowserWindow lifecycle and renderer keyboard actions.
 await setFixture({collecting:true,count:2,status:'collecting'});
 openPreview(snapshot().images[0].id);
 let preview=getPreview();
 await new Promise(resolve=>preview.webContents.once('did-finish-load',resolve));
 assert.equal(intake.previewing,true); assert.equal(intake.deadline,null);
 assert.equal(preview.isResizable(),true);
 assert.equal(await win.webContents.executeJavaScript('!!document.querySelector("#overlays .preview")'),false);
 await fs.writeFile(path.join(out,'preview.png'),(await preview.webContents.capturePage()).toPNG());
 await preview.webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
 await new Promise(resolve=>setTimeout(resolve,120));
 assert.equal(getPreview(),null); assert.equal(intake.previewing,false);
 assert.ok(intake.deadline > Date.now()+3500 && intake.deadline <= Date.now()+4000);
 openPreview(snapshot().images[0].id); preview=getPreview();
 await new Promise(resolve=>preview.webContents.once('did-finish-load',resolve));
 await preview.webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true}))');
 await new Promise(resolve=>setTimeout(resolve,120));
 assert.equal(getPreview(),null); assert.equal(snapshot().images.length,1); assert.equal(intake.deadline,null);
 openPreview(snapshot().images[0].id); preview=getPreview();
 await new Promise(resolve=>preview.webContents.once('did-finish-load',resolve));
 await new Promise(resolve=>{preview.once("closed",resolve);preview.close();});
 assert.equal(snapshot().preview,null);
 // Reduced motion freezes the light field at the native deterministic instant.
 win.webContents.debugger.attach('1.3');
 try {
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await setFixture({status:'error',count:1,message:'Reduced motion fixture'});
  await new Promise(resolve=>setTimeout(resolve,200));
  const crop=await win.webContents.executeJavaScript("(() => {const r=document.querySelector('.slab').getBoundingClientRect();return {x:Math.round(r.x+60),y:Math.round(r.height-20),width:300,height:8};})()");
  const first=(await win.webContents.capturePage(crop)).toPNG();
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.deepEqual((await win.webContents.capturePage(crop)).toPNG(),first,'reduced-motion material must remain still');
 } finally { await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});win.webContents.debugger.detach(); }
 // GPU loss must leave the functional UI intact and the preview usable.
 const lost=await run("(() => {const canvas=document.querySelector('.light-field');const ext=canvas.getContext('webgl').getExtension('WEBGL_lose_context');if(!ext)return false;ext.loseContext();return true;})()");
 assert.equal(lost,true,'validation host must support intentional context-loss coverage');await settle();
 assert.equal(await run("document.querySelector('.light-field').dataset.renderer"),'unavailable');
 await setFixture({status:'error',count:2,message:'GPU fallback fixture'});await settle();
 await run("document.querySelector('[data-action=preview][data-value=\"daily-1\"]').click()");
 await settle();assert.ok(getPreview(),'preview must remain functional after GPU loss');
 assert.equal(snapshot().previewID,'daily-1');
 await new Promise(resolve=>{getPreview().once('closed',resolve);getPreview().close();});
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({host:process.platform,windowsRealDevice:false,records},null,2));
}
