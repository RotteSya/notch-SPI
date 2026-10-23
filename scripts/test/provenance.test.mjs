import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sourceIdentity, verifySourceIdentity, verifyArchivedFile } from '../cross-platform/provenance.mjs';

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nspi-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, '.gitignore'), '/output/\n');
  fs.writeFileSync(path.join(root, 'source.txt'), 'first');
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  return { root, git };
}

test('source identity binds a clean commit and rejects tracked or untracked source drift', t => {
  const { root, git } = repository(t);
  const original = sourceIdentity(root);
  assert.equal(original.dirty, false);
  assert.match(original.commit, /^[a-f0-9]{40}$/);
  verifySourceIdentity(original, root);
  fs.writeFileSync(path.join(root, 'source.txt'), 'second');
  assert.throws(() => verifySourceIdentity(original, root), /Source changed/);
  const changed = sourceIdentity(root);
  assert.equal(changed.dirty, true);
  assert.notEqual(changed.sourceSHA256, original.sourceSHA256);
  git(['add', 'source.txt']);
  assert.deepEqual(sourceIdentity(root), changed, 'Staging must not change the packaged source bytes');
  fs.writeFileSync(path.join(root, 'new.txt'), 'new source');
  assert.throws(() => verifySourceIdentity(changed, root), /Source changed/);
});

test('ignored build output does not invalidate source; deleted source does', t => {
  const { root } = repository(t);
  const original = sourceIdentity(root);
  fs.mkdirSync(path.join(root, 'output'));
  fs.writeFileSync(path.join(root, 'output', 'candidate.zip'), 'artifact');
  verifySourceIdentity(original, root);
  fs.unlinkSync(path.join(root, 'source.txt'));
  assert.throws(() => verifySourceIdentity(original, root), /Source changed/);
});

test('ZIP payload verification rejects stale, missing and duplicate entries', async () => {
  const entry = (path, contents) => ({ path, buffer: async () => Buffer.from(contents) });
  const expected = Buffer.from('new archive');
  await verifyArchivedFile([entry('resources/app.asar', 'new archive')], 'resources/app.asar', expected);
  await assert.rejects(verifyArchivedFile([entry('resources/app.asar', 'old archive')], 'resources/app.asar', expected), /Stale ZIP/);
  await assert.rejects(verifyArchivedFile([], 'resources/app.asar', expected), /Missing or duplicate/);
  await assert.rejects(verifyArchivedFile([entry('resources/app.asar', 'new archive'), entry('resources/app.asar', 'new archive')], 'resources/app.asar', expected), /Missing or duplicate/);
});
