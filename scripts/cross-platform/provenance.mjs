import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function sourceIdentity(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const commit = git(['rev-parse', 'HEAD']).trim();
  const names = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
  const files = names.map(name => {
    const file = path.join(root, name);
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) {
      if (error.code === 'ENOENT') return [name, 'deleted'];
      throw error;
    }
    if (stat.isSymbolicLink()) return [name, 'symlink', sha256(fs.readlinkSync(file))];
    assert.ok(stat.isFile(), `Unsupported source entry: ${name}`);
    return [name, (stat.mode & 0o111) !== 0 ? 'executable' : 'file', sha256(fs.readFileSync(file))];
  });
  return {
    commit,
    sourceSHA256: sha256(JSON.stringify(files)),
    fileCount: files.length,
    dirty: git(['status', '--porcelain', '--untracked-files=all']).length > 0,
  };
}
export function verifySourceIdentity(expected, root) {
  assert.deepEqual(sourceIdentity(root), expected, 'Source changed since packaging began; rebuild the candidate');
}

// ZIP readers expose file entries with buffer(). Check the bytes actually being delivered,
// rather than assuming a neighbouring unpacked directory belongs to the same build.
export async function verifyArchivedFile(entries, name, expected) {
  const matches = entries.filter(entry => entry.path === name);
  assert.equal(matches.length, 1, `Missing or duplicate ZIP entry: ${name}`);
  assert.equal(sha256(await matches[0].buffer()), sha256(expected), `Stale ZIP entry: ${name}`);
}

// Do not follow bundle symlinks: their targets, not external files, are part of the payload.
export function bundleIdentity(directory) {
  const files = [];
  function visit(relative) {
    const absolute = path.join(directory, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) files.push([relative, 'symlink', fs.readlinkSync(absolute)]);
    else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(stat.isFile(), `Unsupported bundle entry: ${relative}`);
      files.push([relative, (stat.mode & 0o111) !== 0 ? 'executable' : 'file', sha256(fs.readFileSync(absolute))]);
    }
  }
  visit('');
  return { sha256: sha256(JSON.stringify(files)), fileCount: files.length };
}
