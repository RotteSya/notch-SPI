import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';

// Run with an allowlisted environment: no production credentials or provider calls.
process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_PROVIDER = 'mock';
process.env.LOG_LEVEL = 'silent';
process.env.QUOTA_POLICY_VERSION = 'legacy-test';
process.env.PUBLIC_BASE_URL = 'http://localhost:8787';
process.env.FREE_TRIAL_ENABLED = '0';
process.env.PLUS_ENABLED = '0';

const {buildApp} = await import('../src/index.ts');
const {SITE_ORIGIN, renderSiteRobots, renderSiteSitemap} = await import('../src/site-seo.ts');
const {demoScript, siteCSP} = await import('../src/site-demo.ts');
let app:FastifyInstance;
before(async () => { app = await buildApp(); });
after(async () => { await app.close(); });

for (const path of ['/', '/spi', '/reading-practice']) {
  for (const lang of ['zh', 'ja', 'en']) {
    test(`initial HTML has stable SEO metadata for ${path}?lang=${lang}`, async () => {
      const url = `${path}?lang=${lang}&utm_source=seo-test`;
      const response = await app.inject({url, headers:{'user-agent':'Googlebot', 'accept-language':'fr-FR'}});
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type'] ?? '', /text\/html/);
      const html = response.body;
      assert.ok(html.includes(`<link rel="canonical" href="${SITE_ORIGIN}${path}?lang=${lang}">`));
      const head = html.split('</head>')[0]!;
      assert.doesNotMatch(head, /localhost|utm_source|device_token|127\.0\.0\.1/);
      assert.equal((head.match(/<title>/g) ?? []).length, 1);
      assert.ok(head.includes('application/ld+json'));
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(ids).size, ids.length);
      if (path === '/reading-practice') {
        assert.match(head, /noindex,follow/);
      } else {
        assert.doesNotMatch(head, /noindex/);
        const study = html.match(/<section[^>]*id="study"[\s\S]*?<\/section>/)?.[0];
        assert.ok(study, 'the study content is present in initial HTML');
        assert.ok(html.indexOf(study) < html.indexOf('id="legal-drawer"'));
        assert.ok(study.includes(`/spi?lang=${lang}`) || path === '/spi');
      }
      assert.equal(response.headers['content-security-policy'], siteCSP);
      assert.ok(siteCSP.includes('sha256-' + createHash('sha256').update(demoScript).digest('base64')));
      assert.doesNotMatch(html, /class="concept-plan plus-plan"|class="concept-plan trial-plan"/);
    });
  }
}

test('language negotiation remains compatible but canonical points to the explicit language URL', async () => {
  for (const lang of ['zh', 'ja', 'en']) {
    const response = await app.inject({url:'/', headers:{'accept-language':lang}});
    assert.ok(response.body.includes(`href="${SITE_ORIGIN}/?lang=${lang}"`));
    assert.equal(response.headers.vary, 'Accept-Language');
  }
});

test('SEO documents are public and match the reviewed static outputs', async () => {
  for (const [path, render, type] of [
    ['/robots.txt', renderSiteRobots, 'text/plain'],
    ['/sitemap.xml', renderSiteSitemap, 'application/xml'],
  ] as const) {
    const response = await app.inject(path);
    assert.equal(response.statusCode, 200);
    assert.ok(String(response.headers['content-type']).startsWith(type));
    assert.equal(response.body, render());
    assert.equal(response.body, await readFile(new URL('../public' + path, import.meta.url), 'utf8'));
    const head = await app.inject({url:path, method:'HEAD'});
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, '');
  }
  const sitemap = (await app.inject('/sitemap.xml')).body;
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 6);
  assert.doesNotMatch(sitemap, /reading-practice|\/purchase|\/admin|\/api\/|\/v1\//);
  assert.equal((await app.inject('/not-a-real-seo-page')).statusCode, 404);
});

test('sharing image remains an existing same-origin asset', async () => {
  const response = await app.inject({method:'HEAD', url:'/media/single-mode-poster.jpg'});
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/jpeg');
  assert.ok(Number(response.headers['content-length']) > 0);
});
