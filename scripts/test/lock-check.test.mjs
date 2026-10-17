import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProject } from '../lib/lock-check.mjs';

const repo = path.resolve(import.meta.dirname, '../..');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nspi-lock-'));
}

function write(dir, manifest, lock, installed = {}) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  for (const [name, version] of Object.entries(installed)) {
    const pkg = path.join(dir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name, version }));
  }
}

function lockWith(rootDeps, packages, extraRoot = {}) {
  return {
    packages: {
      '': { ...extraRoot, ...rootDeps },
      ...packages,
    },
  };
}

test('manifest 2.0.0 against lock and install 1.0.0 fails', () => {
  const dir = tempProject();
  write(
    dir,
    { dependencies: { demo: '2.0.0' } },
    lockWith({ dependencies: { demo: '1.0.0' } }, { 'node_modules/demo': { version: '1.0.0' } }),
    { demo: '1.0.0' },
  );
  const errors = checkProject(dir);
  assert.ok(errors.some((line) => line.includes('dependencies.demo') && line.includes('2.0.0') && line.includes('1.0.0')));
});

test('a dependency added or removed only in the manifest fails', () => {
  const dir = tempProject();
  write(
    dir,
    { dependencies: { demo: '1.0.0', extra: '1.0.0' } },
    lockWith({ dependencies: { demo: '1.0.0' } }, { 'node_modules/demo': { version: '1.0.0' } }),
    { demo: '1.0.0' },
  );
  assert.ok(checkProject(dir).some((line) => line.includes('dependencies.extra') && line.includes('package.json')));

  const removed = tempProject();
  write(
    removed,
    { dependencies: {} },
    lockWith({ dependencies: { demo: '1.0.0' } }, { 'node_modules/demo': { version: '1.0.0' } }),
    { demo: '1.0.0' },
  );
  assert.ok(checkProject(removed).some((line) => line.includes('dependencies.demo') && line.includes('package-lock.json')));
});

test('matching manifest and lock with the wrong installed version fails', () => {
  const dir = tempProject();
  write(
    dir,
    { dependencies: { demo: '1.0.0' } },
    lockWith({ dependencies: { demo: '1.0.0' } }, { 'node_modules/demo': { version: '1.0.0' } }),
    { demo: '9.9.9' },
  );
  const errors = checkProject(dir);
  assert.ok(errors.some((line) => line.includes('node_modules/demo') && line.includes('1.0.0') && line.includes('9.9.9')));
});

test('a missing required dependency fails', () => {
  const dir = tempProject();
  write(
    dir,
    { dependencies: { demo: '1.0.0' } },
    lockWith({ dependencies: { demo: '1.0.0' } }, { 'node_modules/demo': { version: '1.0.0' } }),
    {},
  );
  assert.ok(checkProject(dir).some((line) => line.includes('node_modules/demo') && line.includes('not installed')));
});

test('damaged JSON or a missing manifest or lock fails', () => {
  const damaged = tempProject();
  fs.writeFileSync(path.join(damaged, 'package.json'), '{');
  fs.writeFileSync(path.join(damaged, 'package-lock.json'), '{}');
  assert.ok(checkProject(damaged).some((line) => line.includes('package.json is not valid JSON')));

  const missing = tempProject();
  assert.ok(checkProject(missing).some((line) => line.includes('package.json is missing')));
  assert.ok(checkProject(missing).some((line) => line.includes('package-lock.json is missing')));
});

test('reordering equivalent fields passes', () => {
  const dir = tempProject();
  const manifest = { dependencies: { b: '1.0.0', a: '1.0.0' }, engines: { node: '>=22.18.0' } };
  const lock = lockWith(
    { engines: { node: '>=22.18.0' }, dependencies: { a: '1.0.0', b: '1.0.0' } },
    {
      'node_modules/a': { version: '1.0.0' },
      'node_modules/b': { version: '1.0.0' },
    },
  );
  write(dir, manifest, lock, { a: '1.0.0', b: '1.0.0' });
  assert.deepEqual(checkProject(dir), []);
});

const hosts = [
  { platform: 'linux', arch: 'x64', otherOS: 'darwin', otherArch: 'arm64' },
  { platform: 'darwin', arch: 'arm64', otherOS: 'linux', otherArch: 'x64' },
];

function projectWithNative(host, { installNative = false, nativeVersion = '0.35.5' } = {}) {
  const dir = tempProject();
  const rel = 'node_modules/@img/sharp-host';
  const installed = { demo: '1.0.0' };
  if (installNative) installed['@img/sharp-host'] = nativeVersion;
  write(
    dir,
    { dependencies: { demo: '1.0.0' } },
    lockWith(
      { dependencies: { demo: '1.0.0' } },
      {
        'node_modules/demo': { version: '1.0.0' },
        [rel]: {
          version: '0.35.5',
          optional: true,
          os: [host.platform],
          cpu: [host.arch],
        },
        'node_modules/@img/sharp-other': {
          version: '0.35.5',
          optional: true,
          os: [host.otherOS],
          cpu: [host.otherArch],
        },
      },
    ),
    installed,
  );
  return dir;
}

for (const host of hosts) {
  test(`${host.platform} ${host.arch} allows a missing optional package for ${host.otherOS} ${host.otherArch}`, () => {
    const dir = projectWithNative(host, { installNative: true });
    assert.deepEqual(checkProject(dir, { platform: host.platform, arch: host.arch }), []);
  });

  test(`${host.platform} ${host.arch} reports a missing native package for that platform`, () => {
    const dir = projectWithNative(host);
    const errors = checkProject(dir, { platform: host.platform, arch: host.arch });
    assert.ok(errors.some((line) => line.includes('node_modules/@img/sharp-host') && line.includes('not installed')), errors.join('\n'));
    assert.equal(errors.some((line) => line.includes('@img/sharp-other')), false);
  });

  test(`${host.platform} ${host.arch} reports a native package whose installed version differs`, () => {
    const dir = projectWithNative(host, { installNative: true, nativeVersion: '9.9.9' });
    const errors = checkProject(dir, { platform: host.platform, arch: host.arch });
    assert.ok(
      errors.some((line) => line.includes('node_modules/@img/sharp-host') && line.includes('0.35.5') && line.includes('9.9.9')),
      errors.join('\n'),
    );
  });

  test(`${host.platform} ${host.arch} accepts a complete tree at the locked versions`, () => {
    const dir = projectWithNative(host, { installNative: true });
    assert.deepEqual(checkProject(dir, { platform: host.platform, arch: host.arch }), []);
  });
}

test('the running platform uses its own os and arch when none are injected', () => {
  const here = { platform: process.platform, arch: process.arch };
  const other = here.platform === 'linux' && here.arch === 'x64'
    ? { platform: 'darwin', arch: 'arm64' }
    : { platform: 'linux', arch: 'x64' };
  const absentOther = tempProject();
  write(
    absentOther,
    { dependencies: { demo: '1.0.0' } },
    lockWith(
      { dependencies: { demo: '1.0.0' } },
      {
        'node_modules/demo': { version: '1.0.0' },
        'node_modules/@img/sharp-other': {
          version: '0.35.5',
          optional: true,
          os: [other.platform],
          cpu: [other.arch],
        },
      },
    ),
    { demo: '1.0.0' },
  );
  assert.deepEqual(checkProject(absentOther), []);

  const absentHere = tempProject();
  write(
    absentHere,
    { dependencies: { demo: '1.0.0' } },
    lockWith(
      { dependencies: { demo: '1.0.0' } },
      {
        'node_modules/demo': { version: '1.0.0' },
        'node_modules/@img/sharp-host': {
          version: '0.35.5',
          optional: true,
          os: [here.platform],
          cpu: [here.arch],
        },
      },
    ),
    { demo: '1.0.0' },
  );
  const errors = checkProject(absentHere);
  assert.ok(errors.some((line) => line.includes('node_modules/@img/sharp-host') && line.includes('not installed')), errors.join('\n'));
});

test('checking the live projects does not rewrite package.json or package-lock.json', () => {
  for (const name of ['server', 'scheduler']) {
    const manifest = path.join(repo, name, 'package.json');
    const lock = path.join(repo, name, 'package-lock.json');
    const before = [fs.readFileSync(manifest), fs.readFileSync(lock)];
    checkProject(path.join(repo, name));
    assert.deepEqual([fs.readFileSync(manifest), fs.readFileSync(lock)], before);
  }
});

test('the command line checker runs when its path goes through a symlink', () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'nspi-lock-real-'));
  const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'nspi-lock-link-'));
  const link = path.join(linkParent, 'via-link');
  fs.symlinkSync(real, link);
  fs.copyFileSync(path.join(repo, 'scripts/lib/lock-check.mjs'), path.join(real, 'lock-check.mjs'));
  const missing = path.join(real, 'missing-project');
  fs.mkdirSync(missing);
  const result = spawnSync(process.execPath, [path.join(link, 'lock-check.mjs'), missing], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lock-check: missing-project: package.json is missing/);
  fs.rmSync(real, { recursive: true, force: true });
  fs.rmSync(linkParent, { recursive: true, force: true });
});
