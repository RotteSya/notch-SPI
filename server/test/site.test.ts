import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// The public product site at GET / — must carry everything a payment-provider review looks
// for: product description, live pricing, contact, and the Japanese commerce disclosure.
process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_PROVIDER = 'mock';
process.env.CURRENCY = 'JPY';
process.env.QUOTA_POLICY_VERSION = 'legacy-test';
process.env.TRIAL_QUESTIONS = '180';
process.env.PACKS_JSON = JSON.stringify([
  { id: 'pack100', questions: 100, amount_cents: 300 },
  { id: 'pack300', questions: 300, amount_cents: 800 },
  { id: 'pack1000', questions: 1000, amount_cents: 2200 },
]);
process.env.LOG_LEVEL = 'silent';
process.env.FREE_TRIAL_ENABLED = '1';
process.env.PLUS_ENABLED = '1';

const { buildApp } = await import('../src/index.ts');
const { renderLandingPage, resolveSiteLang } = await import('../src/site.ts');

let app: FastifyInstance;
let base: string;

before(async () => {
  app = await buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
});

test('GET / renders the Japanese site by default with live pricing and legal sections', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /問題は、そのまま。/);            // hero (ja default)
  assert.match(html, /72 時間の無料体験/);            // current released trial
  assert.match(html, /¥800/);                               // live pack price
  assert.match(html, /特定商取引法に基づく表記/);            // JP commerce disclosure
  assert.match(html, /プライバシーとデータ利用/);            // privacy
  assert.match(html, /返金・キャンセルポリシー/);            // refunds
  assert.match(html, /raysyadesu@gmail\.com/);              // contact
  assert.match(html, /href="\/dl"/);                        // download CTA → our own counted endpoint
});

test('the site never links a visitor to where the app is hosted or built', async () => {
  // The product is distributed from this origin only: /dl streams the DMG and /update reports
  // the version. A stray github.com href would leak the source repo straight into the UI, so
  // this asserts the absence across every rendered language, not just the default one.
  for (const lang of ['ja', 'zh', 'en']) {
    const html = await (await fetch(`${base}/?lang=${lang}`)).text();
    assert.doesNotMatch(html, /github\.com|api\.github\.com/i, `${lang} page links to GitHub`);
  }
});

test('?lang switches the site language; the JP disclosure stays present', async () => {
  const zh = await (await fetch(`${base}/?lang=zh`)).text();
  assert.match(zh, /题目留在原处/);
  assert.match(zh, /特定商取引法に基づく表記/);
  const en = await (await fetch(`${base}/?lang=en`)).text();
  assert.match(en, /Keep your focus./);
  assert.match(en, /特定商取引法に基づく表記/);
});

test('Accept-Language negotiation picks zh/en; unknown falls back to ja', async () => {
  const zh = await (await fetch(`${base}/`, { headers: { 'accept-language': 'zh-CN,zh;q=0.9' } })).text();
  assert.match(zh, /题目留在原处/);
  const en = await (await fetch(`${base}/`, { headers: { 'accept-language': 'en-US,en;q=0.9' } })).text();
  assert.match(en, /Keep your focus./);
  const fr = await (await fetch(`${base}/`, { headers: { 'accept-language': 'fr-FR' } })).text();
  assert.match(fr, /問題は、そのまま。/);
});

test('resolveSiteLang: explicit query beats headers; header order respected', () => {
  assert.equal(resolveSiteLang('en', 'ja-JP'), 'en');
  assert.equal(resolveSiteLang('', 'zh-CN,ja;q=0.8'), 'zh');
  assert.equal(resolveSiteLang('', 'fr-FR,de-DE'), 'ja');
  assert.equal(resolveSiteLang('', ''), 'ja');
});

test('the site is browser-cacheable and varies on Accept-Language', async () => {
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get('cache-control') ?? '', /max-age=300/);
  assert.ok(!(res.headers.get('cache-control') ?? '').includes('s-maxage'));
  assert.match(res.headers.get('vary') ?? '', /Accept-Language/i);
  await res.text(); // Drain the page before Fastify closes its keep-alive connections.
});

test('the privacy disclosure names the configured AI provider', () => {
  const html = renderLandingPage({
    packs: [{ id: 'pack100', questions: 100, amountCents: 300 }],
    trialQuestions: 180,
    currency: 'JPY',
    lang: 'en',
    aiProvider: 'deepseek',
  });
  assert.match(html, /AI provider \(DeepSeek\)/);
  assert.doesNotMatch(html, /\{\{AI_PROVIDER\}\}/);
});

test('both entry pages preserve their route across languages and use the shared distribution endpoint', async () => {
  for (const path of ['/spi', '/reading-practice']) for (const lang of ['ja', 'zh', 'en']) {
    const response = await fetch(`${base}${path}?lang=${lang}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const target of ['ja', 'zh', 'en']) assert.ok(html.includes(`href="${path}?lang=${target}"`));
    assert.match(html, /href="\/dl"/);
    assert.match(html, /¥800/);
    assert.doesNotMatch(html, /github\.com|utm_source|device_token/i);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'.*frame-ancestors 'none'/);
  }
});

test('entry descriptions distinguish unsupported reading practice from the existing SPI entry', async () => {
  const reading = await (await fetch(`${base}/reading-practice?lang=en`)).text();
  assert.match(reading, /Practice reading questions on your Mac/);
  assert.match(reading, /Reading practice is not open yet/);
  assert.match(reading, /Authorized material and independent evaluation/);
  assert.match(reading, /You can skip the source choice/);
  assert.match(reading, /A download click is not an installation record/);
  const spi = await (await fetch(`${base}/spi?lang=en`)).text();
  assert.match(spi, /Prepare for SPI on your Mac/);
  assert.match(spi, /The existing SPI entry continues/);
  assert.match(spi, /Historical SPI results do not establish accuracy for all questions/);
});

test('beta reading scope remains explicit and pack pricing renders from the current catalog', () => {
  const input = {packs: [{id:'current', questions:100, amountCents:500}], trialQuestions:30,
    currency:'USD', lang:'en' as const, aiProvider:'openai' as const, entry:'reading_practice' as const, entryStatus:'beta' as const};
  const html = renderLandingPage(input);
  assert.match(html, /Reading practice is in internal testing/);
  assert.match(html, /No public support combinations have completed independent evaluation/);
  assert.match(html, /72-hour free trial/); assert.match(html, /data-amount-cents="500"/); assert.match(html, /USD <span class="price">5<\/span>/); assert.match(html, /class="price">\$0<\/span>/);
  assert.doesNotMatch(html, /¥0|180 free questions|\{\{TRIAL\}\}|invisible|notarized|Most popular/i);
  for (const lang of ['zh', 'ja', 'en'] as const) {
    const page = renderLandingPage({...input, lang});
    const visibleCopy = page.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ');
    assert.doesNotMatch(visibleCopy, /绝对隐身|完全不可见|100%|必ず正解|always correct|unlimited free/i);
    assert.match(page, /raysyadesu@gmail\.com/);
  }
});

test('pack recommendations match the app purchase entry, with precise fractional unit prices', async () => {
  const { formatUnitPrice } = await import('../src/site.ts');
  const packs = [{id:'large',questions:1000,amountCents:2200},{id:'small',questions:100,amountCents:300},{id:'daily',questions:300,amountCents:800}];
  assert.match(formatUnitPrice(packs[2]!, 'JPY', 'en'), /2\.67/);
  assert.match(formatUnitPrice({id:'usd',questions:30,amountCents:500},'USD','en'), /0\.17/);
  const page=renderLandingPage({packs,trialQuestions:30,currency:'JPY',lang:'en',aiProvider:'deepseek'});
  assert.match(page, /value="daily" data-questions="300" checked/);
  assert.match(page, /offers all packs and selects 300 questions by default/);
  assert.match(page, /href="#purchase"/);
  const choices=page.match(/<label class="pack-choice"[\s\S]*?<\/label>/g)??[];
  assert.equal(choices.length,3);
  assert.match(page, /data-purchase="pack"/);
  assert.doesNotMatch(page, /buy\.stripe\.com|checkout\.stripe\.com|device_token/);
  assert.equal((page.match(/ · One-time payment/g)??[]).length,3);
});

test('demo is accessible without scripts and reduced motion is included in all languages', () => {
  for(const lang of ['zh','ja','en'] as const){
    const page=renderLandingPage({packs:[],trialQuestions:30,currency:'JPY',lang,aiProvider:'deepseek'});
    assert.equal((page.match(/type="radio"/g)??[]).length,3);
    assert.match(page,/id="demo-answer"[^>]*checked/);
    assert.match(page,/<fieldset><legend>/);
    assert.match(page,/prefers-reduced-motion:reduce/);
    assert.match(page,/href="#main"/);
    assert.doesNotMatch(page,/onchange=|onclick=/);
    const ids=[...page.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length);
    for(const [,id] of page.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id),`missing ${id}`);
  }
});

 test('disabled trial and Plus do not advertise unavailable offers',()=>{
  for(const lang of ['zh','ja','en'] as const){
   const page=renderLandingPage({lang,packs:[],currency:'JPY',trialQuestions:30,aiProvider:'mock',freeTrialEnabled:false,plusEnabled:false});
   assert.doesNotMatch(page, /class="plan"|72 小时|72 時間|72-hour|CNY \/|69 CNY/);
   assert.match(page, /href="\/dl"/);
  }
 });


test('hero uses the native AppKit answer capture and desktop chrome without the demo banner', () => {
  const page = renderLandingPage({lang:'zh', packs:[], currency:'JPY', trialQuestions:30, aiProvider:'mock'});
  const menu = page.match(/<div class="menu-bar"[\s\S]*?<div class="notch">/)?.[0] ?? '';
  assert.match(menu, /Finder/);
  assert.doesNotMatch(menu, /交互演示/);
  assert.match(page, /class="native-shot"><img src="data:image\/webp;base64,/);
  assert.match(page, /真实 Mac App 答案面板，离线示例/);
  assert.match(page, /D. 120 km\/h/);
});

test('single-image demo precedes multi-image mode and waits for user playback', () => {
  for (const lang of ['zh','ja','en'] as const) {
    const html = renderLandingPage({lang,packs:[],currency:'JPY',trialQuestions:30,aiProvider:'mock'});
    assert.ok(html.indexOf('id="single-mode"') < html.indexOf('id="automatic-mode"'));
    assert.match(html, /<video controls playsinline preload="none" poster="\/media\/single-mode-poster.jpg"/);
    assert.doesNotMatch(html, /<video[^>]*autoplay/);
  }
});

test('demo media supports seeking and HEAD; rejects invalid paths and ranges', async () => {
  const head = await app.inject({method:'HEAD',url:'/media/single-mode.mp4'});
  assert.equal(head.statusCode,200);
  assert.equal(head.headers['content-type'],'video/mp4');
  assert.equal(head.body,'');
  const size = Number(head.headers['content-length']);
  assert.ok(size > 0);
  const part = await app.inject({url:'/media/single-mode.mp4',headers:{range:'bytes=0-31'}});
  assert.equal(part.statusCode,206);
  assert.equal(part.rawPayload.length,32);
  assert.equal(part.headers['content-range'],`bytes 0-31/${size}`);
  const suffix = await app.inject({url:'/media/single-mode.mp4',headers:{range:'bytes=-16'}});
  assert.equal(suffix.rawPayload.length,16);
  assert.equal(suffix.statusCode,206);
  const invalid = await app.inject({url:'/media/single-mode.mp4',headers:{range:`bytes=${size}-`}});
  assert.equal(invalid.statusCode,416);
  assert.equal((await app.inject('/media/not-a-demo.mp4')).statusCode,404);
  assert.equal((await app.inject('/media/single-mode-poster.jpg')).headers['content-type'],'image/jpeg');
});

test('automatic-mode recording is seekable and served from the same origin', async () => {
  const media = await app.inject({url:'/media/automatic-mode.mp4',headers:{range:'bytes=0-31'}});
  assert.equal(media.statusCode,206);
  assert.equal(media.headers['content-type'],'video/mp4');
  assert.equal(media.rawPayload.length,32);
  const html = renderLandingPage({lang:'zh',packs:[],currency:'JPY',trialQuestions:30,aiProvider:'mock'});
  assert.match(html, /画面变化，自动查题/);
  assert.doesNotMatch(html, /data-auto-caption|auto-video-badge|data-auto-cues/);
  assert.match(html, /默认快捷键 ⌘⇧0 · 再按一次即可停止（真实 App 操作演示）/);
  assert.match(html, /按下 ⌘⇧0 ，检测到画面变化自动查题，无需重复按快捷键。/);
  assert.match(html, /source src="\/media\/automatic-mode.mp4"/);
});
