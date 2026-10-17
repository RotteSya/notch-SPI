import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const repo = path.resolve(import.meta.dirname, '../..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nspi-bootstrap-'));
const stubDir = path.join(work, 'stubs');
const materialize = path.join(work, 'materialize.mjs');
const base = path.join(work, 'base');

fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(materialize, `import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
for (const [rel, meta] of Object.entries(lock.packages ?? {})) {
  if (!rel || !meta || meta.link === true || typeof meta.version !== 'string') continue;
  const pkg = path.join(dir, rel);
  fs.mkdirSync(pkg, { recursive: true });
  const name = typeof meta.name === 'string' ? meta.name : rel.split('node_modules/').pop();
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name, version: meta.version }));
}
`);
fs.writeFileSync(path.join(stubDir, 'npm'), `#!/bin/bash
set -u
printf 'npm %s\\n' "$*" >> "$NSPI_STUB_LOG"
if [[ "\${1:-}" == "ci" ]]; then
  printf 'npm-ci %s\\n' "$PWD" >> "$NSPI_STUB_LOG"
  if [[ "\${NSPI_NPM_CI_FAIL:-}" == "1" ]]; then
    echo "npm ci failed: simulated" >&2
    exit 1
  fi
  node "$NSPI_MATERIALIZE" "$PWD"
  exit $?
fi
echo "npm stub: unexpected $*" >&2
exit 1
`);
fs.writeFileSync(path.join(stubDir, 'swift'), `#!/bin/bash
set -u
printf 'swift %s\\n' "$*" >> "$NSPI_STUB_LOG"
if [[ "\${1:-}" == "--version" ]]; then
  echo "Apple Swift version 6.2"
  exit 0
fi
mkdir -p "$NSPI_FAKE_BIN/SwiftMath_SwiftMath.bundle"
if [[ "$*" == *"--show-bin-path"* ]]; then
  printf '%s\\n' "$NSPI_FAKE_BIN"
fi
exit 0
`);
fs.chmodSync(path.join(stubDir, 'npm'), 0o755);
fs.chmodSync(path.join(stubDir, 'swift'), 0o755);
fs.writeFileSync(path.join(stubDir, 'pgrep'), `#!/bin/bash
if [[ "\${NSPI_STUB_PGREP_ERROR:-}" == "1" ]]; then exit 2; fi
if [[ -n "\${NSPI_STUB_RUNNING_CLIENT_PID:-}" ]]; then
  echo "$NSPI_STUB_RUNNING_CLIENT_PID"
  exit 0
fi
if [[ "\${NSPI_STUB_RUNNING_AFTER_BUILD:-}" == "1" ]] && grep -q 'swift build' "$NSPI_STUB_LOG"; then
  echo 54321
  exit 0
fi
exit 1
`);
fs.chmodSync(path.join(stubDir, 'pgrep'), 0o755);

execFileSync('rsync', [
  '-a',
  '--exclude', 'node_modules',
  '--exclude', '.build',
  '--exclude', 'output',
  '--exclude', 'dist',
  '--exclude', 'dist-qa',
  '--exclude', '.swiftpm',
  '--exclude', '.release-evidence',
  '--exclude', '.eval-results',
  '--exclude', '.wrangler',
  `${repo}/`,
  `${base}/`,
]);
fs.rmSync(path.join(base, 'scripts/test/bootstrap.test.mjs'), { force: true });
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function scenario() {
  const dir = fs.mkdtempSync(path.join(work, 'case-'));
  execFileSync('cp', ['-a', `${base}/.`, dir]);
  const devPath = path.join(dir, 'scripts/dev.sh');
  const original = fs.readFileSync(devPath, 'utf8');
  const guard = [
    'if [[ "${NSPI_BOOTSTRAP_STUB_DEV:-}" == "1" ]]; then',
    '  printf \'dev.sh %s\\n\' "$*" >> "$NSPI_STUB_LOG"',
    '  exit 0',
    'fi',
    '',
  ].join('\n');
  const next = original.startsWith('#!')
    ? original.replace(/^#![^\n]*\n/, (line) => `${line}${guard}`)
    : `${guard}${original}`;
  fs.writeFileSync(devPath, next);
  fs.chmodSync(devPath, 0o755);
  return dir;
}

function installLocked(dir, name) {
  execFileSync(process.execPath, [materialize, path.join(dir, name)], { stdio: 'ignore' });
}

function breakVersion(dir) {
  installLocked(dir, 'server');
  installLocked(dir, 'scheduler');
  const pkg = path.join(dir, 'server/node_modules/fastify/package.json');
  const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  parsed.version = '0.0.1';
  fs.writeFileSync(pkg, JSON.stringify(parsed));
}

function partialInstall(dir) {
  const pkg = path.join(dir, 'server/node_modules/fastify');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'fastify', version: '0.0.1' }));
}

function invoke(dir, args, extra = {}) {
  const log = path.join(dir, 'stub-order.log');
  fs.writeFileSync(log, '');
  const fake = path.join(dir, 'fake-bin');
  fs.mkdirSync(fake, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST_')) delete env[key];
  }
  const result = spawnSync(path.join(dir, 'scripts/bootstrap.sh'), args, {
    cwd: dir,
    env: {
      ...env,
      PATH: `${stubDir}${path.delimiter}${process.env.PATH}`,
      NSPI_STUB_LOG: log,
      NSPI_FAKE_BIN: fake,
      NSPI_MATERIALIZE: materialize,
      NSPI_BOOTSTRAP_STUB_DEV: '1',
      ...extra,
    },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', order: fs.readFileSync(log, 'utf8') };
}

function governanceIndex(out) {
  const spec = out.indexOf('ℹ tests');
  if (spec >= 0) return spec;
  return out.indexOf('# tests');
}

function assertReachedInstall(result) {
  const out = result.stdout;
  const tests = governanceIndex(out);
  const install = out.indexOf('==> Installing server dependencies');
  const checked = out.indexOf('matches package.json and package-lock.json');
  const build = out.indexOf('==> Building client');
  assert.equal(result.stderr.includes('skipping running files'), false, result.stderr);
  assert.ok(tests >= 0 && install > tests, out);
  assert.match(out.slice(tests, install), /(?:ℹ|#) fail 0/);
  assert.ok(checked > install && build > checked, `${out}\n${result.stderr}`);
  assert.equal((out.match(/matches package.json and package-lock.json/g) ?? []).length, 2);
  const server = result.order.indexOf('npm-ci ');
  const scheduler = result.order.indexOf('npm-ci ', server + 1);
  const swift = result.order.indexOf('swift build');
  const dev = result.order.indexOf('dev.sh --smoke');
  assert.ok(server >= 0 && scheduler > server && swift > scheduler && dev > swift, result.order);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.order}`);
}

const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';

describe('bootstrap install recovery', { concurrency: 1 }, () => {
  if (!appleSilicon) {
    test('a non-Apple host stops after repository checks and before npm ci', () => {
      const dir = scenario();
      const result = invoke(dir, []);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /macOS 14\+ on Apple Silicon is required/);
      assert.ok(governanceIndex(result.stdout) >= 0, result.stdout);
      assert.match(result.stdout, /(?:ℹ|#) fail 0/);
      assert.equal(result.order.includes('npm-ci '), false);
      assert.equal(result.order.includes('swift build'), false);
      assert.equal(result.order.includes('dev.sh'), false);
      assert.equal(result.stdout.includes('==> Building client'), false);
    });

    test('check on a non-Apple host does not install', () => {
      const dir = scenario();
      const result = invoke(dir, ['--check']);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /macOS 14\+ on Apple Silicon is required/);
      assert.equal(result.order.includes('npm'), false);
      assert.equal(result.stdout.includes('Installing server'), false);
    });
    return;
  }

  test('a missing install reaches npm ci and the post-install check', () => {
    const dir = scenario();
    assert.equal(fs.existsSync(path.join(dir, 'server/node_modules')), false);
    assertReachedInstall(invoke(dir, []));
  });

  test('run refuses an existing client before installation without stopping it', () => {
    const result = invoke(scenario(), ['--run'], { NSPI_STUB_RUNNING_CLIENT_PID: '54321' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NotchSPI is already running.*54321/);
    assert.match(result.stderr, /No existing process was stopped/);
    assert.equal(result.order, '');
  });

  test('run fails closed when process discovery fails', () => {
    const result = invoke(scenario(), ['--run'], { NSPI_STUB_PGREP_ERROR: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not check existing NotchSPI processes/);
    assert.equal(result.order, '');
  });

  test('prepare remains available while another client is running', () => {
    assertReachedInstall(invoke(scenario(), [], { NSPI_STUB_RUNNING_CLIENT_PID: '54321' }));
  });

  test('run with no existing client reaches dependency installation', () => {
    const result = invoke(scenario(), ['--run'], { NSPI_NPM_CI_FAIL: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm ci failed: simulated/);
    assert.equal(result.stderr.includes('already running'), false);
    assert.equal(result.order.includes('npm-ci '), true);
  });

  test('run rechecks for a client started during preparation', () => {
    const result = invoke(scenario(), ['--run'], { NSPI_STUB_RUNNING_AFTER_BUILD: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NotchSPI is already running.*54321/);
    assert.equal(result.order.includes('swift build'), true);
    assert.equal(result.order.includes('dev.sh --smoke'), true);
    assert.equal(result.stdout.includes('==> Launching isolated development app'), false);
  });

  test('a partial install reaches npm ci and the post-install check', () => {
    const dir = scenario();
    partialInstall(dir);
    assertReachedInstall(invoke(dir, []));
  });

  test('a stale installed version reaches npm ci and the post-install check', () => {
    const dir = scenario();
    breakVersion(dir);
    assertReachedInstall(invoke(dir, []));
  });

  test('a consistent install still runs the post-install check before the build', () => {
    const dir = scenario();
    installLocked(dir, 'server');
    installLocked(dir, 'scheduler');
    assertReachedInstall(invoke(dir, []));
  });

  test('a failed npm ci stops before the Swift build and the client', () => {
    const dir = scenario();
    partialInstall(dir);
    const result = invoke(dir, [], { NSPI_NPM_CI_FAIL: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm ci failed: simulated/);
    assert.equal(result.stderr.includes('skipping running files'), false, result.stderr);
    const tests = governanceIndex(result.stdout);
    const install = result.stdout.indexOf('==> Installing server dependencies');
    assert.ok(tests >= 0 && tests < install, result.stdout);
    assert.match(result.stdout.slice(tests, install), /(?:ℹ|#) fail 0/);
    assert.equal(result.order.includes('npm-ci '), true);
    assert.equal(result.order.includes('swift build'), false);
    assert.equal(result.order.includes('dev.sh'), false);
    assert.equal(result.stdout.includes('==> Building client'), false);
  });

  test('check does not install when node_modules is missing', () => {
    const dir = scenario();
    const result = invoke(dir, ['--check']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /not installed/);
    assert.equal(result.order.includes('npm'), false);
    assert.equal(result.stdout.includes('Installing server'), false);
  });

  test('check names a missing package and does not install', () => {
    const dir = scenario();
    partialInstall(dir);
    const result = invoke(dir, ['--check']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /node_modules\/fastify is not installed|node_modules\/fastify lock/);
    assert.match(`${result.stdout}\n${result.stderr}`, /not installed/);
    assert.equal(result.order.includes('npm'), false);
  });

  test('check names a version mismatch and does not install', () => {
    const dir = scenario();
    breakVersion(dir);
    const result = invoke(dir, ['--check']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /node_modules\/fastify lock .+ installed 0\.0\.1/);
    assert.equal(result.order.includes('npm'), false);
  });

  test('check passes for a consistent tree without installing', () => {
    const dir = scenario();
    installLocked(dir, 'server');
    installLocked(dir, 'scheduler');
    const result = invoke(dir, ['--check']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /bootstrap: check passed/);
    assert.equal((result.stdout.match(/matches package.json and package-lock.json/g) ?? []).length, 2);
    assert.equal(result.order.includes('npm'), false);
    assert.equal(result.order.includes('swift build'), false);
  });
});
