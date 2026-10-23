import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderLandingPage} from '../src/site.ts';
import {parsePacks,DEFAULT_PACKS_JSON} from '../src/pricing.ts';
test('3.0 site explains recurring Plus, deferred trial and local history retention in every language',()=>{
 for(const lang of ['zh','ja','en'] as const){
  const html=renderLandingPage({lang,packs:parsePacks(DEFAULT_PACKS_JSON),currency:'CNY',trialQuestions:30,aiProvider:'mock'} as Parameters<typeof renderLandingPage>[0]);
  const visible=html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g,'');
  assert.match(visible,/NotchSPI Plus/);assert.match(visible,/69/);assert.match(visible,/400/);assert.match(visible,/200 MB/);
  assert.match(visible,lang==='zh'?/稍后领取/:lang==='ja'?/スキップ/:/Claim later/);
  assert.match(visible,lang==='zh'?/自动续费/:lang==='ja'?/自動更新/:/Renews monthly/);
 }
 const source=readFileSync(new URL('../src/site-design.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/No subscription\.|サブスクリプションはありません|付费增加可用题数，无需订阅/);
});

import {renderPurchaseComplete} from '../src/purchase-page.ts';
test('Plus payment return opens Plus settings without claiming payment succeeded',()=>{
 for(const lang of ['zh','ja','en']) {
  const html=renderPurchaseComplete(lang,false,true);
  assert.match(html,/notchspi:\/\/plus/);
  assert.match(html,lang==='zh'?/账户与订阅/:lang==='ja'?/アカウントとプラン/:/Account &amp; plan|Account & plan/);
  assert.doesNotMatch(html,/设置 → NotchSPI Plus|Settings → NotchSPI Plus|設定 → NotchSPI Plus/);
  assert.doesNotMatch(html,/notchspi:\/\/account/);
 }
});

 test('released landing pages expose a pending Windows button and no legacy trial offer',()=>{
  for(const lang of ['zh','ja','en'] as const) for(const entry of [undefined,'spi','reading_practice'] as const){
   const html=renderLandingPage({lang,entry,packs:parsePacks(DEFAULT_PACKS_JSON),currency:'CNY',trialQuestions:30,aiProvider:'mock'});
   const visible=html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g,'');
   assert.match(visible,/<button[^>]*windows-download[^>]*disabled[^>]*>[^<]*Windows[^<]*<span class="coming-soon">Coming soon<\/span><\/button>/);
   assert.match(visible,/NotchSPI 3\.0/);
   assert.doesNotMatch(visible,/href="#demo"|30 free questions|先试 30 题|まずは 30 問|Settings → Account,|アカウントと残高/);
   assert.match(visible,lang==='zh'?/恢复码/:lang==='ja'?/復元コード/:/recovery code/);
   assert.match(visible,/2\.17/);
  }
 });

 test('Ghost is used throughout the site including the favicon',()=>{
  const html=renderLandingPage({lang:'zh',packs:[],currency:'CNY',trialQuestions:30,aiProvider:'mock'});
  assert.equal((html.match(/class="ghost-mark"/g)??[]).length,4);
  assert.match(html,/<link rel="icon" type="image\/png" href="data:image\/png;base64,/);
  assert.match(html,/真实 App 画面 · 首次查题引导/);
  const source=readFileSync(new URL('../src/site.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/roseSVGPath|idleScreenshot|\$\{rose\}/);
 });
