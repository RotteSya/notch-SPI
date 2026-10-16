// Direct checks for the Git-aware document scanner. Fixtures are temporary repos.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  IMMUTABLE_EVIDENCE,
  checkDocumentLinks,
  checkGovernance,
  checkPortableDocs,
  checkTrackedSymlinks,
  forbiddenTrackedReason,
  governedPaths,
  indexedPaths,
  isImmutableEvidence,
} from '../lib/repo-health-lib.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-health-'));
  git(root, ['init', '-q']);
  return root;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function commit(root) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=repo-health@example.com', '-c', 'user.name=repo-health', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture']);
}

test('a broken link inside an ignored directory is not scanned', () => {
  const root = fixture();
  write(root, '.gitignore', 'output/\n.release-evidence/\n');
  write(root, 'docs/ok.md', 'See [note](../output/note.md).\n');
  write(root, 'output/note.md', 'kept locally\n');
  write(root, 'output/bad.md', 'Broken [gone](missing.md).\n');
  write(root, '.release-evidence/log.md', 'Also [gone](nope.md).\n');
  commit(root);
  const governed = governedPaths(root);
  assert.equal(governed.includes('output/bad.md'), false);
  assert.equal(governed.includes('.release-evidence/log.md'), false);
  assert.equal(governed.includes('docs/ok.md'), true);
  assert.deepEqual(checkDocumentLinks(root, governed), []);
});

test('a broken link in a tracked document fails', () => {
  const root = fixture();
  write(root, 'docs/bad.md', 'See [missing](missing.md).\n');
  commit(root);
  const errors = checkDocumentLinks(root, governedPaths(root));
  assert.equal(errors.some((line) => line.includes('docs/bad.md') && line.includes('broken relative link')), true);
});

test('a broken link in an unignored new document fails', () => {
  const root = fixture();
  write(root, 'README.md', '# fixture\n');
  commit(root);
  write(root, 'docs/new.md', 'See [missing](missing.md).\n');
  const governed = governedPaths(root);
  assert.equal(governed.includes('docs/new.md'), true);
  const errors = checkDocumentLinks(root, governed);
  assert.equal(errors.some((line) => line.startsWith('docs/new.md')), true);
});

test('a link that leaves the repository fails', () => {
  const root = fixture();
  write(root, 'docs/out.md', 'See [up](../../outside.txt) and [abs](/etc/passwd).\n');
  commit(root);
  const errors = checkDocumentLinks(root, governedPaths(root));
  assert.equal(errors.filter((line) => line.includes('link escapes repo')).length, 2);
});

test('a URL-encoded escape and a heading anchor are classified separately', () => {
  const root = fixture();
  write(root, 'docs/here.md', '# Here\n');
  write(root, 'docs/links.md', 'Stay [here](here.md#section) and leave [out](%2e%2e/%2e%2e/secret).\n');
  write(root, 'docs/spaced.md', 'See [space](<my file.md>).\n');
  write(root, 'docs/my file.md', 'present\n');
  commit(root);
  const errors = checkDocumentLinks(root, governedPaths(root));
  assert.equal(errors.some((line) => line.includes('here.md#section')), false);
  assert.equal(errors.some((line) => line.includes('my file.md')), false);
  assert.equal(errors.some((line) => line.includes('link escapes repo') && line.includes('%2e%2e')), true);
});

test('a symlink that leaves the repository fails', () => {
  const root = fixture();
  const outside = path.join(os.tmpdir(), `repo-health-outside-${process.pid}.txt`);
  fs.writeFileSync(outside, 'outside\n');
  write(root, 'docs/note.md', 'See [away](away.txt).\n');
  fs.symlinkSync(outside, path.join(root, 'docs/away.txt'));
  fs.symlinkSync(outside, path.join(root, 'leak.txt'));
  commit(root);
  const governed = governedPaths(root);
  const links = checkDocumentLinks(root, governed);
  const symlinks = checkTrackedSymlinks(root, governed);
  assert.equal(links.some((line) => line.includes('link symlink leaves repo')), true);
  assert.equal(symlinks.some((line) => line === 'leak.txt: symlink leaves repo'), true);
  fs.rmSync(outside, { force: true });
});

test('tracked databases, credentials, and generated trees are rejected', () => {
  for (const file of [
    'server/data/app.db',
    'server/data/app.db-wal',
    'server/data/app.db-shm',
    'server/.env',
    '.build/debug/app',
    'dist/NotchSPI.app/Contents/Info.plist',
    'dist-qa/NotchSPI.app',
    'server/node_modules/fastify/package.json',
    '.eval-results/run.json',
  ]) {
    assert.match(forbiddenTrackedReason(file) ?? '', /generated or secret path is tracked/);
  }
  assert.equal(forbiddenTrackedReason('server/.env.example'), null);
  assert.equal(forbiddenTrackedReason('docs/client-behavior.md'), null);
});

test('a tracked ignored database remains visible to the index scan', () => {
  const root = fixture();
  write(root, 'local.db', 'sqlite\n');
  commit(root);
  write(root, '.gitignore', '*.db\n');
  commit(root);
  assert.equal(indexedPaths(root).includes('local.db'), true);
  assert.equal(governedPaths(root).includes('local.db'), true);
});

test('the seventeen evidence files are exempt and a new sibling is not', () => {
  assert.equal(IMMUTABLE_EVIDENCE.length, 17);
  const root = fixture();
  const sample = IMMUTABLE_EVIDENCE[2];
  write(root, sample, 'Signed summary. Broken [x](missing.md) and /Users/example/path.\n');
  write(root, 'objective-eval-output/new-sibling.md', 'Broken [x](missing.md) and /Users/example/path.\n');
  commit(root);
  for (const rel of IMMUTABLE_EVIDENCE) assert.equal(isImmutableEvidence(rel), true);
  assert.equal(isImmutableEvidence('objective-eval-output/new-sibling.md'), false);
  const governed = governedPaths(root);
  const links = checkDocumentLinks(root, governed);
  const portable = checkPortableDocs(root, governed);
  assert.equal(links.some((line) => line.startsWith(sample)), false);
  assert.equal(portable.some((line) => line.startsWith(sample)), false);
  assert.equal(links.some((line) => line.startsWith('objective-eval-output/new-sibling.md')), true);
  assert.equal(portable.some((line) => line.startsWith('objective-eval-output/new-sibling.md')), true);
});

test('the live evidence set matches the allowlist exactly', () => {
  const live = execFileSync('git', ['ls-files', 'objective-eval-output'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
  assert.deepEqual(live, [...IMMUTABLE_EVIDENCE].sort());
});

test('README startup copies, long pointers, and an oversized handover fail', () => {
  const root = fixture();
  write(root, 'README.md', 'Start with `./scripts/bootstrap.sh --run`.\n');
  write(root, 'HANDOVER.md', `${'# 标题\n'.repeat(201)}`);
  write(root, 'AGENTS.md', 'one\ntwo\nthree\nfour\nfive\nsix\n');
  const errors = checkGovernance(root);
  assert.equal(errors.some((line) => line.includes('README.md must link to HANDOVER.md')), true);
  assert.equal(errors.some((line) => line.includes('must not copy startup commands')), true);
  assert.equal(errors.some((line) => line.includes('HANDOVER.md is 201 lines')), true);
  assert.equal(errors.some((line) => line.includes('AGENTS.md must stay a short pointer')), true);
  assert.equal(errors.some((line) => line.includes('AGENTS.md must point at HANDOVER.md')), true);
});

test('a handover over 20 KiB or 1200 opening Han characters fails', () => {
  const root = fixture();
  write(root, 'README.md', 'Read [HANDOVER.md](HANDOVER.md).\n');
  write(root, 'HANDOVER.md', `${'测'.repeat(1201)}\n## 后文\n`);
  let errors = checkGovernance(root);
  assert.equal(errors.some((line) => line.includes('1201 Han characters')), true);
  write(root, 'HANDOVER.md', `# 交接\n\n${'x'.repeat(20481)}\n## 后文\n`);
  errors = checkGovernance(root);
  assert.equal(errors.some((line) => /HANDOVER.md is \d+ bytes/.test(line)), true);
});

test('a compact handover and pointer pass', () => {
  const root = fixture();
  write(root, 'README.md', '工程入口是 [HANDOVER.md](HANDOVER.md)。\n');
  write(root, 'HANDOVER.md', '# 交接\n\n摘要。\n\n## 阅读规则\n\nrole: engineering\n');
  write(root, 'AGENTS.md', 'Read HANDOVER.md.\n');
  write(root, 'CLAUDE.md', 'Read HANDOVER.md.\n');
  assert.deepEqual(checkGovernance(root), []);
});
