import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { guideSteps, onboardingControls } from '../generated/ui/onboarding.mjs';
export async function verifyGuide({ win, root, setFixture, snapshot, dismissGuide, guidePrimary }) {
  const out = path.join(root,'test-output','guide-parity');
  await fs.mkdir(out,{recursive:true});
  const records = [];
  for (const language of ['zh','ja','en']) for (const step of guideSteps) {
    const fixture = {step,language,trial:'available',count:step==='collecting'?2:0};
    await setFixture(fixture);
    await new Promise(resolve=>setTimeout(resolve,650));
    const layout = await win.webContents.executeJavaScript(`(() => {
      const box = node => { const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
      const controls = [...document.querySelectorAll('.guide-header button,.guide-actions button,.guide-language,.guide-target')].map(n=>({action:n.dataset.action??'language',disabled:n.disabled,box:box(n)}));
      return {controls,slab:box(document.querySelector('.slab')),text:document.querySelector('.guide-active').innerText};
    })()`);
    const policy = onboardingControls(fixture);
    assert.equal(layout.controls.some(c=>c.action==='guideBack'),policy.back,`${language}/${step}: back`);
    assert.equal(layout.controls.some(c=>c.action==='guidePrimary'),policy.primary,`${language}/${step}: primary`);
    for (const c of layout.controls) {
      assert.ok(c.box.width>0 && c.box.height>0,`${step}: invisible control`);
      assert.ok(c.box.y+c.box.height <= layout.slab.y+layout.slab.height+1,`${language}/${step}: clipped ${c.action}`);
      for (const other of layout.controls) if (other!==c) {
        const overlap = Math.min(c.box.x+c.box.width,other.box.x+other.box.width)-Math.max(c.box.x,other.box.x)>1 && Math.min(c.box.y+c.box.height,other.box.y+other.box.height)-Math.max(c.box.y,other.box.y)>1;
        assert.equal(overlap,false,`${language}/${step}: ${c.action} overlaps ${other.action}`);
      }
    }
    if(language==='zh') await fs.writeFile(path.join(out,`${step}.png`),(await win.webContents.capturePage({x:Math.floor(layout.slab.x),y:0,width:Math.ceil(layout.slab.width),height:Math.ceil(layout.slab.height+28)})).toPNG());
    records.push({language,step,...layout});
  }
  // Sample a height-changing handoff; the action baseline must follow the slab.
  await setFixture({step:'welcome'});
  await new Promise(resolve=>setTimeout(resolve,650));
  await setFixture({step:'permission'});
  const motion=[];
  for (const delay of [30,50,80,160,300]) {
    await new Promise(resolve=>setTimeout(resolve,delay));
    const frame=await win.webContents.executeJavaScript(`(() => {
      const r=document.querySelector('.slab').getBoundingClientRect();
      const b=document.querySelector('.guide-actions').getBoundingClientRect();
      return {height:r.height,actionBottom:b.bottom,slabBottom:r.bottom,animations:document.getAnimations().map(a=>a.effect.getTiming().duration)};
    })()`);
    assert.ok(frame.actionBottom<=frame.slabBottom+1,'handoff action row escapes visible slab');
    motion.push(frame);
  }
  assert.ok(motion.some(frame=>frame.animations.includes(560)),'illustration reveal never ran');
  await fs.writeFile(path.join(out,'motion.json'),JSON.stringify(motion,null,2));
  for (const trial of ['unavailable','loading','claiming','failed','claimed','expired','ineligible']) {
    await setFixture({step:'trial',trial});
    await new Promise(resolve=>setTimeout(resolve,100));
    const flags=await win.webContents.executeJavaScript(`({disabled:document.querySelector('[data-action=guidePrimary]').disabled,later:!!document.querySelector('[data-action=guideLater]')})`);
    const c=onboardingControls({step:'trial',trial});
    assert.equal(flags.disabled,!c.primaryEnabled,trial); assert.equal(flags.later,c.secondary,trial);
  }
  const running = await setFixture({step:'working'}); dismissGuide();
  assert.equal(running.signal.aborted,false); assert.equal(snapshot().expanded,true);
  assert.equal(snapshot().onboarding,false); assert.equal(snapshot().status,'running','dismiss must not cancel a running solve');
  await setFixture({step:'collecting',count:2}); dismissGuide();
  assert.equal(snapshot().collecting,false); assert.equal(snapshot().status,'canceled');
  await setFixture({step:'trial',trial:'claimed'}); await guidePrimary();
  assert.equal(snapshot().onboarding,false); assert.equal(snapshot().expanded,false);
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({host:process.platform,windowsRealDevice:false,records,behaviors:['working-dismiss-preserves-solve','collecting-dismiss-cancels','receipt-primary-completes']},null,2));
}
