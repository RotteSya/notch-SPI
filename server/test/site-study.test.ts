import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderStudySection, studyCSS, studyIntro} from '../src/site-study.ts';
import type {PageLang} from '../src/payments.ts';

// Pure rendering tests only: no server, environment configuration or network calls.
const languages: readonly PageLang[] = ['zh', 'ja', 'en'];
const entries = [undefined, 'spi', 'reading_practice'] as const;
const plainText = (html: string) => html.replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, '');

const expected = {
  zh: {audience: /在日中国留学生/, product: /Mac 截图查题助手/, practice: /看完整题干和选项/, systems: /支持哪些 Mac 系统/, unavailable: /未开放，查看开放状态/, rule: /仅用于允许 AI 的自学/, exam: /(?:遵守正式考试规则|正式考试须遵守主办方规则)/, answer: /^答案是 60 km\/h。/, original: /本站原创练习题不是正式考试原题/},
  ja: {audience: /日本で学ぶ中国人留学生/, product: /Mac 上の問題をキャプチャ/, practice: /問題文と選択肢をすべて表示/, systems: /対応する Mac の OS/, unavailable: /未公開、公開状況を確認/, rule: /AI.*認められた自習/, exam: /本試験.*規則を守/, answer: /^答えは 60 km\/h です。/, original: /オリジナル練習問題で、本試験の問題ではありません/},
  en: {audience: /Chinese students.*in Japan/, product: /NotchSPI captures questions on your Mac/, practice: /Show the complete question and options/, systems: /Which Mac systems are supported/, unavailable: /Not open yet; view availability/, rule: /only for self-study where AI is permitted/, exam: /follow.*official exam rules/, answer: /^The answer is 60 km\/h\./, original: /original practice question written for this site, not an official exam question/},
} as const;

for (const lang of languages) {
  test(`${lang}: hero introduction is plain-text audience positioning, not a new slogan`, () => {
    const intro = studyIntro(lang);
    assert.equal(typeof intro, 'string');
    assert.match(intro, expected[lang].audience);
    assert.match(intro, /Mac SPI/);
    assert.doesNotMatch(intro, /[<>\n]|h1|hero-title/);
    assert.equal(studyIntro(lang), intro);
  });

  test(`${lang}: home has one descriptive h2 and three direct h3+p answers`, () => {
    const html = renderStudySection(lang);
    assert.match(html, expected[lang].audience);
    assert.match(html, /<h2 id="study-title">[^<]*SPI[^<]*<\/h2>/);
    const answers = [...html.matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)];
    assert.equal(answers.length, 3);
    assert.match(answers[0]![1]!, /NotchSPI/);
    assert.match(answers[0]![2]!, expected[lang].product);
    assert.match(answers[1]![2]!, expected[lang].practice);
    assert.match(answers[1]![2]!, /⌘⇧1/);
    assert.match(answers[2]![1]!, expected[lang].systems);
    assert.match(answers[2]![2]!, /Apple Silicon/);
    assert.match(answers[2]![2]!, /macOS 14/);
    assert.match(answers[2]![2]!, /Intel/);
    assert.match(answers[2]![2]!, /macOS 12\.3/);
    assert.doesNotMatch(html, /120 km|60 km\/h|<h1\b|<img\b|<video\b/);
  });

  test(`${lang}: home and SPI preserve language in both internal links and disclose reading status`, () => {
    for (const entry of [undefined, 'spi'] as const) {
      const html = renderStudySection(lang, entry);
      const links = [...html.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)];
      assert.equal(links.length, 2);
      assert.equal(links[0]![1], `/spi?lang=${lang}`);
      assert.equal(links[1]![1], `/reading-practice?lang=${lang}`);
      assert.match(links[1]![3]!, expected[lang].unavailable);
      assert.doesNotMatch(links[1]![2]!, /aria-current|download|data-disclosure/);
      assert.equal(links[0]![2]!.includes('aria-current="page"'), entry === 'spi');
      assert.doesNotMatch(html, /https?:|utm_|device_token|href="#/);
    }
  });

  test(`${lang}: SPI is an original answer-first example with Japanese terms and correct units`, () => {
    const html = renderStudySection(lang, 'spi');
    assert.match(html, /class="study-section study-spi"/);
    const answers = [...html.matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)];
    assert.equal(answers.length, 3);
    assert.match(answers[0]![1]!, /120 km.*2/);
    assert.match(answers[0]![2]!, expected[lang].answer);
    assert.match(answers[0]![2]!, /120 ÷ 2 = 60/);
    assert.equal(120 / 2, 60);
    assert.match(answers[1]![1]!, /距離.*時間.*速さ/);
    assert.match(answers[1]![2]!, expected[lang].original);
    assert.match(answers[1]![2]!, /速さ = 距離 ÷ 時間/);
    assert.match(answers[1]![2]!, /km\/h/);
    assert.match(answers[2]![2]!, /→.*⌘⇧1.*→/);
    assert.ok(html.indexOf('60 km/h') < html.indexOf('距離'));
    assert.doesNotMatch(html, /<h1\b|<img\b|<video\b|demo-stage|<script\b/);
  });

  test(`${lang}: both study variants restrict use to permitted self-study and retain exam rules`, () => {
    for (const entry of [undefined, 'spi'] as const) {
      const html = renderStudySection(lang, entry);
      assert.match(html, expected[lang].rule);
      assert.match(html, entry === 'spi' && lang === 'en' ? /follow the organiser’s rules in official exams/ : expected[lang].exam);
      assert.doesNotMatch(html, /准确率|全题型|保证中文解释|录用承诺|用户评价|作者资质|正解率|内定保証|合格保証|accuracy rate|guaranteed.*(?:answer|hire)|testimonials|\b20\d{2}[-/]\d{2}|\d+%/i);
    }
  });

  test(`${lang}: sections are visible without a drawer or scripts and their ids are unique`, () => {
    for (const entry of [undefined, 'spi'] as const) {
      const html = renderStudySection(lang, entry);
      assert.match(html, /^<section id="study" class="study-section/);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(ids, ['study', 'study-title']);
      assert.equal(new Set(ids).size, ids.length);
      for (const [, label] of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(label && ids.includes(label));
      assert.equal((html.match(/<h2\b/g) ?? []).length, 1);
      assert.doesNotMatch(html, /<details\b|<summary\b|<script\b|\bhidden\b|aria-hidden|legal-drawer|data-disclosure|chapter-arrival|is-waiting|\bstyle=/);
    }
  });

  test(`${lang}: reading practice returns no added copy, demo, links or ids`, () => {
    assert.equal(renderStudySection(lang, 'reading_practice'), '');
  });
}

test('Chinese home copy stays within 200 visible characters and SPI guidance is approximately 300', () => {
  const homeLength = [...plainText(renderStudySection('zh'))].length;
  const spiLength = [...plainText(renderStudySection('zh', 'spi'))].length;
  assert.ok(homeLength > 0 && homeLength <= 200, `home: ${homeLength}`);
  assert.ok(spiLength >= 260 && spiLength <= 380, `SPI: ${spiLength}`);
  const spi = renderStudySection('zh', 'spi');
  assert.match(spi, /「距離」是行驶距离/);
  assert.match(spi, /「時間」是所用时间/);
  assert.match(spi, /「速さ」是速度/);
  assert.match(spi, /核验答案与计算，再复习日语术语和单位/);
});

test('HTML-sensitive copy is escaped rather than interpreted as markup', () => {
  const html = renderStudySection('en', 'spi');
  assert.match(html, /<h3>How do I practise &amp; review on a Mac\?<\/h3>/);
  assert.doesNotMatch(html, /practise & review/);
  assert.doesNotMatch(html, /&(?!amp;|lt;|gt;|quot;|#39;)/);
  assert.doesNotMatch(html, /on\w+=|javascript:/i);
});

test('CSS keeps the inherited palette, visible eyebrow and mobile-readable content without animation', () => {
  assert.match(studyCSS, /\.hero \.eyebrow\{display:block/);
  assert.match(studyCSS, /\.study-section\{display:block/);
  for (const name of ['paper', 'ink', 'secondary', 'accent']) assert.ok(studyCSS.includes(`var(--${name})`));
  assert.match(studyCSS, /@media\(max-width:700px\)/);
  assert.match(studyCSS, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(studyCSS, /min-height:44px/);
  assert.match(studyCSS, /font-size:14px;line-height:1\.85/);
  assert.match(studyCSS, /overflow-wrap:anywhere/);
  assert.doesNotMatch(studyCSS, /display:\s*none|visibility:\s*hidden|opacity:\s*0\b|animation|@keyframes|transition|font-family|legal-drawer|chapter-arrival|content-visibility/);
});

test('all entry and language combinations render deterministically with no mutable caller state', () => {
  const initial = languages.flatMap(lang => entries.map(entry => renderStudySection(lang, entry)));
  for (const lang of [...languages].reverse()) for (const entry of [...entries].reverse()) renderStudySection(lang, entry);
  assert.deepEqual(languages.flatMap(lang => entries.map(entry => renderStudySection(lang, entry))), initial);
});
