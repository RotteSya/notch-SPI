export interface ReleaseDownload {
  url: string;
  filename: string;
}

// Name the bytes selected from one release snapshot, not a separately fetched latest version.
export function releaseDownload(release: unknown, configuredUrl: string, platform: 'mac' | 'intel'): ReleaseDownload | null {
  if (!release || typeof release !== 'object') return null;
  const rel = release as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (rel.draft === true || rel.prerelease === true || typeof rel.tag_name !== 'string') return null;
  const version = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/i.exec(rel.tag_name);
  if (!version || !Array.isArray(rel.assets)) return null;
  const filename = `NotchSPI${version[1]}.${version[2]}.${version[3] ?? '0'}-${platform}.dmg`;
  let configured: URL;
  try { configured = new URL(configuredUrl); } catch { return null; }
  const pinned = /\/releases\/download\/([^/]+)\//.exec(configured.pathname);
  if (pinned && decodeURIComponent(pinned[1]!) !== rel.tag_name) return null;
  const legacyName = configured.pathname.split('/').at(-1);
  const latestAlias = configured.hostname === 'github.com' && configured.pathname.includes('/releases/latest/download/');
  const assets = rel.assets.filter((asset): asset is { name?: string; browser_download_url: string } =>
    !!asset && typeof asset === 'object' && typeof asset.browser_download_url === 'string');
  // Keep old storage aliases usable during migration, but prefer the canonical asset.
  const asset = assets.find(a => a.name === filename)
    ?? assets.find(a => a.browser_download_url === configuredUrl)
    ?? (latestAlias ? assets.find(a => a.name === legacyName) : undefined);
  if (!asset) return null;
  let url: URL;
  try { url = new URL(asset.browser_download_url); } catch { return null; }
  const assetTag = /\/releases\/download\/([^/]+)\//.exec(url.pathname);
  if (assetTag && assetTag[1] !== encodeURIComponent(rel.tag_name)) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'data:') return null;
  return { url: asset.browser_download_url, filename };
}
