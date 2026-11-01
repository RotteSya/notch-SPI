import {siteMedia} from '../server/src/site-media.ts';
// Website-only preview: no account, database, model, payment or environment-secret loading.
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {renderLandingPage, resolveSiteLang} from '../server/src/site.ts';
import {siteCSP} from '../server/src/site-demo.ts';
import {DEFAULT_PACKS_JSON, parsePacks} from '../server/src/pricing.ts';
const port = Number(process.env.SITE_PREVIEW_PORT || 4173);
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const media = siteMedia(url.pathname, req.headers.range);
  if (media) {
    res.writeHead(media.status,media.headers);
    if (req.method === 'HEAD' || !media.body) {media.body?.destroy();res.end();}
    else media.body.pipe(res);
    return;
  }
  if (url.pathname === '/dl' || url.pathname === '/dl/intel') {
    res.writeHead(302, {Location: 'https://notchspi-api.vercel.app' + url.pathname});res.end();return;
  }
  if (!['/', '/spi', '/reading-practice'].includes(url.pathname)) {res.writeHead(404);res.end('Not found');return;}
  let html = renderLandingPage({packs:parsePacks(DEFAULT_PACKS_JSON),currency:'JPY',trialQuestions:30,
    freeTrialEnabled:true,plusEnabled:true,aiProvider:'openai',
    lang:resolveSiteLang(url.searchParams.get('lang') || '',req.headers['accept-language'] || ''),
    entry:url.pathname === '/spi' ? 'spi' : url.pathname === '/reading-practice' ? 'reading_practice' : undefined,
    entryStatus:'disabled'});
  let csp = siteCSP;
  // Preview-only reduced-motion fixture; never changes the user's OS preference.
  if (url.searchParams.get('qa-motion') === 'reduce') {
    html = html.replaceAll('@media(prefers-reduced-motion:reduce)', '@media all')
      .replaceAll("window.matchMedia('(prefers-reduced-motion: reduce)')", "({matches:true,addEventListener(){}})");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (script) csp = siteCSP.replace(/sha256-[^']+/, 'sha256-' + createHash('sha256').update(script).digest('base64'));
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(html);
});
server.listen(port,'127.0.0.1',()=>console.log(`Website preview: http://127.0.0.1:${port}/?lang=zh`));
