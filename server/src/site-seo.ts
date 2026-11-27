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
      title: '日本留学生 SPI 备考｜Mac AI 学习助手 · NotchSPI',
      description: '面向在日中国留学生的 Mac AI 学习助手，辅助日本就职 SPI 备考。支持截图提问、题组与最近查题，中日英界面可切换。Apple Silicon 需 macOS 14+，Intel 兼容版需 macOS 12.3+。了解功能与下载要求，AI 回答请自行核对。',
    },
    ja: {
      title: 'Mac の AI 学習アシスタント・SPI 対策 | NotchSPI',
      description: 'NotchSPI は Mac 向けの AI 学習アシスタント。スクリーンショットから質問し、複数の画像をまとめて、最近の問題を振り返れます。SPI 対策の自主学習に。Apple Silicon は macOS 14 以降、Intel 互換版は 12.3 以降。機能とダウンロード要件をご確認ください。',
    },
    en: {
      title: 'Mac AI Study Assistant for SPI Prep | NotchSPI',
      description: "Prepare for Japan's SPI with NotchSPI, a Mac AI study assistant. Ask from screenshots, group questions and review recent answers. Explore features and Mac downloads.",
    },
  },
  spi: {
    zh: {
      title: '日本就职 SPI 备考｜中国留学生 Mac AI 学习助手 · NotchSPI',
      description: '为在日中国留学生准备日本就职 SPI 提供 Mac AI 学习辅助。通过截图提问、合并题组和回看最近查题整理练习过程。中日英界面可切换；Apple Silicon 支持 macOS 14+，Intel 兼容版支持 macOS 12.3+。查看 SPI 备考用法，答案与思路需自行核对。',
    },
    ja: {
      title: 'SPI 対策を Mac でサポート | NotchSPI',
      description: '日本での就職に向けた SPI の自主学習を、Mac の AI アシスタントで補助。スクリーンショットから質問し、複数の画像をまとめて、最近の問題を復習できます。日本語・中国語・英語の UI に対応。SPI 学習での使い方と Mac の動作環境を確認し、回答は自分で検証してください。',
    },
    en: {
      title: 'SPI Preparation in Japan on Mac | NotchSPI',
      description: "Study for Japan's SPI recruitment test on Mac with screenshot questions and recent-answer review. See how NotchSPI supports self-study; check AI answers yourself.",
    },
  },
  reading_practice: {
    zh: {
      title: '日本留学生阅读练习（尚未开放）｜Mac AI 学习助手 · NotchSPI',
      description: 'NotchSPI 阅读练习入口目前仅供内部准备，尚未向公众开放。现有 Mac 学习功能与下载要求请查看首页；日本就职 SPI 自主备考请查看 SPI 入口。此页面不代表阅读练习功能已正式发布。',
    },
    ja: {
      title: '読解練習（未公開）| NotchSPI',
      description: 'NotchSPI の読解練習入口は内部準備用で、一般公開前です。現在の Mac 向け学習機能と動作環境はホーム、SPI の自主学習については SPI ページをご覧ください。この入口は読解練習機能の正式提供を示すものではありません。',
    },
    en: {
      title: 'Reading Practice (Not Yet Available) | NotchSPI',
      description: 'The NotchSPI reading-practice entry is for internal preparation and is not publicly available. Visit the home or SPI page for current Mac features and downloads.',
    },
  },
};

const PRODUCT_DESCRIPTION: Record<PageLang, string> = {
  zh: 'NotchSPI 是 Mac AI 学习助手，支持截图提问、题组与最近查题，提供中日英界面，可辅助 SPI 自主备考。AI 回答需要自行核对。',
  ja: 'NotchSPI は Mac 向けの AI 学習アシスタント。スクリーンショットからの質問、複数画像のまとめ質問、最近の問題の振り返り、日本語・中国語・英語の UI を備え、SPI の自主学習を補助します。AI の回答は自分で確認してください。',
  en: 'NotchSPI is a Mac AI study assistant with screenshot questions, question groups, recent-question review and Chinese, Japanese and English interfaces. It supports SPI self-study; verify AI answers yourself.',
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
    applicationCategory: 'EducationalApplication',
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
