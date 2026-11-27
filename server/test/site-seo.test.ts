import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SITE_ORIGIN, renderSiteHead, renderSiteRobots, renderSiteSitemap} from '../src/site-seo.ts';

const ORIGIN = 'https://notchspi-api.vercel.app';
const LANGUAGES = ['zh', 'ja', 'en'] as const;
const ENTRIES = [undefined, 'spi', 'reading_practice'] as const;
const HREFLANG = {zh: 'zh-Hans', ja: 'ja', en: 'en'};
const LOCALE = {zh: 'zh_CN', ja: 'ja_JP', en: 'en_US'};
const IMAGE = `${ORIGIN}/media/single-mode-poster.jpg`;
const PRIVATE_LOCATION = /private|localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i;

function unescapeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function metadata(head: string, key: string): string[] {
  return [...head.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)">/g)]
    .filter(match => match[1] === key).map(match => unescapeHtml(match[2]!));
}

function onlyMeta(head: string, key: string): string {
  const values = metadata(head, key);
  assert.equal(values.length, 1, `${key} must appear exactly once`);
  return values[0]!;
}

function alternatives(fragment: string, tag = 'link'): Map<string, string> {
  const expression = new RegExp(`<${tag} rel="alternate" hreflang="([^"]+)" href="([^"]+)"(?: \\/)?>`, 'g');
  const matches = [...fragment.matchAll(expression)];
  assert.equal(matches.length, 4, 'three language variants plus x-default');
  return new Map(matches.map(match => [match[1]!, unescapeHtml(match[2]!)]));
}

for (const entry of ENTRIES) {
  const path = entry === 'spi' ? '/spi' : entry === 'reading_practice' ? '/reading-practice' : '/';
  for (const lang of LANGUAGES) {
    test(`SEO head: ${entry ?? 'home'} / ${lang}`, () => {
      const head = renderSiteHead({lang, entry});
      const canonical = `${ORIGIN}${path}?lang=${lang}`;
      const canonicals = [...head.matchAll(/<link rel="canonical" href="([^"]+)">/g)];
      assert.equal(canonicals.length, 1);
      assert.equal(unescapeHtml(canonicals[0]![1]!), canonical);
      assert.equal(new URL(canonical).search, `?lang=${lang}`);

      const alternates = alternatives(head);
      for (const language of LANGUAGES) {
        assert.equal(alternates.get(HREFLANG[language]), `${ORIGIN}${path}?lang=${language}`);
        // Every peer returns the complete same set, including itself and this page.
        const peer = alternatives(renderSiteHead({lang: language, entry}));
        assert.deepEqual(peer, alternates);
        assert.equal(peer.get(HREFLANG[lang]), canonical);
      }
      assert.equal(alternates.get('x-default'), `${ORIGIN}${path}?lang=ja`);
      assert.equal(onlyMeta(head, 'robots'), entry === 'reading_practice' ? 'noindex,follow' : 'index,follow');

      const titles = [...head.matchAll(/<title>([^<]+)<\/title>/g)];
      assert.equal(titles.length, 1);
      const title = unescapeHtml(titles[0]![1]!);
      const description = onlyMeta(head, 'description');
      assert.ok(title.includes('NotchSPI'));
      assert.ok(description.length > 50);
      assert.notEqual(description, title);
      assert.doesNotMatch(description, /objective_v1|treatment|control|cohort|manifest|attestation|评测|評価データ/);
      if (lang === 'zh' && entry !== 'reading_practice') {
        for (const keyword of ['日本', '留学生', 'SPI', 'Mac', 'AI', '学习助手']) assert.ok(title.includes(keyword));
        assert.ok(description.includes('在日中国留学生'));
      }
      if (entry === 'reading_practice') {
        assert.match(description, /尚未向公众开放|一般公開前|not publicly available/);
      }

      assert.equal(onlyMeta(head, 'og:type'), 'website');
      assert.equal(onlyMeta(head, 'og:site_name'), 'NotchSPI');
      assert.equal(onlyMeta(head, 'og:title'), title);
      assert.equal(onlyMeta(head, 'og:description'), description);
      assert.equal(onlyMeta(head, 'og:url'), canonical);
      assert.equal(onlyMeta(head, 'og:locale'), LOCALE[lang]);
      assert.deepEqual(metadata(head, 'og:locale:alternate'), LANGUAGES.filter(language => language !== lang).map(language => LOCALE[language]));
      assert.equal(onlyMeta(head, 'og:image'), IMAGE);
      assert.equal(onlyMeta(head, 'og:image:secure_url'), IMAGE);
      assert.equal(onlyMeta(head, 'og:image:type'), 'image/jpeg');
      assert.equal(onlyMeta(head, 'og:image:width'), '1440');
      assert.equal(onlyMeta(head, 'og:image:height'), '852');
      assert.ok(onlyMeta(head, 'og:image:alt').includes('NotchSPI'));
      assert.equal(onlyMeta(head, 'twitter:card'), 'summary_large_image');
      assert.equal(onlyMeta(head, 'twitter:title'), title);
      assert.equal(onlyMeta(head, 'twitter:description'), description);
      assert.equal(onlyMeta(head, 'twitter:url'), canonical);
      assert.equal(onlyMeta(head, 'twitter:image'), IMAGE);
      assert.equal(onlyMeta(head, 'twitter:image:alt'), onlyMeta(head, 'og:image:alt'));

      const scripts = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      assert.equal(scripts.length, 1);
      const json = scripts[0]![1]!;
      assert.doesNotMatch(json, /</, 'JSON must not contain an HTML/script opener');
      const application = JSON.parse(json);
      assert.equal(application['@context'], 'https://schema.org');
      assert.equal(application['@type'], 'SoftwareApplication');
      assert.equal(application.name, 'NotchSPI');
      assert.equal(application.url, canonical);
      assert.equal(application.applicationCategory, 'EducationalApplication');
      assert.equal(application.operatingSystem, 'macOS 14+ (Apple Silicon); macOS 12.3+ (Intel)');
      assert.equal(application.image, IMAGE);
      assert.deepEqual(application.inLanguage, ['zh-Hans', 'ja', 'en']);
      assert.ok(application.description.includes('NotchSPI'));
      assert.ok(application.description.length > 30);
      assert.equal(application.offers, undefined);
      assert.equal(application.aggregateRating, undefined);
      assert.equal(application.review, undefined);
      assert.equal(application.rating, undefined);
      assert.doesNotMatch(head, /Windows|guaranteed correct|保证答对|必ず正解|保证中文解释|中文解释保证/);
      assert.doesNotMatch(head, PRIVATE_LOCATION);
      assert.doesNotMatch(head, /Content-Security-Policy|<style\b|<head\b|<html\b/i);
      assert.equal((head.match(/<script\b/g) ?? []).length, 1, 'no executable script added');
    });
  }
}

test('all nine pages have independent localized titles and search summaries', () => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const entry of ENTRIES) for (const lang of LANGUAGES) {
    const head = renderSiteHead({lang, entry});
    titles.add(head.match(/<title>([^<]+)<\/title>/)![1]!);
    descriptions.add(onlyMeta(head, 'description'));
  }
  assert.equal(titles.size, 9);
  assert.equal(descriptions.size, 9);
});

test('HTML attributes escape apostrophes while JSON-LD remains valid JSON', () => {
  const head = renderSiteHead({lang: 'en'});
  assert.ok(head.includes('Japan&#39;s SPI'));
  for (const attribute of [...head.matchAll(/content="([^"]*)"/g)]) {
    assert.doesNotMatch(attribute[1]!, /[<>']|&(?!amp;|lt;|gt;|quot;|#39;)/);
  }
  const application = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
  assert.equal(typeof application.description, 'string');
  assert.doesNotMatch(application.description, /&(?:quot|amp|lt|gt);|&#39;/);
});

test('sitemap contains exactly six public canonical URLs and reciprocal alternates', () => {
  assert.equal(SITE_ORIGIN, ORIGIN);
  const sitemap = renderSiteSitemap();
  assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(sitemap.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
  assert.ok(sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  assert.ok(sitemap.endsWith('</urlset>\n'));
  const nodes = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  assert.equal(nodes.length, 6);
  const expected = ['/', '/spi'].flatMap(path => LANGUAGES.map(lang => `${ORIGIN}${path}?lang=${lang}`));
  const locations: string[] = [];
  for (const node of nodes) {
    const locationMatches = [...node[1]!.matchAll(/<loc>([^<]+)<\/loc>/g)];
    assert.equal(locationMatches.length, 1);
    const location = unescapeHtml(locationMatches[0]![1]!);
    locations.push(location);
    const url = new URL(location);
    assert.equal(url.origin, ORIGIN);
    assert.ok(LANGUAGES.includes(url.searchParams.get('lang') as typeof LANGUAGES[number]));
    const alternates = alternatives(node[1]!, 'xhtml:link');
    for (const lang of LANGUAGES) assert.equal(alternates.get(HREFLANG[lang]), `${ORIGIN}${url.pathname}?lang=${lang}`);
    assert.equal(alternates.get('x-default'), `${ORIGIN}${url.pathname}?lang=ja`);
    const entry = url.pathname === '/spi' ? 'spi' : undefined;
    assert.deepEqual(alternates, alternatives(renderSiteHead({lang: 'ja', entry})));
  }
  assert.deepEqual(locations, expected);
  assert.equal(new Set(locations).size, 6);
  assert.doesNotMatch(sitemap, /reading-practice|reading_practice|<lastmod>|<changefreq>|<priority>/);
  assert.doesNotMatch(sitemap, PRIVATE_LOCATION);
});

test('robots preserves all original policy lines and adds only the confirmed sitemap', () => {
  const robots = renderSiteRobots();
  assert.equal(robots, [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /v1/',
    'Disallow: /purchase',
    'Disallow: /topup',
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    '',
  ].join('\n'));
  assert.equal((robots.match(/^User-agent:/gm) ?? []).length, 1);
  assert.equal((robots.match(/^Disallow:/gm) ?? []).length, 5);
  assert.doesNotMatch(robots, /GPTBot|ClaudeBot|Google-Extended|CCBot|Bytespider|reading-practice/);
  assert.doesNotMatch(robots, PRIVATE_LOCATION);
});
