import test from 'node:test';
import assert from 'node:assert/strict';
import { guideSteps, onboardingControls, onboardingBackStep, onboardingDismissal } from '../generated/ui/onboarding.mjs';
import { guidePresentation } from '../ui/onboarding.mjs';
const state = (step, extra = {}) => ({ guide: { step, live: ['working','firstAnswer','collecting','success'].includes(step), trial: 'available', ...extra }, settings: {language:'zh'}, images: [], account: null });
test('native guide action matrix covers every step, without generic account/settings chrome', () => {
  const back = ['permission','practice','capture','multiple','multiCapture'];
  for (const step of guideSteps) {
    const c = onboardingControls({step, trial:'available'});
    assert.equal(c.back, back.includes(step), step);
    assert.equal(c.language, step === 'welcome', step);
    assert.equal(c.primary, !['capture','multiCapture','collecting','working'].includes(step), step);
    for (const language of ['zh','ja','en']) {
      const s = state(step); s.settings.language = language;
      const html = Object.values(guidePresentation(s, () => '<kbd>Ctrl</kbd>')).join('');
      assert.ok(!html.includes('data-value="account"'), step);
      assert.ok(!html.includes('data-action="capture"'), step);
      assert.ok(!html.includes('data-action="collapse"'), step);
      assert.equal(html.includes('data-action="guideBack"'), c.back, step);
      assert.equal(html.includes('name="guideLanguage"'), c.language, step);
    }
  }
});
test('capture guidance disappears during capture and preview, and at the four-image cap', () => {
  assert.equal(onboardingControls({step:'collecting',count:4}).shortcut,false);
  assert.equal(onboardingControls({step:'collecting',count:4}).secondary,true);
  for (const step of ['capture','multiCapture','collecting']) for (const key of ['capturing','previewing']) {
    const c = onboardingControls({step,[key]:true});
    assert.equal(c.shortcut,false); assert.equal(c.secondary,false);
  }
  assert.equal(onboardingControls({step:'working',failed:true}).back,true);
  assert.equal(onboardingControls({step:'working',failed:true}).shortcut,true);
});
test('back follows the native return destination rather than a generic restart', () => {
  assert.equal(onboardingBackStep('multiple',true),'welcome');
  assert.equal(onboardingBackStep('multiCapture',true),'multiple');
  assert.equal(onboardingBackStep('working',false,'capture',true),'capture');
  assert.equal(onboardingBackStep('working',true,'capture',true),'multiple');
  assert.equal(onboardingBackStep('permission',true,'multiCapture'),'multiCapture');
  for (const step of ['working','collecting','firstAnswer','success','trial']) assert.equal(onboardingBackStep(step),null);
});
test('dismissing a working lesson does not cancel the solve; collecting cancels; receipt completes', () => {
  assert.deepEqual(onboardingDismissal('working'),{cancelCollection:false,clearAnswer:false,complete:false});
  assert.equal(onboardingDismissal('collecting').cancelCollection,true);
  assert.equal(onboardingDismissal('success').clearAnswer,true);
  assert.equal(onboardingDismissal('trial','claimed').complete,true);
  assert.equal(onboardingDismissal('trial','available').complete,false);
});
test('trial busy and terminal states retain the native confirmation actions', () => {
  for (const trial of ['unavailable','loading','claiming','available','failed','claimed','expired','ineligible']) {
    const c = onboardingControls({step:'trial',trial});
    assert.equal(c.primaryEnabled,!['unavailable','loading','claiming'].includes(trial));
    assert.equal(c.secondary,['unavailable','available','failed'].includes(trial));
    assert.equal(c.finish,trial==='claimed');
    if (['claimed','expired','ineligible'].includes(trial)) assert.match(guidePresentation(state('trial',{trial}),()=> '').footer,/开始使用/);
  }
});
test('collecting copy distinguishes one image, preview and four-image limit', () => {
  const s = state('collecting'); s.images = [{}];
  assert.match(guidePresentation(s,()=> '').footer,/只有一张时不会自动提交/);
  s.preview = 'image'; assert.match(guidePresentation(s,()=> '').footer,/至少两张/);
  s.images = [{},{},{},{}]; s.preview=null;
  assert.match(guidePresentation(s,()=> '').footer,/已达 4 张上限/);
});
