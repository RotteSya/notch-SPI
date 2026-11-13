import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const repository = 'RotteSya/notch-SPI';
export const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function releaseAssets(release, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || release.tag_name !== tag || release.prerelease) throw Error('Expected an exact stable vX.Y.Z release');
  const version = tag.slice(1);
  return [`NotchSPI${version}-mac.dmg`, `NotchSPI${version}-intel.dmg`, `NotchSPI${version}-SHA256SUMS.txt`].map(name => {
    const matches = release.assets?.filter(a => a.name === name) ?? [];
    if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest) || !(matches[0].size > 0)) throw Error(`Missing or ambiguous verified release asset: ${name}`);
    return {name, id: matches[0].id, bytes: matches[0].size, sha256: matches[0].digest.slice(7)};
  });
}
export function ndjson(text) {
  return text.split(/\r?\n/).filter(l => l.trim().startsWith('{')).map(l => JSON.parse(l));
}
function result(rows) {
  const final = rows.filter(r => r.type === 'result').at(-1);
  if (!final || final.code !== 0) throw Error(final?.msg || 'Quark command did not report success');
  return final.data;
}
export function selectFolder(rows, config) {
  const data = result(rows);
  const artifact = rows.find(r => r.type === 'artifact')?.data?.file_path;
  if (!artifact) throw Error('Quark full search artifact is required; previews are insufficient');
  const files = fs.readFileSync(artifact, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  if (data.total >= 100 || files.length !== data.total) throw Error('Quark search is truncated; stop rather than risk duplicate uploads');
  const folders = files.filter(f => f.filename === config.folderName && String(f.file_type) === '0');
  if (folders.length !== 1) throw Error('Expected exactly one existing release folder; no folder will be created');
  return {fid: folders[0].fid, files};
}
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function checkFile(file, asset) {
  if (!fs.existsSync(file) || fs.statSync(file).size !== asset.bytes || digest(file) !== asset.sha256) throw Error(`Asset bytes differ: ${asset.name}`);
}
function defaultRun(command, args, {cwd, timeout = 300_000} = {}) {
  return execFileSync(command, args, {cwd, timeout, encoding:'utf8', maxBuffer:32 * 1024 * 1024});
}

export function publishRelease({root, tag, mode, config, run = defaultRun, searchSnapshot}) {
  if (!['publish', 'sync'].includes(mode)) throw Error('Expected publish or sync');
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw Error('Tag must be vX.Y.Z');
  if (!config.quarkCli || !fs.existsSync(config.quarkCli)) throw Error('Existing Quark CLI required; nothing will be installed');
  if (config.folderName !== 'NotchSPI Releases' || config.folderPath !== '夸克网盘/NotchSPI Releases') throw Error('Unexpected release destination');
  const directory = path.join(root, 'output/release-publish', tag);
  fs.mkdirSync(directory, {recursive:true});
  const lock = path.join(directory, 'running.lock');
  const fd = fs.openSync(lock, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd);
  let state;
  const stateFile = path.join(directory, 'state.json');
  const save = () => write(stateFile, state);
  let call = 0;
  const gh = args => run('gh', args, {cwd:root});
  const readRelease = () => JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tag}`]));
  const quark = args => {
    const log = path.join(directory, `${Date.now()}-${++call}-${args[0]}.jsonl`);
    try { const out = run('bash', [config.quarkCli, ...args], {cwd:directory}); fs.writeFileSync(log, out); return ndjson(out); }
    catch (error) {
      fs.writeFileSync(log, String(error.stdout ?? '') + String(error.stderr ?? ''));
      const rows = ndjson(String(error.stdout ?? ''));
      const message = rows.filter(r=>r.type==='result').at(-1)?.msg;
      throw Error(message || `Quark ${args[0]} failed; inspect ${path.basename(log)} before retry`);
    }
  };
  try {
    const release = readRelease();
    const tagRef = JSON.parse(gh(['api', `repos/${repository}/git/ref/tags/${tag}`]));
    if (!/^[a-f0-9]{40}$/.test(tagRef.object?.sha ?? '')) throw Error('Existing release tag required; no tag will be created');
    const assets = releaseAssets(release, tag);
    // Keep the checksum as release evidence; mirror only the two installers.
    const installers = assets.slice(0, 2);
    if (mode === 'sync' && release.draft) throw Error('sync cannot publish or upload a draft release');
    state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {tag, releaseId:release.id, assets, files:{}, status:'preparing'};
    if (state.releaseId !== release.id || JSON.stringify(state.assets) !== JSON.stringify(assets)) throw Error('Release identity changed; do not overwrite the existing release receipt');
    save();
    const local = path.join(directory, 'assets'); fs.mkdirSync(local, {recursive:true});
    for (const asset of assets) {
      const file = path.join(local, asset.name);
      if (!fs.existsSync(file)) gh(['release','download',tag,'--repo',repository,'--pattern',asset.name,'--dir',local]);
      checkFile(file, asset);
    }
    const sums = fs.readFileSync(path.join(local, assets[2].name), 'utf8').trim().split(/\r?\n/);
    for (const asset of assets.slice(0,2)) if (!sums.includes(`${asset.sha256}  ${asset.name}`)) throw Error(`Checksum file does not bind ${asset.name}`);
    // One complete search per run. Never infer absence from the CLI's five-row preview.
    const search = searchSnapshot ? ndjson(fs.readFileSync(searchSnapshot, 'utf8')) : quark(['search','--keyword','NotchSPI','--size','100','--stdout-only']);
    const folder = selectFolder(search, config); write(path.join(directory,'search-files.json'),folder.files);
    for (const asset of installers) {
      const existing = folder.files.filter(f => f.filename === asset.name);
      if (existing.length && !state.files[asset.name]?.fid) throw Error(`Existing name has no trusted upload receipt: ${asset.name}; inspect before retry`);
      if (existing.length > 1) throw Error(`Duplicate remote name: ${asset.name}`);
      if (state.files[asset.name]?.uploadStarted && !state.files[asset.name]?.fid) throw Error(`Upload outcome uncertain: ${asset.name}; inspect saved logs instead of duplicating`);
    }
    // Pin the asset IDs/digests again immediately before making a draft public.
    const current = readRelease();
    if (current.id !== release.id || JSON.stringify(releaseAssets(current,tag)) !== JSON.stringify(assets)) throw Error('Release changed during preflight');
    if (mode === 'sync' && current.draft) throw Error('sync cannot publish a release changed back to draft');
    if (current.draft) {
      state.status='publishing'; save();
      gh(['release','edit',tag,'--repo',repository,'--draft=false','--latest']);
    }
    const published = readRelease();
    if (published.draft || published.id !== release.id || JSON.stringify(releaseAssets(published,tag)) !== JSON.stringify(assets)) throw Error('Published release identity does not match');
    state.status='syncing'; state.published=true; save();
    for (const asset of installers) {
      let receipt = state.files[asset.name];
      if (!receipt?.fid) {
        receipt = state.files[asset.name] = {uploadStarted:true}; save();
        const rows = quark(['upload',path.join(local,asset.name),'--parent-fid',folder.fid]);
        const uploaded = rows.find(r => r.type==='list' && r.code===0 && r.data?.fileName===asset.name)?.data;
        if (uploaded?.fileId) {receipt.fid=uploaded.fileId; save();}
        const data = result(rows);
        if (!receipt.fid || uploaded.fileSize!==asset.bytes || data.fullPath!==config.folderPath) throw Error(`Upload name, size or destination mismatch: ${asset.name}`);
        receipt.folderPath=data.fullPath; save();
      }
      if (receipt.folderPath !== config.folderPath) throw Error('Upload destination was not verified');
      const readback = fs.mkdtempSync(path.join(directory,'readback-'));
      const downloaded = result(quark(['download','--fid',receipt.fid,'--output-dir',readback]));
      const file = path.join(readback,asset.name);
      if (downloaded.fileName!==asset.name || path.resolve(downloaded.filePath)!==file) throw Error('Readback returned unexpected file name/path');
      checkFile(file,asset);
      receipt.sha256=asset.sha256; receipt.readback=file; receipt.verifiedAt=new Date().toISOString(); save();
    }
    const finalRelease = readRelease();
    if (finalRelease.draft || finalRelease.id !== release.id || JSON.stringify(releaseAssets(finalRelease,tag)) !== JSON.stringify(assets)) throw Error('Release changed during mirror verification');
    state.status='complete';state.completedAt=new Date().toISOString();delete state.error;save();
    return state;
  } catch (error) {
    if (state) {state.status='blocked';state.error=error.message;save();}
    throw error;
  } finally { fs.unlinkSync(lock); }
}
