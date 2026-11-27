import {escapeHtml, type PageLang} from './payments.ts';

// The confirmed public origin is independent of request hosts and preview configuration.
export const SITE_ORIGIN = 'https://notchspi-api.vercel.app';

const LANGUAGES = ['zh', 'ja', 'en'] as const;
const HREFLANG: Record<PageLang, string> = {zh: 'zh-Hans', ja: 'ja', en: 'en'};
const OG_LOCALE: Record<PageLang, string> = {zh: 'zh_CN', ja: 'ja_JP', en: 'en_US'};
const OG_IMAGE = `${SITE_ORIGIN}/media/single-mode-poster.jpg`;

type SiteEntry = 'spi' | 'reading_practice';
type SitePage = 'home' | SiteEntry;
type PageCopy = {title: string; description: string};

const PAGE_PATH: Record<SitePage, string> = {
  home: '/',
  spi: '/spi',
  reading_practice: '/reading-practice',
};

// Search summaries are deliberately separate from body copy and internal evaluations.
const PAGE_COPY: Record<SitePage, Record<PageLang, PageCopy>> = {
  home: {
    zh: {
      title: '日本留学生 SPI 查题｜Mac AI 截图查题工具 · NotchSPI',
      description: '面向在日中国留学生的 Mac AI 截图查题工具，用于 SPI 等考试过程中截图提问、查看 AI 答案。支持题组、最近查题和中日英界面。Apple Silicon 需 macOS 14+，Intel 兼容版需 macOS 12.3+。使用须遵守考试规则，AI 回答需自行核对。',
    },
    ja: {
      title: 'SPI 試験中の画像質問・Mac AI ツール | NotchSPI',
      description: 'NotchSPI は SPI などの試験中にスクリーンショットから質問し、AI の回答を確認する Mac 向けツールです。複数画像のまとめ質問、最近の質問、日本語・中国語・英語の UI に対応。Apple Silicon は macOS 14 以降、Intel 互換版は 12.3 以降。利用は試験規則に従い、回答は自分で確認してください。',
    },
    en: {
      title: 'Mac AI Screenshot Lookup for SPI Tests | NotchSPI',
      description: "Look up answers to Japan's SPI questions from screenshots during tests on Mac with NotchSPI. Check AI answers yourself and follow the test provider's rules. Explore features and downloads.",
    },
  },
  spi: {
    zh: {
      title: '日本就职 SPI 考试中查题｜Mac AI 截图查题工具 · NotchSPI',
      description: 'NotchSPI 面向在日中国留学生，用于日本就职 SPI 考试过程中截图查题、查看 AI 答案。支持单图提问、合并题组和回看最近查题，中日英界面可切换。查看 Mac 功能与下载要求；使用须遵守考试规则，答案与思路需自行核对。',
    },
    ja: {
      title: 'SPI 試験中にスクリーンショットで質問 | NotchSPI',
      description: '日本の就職 SPI 試験中に、Mac でスクリーンショットから質問し AI の回答を確認するための NotchSPI。単一画像・複数画像の質問、最近の質問、日本語・中国語・英語の UI に対応。Mac の機能と動作環境をご確認ください。利用は試験規則に従い、回答は自分で検証してください。',
    },
    en: {
      title: 'SPI Test Answer Lookup on Mac | NotchSPI',
      description: 'Use NotchSPI to ask screenshot questions and view AI answers during SPI tests on Mac. Group images or revisit recent questions. Follow the exam rules and verify answers yourself.',
    },
  },
  reading_practice: {
    zh: {
      title: '日本留学生阅读练习（尚未开放）｜NotchSPI',
      description: 'NotchSPI 阅读练习入口目前仅供内部准备，尚未向公众开放。现有 Mac 截图查题功能与下载要求请查看首页，SPI 考试中查题功能请查看 SPI 入口。此页面不代表阅读练习功能已正式发布。',
    },
    ja: {
      title: '読解練習（未公開）| NotchSPI',
      description: 'NotchSPI の読解練習入口は内部準備用で、一般公開前です。現在の Mac 向け画像質問機能と動作環境はホーム、SPI 試験中の画像質問については SPI ページをご覧ください。この入口は読解練習機能の正式提供を示すものではありません。',
    },
    en: {
      title: 'Reading Practice (Not Yet Available) | NotchSPI',
      description: 'The NotchSPI reading-practice entry is for internal preparation and is not publicly available. Visit the home or SPI page for current Mac screenshot-question features and downloads.',
    },
  },
};

const PRODUCT_DESCRIPTION: Record<PageLang, string> = {
  zh: 'NotchSPI 是用于 SPI 等考试过程中截图查题、查看 AI 答案的 Mac 工具，支持截图提问、题组与最近查题，提供中日英界面。使用须遵守考试规则，AI 回答需要自行核对。',
  ja: 'NotchSPI は SPI などの試験中にスクリーンショットから質問し、AI の回答を確認する Mac 向けツールです。複数画像のまとめ質問、最近の質問、日本語・中国語・英語の UI を備えます。利用は試験規則に従い、AI の回答は自分で確認してください。',
  en: 'NotchSPI is a Mac tool for asking screenshot questions and viewing AI answers during SPI tests, with question groups, recent questions and Chinese, Japanese and English interfaces. Follow the exam rules and verify AI answers yourself.',
};

const IMAGE_ALT: Record<PageLang, string> = {
  zh: 'NotchSPI Mac 单图提问演示画面',
  ja: 'NotchSPI の Mac スクリーンショット質問デモ',
  en: 'NotchSPI screenshot-question demo on Mac',
};

function pageURL(page: SitePage, lang: PageLang): string {
  return `${SITE_ORIGIN}${PAGE_PATH[page]}?lang=${lang}`;
}

function meta(attribute: 'name' | 'property', key: string, value: string): string {
  return `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(value)}">`;
}

/** Metadata fragment for the existing <head>; does not change CSP or language resolution. */
export function renderSiteHead(input: {lang: PageLang; entry?: 'spi' | 'reading_practice'}): string {
  const page = input.entry ?? 'home';
  const {lang} = input;
  const copy = PAGE_COPY[page][lang];
  const canonical = pageURL(page, lang);
  const application = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'NotchSPI',
    url: canonical,
    description: PRODUCT_DESCRIPTION[lang],
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'macOS 14+ (Apple Silicon); macOS 12.3+ (Intel)',
    inLanguage: LANGUAGES.map(language => HREFLANG[language]),
    image: OG_IMAGE,
  };
  const jsonLD = JSON.stringify(application).replace(/</g, '\\u003c');

  return [
    `<title>${escapeHtml(copy.title)}</title>`,
    meta('name', 'description', copy.description),
    meta('name', 'robots', page === 'reading_practice' ? 'noindex,follow' : 'index,follow'),
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    ...LANGUAGES.map(language => `<link rel="alternate" hreflang="${escapeHtml(HREFLANG[language])}" href="${escapeHtml(pageURL(page, language))}">`),
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(pageURL(page, 'ja'))}">`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'NotchSPI'),
    meta('property', 'og:title', copy.title),
    meta('property', 'og:description', copy.description),
    meta('property', 'og:url', canonical),
    meta('property', 'og:locale', OG_LOCALE[lang]),
    ...LANGUAGES.filter(language => language !== lang).map(language => meta('property', 'og:locale:alternate', OG_LOCALE[language])),
    meta('property', 'og:image', OG_IMAGE),
    meta('property', 'og:image:secure_url', OG_IMAGE),
    meta('property', 'og:image:type', 'image/jpeg'),
    // Dimensions of the existing JPEG, not the larger source video.
    meta('property', 'og:image:width', '1440'),
    meta('property', 'og:image:height', '852'),
    meta('property', 'og:image:alt', IMAGE_ALT[lang]),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', copy.title),
    meta('name', 'twitter:description', copy.description),
    meta('name', 'twitter:url', canonical),
    meta('name', 'twitter:image', OG_IMAGE),
    meta('name', 'twitter:image:alt', IMAGE_ALT[lang]),
    `<script type="application/ld+json">${jsonLD}</script>`,
  ].join('\n');
}

/** Only public home and SPI variants are indexed; no invented modification dates. */
export function renderSiteSitemap(): string {
  const entries = (['home', 'spi'] as const).flatMap(page => LANGUAGES.map(lang => [
    '  <url>',
    `    <loc>${escapeHtml(pageURL(page, lang))}</loc>`,
    ...LANGUAGES.map(language => `    <xhtml:link rel="alternate" hreflang="${escapeHtml(HREFLANG[language])}" href="${escapeHtml(pageURL(page, language))}" />`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(pageURL(page, 'ja'))}" />`,
    '  </url>',
  ].join('\n')));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

/** Preserve the existing wildcard policy for search and AI crawlers alike. */
export function renderSiteRobots(): string {
  return [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /v1/',
    'Disallow: /purchase',
    'Disallow: /topup',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}
