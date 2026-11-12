import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderLandingPage} from '../src/site.ts';
test('Intel and standard downloads coexist in all languages and entries',()=>{
 for(const lang of ['zh','ja','en'] as const) for(const entry of [undefined,'spi','reading_practice'] as const){
  const html=renderLandingPage({lang,entry,packs:[],currency:'CNY',trialQuestions:30,aiProvider:'mock',freeTrialEnabled:true});
  assert.equal(html.split('href="/dl/intel"').length-1,3);
  const hero=html.slice(html.indexOf('<section class="hero'),html.indexOf('<div class="demo"'));
  for(const path of ['/dl','/dl/intel']) assert.ok(hero.includes(`href="${path}"`));
  assert.ok(hero.includes('id="downloads"'));
  assert.ok(hero.includes('macOS 14')); assert.ok(hero.includes('macOS 12.3'));
  assert.ok(!hero.slice(0,hero.indexOf('<details')).includes('windows-download'));
  assert.ok(hero.includes('<details class="chip-help">')); assert.ok(!hero.includes('windows-download'));
  assert.ok(hero.includes(({zh:'关于本机',ja:'この Mac について',en:'About This Mac'})[lang]));
  const header=html.slice(html.indexOf('<header'),html.indexOf('</header>'));
  assert.ok(header.includes('href="#downloads"')); assert.ok(!header.includes('href="/dl"'));
  const trial=html.slice(html.indexOf('<article class="concept-plan trial-plan"'),html.indexOf('<article class="concept-plan plus-plan"'));
  assert.ok(trial.includes('href="#downloads"'));
  const faq=html.slice(html.indexOf('<section id="faq"'),html.indexOf('<div class="scenic-footer"'));
  assert.ok(faq.includes('Intel')); assert.ok(faq.includes('macOS 12.3'));
  assert.ok(html.includes('3.1.2 build 37'));
  assert.ok(html.includes('href="/dl"')); assert.ok(html.includes('macOS 12.3')); assert.ok(html.includes('macOS 14'));
  assert.ok(html.includes(({zh:'之后可应用内更新',ja:'アプリ内更新に対応',en:'then use in-app updates'})[lang]));
 }
 const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.equal(config.redirects, undefined); // Both download channels are handled by the API.
});
