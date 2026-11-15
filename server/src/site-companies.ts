import type {PageLang} from './payments.ts';

// Reference-site source URLs and download date are recorded in docs/website.md.
export const companyLogos = [
  {name:'ANA', file:'ana.png', width:2560, height:666},
  {name:'Canon', file:'canon.png', width:709, height:215},
  {name:'Goldman Sachs', file:'goldman-sachs.png', width:1022, height:429},
  {name:'Honda', file:'honda.png', width:3000, height:2000},
  {name:'ITOCHU', file:'itochu.png', width:720, height:289},
  {name:'JAL', file:'jal.png', width:448, height:240},
  {name:'JR EAST', file:'jr-east.png', width:1200, height:888},
  {name:'LINE Yahoo', file:'line-yahoo.webp', width:1950, height:559},
  {name:'Marubeni', file:'marubeni.svg', width:164, height:16},
  {name:'Microsoft', file:'microsoft.png', width:2124, height:540},
  {name:'Mitsubishi', file:'mitsubishi.png', width:1200, height:1036},
  {name:'Panasonic', file:'panasonic.png', width:3840, height:2160},
  {name:'Rakuten', file:'rakuten.png', width:412, height:122},
  {name:'Recruit', file:'recruit.png', width:1200, height:502},
  {name:'SoftBank Group', file:'softbank-group.png', width:2560, height:628},
  {name:'Sony', file:'sony.svg', width:1280, height:225},
  {name:'Starbucks', file:'starbucks.png', width:650, height:300},
  {name:'Toyota', file:'toyota.png', width:3900, height:1200},
  {name:'AWS', file:'aws.png', width:1024, height:614},
  {name:'Suntory', file:'suntory.png', width:1920, height:1080},
] as const;

// Match measured reference velocity, rather than its period: our retained
// Goldman Sachs / Marubeni wordmarks make the natural-width track longer.
export function companyCycleSeconds(height: number, maxWidth: number, gap: number, pixelsPerSecond: number) {
  const distance = companyLogos.reduce((sum, logo) => sum + Math.min(height * logo.width / logo.height, maxWidth) + gap, 0);
  return (distance / pixelsPerSecond).toFixed(6);
}

const copy = {
  zh: {title:'企业品牌一览', pause:'企业标识，聚焦此区域可暂停滚动'},
  ja: {title:'企業ブランド一覧', pause:'企業ロゴ。この領域にフォーカスするとスクロールが停止します'},
  en: {title:'Company brands at a glance', pause:'Company logos. Focus this region to pause scrolling'},
} as const;

export function companySection(lang: PageLang) {
  const c = copy[lang];
  const group = (duplicate: boolean) => `<ul class="company-group"${duplicate ? ' aria-hidden="true"' : ''}>${companyLogos.map(logo => `<li><img src="/media/company-${logo.file}" alt="${duplicate ? '' : logo.name}" width="${logo.width}" height="${logo.height}" decoding="async"></li>`).join('')}</ul>`;
  return `<section class="company-band" aria-labelledby="company-title"><div class="company-inner"><div class="company-heading"><h2 id="company-title">${c.title}</h2></div><div class="company-window" tabindex="0" role="group" aria-label="${c.pause}"><div class="company-track" id="company-track">${group(false)}${group(true)}</div></div></div></section>`;
}

export const companyCSS = `
.company-band{background:var(--paper);color:var(--ink);padding:32px 16px}
.company-inner{width:100%;margin:auto}
.company-heading{text-align:center;margin-bottom:20px}
.company-heading h2{font-size:18px;line-height:1.7;font-weight:600;letter-spacing:.02em;margin:0;color:#536176}
.company-window:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.company-window{display:flex;align-items:center;height:80px;overflow:hidden;mask-image:linear-gradient(to right,transparent,#000 128px,#000 calc(100% - 128px),transparent)}
.company-track{display:flex;width:max-content;animation:company-scroll ${companyCycleSeconds(48,150,64,86.2545)}s linear infinite}
.company-group{display:flex;align-items:center;flex:none;gap:64px;list-style:none;margin:0;padding:0 32px}
.company-group li{flex:none;display:flex;align-items:center;justify-content:center}
.company-group img{display:block;width:auto;height:48px;max-width:150px;object-fit:contain}
.company-window:focus-within .company-track,.company-window:hover .company-track{animation-play-state:paused}
@keyframes company-scroll{to{transform:translateX(-50%)}}
@media(max-width:767px){
.company-band{padding:24px 16px 20px}.company-heading h2{font-size:14px}
.company-window{height:48px;mask-image:linear-gradient(to right,transparent,#000 48px,#000 calc(100% - 48px),transparent)}
.company-group{gap:32px;padding:0 16px}.company-group img{height:32px;max-width:100px}
.company-track{animation-duration:${companyCycleSeconds(32,100,32,52.1695)}s}
}
@media(prefers-reduced-motion:reduce){
.company-track{animation:none;transform:none;width:100%}.company-window{height:auto;mask-image:none;overflow:visible}
.company-group{width:100%;flex-wrap:wrap;justify-content:center;gap:32px;padding:16px 0}
.company-group[aria-hidden=true]{display:none}
}
`;
