import {escapeHtml, type PageLang} from './payments.ts';

interface StudyCopy {
  intro: string;
  homeTitle: string;
  homeQuestions: readonly (readonly [string, string])[];
  spiTitle: string;
  spiQuestions: readonly (readonly [string, string])[];
  linksLabel: string;
  spiLink: string;
  readingLink: string;
}

// Authored study guidance, not an exam question, model result or support guarantee.
const copy: Record<PageLang, StudyCopy> = {
  zh: {
    intro: 'NOTCHSPI / 在日中国留学生的 Mac SPI 备考助手',
    homeTitle: '给在日中国留学生准备 SPI 的 Mac 助手',
    homeQuestions: [
      ['NotchSPI 是什么？', 'Mac 截图查题助手，在顶部面板查看 AI 答案与解释。'],
      ['留学生如何练习？', '看完整题干和选项，按 ⌘⇧1，再核验复习。仅用于允许 AI 的自学，遵守正式考试规则。'],
      ['支持哪些 Mac 系统？', 'Apple Silicon：macOS 14+；Intel 兼容版：macOS 12.3+。'],
    ],
    spiTitle: 'SPI 速率例题：先看答案，再理解日语题干',
    spiQuestions: [
      ['120 km 用时 2 小时，平均速度是多少？', '答案是 60 km/h。平均速度用距离除以时间：120 ÷ 2 = 60。'],
      ['距離、時間、速さ分别是什么意思？', '这道本站原创练习题不是正式考试原题。日语「距離」是行驶距离，此题为 120 km；「時間」是所用时间，此题为 2 小时；「速さ」是速度。把条件放进「速さ = 距離 ÷ 時間」，得到每小时 60 km。先辨清题干问什么，再检查单位：小时与 km 对应，结果为 km/h，不要把两小时的总路程当作一小时的速度。'],
      ['如何在 Mac 上练习和复习？', '看完整题图，确认题干和选项 → 按 ⌘⇧1 → 对照原题核验答案与计算，再复习日语术语和单位。AI 答案需要自行核验。仅用于允许 AI 的自学场景；正式考试须遵守主办方规则。'],
    ],
    linksLabel: '学习入口与开放状态',
    spiLink: 'SPI 备考指南',
    readingLink: '阅读练习 · 未开放，查看开放状态',
  },
  ja: {
    intro: 'NOTCHSPI / 日本で学ぶ中国人留学生のための Mac SPI 対策',
    homeTitle: '日本で学ぶ中国人留学生の SPI 対策を支える Mac アシスタント',
    homeQuestions: [
      ['NotchSPI とは？', 'Mac 上の問題をキャプチャし、画面上部のパネルで AI の回答と解説を確認するアシスタントです。'],
      ['留学生はどう練習する？', '問題文と選択肢をすべて表示し、⌘⇧1 を押して、回答を検算・復習します。AI 利用が認められた自習でのみ使い、本試験の規則を守ってください。'],
      ['対応する Mac の OS は？', 'Apple Silicon 版は macOS 14 以降、Intel 互換版は macOS 12.3 以降に対応しています。'],
    ],
    spiTitle: 'SPI の速さの練習問題：答えから考え方へ',
    spiQuestions: [
      ['120 km を 2 時間で走ると、平均の速さは？', '答えは 60 km/h です。平均の速さは距離を時間で割って求めます：120 ÷ 2 = 60。'],
      ['「距離」「時間」「速さ」をどう読み取る？', 'これは当サイトのオリジナル練習問題で、本試験の問題ではありません。「距離」は移動した長さで 120 km、「時間」はかかった時間で 2 時間、「速さ」は単位時間に進む距離です。「速さ = 距離 ÷ 時間」に当てはめると、1 時間あたり 60 km になります。何を求める問題かを確認してから、単位も確認しましょう。km と時間を使うので答えの単位は km/h。2 時間の総距離を 1 時間の距離と取り違えないことが大切です。'],
      ['Mac で練習・復習する手順は？', '問題画像全体を見て、問題文と選択肢を確認 → ⌘⇧1 → 元の問題と照合して検算し、用語と単位を復習します。AI の回答は自分で確認してください。利用は AI が認められた自習に限り、本試験では主催者の規則を守ってください。'],
    ],
    linksLabel: '学習の入口と公開状況',
    spiLink: 'SPI 対策ガイド',
    readingLink: '読解練習 · 未公開、公開状況を確認',
  },
  en: {
    intro: 'NOTCHSPI / Mac SPI study support for Chinese students in Japan',
    homeTitle: 'A Mac assistant for Chinese students preparing for SPI in Japan',
    homeQuestions: [
      ['What is NotchSPI?', 'NotchSPI captures questions on your Mac and displays AI answers and explanations in a panel at the top of your screen.'],
      ['How can students practise?', 'Show the complete question and options, press ⌘⇧1, then check and review the answer. Use it only for self-study where AI is permitted, and follow official exam rules.'],
      ['Which Mac systems are supported?', 'The Apple Silicon version requires macOS 14 or later; the Intel compatibility version requires macOS 12.3 or later.'],
    ],
    spiTitle: 'SPI speed practice: the answer first, then the Japanese terms',
    spiQuestions: [
      ['120 km in 2 hours: what is the average speed?', 'The answer is 60 km/h. Divide distance by time to find average speed: 120 ÷ 2 = 60.'],
      ['What do 距離, 時間 and 速さ mean?', 'This is an original practice question written for this site, not an official exam question. 距離 means distance travelled: 120 km here. 時間 means elapsed time: 2 hours here. 速さ means speed. Substitute the values into 速さ = 距離 ÷ 時間 to get 60 km per hour. Identify what the question asks before calculating, then check the units. With kilometres and hours, the result is in km/h. Do not confuse the total distance over two hours with the distance covered in one hour.'],
      ['How do I practise & review on a Mac?', 'View the complete question image and check the question and options → press ⌘⇧1 → verify the answer and calculation against the original, then review the Japanese terms and units. Check AI answers yourself. Use NotchSPI only for self-study where AI is permitted; follow the organiser’s rules in official exams.'],
    ],
    linksLabel: 'Study entries and availability',
    spiLink: 'SPI study guide',
    readingLink: 'Reading practice · Not open yet; view availability',
  },
};

/** Plain text only: the page renderer escapes this before placing it in the hero eyebrow. */
export function studyIntro(lang: PageLang): string {
  return copy[lang].intro;
}

/** Visible, server-rendered study copy. Unreleased reading practice gets no added content. */
export function renderStudySection(lang: PageLang, entry?: 'spi' | 'reading_practice'): string {
  if (entry === 'reading_practice') return '';
  const c = copy[lang];
  const spi = entry === 'spi';
  const questions = spi ? c.spiQuestions : c.homeQuestions;
  const answers = questions.map(([question, answer]) =>
    `<div class="study-answer"><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></div>`
  ).join('');
  return `<section id="study" class="study-section${spi ? ' study-spi' : ''}" aria-labelledby="study-title"><div class="study-inner"><h2 id="study-title">${escapeHtml(spi ? c.spiTitle : c.homeTitle)}</h2><div class="study-answers">${answers}</div><nav class="study-links" aria-label="${escapeHtml(c.linksLabel)}"><a href="${escapeHtml(`/spi?lang=${lang}`)}"${spi ? ' aria-current="page"' : ''}>${escapeHtml(c.spiLink)}</a><a href="${escapeHtml(`/reading-practice?lang=${lang}`)}">${escapeHtml(c.readingLink)}</a></nav></div></section>`;
}

// Reuse the site's typeface and palette; no drawer, reveal class, script or animation.
export const studyCSS: string = `
.hero .eyebrow{display:block;color:#c1cbdb;font-size:12px;line-height:1.6;letter-spacing:.04em;text-transform:none;margin-bottom:14px}
.study-section{display:block;background:var(--paper);color:var(--ink);padding:32px 0 40px}
.study-inner{width:min(1160px,calc(100% - 96px));margin:auto}
.study-section h2{font-size:clamp(23px,2.4vw,30px);line-height:1.4;font-weight:650;letter-spacing:-.025em;margin-bottom:22px}
.study-answers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
.study-answer{min-width:0;overflow-wrap:anywhere}
.study-section h3{font-size:16px;line-height:1.6;font-weight:650;letter-spacing:0;margin-bottom:8px}
.study-section p{font-size:14px;line-height:1.85;color:var(--secondary)}
.study-links{display:flex;flex-wrap:wrap;gap:4px 24px;margin-top:18px;font-size:13px;line-height:1.7}
.study-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--accent);text-decoration:underline;text-underline-offset:4px;overflow-wrap:anywhere}
.study-spi .study-inner{max-width:900px}
.study-spi .study-answers{grid-template-columns:minmax(0,1fr);gap:22px}
@media(max-width:1100px){.study-inner{width:calc(100% - 64px)}}
@media(max-width:700px){.hero .eyebrow{font-size:11px;letter-spacing:.02em;margin-bottom:12px}.study-section{padding:24px 0 28px}.study-inner{width:calc(100% - 40px)}.study-section h2{font-size:23px;margin-bottom:18px}.study-answers{grid-template-columns:minmax(0,1fr);gap:18px}.study-section h3{font-size:16px}.study-section p{font-size:14px}.study-links{gap:4px 16px;margin-top:14px}}
`;
