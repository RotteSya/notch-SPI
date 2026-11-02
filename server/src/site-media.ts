import {createReadStream, statSync} from 'node:fs';

// Only these bundled product-demo assets are accessible; never accept filesystem paths.
const files = {
  '/media/automatic-mode.mp4': {url:new URL('../public/media/automatic-mode.mp4', import.meta.url), type:'video/mp4'},
  '/media/automatic-mode-poster.jpg': {url:new URL('../public/media/automatic-mode-poster.jpg', import.meta.url), type:'image/jpeg'},
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
