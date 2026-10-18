import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {renderMonthPassPreview,MONTH_PASS_PREVIEW_CSP,MONTH_PASS_PREVIEW} from '../src/month-pass-page.ts';
import {parsePacks,DEFAULT_PACKS_JSON} from '../src/pricing.ts';

test('month pass preview cannot execute a payment or reach network services',()=>{
  for(const lang of ['zh','ja','en']) {
    const html=renderMonthPassPreview(lang);
    assert.match(html,/CNY 69\.00/);
    const visibleCopy=html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(visibleCopy,/800|100|月卡|マンスリーパス|month pass/i);
    assert.match(visibleCopy,/Plus/);
    assert.doesNotMatch(html,/fetch\(|XMLHttpRequest|stripe\.com|\/purchase\/checkout|<form/);
    const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.ok(MONTH_PASS_PREVIEW_CSP.includes("connect-src 'none'"));
    assert.ok(MONTH_PASS_PREVIEW_CSP.includes(createHash('sha256').update(script).digest('base64')));
    assert.match(html,/<section class="success" id="success" hidden>/);
  }
});

test('the purchase page module does not depend on the month-pass preview',()=>{
  const source=readFileSync(new URL('../src/purchase-page.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/month-pass-page|renderMonthPassPreview|MONTH_PASS_PREVIEW_CSP/);
});

test('preview catalog matches client contract and does not change live packs',()=>{
  assert.deepEqual(MONTH_PASS_PREVIEW,{currency:'CNY',amountMinor:6900,days:30,dailySolves:400,warningAt:360,resetTimeZone:'Asia/Shanghai'});
  const swift=readFileSync(new URL('../../Sources/NotchSPI/Cloud/MonthPass.swift',import.meta.url),'utf8');
  for(const [name,value]of Object.entries({priceCNY:69,durationDays:30,dailySolveLimit:400,dailyWarningThreshold:360}))assert.ok(swift.includes(`static let ${name} = ${value}`));
  assert.deepEqual(parsePacks(DEFAULT_PACKS_JSON).map(p=>p.amountCents),[300,800,2200]);
  assert.match(renderMonthPassPreview('invalid'),/<html lang="zh">/);
});

 test('preview discloses daily allowance and reset without unlimited claims',()=>{
  const html=renderMonthPassPreview('zh');
  assert.match(html,/每天 400 次成功求解/);
  assert.match(html,/北京时间每日零点重置，不累计/);
  assert.doesNotMatch(html,/不设固定题数上限/);
  assert.match(html,/暂时限制使用或要求验证/);
  assert.match(html,/误判可申请复核/);
  const swift=readFileSync(new URL('../../Sources/NotchSPI/Cloud/MonthPass.swift',import.meta.url),'utf8');
  assert.match(swift,/Asia\/Shanghai/);
});
