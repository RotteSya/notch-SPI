// Git-aware document and governance checks. Node stdlib only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMMUTABLE_EVIDENCE_BASELINE = 'b89630b33ea70ef541b4031a82fb512812987d67';
export const IMMUTABLE_EVIDENCE_MANIFEST = fileURLToPath(new URL('../fixtures/immutable-evidence.json', import.meta.url));

export function parseEvidenceManifest(text, label = 'immutable-evidence.json') {
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return { errors: [`${label} is not valid JSON: ${err.message}`], files: [] };
  }
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: [`${label} is not an object`], files: [] };
  }
  if (body.baseline_commit !== IMMUTABLE_EVIDENCE_BASELINE) {
    errors.push(`${label} baseline_commit is missing or not ${IMMUTABLE_EVIDENCE_BASELINE}`);
  }
  if (!Array.isArray(body.files)) {
    errors.push(`${label} files is missing`);
    return { errors, files: [] };
  }
  const files = [];
  const seen = new Set();
  for (const entry of body.files) {
    const rel = entry && typeof entry.path === 'string' ? entry.path : '';
    if (!rel) {
      errors.push(`${label} has an entry without a path`);
      continue;
    }
    if (seen.has(rel)) errors.push(`${rel} is duplicated in ${label}`);
    seen.add(rel);
    const sha = entry.sha256;
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
      errors.push(`${rel} is missing a sha256`);
      continue;
    }
    files.push({ path: rel, sha256: sha });
  }
  return { errors, files };
}

function loadAllowlist() {
  const parsed = parseEvidenceManifest(fs.readFileSync(IMMUTABLE_EVIDENCE_MANIFEST, 'utf8'), path.basename(IMMUTABLE_EVIDENCE_MANIFEST));
  return parsed.errors.length ? [] : parsed.files.map((file) => file.path);
}

export const IMMUTABLE_EVIDENCE = loadAllowlist();

const immutable = new Set(IMMUTABLE_EVIDENCE);

function evidenceIndex(root) {
  return execFileSync('git', ['ls-files', '-z', 'objective-eval-output'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
}

/** Compare working-tree bytes with the fixed manifest. Does not rewrite the manifest. */
export function checkImmutableEvidence(root, options = {}) {
  const manifestPath = options.manifestPath ?? IMMUTABLE_EVIDENCE_MANIFEST;
  const label = path.basename(manifestPath);
  let text;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    return [`${label} is missing: ${err.message}`];
  }
  const parsed = parseEvidenceManifest(text, label);
  const errors = [...parsed.errors];
  let indexed;
  try {
    indexed = options.indexedPaths ?? evidenceIndex(root);
  } catch (err) {
    errors.push(`objective-eval-output index could not be read: ${err.message}`);
    return errors;
  }
  const allowed = new Set(parsed.files.map((file) => file.path));
  for (const rel of indexed) {
    if (!rel.startsWith('objective-eval-output/')) continue;
    if (!allowed.has(rel)) errors.push(`${rel} is not in the immutable evidence manifest`);
  }
  const indexedSet = new Set(indexed);
  for (const file of parsed.files) {
    if (!indexedSet.has(file.path)) errors.push(`${file.path} is not in the git index`);
    const abs = path.join(root, file.path);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      errors.push(`${file.path} is missing`);
      continue;
    }
    if (!stat.isFile()) {
      errors.push(`${file.path} is not a regular file`);
      continue;
    }
    const sha = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    if (sha !== file.sha256) errors.push(`${file.path} sha256 ${sha} != ${file.sha256}`);
  }
  return errors;
}

export const isImmutableEvidence = (rel) => immutable.has(rel);

const forbiddenRes = [
  /^\.build\//,
  /\/node_modules\//,
  /^server\/node_modules\//,
  /^dist\//,
  /^dist-qa\//,
  /^dist-intel-compat\//,
  /^dist-qa-intel-compat\//,
  /^desktop\/(dist|test-output)\//,
  /^output\//,
  /^\.release-evidence\//,
  /^\.eval-results\//,
  /^server\/data\//,
  /^server\/\.env$/,
  /\.db(-wal|-shm)?$/,
];

export function forbiddenTrackedReason(file) {
  return forbiddenRes.some((re) => re.test(file)) ? `generated or secret path is tracked: ${file}` : null;
}

function gitZ(root, args) {
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/** Index plus unignored untracked paths. Does not walk ignored evidence or build trees. */
export function governedPaths(root) {
  return gitZ(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
}

/** Git index only, including tracked files that .gitignore would otherwise hide. */
export function indexedPaths(root) {
  return gitZ(root, ['ls-files', '-z']);
}

/** Delivery must be reproducible from the index, including new source and docs. */
export function checkDelivery(root) {
  const errors = [];
  for (const file of gitZ(root, ['ls-files', '-z', '--others', '--exclude-standard'])) {
    errors.push(`delivery: untracked file must be included or explicitly excluded: ${file}`);
  }
  for (const file of gitZ(root, ['diff', '--name-only', '-z'])) {
    errors.push(`delivery: unstaged change is absent from the index: ${file}`);
  }
  return errors;
}

export function checkHistoricalArchives(root) {
  const dir = path.join(root, 'docs/history');
  if (!fs.existsSync(dir)) return [];
  const errors = [];
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('-retired.json'))) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (path.basename(manifest.archive) !== manifest.archive || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
        throw new Error('invalid archive path or digest');
      }
      const digest = createHash('sha256').update(fs.readFileSync(path.join(dir, manifest.archive))).digest('hex');
      if (digest !== manifest.sha256) throw new Error('archive SHA-256 mismatch');
    } catch (error) {
      errors.push(`docs/history/${name}: ${error.message}`);
    }
  }
  return errors;
}

function lineCount(text) {
  if (text.length === 0) return 0;
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function destinations(text) {
  const found = [];
  const inline = /!?\[[^\]]*]\(([^)]+)\)/g;
  let m;
  while ((m = inline.exec(text))) found.push(m[1].trim());
  const ref = /^[ ]{0,3}\[[^\]]+]:[ \t]+(\S+)/gm;
  while ((m = ref.exec(text))) found.push(m[1].trim());
  return found;
}

function destinationPath(raw) {
  let dest = raw.trim();
  if (!dest) return null;
  if (dest.startsWith('<')) {
    const end = dest.indexOf('>');
    dest = end === -1 ? dest.slice(1) : dest.slice(1, end);
  } else {
    dest = dest.split(/\s+/)[0];
  }
  if (!dest || dest.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(dest)) return null;
  const hash = dest.indexOf('#');
  const filePart = hash === -1 ? dest : dest.slice(0, hash);
  if (!filePart) return null;
  try {
    return decodeURIComponent(filePart);
  } catch {
    return { error: 'bad-encoding', raw };
  }
}

function classifyTarget(root, fromFile, decoded) {
  const rootAbs = path.resolve(root);
  const lexical = path.resolve(rootAbs, path.dirname(fromFile), decoded);
  const lexRel = path.relative(rootAbs, lexical);
  if (lexRel.startsWith('..') || path.isAbsolute(lexRel)) return 'escapes';
  const rootReal = fs.realpathSync(rootAbs);
  let cursor = rootAbs;
  for (const part of lexRel.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) return 'missing';
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      let real;
      try { real = fs.realpathSync(cursor); } catch { return 'symlink'; }
      const rel = path.relative(rootReal, real);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return 'symlink';
      cursor = real;
    }
  }
  return 'ok';
}

export function checkDocumentLinks(root, files) {
  const errors = [];
  const available = new Set(files.map(file => path.resolve(root, file)));
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    if (isImmutableEvidence(file)) continue;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const text = readText(root, file);
    for (const raw of destinations(text)) {
      const decoded = destinationPath(raw);
      if (!decoded) continue;
      if (typeof decoded === 'object') {
        errors.push(`${file}: broken relative link ${raw}`);
        continue;
      }
      const kind = classifyTarget(root, file, decoded);
      if (kind === 'escapes') errors.push(`${file}: link escapes repo: ${raw}`);
      else if (kind === 'symlink') errors.push(`${file}: link symlink leaves repo: ${raw}`);
      else if (kind === 'missing') errors.push(`${file}: broken relative link ${raw}`);
      else if (kind === 'ok') {
        const target = path.resolve(root, path.dirname(file), decoded);
        if (!available.has(target) && ![...available].some(candidate => candidate.startsWith(`${target}${path.sep}`))) {
          errors.push(`${file}: relative link is outside the delivery file set: ${raw}`);
        }
      }
    }
  }
  return errors;
}

export function checkTrackedSymlinks(root, files) {
  const errors = [];
  const rootReal = fs.realpathSync(path.resolve(root));
  for (const file of files) {
    if (isImmutableEvidence(file)) continue;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    if (!fs.lstatSync(abs).isSymbolicLink()) continue;
    let real;
    try { real = fs.realpathSync(abs); } catch { errors.push(`${file}: symlink cannot be resolved`); continue; }
    const rel = path.relative(rootReal, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) errors.push(`${file}: symlink leaves repo`);
  }
  return errors;
}

const machinePath = /\/Users\/|~\/Developer\/|\/native\//;

export function checkPortableDocs(root, files) {
  const errors = [];
  for (const file of files) {
    if (!file.endsWith('.md') || isImmutableEvidence(file)) continue;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    if (machinePath.test(readText(root, file))) {
      errors.push(`${file} contains a machine-local or nested-native path assumption`);
    }
  }
  return errors;
}

const startupCopy = /scripts\/(bootstrap|dev|run-local|verify|onboarding-qa)\.sh/;

export function checkGovernance(root) {
  const errors = [];
  const readmePath = path.join(root, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, 'utf8');
    if (!readme.includes('HANDOVER.md')) errors.push('README.md must link to HANDOVER.md');
    if (startupCopy.test(readme)) errors.push('README.md must not copy startup commands; point at HANDOVER.md');
  }
  const handoverPath = path.join(root, 'HANDOVER.md');
  if (fs.existsSync(handoverPath)) {
    const text = fs.readFileSync(handoverPath, 'utf8');
    const lines = lineCount(text);
    const bytes = Buffer.byteLength(text);
    if (lines > 200) errors.push(`HANDOVER.md is ${lines} lines; budget is 200`);
    if (bytes > 20 * 1024) errors.push(`HANDOVER.md is ${bytes} bytes; budget is 20480`);
    const intro = text.split(/^## /m)[0] ?? '';
    const cjk = (intro.match(/[\u4e00-\u9fff]/g) ?? []).length;
    if (cjk > 1200) errors.push(`HANDOVER.md opening is ${cjk} Han characters; budget is 1200`);
  }
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const nonempty = text.split('\n').filter((line) => line.trim() !== '');
    if (nonempty.length > 5) errors.push(`${file} must stay a short pointer (≤ 5 non-empty lines)`);
    if (!text.includes('HANDOVER.md')) errors.push(`${file} must point at HANDOVER.md`);
  }
  return errors;
}
