import {createReadStream, statSync} from 'node:fs';

// Only these bundled website assets are accessible; never accept filesystem paths.
const files = {
  '/media/notchspi-ghost-logo.png': {url:new URL('../public/media/notchspi-ghost-logo.png', import.meta.url), type:'image/png'},
  '/media/notchspi-ghost-favicon.png': {url:new URL('../public/media/notchspi-ghost-favicon.png', import.meta.url), type:'image/png'},
  '/media/company-ana.png': {url:new URL('../public/media/companies/ana.png', import.meta.url), type:'image/png'},
  '/media/company-canon.png': {url:new URL('../public/media/companies/canon.png', import.meta.url), type:'image/png'},
  '/media/company-goldman-sachs.png': {url:new URL('../public/media/companies/goldman-sachs.png', import.meta.url), type:'image/png'},
  '/media/company-honda.png': {url:new URL('../public/media/companies/honda.png', import.meta.url), type:'image/png'},
  '/media/company-itochu.png': {url:new URL('../public/media/companies/itochu.png', import.meta.url), type:'image/png'},
  '/media/company-jal.png': {url:new URL('../public/media/companies/jal.png', import.meta.url), type:'image/png'},
  '/media/company-jr-east.png': {url:new URL('../public/media/companies/jr-east.png', import.meta.url), type:'image/png'},
  '/media/company-line-yahoo.webp': {url:new URL('../public/media/companies/line-yahoo.webp', import.meta.url), type:'image/webp'},
  '/media/company-marubeni.svg': {url:new URL('../public/media/companies/marubeni.svg', import.meta.url), type:'image/svg+xml'},
  '/media/company-microsoft.png': {url:new URL('../public/media/companies/microsoft.png', import.meta.url), type:'image/png'},
  '/media/company-mitsubishi.png': {url:new URL('../public/media/companies/mitsubishi.png', import.meta.url), type:'image/png'},
  '/media/company-panasonic.png': {url:new URL('../public/media/companies/panasonic.png', import.meta.url), type:'image/png'},
  '/media/company-rakuten.png': {url:new URL('../public/media/companies/rakuten.png', import.meta.url), type:'image/png'},
  '/media/company-recruit.png': {url:new URL('../public/media/companies/recruit.png', import.meta.url), type:'image/png'},
  '/media/company-softbank-group.png': {url:new URL('../public/media/companies/softbank-group.png', import.meta.url), type:'image/png'},
  '/media/company-sony.svg': {url:new URL('../public/media/companies/sony.svg', import.meta.url), type:'image/svg+xml'},
  '/media/company-starbucks.png': {url:new URL('../public/media/companies/starbucks.png', import.meta.url), type:'image/png'},
  '/media/company-toyota.png': {url:new URL('../public/media/companies/toyota.png', import.meta.url), type:'image/png'},
  '/media/company-aws.png': {url:new URL('../public/media/companies/aws.png', import.meta.url), type:'image/png'},
  '/media/company-suntory.png': {url:new URL('../public/media/companies/suntory.png', import.meta.url), type:'image/png'},


  '/media/automatic-mode.mp4': {url:new URL('../public/media/automatic-mode.mp4', import.meta.url), type:'video/mp4'},
  '/media/automatic-mode-poster.jpg': {url:new URL('../public/media/automatic-mode-poster.jpg', import.meta.url), type:'image/jpeg'},
  '/media/multi-mode.mp4': {url:new URL('../public/media/multi-mode.mp4', import.meta.url), type:'video/mp4'},
  '/media/multi-mode-poster.jpg': {url:new URL('../public/media/multi-mode-poster.jpg', import.meta.url), type:'image/jpeg'},
  '/media/single-mode.mp4': {url:new URL('../public/media/single-mode.mp4', import.meta.url), type:'video/mp4'},
  '/media/single-mode-poster.jpg': {url:new URL('../public/media/single-mode-poster.jpg', import.meta.url), type:'image/jpeg'},
} as const;

export function siteMedia(path: string, range?: string) {
  const asset = files[path as keyof typeof files];
  if (!asset) return undefined;
  const size = statSync(asset.url).size;
  const headers: Record<string,string> = {'Content-Type':asset.type,'Accept-Ranges':'bytes',
    'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'};
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else start = size;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      return {status:416,headers:{...headers,'Content-Range':`bytes */${size}`,'Content-Length':'0'},body:undefined};
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  return {status:range ? 206 : 200,headers,body:createReadStream(asset.url,{start,end})};
}
