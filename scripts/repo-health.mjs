#!/usr/bin/env node
// Drift guards for version, docs, env, and generated artifacts. Node stdlib only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkDocumentLinks,
  checkDelivery,
  checkGovernance,
  checkHistoricalArchives,
  checkPortableDocs,
  checkTrackedSymlinks,
  forbiddenTrackedReason,
  governedPaths,
  indexedPaths,
} from './lib/repo-health-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const delivery = process.argv.includes('--delivery');
if (process.argv.slice(2).some(arg => arg !== '--delivery')) {
  console.error('Usage: node scripts/repo-health.mjs [--delivery]');
  process.exit(2);
}

const fail = (msg) => errors.push(msg);

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const exists = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));

const walk = (rel, pred) => {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const relPath = path.relative(REPO_ROOT, full);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.build' || ent.name === 'dist' || ent.name === 'dist-qa') continue;
        stack.push(full);
      } else if (!pred || pred(relPath, ent.name)) {
        out.push(relPath);
      }
    }
  }
  return out;
};

// --- VERSION.env -----------------------------------------------------------------

const loadVersionEnv = () => {
  const rel = 'VERSION.env';
  if (!exists(rel)) {
    fail('VERSION.env is missing');
    return null;
  }
  const keys = new Map();
  for (const raw of read(rel).split(/\n/)) {
    const line = raw.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) {
      fail(`VERSION.env: malformed line: ${line}`);
      continue;
    }
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (keys.has(key)) fail(`VERSION.env: duplicate key ${key}`);
    keys.set(key, value);
  }
  const allowed = ['APP_VERSION', 'BUILD_NUMBER'];
  for (const key of keys.keys()) {
    if (!allowed.includes(key)) fail(`VERSION.env: unexpected key ${key}`);
  }
  for (const key of allowed) {
    if (!keys.has(key)) fail(`VERSION.env: missing ${key}`);
  }
  const app = keys.get('APP_VERSION') ?? '';
  const build = keys.get('BUILD_NUMBER') ?? '';
  if (!/^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(app)) {
    fail(`VERSION.env: APP_VERSION must look like 1.2 or 1.2.3 (got '${app}')`);
  }
  if (!/^[0-9]+$/.test(build)) {
    fail(`VERSION.env: BUILD_NUMBER must be an integer (got '${build}')`);
  }
  const tag = `v${app}`;
  if (!/^v[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(tag)) {
    fail(`Git tag format v\${APP_VERSION} is invalid: ${tag}`);
  }
  return { app, build, tag };
};

const version = loadVersionEnv();

// --- Node runtime floor ------------------------------------------------------------

let nodeMinimum = null;
if (exists('server/package.json')) {
  try {
    const pkg = JSON.parse(read('server/package.json'));
    const engine = pkg.engines?.node;
    const match = typeof engine === 'string' ? engine.match(/^>=(\d+\.\d+\.\d+)$/) : null;
    if (!match) {
      fail('server/package.json engines.node must be an exact minimum such as >=22.18.0');
    } else {
      nodeMinimum = match[1];
    }
  } catch (err) {
    fail(`server/package.json is not valid JSON: ${err.message}`);
  }
}

if (nodeMinimum !== null) {
  if (exists('scheduler/package.json')) {
    try {
      const schedulerPkg = JSON.parse(read('scheduler/package.json'));
      if (schedulerPkg.engines?.node !== `>=${nodeMinimum}`) {
        fail('scheduler/package.json engines.node must match server/package.json');
      }
    } catch (err) {
      fail(`scheduler/package.json is not valid JSON: ${err.message}`);
    }
  }
  if (exists('scripts/bootstrap.sh')) {
    const boot = read('scripts/bootstrap.sh');
    if (!boot.includes('server/package.json') || !boot.includes('scheduler/package.json')) {
      fail('scripts/bootstrap.sh must read the Node minimum from server/package.json and compare scheduler/package.json');
    }
    if (/version_ge "\$node_ver" "[0-9]/.test(boot)) {
      fail('scripts/bootstrap.sh must not hardcode the Node minimum');
    }
  }
  if (exists('.github/workflows/ci.yml')
      && !read('.github/workflows/ci.yml').includes(`node-version: '${nodeMinimum}'`)) {
    fail(`CI must exercise the declared minimum Node version ${nodeMinimum}`);
  }
  if (exists('server/package-lock.json')) {
    try {
      const lock = JSON.parse(read('server/package-lock.json'));
      if (lock.packages?.['']?.engines?.node !== `>=${nodeMinimum}`) {
        fail('server/package-lock.json root engine must match server/package.json');
      }
    } catch (err) {
      fail(`server/package-lock.json is not valid JSON: ${err.message}`);
    }
  }
}

for (const retired of ['scripts/make-dmg.sh', 'scripts/make-qa-app.sh', 'scripts/publish-quark.sh']) {
  if (exists(retired)) fail(`${retired} must not remain; use scripts/package.sh`);
}

for (const retired of [
  'Sources/NotchSPI/Cloud/MonthPass.swift', 'Sources/NotchSPI/Settings/MonthPassAccountPage.swift',
  'Tests/NotchSPITests/MonthPassTests.swift', 'server/src/month-pass-page.ts',
  'server/test/month-pass-preview.test.ts', 'scripts/preview-month-pass.mjs',
]) {
  if (exists(retired)) fail(`${retired}: retired prototype must stay in the history archive`);
}

if (exists('desktop/package.json')) {
  try {
    const pkg = JSON.parse(read('desktop/package.json'));
    const engine = pkg.engines?.node;
    const match = typeof engine === 'string' ? engine.match(/^>=(\d+\.\d+\.\d+)$/) : null;
    if (!match) fail('desktop/package.json must declare an exact Node minimum');
    const lock = JSON.parse(read('desktop/package-lock.json'));
    if (lock.packages?.['']?.engines?.node !== engine) fail('desktop lock Node engine must match its manifest');
    if (match && !read('.github/workflows/desktop.yml').includes(`node-version: "${match[1]}"`)) {
      fail('Desktop CI must exercise its declared minimum Node version');
    }
  } catch (error) {
    fail(`desktop runtime configuration: ${error.message}`);
  }
}

if (exists('scripts/package.sh')) {
  const pkg = read('scripts/package.sh');
  if (!pkg.includes('VERSION.env')) {
    fail('scripts/package.sh must read CFBundle versions from VERSION.env');
  }
  if (/VERSION="[0-9]+\.[0-9]+/.test(pkg) || /CFBundleVersion<\/key><string>[0-9]+/.test(pkg)) {
    fail('scripts/package.sh must not hardcode CFBundle version values');
  }
  if (pkg.includes('x86_64') || /universal/i.test(pkg)) {
    fail('scripts/package.sh must build arm64 only');
  }
  if (/SHORT_VERSION=.*-test/.test(pkg)) {
    fail('scripts/package.sh must keep CFBundleShortVersionString numeric in QA builds');
  }
  if (/codesign --verify[^\n]*\|\| true/.test(pkg) || /stapler validate[^\n]*\|\| true/.test(pkg)) {
    fail('scripts/package.sh must fail closed when code-signing or stapler validation fails');
  }
}

if (exists('scripts/dev.sh')) {
  const dev = read('scripts/dev.sh');
  if (!dev.includes('exec env -i')) {
    fail('scripts/dev.sh must start the local server from an empty environment');
  }
  if (!dev.includes('--smoke') || !exists('scripts/verify.sh') || !read('scripts/verify.sh').includes('--smoke')) {
    fail('the isolated local-server smoke must remain part of scripts/dev.sh and scripts/verify.sh');
  }
  for (const fixed of [
    'HOST="127.0.0.1"',
    'DB_PATH=":memory:"',
    'OFFICIAL_PROVIDER="mock"',
    'PAYMENT_PROVIDER="stub"',
    'ALLOW_STUB_TOPUP="1"',
    'export NSPI_QA_EPHEMERAL=1',
  ]) {
    if (!dev.includes(fixed)) fail(`scripts/dev.sh is missing safe local setting: ${fixed}`);
  }
  if (/HOST="\$\{HOST|OFFICIAL_PROVIDER="\$\{|DB_PATH="\$\{|PAYMENT_PROVIDER="\$\{/.test(dev)) {
    fail('scripts/dev.sh must not accept inherited host, storage, model, or payment mode');
  }
}

if (exists('Sources/NotchSPI/Update/UpdateChecker.swift')) {
  const src = read('Sources/NotchSPI/Update/UpdateChecker.swift');
  if (src.includes('devFallbackVersion')) {
    fail('UpdateChecker.swift still defines devFallbackVersion; read VERSION.env or return 0.0.0-dev');
  }
  if (/=\s*"2\.\d+"/.test(src)) {
    fail('UpdateChecker.swift still contains a hardcoded marketing version');
  }
}

// --- Markdown links, symlinks, and portable paths --------------------------------
// Governed inputs are the Git index plus unignored new files. Ignored local
// evidence and build trees are not walked.

let governed = [];
try {
  governed = delivery ? indexedPaths(REPO_ROOT) : governedPaths(REPO_ROOT);
  if (delivery) for (const message of checkDelivery(REPO_ROOT)) fail(message);
} catch (err) {
  fail(`git ls-files failed: ${err.message}`);
}
for (const message of checkDocumentLinks(REPO_ROOT, governed)) fail(message);
for (const message of checkTrackedSymlinks(REPO_ROOT, governed)) fail(message);
for (const message of checkPortableDocs(REPO_ROOT, governed)) fail(message);
for (const message of checkGovernance(REPO_ROOT)) fail(message);
for (const message of checkHistoricalArchives(REPO_ROOT)) fail(message);

// --- Env var parity --------------------------------------------------------------

const PLATFORM_ENV = new Set([
  'VERCEL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'DATABASE_URL',
  'NODE_ENV',
  'PATH',
  'HOME',
  'LOG_LEVEL',
]);

const usedEnv = new Set();
const envCall = /\b(?:envStr|envInt)\(\s*'([A-Z][A-Z0-9_]*)'/g;
const processEnv = /process\.env\.([A-Z][A-Z0-9_]*)/g;
for (const file of walk('server', (rel) => rel.endsWith('.ts') && !rel.includes(`${path.sep}test${path.sep}`))) {
  if (file.startsWith(`server${path.sep}test${path.sep}`)) continue;
  const text = read(file);
  let m;
  while ((m = envCall.exec(text))) usedEnv.add(m[1]);
  while ((m = processEnv.exec(text))) usedEnv.add(m[1]);
}

const exampleVars = new Set();
if (exists('server/.env.example')) {
  for (const raw of read('server/.env.example').split(/\n/)) {
    const line = raw.replace(/^\s*#\s*/, '');
    const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (m) exampleVars.add(m[1]);
  }
} else {
  fail('server/.env.example is missing');
}

for (const name of usedEnv) {
  if (PLATFORM_ENV.has(name)) continue;
  if (!exampleVars.has(name)) fail(`config uses ${name} but server/.env.example does not list it`);
}
for (const name of exampleVars) {
  if (PLATFORM_ENV.has(name)) continue;
  if (!usedEnv.has(name)) fail(`server/.env.example lists ${name} which is not read by server source`);
}

// --- Tracked generated artifacts -------------------------------------------------
// Read the index directly so a tracked generated file is still reported when
// .gitignore would hide it from a working-tree walk.

let trackedFiles = [];
try {
  trackedFiles = indexedPaths(REPO_ROOT);
} catch (err) {
  fail(`git ls-files failed: ${err.message}`);
}
for (const file of trackedFiles) {
  const reason = forbiddenTrackedReason(file);
  if (reason) fail(reason);
}

// --- Eval output stays under .eval-results/ --------------------------------------

if (exists('Tests/NotchSPITests/PersonalityEvaluationTests.swift')) {
  const evalSrc = read('Tests/NotchSPITests/PersonalityEvaluationTests.swift');
  if (evalSrc.includes('docs/evals')) {
    fail('PersonalityEvaluationTests.swift still writes under docs/evals');
  }
}

if (exists('.github/workflows/ci.yml')) {
  const ci = read('.github/workflows/ci.yml');
  if (/notarytool|publish-quark|NSPI_RUN_PERSONALITY_EVAL/.test(ci)) {
    fail('CI must not run notarization, netdisk publish, or the paid personality gate');
  }
}

// --- Secrets and private tool paths in tracked files -----------------------------

const secretRe = [
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /sk-live-[A-Za-z0-9]{20,}/,
  /rk_live_[A-Za-z0-9]{16,}/,
  /whsec_[A-Za-z0-9]{16,}/,
  /postgres(?:ql)?:\/\/[^:\s\/]+:[^@\s]{12,}@/,
];
const privateTool = /\$HOME\/\.claude\/skills\//;
for (const file of trackedFiles) {
  if (file.endsWith('.lock') || file.includes('node_modules')) continue;
  let text;
  try {
    text = read(file);
  } catch {
    continue;
  }
  if (file === 'server/.env.example') continue;
  for (const re of secretRe) {
    if (re.test(text)) fail(`${file} matches a live-looking secret pattern`);
  }
  if (privateTool.test(text)) fail(`${file} references a private absolute tool path`);
}

if (errors.length) {
  for (const e of errors) console.error(`FAIL  ${e}`);
  console.error(`repo-health: ${errors.length} issue(s)`);
  process.exit(1);
}

console.log('repo-health: ok');
if (version) {
  console.log(`  APP_VERSION=${version.app} BUILD_NUMBER=${version.build} tag=${version.tag}`);
}
