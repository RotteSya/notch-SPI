import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

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

const sourceFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const relative of sourceFiles) {
  const source = path.join(repo, relative);
  if (!fs.existsSync(source)) continue;
  const target = path.join(base, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, fs.statSync(source).mode);
}
execFileSync('git', ['init', '-q', base]);
execFileSync('git', ['add', '-f', '--', ...sourceFiles.filter(file => fs.existsSync(path.join(base, file)))], { cwd: base });
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

function prepareSwift(dir) {
  const checkout = path.join(dir, '.build/checkouts/fixture');
  fs.mkdirSync(checkout, {recursive:true});
  fs.writeFileSync(path.join(checkout, 'Package.swift'), '// fixture\n');
  const git = args => execFileSync('git', args, {cwd:checkout,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']); git(['add','.']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture']);
  const revision=git(['rev-parse','HEAD']);
  fs.writeFileSync(path.join(dir,'Package.resolved'),JSON.stringify({pins:[{identity:'fixture',state:{revision}}]}));
  fs.writeFileSync(path.join(dir,'.build/workspace-state.json'),JSON.stringify({object:{dependencies:[{packageRef:{identity:'fixture'},subpath:'fixture',state:{checkoutState:{revision}}}]}}));
  return checkout;
}

const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
describe('bootstrap offline defaults and explicit install', {concurrency:1}, () => {
  if (!appleSilicon) {
    test('unsupported host stops without installation or build', () => {
      for(const args of [[],['--check'],['--install']]) {
        const result=invoke(scenario(),args);
        assert.notEqual(result.status,0);
        assert.match(result.stdout+result.stderr,/macOS 14\+ on Apple Silicon is required/);
        assert.equal(result.order.includes('npm-ci '),false);
        assert.equal(result.order.includes('swift build'),false);
      }
    });
    return;
  }

  for(const args of [[],['--no-install'],['--check']]) {
    test(`${args.join(' ') || 'default'} refuses absent dependencies without installing`, () => {
      const result=invoke(scenario(),args);
      assert.notEqual(result.status,0);
      assert.match(result.stdout+result.stderr,/not installed|dependencies need preparation/);
      assert.equal(result.order.includes('npm-ci '),false);
      assert.equal(result.order.includes('swift build'),false);
    });
  }

  test('explicit install prepares only server, then builds and smokes', () => {
    const result=invoke(scenario(),['--install']);
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal((result.order.match(/npm-ci /g)||[]).length,1);
    assert.match(result.order,/npm-ci .*server/);
    assert.equal(result.order.includes('scheduler'),false);
    assert.ok(result.order.indexOf('swift build')>result.order.indexOf('npm-ci '));
    assert.ok(result.order.indexOf('dev.sh --smoke')>result.order.indexOf('swift build'));
    assert.equal(result.stdout.includes('ℹ tests'),false,'bootstrap must not recursively run the governance suite');
  });

  for(const prepare of [partialInstall,breakVersion]) {
    test(`explicit install repairs ${prepare.name}`, () => {
      const dir=scenario();prepare(dir);
      const result=invoke(dir,['--install']);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal((result.order.match(/npm-ci /g)||[]).length,1);
    });
  }

  test('failed explicit npm ci stops before build', () => {
    const result=invoke(scenario(),['--install'],{NSPI_NPM_CI_FAIL:'1'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/npm ci failed: simulated/);
    assert.equal(result.order.includes('swift build'),false);
  });

  test('existing server dependencies and Swift checkout need no scheduler install', () => {
    const dir=scenario();installLocked(dir,'server');prepareSwift(dir);
    const result=invoke(dir,[]);
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(result.order.includes('npm-ci '),false);
    const builds=result.order.split('\n').filter(x=>x.startsWith('swift build'));
    assert.equal(builds.length,2);
    for(const line of builds)assert.match(line,/--disable-automatic-resolution --skip-update/);
    assert.match(result.stdout,/Shared product sources are synchronized/);
    assert.equal(fs.existsSync(path.join(dir,'scheduler/node_modules')),false);
  });

  test('check includes Swift checkout and remains read-only', () => {
    const dir=scenario();installLocked(dir,'server');
    let result=invoke(dir,['--check']);
    assert.notEqual(result.status,0);assert.match(result.stderr,/Swift checkout preflight failed/);
    const checkout=prepareSwift(dir);
    result=invoke(dir,['--check']);assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(result.order.includes('npm'),false);assert.equal(result.order.includes('swift build'),false);
    fs.appendFileSync(path.join(checkout,'Package.swift'),'// local change\n');
    result=invoke(dir,['--check']);assert.notEqual(result.status,0);assert.match(result.stderr,/local modifications/);
    assert.match(fs.readFileSync(path.join(checkout,'Package.swift'),'utf8'),/local change/);
  });

  test('default refuses missing Swift checkout before build', () => {
    const dir=scenario();installLocked(dir,'server');const result=invoke(dir,[]);
    assert.notEqual(result.status,0);assert.match(result.stderr,/Swift dependencies need preparation/);
    assert.equal(result.order.includes('swift build'),false);
  });

  test('stale dependencies are named without implicit repair', () => {
    const dir=scenario();breakVersion(dir);const result=invoke(dir,['--check']);
    assert.notEqual(result.status,0);assert.match(result.stderr,/fastify lock .+ installed 0\.0\.1/);
    assert.equal(result.order.includes('npm'),false);
  });

  test('run refuses existing clients without stopping them', () => {
    const result=invoke(scenario(),['--run'],{NSPI_STUB_RUNNING_CLIENT_PID:'54321'});
    assert.equal(result.status,1);assert.match(result.stderr,/already running.*54321/);
    assert.match(result.stderr,/No existing process was stopped/);assert.equal(result.order,'');
  });
  test('run fails closed on process discovery error', () => {
    const result=invoke(scenario(),['--run'],{NSPI_STUB_PGREP_ERROR:'1'});
    assert.equal(result.status,1);assert.match(result.stderr,/could not check existing/);assert.equal(result.order,'');
  });
  test('prepare does not reject another running client', () => {
    const dir=scenario();installLocked(dir,'server');prepareSwift(dir);
    const result=invoke(dir,[],{NSPI_STUB_RUNNING_CLIENT_PID:'54321'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  });
  test('run rechecks after building', () => {
    const dir=scenario();installLocked(dir,'server');prepareSwift(dir);
    const result=invoke(dir,['--run'],{NSPI_STUB_RUNNING_AFTER_BUILD:'1'});
    assert.equal(result.status,1);assert.match(result.stderr,/already running.*54321/);
    assert.match(result.order,/dev.sh --smoke/);assert.equal(result.stdout.includes('Launching isolated'),false);
  });
  test('contradictory install flags and install check are rejected', () => {
    for(const args of [['--install','--no-install'],['--check','--install']]) {
      const result=invoke(scenario(),args);assert.equal(result.status,2);assert.equal(result.order,'');
    }
  });
  test('a busy smoke port preserves the listener and stops before installation', async t => {
    const listener=net.createServer();
    await new Promise((resolve,reject)=>listener.once('error',reject).listen(18787,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>listener.close(resolve)));
    const result=invoke(scenario(),['--install']);
    assert.equal(result.status,1);assert.match(result.stderr,/port 18787 is already in use/);
    assert.equal(listener.listening,true);assert.equal(result.order.includes('npm-ci '),false);
  });
  test('unsupported Node stops before importing the generator or running checks', () => {
    const nodeStub=path.join(stubDir,'node');
    fs.writeFileSync(nodeStub,'#!/bin/bash\nif [[ "${1:-}" == "-v" ]]; then echo v20.0.0; exit 0; fi\nprintf "node %s\\n" "$*" >> "$NSPI_STUB_LOG"\nexec "$NSPI_REAL_NODE" "$@"\n');
    fs.chmodSync(nodeStub,0o755);
    try {
      const result=invoke(scenario(),[],{NSPI_REAL_NODE:process.execPath});
      assert.equal(result.status,1);assert.match(result.stderr,/Node.js >= 22.18.0 is required/);
      assert.equal(result.order.includes('repo-health.mjs'),false);
      assert.equal(result.order.includes('generate.mjs'),false);
      assert.equal(result.order.includes('npm-ci '),false);
    } finally { fs.unlinkSync(nodeStub); }
  });
});
