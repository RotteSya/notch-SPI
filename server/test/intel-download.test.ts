import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderLandingPage} from '../src/site.ts';
test('Intel and standard downloads coexist in all languages and entries',()=>{
 for(const lang of ['zh','ja','en'] as const) for(const entry of [undefined,'spi','reading_practice'] as const){
  const html=renderLandingPage({lang,entry,packs:[],currency:'CNY',trialQuestions:30,aiProvider:'mock'});
  assert.equal(html.split('href="/dl/intel"').length-1,2);
  assert.ok(html.includes('href="/dl"')); assert.ok(html.includes('macOS 12.3')); assert.ok(html.includes('macOS 14'));
  assert.ok(html.includes(({zh:'手动更新',ja:'手動更新',en:'Manual updates'})[lang]));
 }
 const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(config.redirects,[{source:'/dl/intel',destination:'https://github.com/RotteSya/notch-SPI/releases/download/v3.0/NotchSPI-3.0-build28-Intel.dmg',permanent:false}]);
});
