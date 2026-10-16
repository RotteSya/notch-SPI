import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMMUTABLE_EVIDENCE,
  IMMUTABLE_EVIDENCE_MANIFEST,
  checkImmutableEvidence,
} from '../lib/repo-health-lib.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
const cli = path.resolve(import.meta.dirname, '../lib/immutable-evidence.mjs');
const attestation = 'objective-eval-output/2026-08-30T17-03-15.896Z-attestation.json';
const summaryMd = 'objective-eval-output/2026-08-30T17-03-15.896Z-summary.md';
const jsonl = 'objective-eval-output/2026-08-30T17-03-15.896Z.jsonl';

function run(root, manifestPath) {
  const args = [cli, root];
  if (manifestPath) args.push(manifestPath);
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function stagedCopy(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nspi-evidence-'));
  const manifest = JSON.parse(fs.readFileSync(IMMUTABLE_EVIDENCE_MANIFEST, 'utf8'));
  git(root, ['init']);
  for (const entry of manifest.files) {
    const abs = path.join(root, entry.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(path.join(repo, entry.path), abs);
  }
  const manifestPath = path.join(root, 'immutable-evidence.json');
  fs.writeFileSync(manifestPath, fs.readFileSync(IMMUTABLE_EVIDENCE_MANIFEST));
  if (mutate) mutate(root, manifest, manifestPath);
  git(root, ['add', '-A']);
  return { root, manifestPath };
}

test('the checked-in evidence matches the fixed manifest', () => {
  const before = fs.readFileSync(IMMUTABLE_EVIDENCE_MANIFEST);
  assert.equal(IMMUTABLE_EVIDENCE.length, 17);
  assert.deepEqual(checkImmutableEvidence(repo), []);
  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(IMMUTABLE_EVIDENCE_MANIFEST), before);
});

test('changing one byte of json, jsonl, or markdown fails and names the file', () => {
  for (const rel of [attestation, jsonl, summaryMd]) {
    const { root, manifestPath } = stagedCopy((dir) => {
      const abs = path.join(dir, rel);
      const bytes = fs.readFileSync(abs);
      bytes[0] = bytes[0] === 0x41 ? 0x42 : 0x41;
      fs.writeFileSync(abs, bytes);
    });
    const result = run(root, manifestPath);
    assert.notEqual(result.status, 0, rel);
    assert.match(result.stderr, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('a deleted file still listed by the git index fails', () => {
  const { root, manifestPath } = stagedCopy();
  fs.rmSync(path.join(root, attestation));
  const listed = execFileSync('git', ['ls-files', attestation], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(listed, attestation);
  const result = run(root, manifestPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`${attestation} is missing`));
});

test('a tracked evidence file outside the manifest fails', () => {
  const extra = 'objective-eval-output/injected-attestation.json';
  const { root, manifestPath } = stagedCopy((dir) => {
    fs.writeFileSync(path.join(dir, extra), '{"injected":true}\n');
  });
  const result = run(root, manifestPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`${extra} is not in the immutable evidence manifest`));
});

test('a non-regular evidence file fails', () => {
  const { root, manifestPath } = stagedCopy((dir) => {
    const abs = path.join(dir, attestation);
    fs.rmSync(abs);
    fs.symlinkSync('/tmp', abs);
  });
  const result = run(root, manifestPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`${attestation} is not a regular file`));
});

test('a damaged manifest, a missing digest, or a duplicate path fails', () => {
  const broken = stagedCopy((dir, _manifest, manifestPath) => {
    fs.writeFileSync(manifestPath, '{');
  });
  const brokenRun = run(broken.root, broken.manifestPath);
  assert.notEqual(brokenRun.status, 0);
  assert.match(brokenRun.stderr, /immutable-evidence.json is not valid JSON/);

  const missing = stagedCopy((dir, manifest, manifestPath) => {
    delete manifest.files[0].sha256;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  });
  const missingRun = run(missing.root, missing.manifestPath);
  assert.notEqual(missingRun.status, 0);
  assert.match(missingRun.stderr, new RegExp(`${attestation} is missing a sha256`));

  const duplicate = stagedCopy((dir, manifest, manifestPath) => {
    manifest.files.push({ ...manifest.files[0] });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  });
  const duplicateRun = run(duplicate.root, duplicate.manifestPath);
  assert.notEqual(duplicateRun.status, 0);
  assert.match(duplicateRun.stderr, new RegExp(`${attestation} is duplicated`));
});

test('the checker does not rewrite the manifest after a mismatch', () => {
  const { root, manifestPath } = stagedCopy((dir) => {
    const abs = path.join(dir, attestation);
    fs.writeFileSync(abs, Buffer.concat([fs.readFileSync(abs), Buffer.from('x')]));
  });
  const before = fs.readFileSync(manifestPath);
  const digest = createHash('sha256').update(before).digest('hex');
  const result = run(root, manifestPath);
  assert.notEqual(result.status, 0);
  assert.equal(createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'), digest);
});
