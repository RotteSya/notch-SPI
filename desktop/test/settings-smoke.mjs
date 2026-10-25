import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function verifySettings({win,root,setFixture,snapshot}) {
 const out=path.join(root,'test-output','settings-parity');await fs.mkdir(out,{recursive:true});
 const run=code=>win.webContents.executeJavaScript(code);
 const settle=()=>new Promise(resolve=>setTimeout(resolve,170));
 const states=[
  {name:'loading',loading:true},
  {name:'eligible',account:{free_trial:{status:'eligible'}}},
  {name:'inactive',plus:{available:true,status:'inactive'}},
  {name:'pending',plus:{available:true,status:'pending'}},
  {name:'active',plus:{available:true,status:'active',can_manage:true,billing_status:'active',daily_remaining:388,daily_limit:400,paid_until:'2026-11-25T00:00:00Z'}},
  {name:'renewal-canceled',plus:{available:true,status:'active',can_manage:true,cancel_at_period_end:true}},
  {name:'payment-attention',plus:{available:true,status:'expired',can_manage:true,billing_status:'past_due'}},
 ];
 const records=[];
 for(const language of ['zh','ja','en']) for(const fixture of states){
  await setFixture({...fixture,language});await settle();
  const view=await run(`(() => {const nodes=[...document.querySelectorAll('.settings-main [data-action]')];return {buttons:nodes.map(n=>({action:n.dataset.action,disabled:n.disabled})),pages:document.querySelectorAll('.sidebar [role=radio]').length,text:document.querySelector('.settings-main').innerText};})()`);
  assert.equal(view.pages,5);
  if(fixture.name==='loading')assert.ok(view.buttons.filter(n=>['plusCheckout','refresh','openRestore'].includes(n.action)).every(n=>n.disabled));
  if(fixture.name==='renewal-canceled')assert.equal(view.buttons.some(n=>n.action==='plusCancel'),false);
  if(['active','payment-attention'].includes(fixture.name)){assert.equal(view.buttons.some(n=>n.action==='plusPortal'),true);assert.equal(view.buttons.some(n=>n.action==='plusCheckout'),false);}
  records.push({language,name:fixture.name,...view});
  if(language==='zh')await fs.writeFile(path.join(out,fixture.name+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await setFixture({plus:{status:'inactive',available:true}});await settle();
 await run(`document.querySelector('[data-action="plusCheckout"]').focus()`);
 await setFixture({plus:{status:'active',available:true,can_manage:true,billing_status:'active'}});await settle();
 assert.equal(await run(`document.activeElement.dataset.action`),'plusPortal');
 await setFixture({plus:{status:'inactive',available:true}});await settle();
 await run(`document.querySelector('[data-action="plusCheckout"]').focus()`);
 await setFixture({loading:true,plus:{status:'inactive',available:true}});await settle();
 await setFixture({plus:{status:'inactive',available:true}});await settle();
 assert.equal(await run(`document.activeElement.dataset.action`),'plusCheckout');
 await setFixture({page:'general',status:'running'});await settle();
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await settle();
 assert.equal(snapshot().status,'running','settings Escape must not cancel a solve');
 for(const page of ['general','shortcuts','account','personas','service']){
  await run(`document.querySelector('.sidebar [data-value="${page}"]').click()`);await settle();
  assert.equal(await run(`document.activeElement.dataset.value`),page);
  await fs.writeFile(path.join(out,page+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await run(`document.querySelector('.sidebar [data-value="shortcuts"]').click()`);await settle();
 assert.deepEqual(await run(`[...document.querySelectorAll('[data-action="record"]')].map(x=>x.dataset.value)`),['single','multiple','personality','toggle','auto']);
 assert.equal(await run(`document.querySelectorAll('.shortcut-row p').length`),3);
 await run(`document.querySelector('[data-action="record"][data-value="single"]').click()`);await settle();
 assert.equal(await run(`document.activeElement.dataset.recording`),'true');
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await settle();
 assert.equal(await run(`!!document.querySelector('[data-recording]')`),false);
 await run(`document.querySelector('.sidebar [data-value="general"]').click()`);await settle();
 await run(`(()=>{const slider=document.querySelector('[name="answerSize"]');slider.value='17';slider.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 assert.equal(await run(`getComputedStyle(document.querySelector('.answer-preview')).fontSize`),'21px');
 assert.equal(await run(`document.querySelector('[name="answerSize"]').closest('.row').querySelector('.value').textContent`),'17 pt');
 await run(`document.querySelector('[name="answerSize"]').dispatchEvent(new Event('change',{bubbles:true}))`);await settle();
 assert.equal(snapshot().settings.answerSize,17);
 await run(`document.querySelector('.sidebar [data-value="account"]').click()`);await settle();
 await run(`document.querySelector('.settings-scroll').scrollTop=150`);
 const scroll=await run(`document.querySelector('.settings-scroll').scrollTop`);
 await run(`document.querySelector('.sidebar [data-value="general"]').click()`);await settle();
 await run(`document.querySelector('.sidebar [data-value="account"]').click()`);await settle();
 assert.equal(await run(`document.querySelector('.settings-scroll').scrollTop`),scroll);
 await run(`document.querySelector('[data-action="openRestore"]').click()`);await settle();
 assert.equal(await run(`!!document.querySelector('dialog[open]')`),true);
 await run(`document.querySelector('dialog [data-dialog-close]').click()`);await settle();
 assert.equal(await run(`document.activeElement.dataset.action`),'openRestore');
 // Exercise real IPC persistence, editor focus, and edit/active separation.
 await run(`document.querySelector('.sidebar [data-value="personas"]').click()`);await settle();
 assert.equal(await run(`!!document.querySelector('.persona-empty')`),true);
 await run(`document.querySelector('[data-action="newPersona"]').click()`);await settle();
 const first=snapshot().settings.persona.id;
 assert.ok(first);assert.equal(snapshot().settings.personas.length,1);
 await fs.writeFile(path.join(out,'personas-first.png'),(await win.webContents.capturePage()).toPNG());
 assert.equal(await run(`document.activeElement.name`),'personaName');
 await run(`(() => {const n=document.querySelector('[name="personaName"]');n.value='First';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
 assert.equal(snapshot().settings.persona.name,'First');
 await run(`document.querySelector('[data-action="newPersona"]').click()`);await settle();
 assert.equal(snapshot().settings.personas.length,2);assert.equal(snapshot().settings.persona.id,first);
 const second=snapshot().settings.personas[1].id;
 await run(`(() => {const n=document.querySelector('[name="personaDescription"]');n.value='Test profile';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
 assert.equal(snapshot().settings.personas[1].description,'Test profile');assert.equal(snapshot().settings.persona.description,'');
 await run(`document.querySelector('[data-action="editPersona"]').click()`);await settle();
 await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);await settle();
 assert.equal(await run(`document.activeElement.dataset.value`),second);
 assert.equal(await run(`document.querySelector('[name="personaDescription"]').value`),'Test profile');
 await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))`);await settle();
 assert.equal(await run(`document.activeElement.dataset.value`),first);
 await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);await settle();

 await run(`document.querySelector('[data-action="selectPersona"]').click()`);await settle();
 assert.equal(snapshot().settings.persona.id,second);
 assert.deepEqual(snapshot().settings.personas.map(x=>x.id),[first,second]);
 assert.equal(await run(`document.querySelector('[data-action="selectPersona"]').disabled`),true);
 await fs.writeFile(path.join(out,'personas-editor.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('.sidebar [data-value="general"]').click()`);await settle();
 await run(`document.querySelector('[name="reliabilitySharing"]').click()`);await settle();
 assert.equal(snapshot().settings.reliabilitySharing,false);
 await run(`document.querySelector('.sidebar [data-value="service"]').click()`);await settle();
 await run(`document.querySelector('.sidebar [data-value="general"]').click()`);await settle();
 assert.equal(await run(`document.querySelector('[name="reliabilitySharing"]').checked`),false);
 await run(`document.querySelector('[name="reliabilitySharing"]').click()`);await settle();
 await setFixture({page:'general',settings:{languageMode:'system',collapseDelay:9}});await settle();
 await run(`document.querySelector('.settings-scroll').scrollTop=document.querySelector('.settings-scroll').scrollHeight`);await settle();
 assert.equal(await run(`(() => {const r=document.querySelector('[name="reliabilitySharing"]').getBoundingClientRect();return r.top>0&&r.bottom<innerHeight;})()`),true);

 await fs.writeFile(path.join(out,'diagnostics.png'),(await win.webContents.capturePage()).toPNG());
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({host:process.platform,windowsRealDevice:false,records},null,2));
}
