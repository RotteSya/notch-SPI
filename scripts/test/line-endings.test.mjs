import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Windows-style Git checkout preserves generated text bytes and binary assets', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nspi-line-endings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']);
  fs.copyFileSync(new URL('../../.gitattributes', import.meta.url), path.join(root, '.gitattributes'));
  const files = {
    'Generated.swift': Buffer.from('// Generated\nlet version = "3.0"\n'),
    'VERSION.env': Buffer.from('APP_VERSION=3.0\nBUILD_NUMBER=27\n'),
    'asset.bin': Buffer.from([0, 13, 10, 255, 10]),
  };
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(root, name), bytes);
  git(['-c', 'core.autocrlf=false', 'add', '.']);
  for (const name of Object.keys(files)) fs.unlinkSync(path.join(root, name));
  git(['-c', 'core.autocrlf=true', 'checkout-index', '--all', '--force']);
  for (const [name, bytes] of Object.entries(files)) {
    assert.deepEqual(fs.readFileSync(path.join(root, name)), bytes, name);
  }
});
