import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { sourceIdentity, verifySourceIdentity, bundleIdentity, sha256 } from './provenance.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [command, argument, appArgument, dmgArgument] = process.argv.slice(2);
if (command === 'begin') {
  assert.ok(['qa', 'release'].includes(argument), 'Expected qa or release');
  const source = sourceIdentity(root);
  const candidateID = `${source.commit.slice(0, 12)}-${source.sourceSHA256.slice(0, 12)}-${randomUUID()}`;
  const directory = path.join(root, 'output/mac-builds', candidateID);
  fs.mkdirSync(directory, { recursive: true });
  const provenance = {
    schemaVersion: 1, candidateID, source, mode: argument,
    builtAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, node: process.version },
    ci: process.env.GITHUB_ACTIONS === 'true' ? {
      repository: process.env.GITHUB_REPOSITORY,
      runID: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    } : null,
  };
  fs.writeFileSync(path.join(directory, 'build-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  console.log(directory);
} else if (command === 'finish') {
  const directory = path.resolve(argument);
  const app = path.resolve(appArgument);
  const provenance = JSON.parse(fs.readFileSync(path.join(directory, 'build-provenance.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/build-provenance.json'))), provenance);
  verifySourceIdentity(provenance.source, root);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  const appPayload = bundleIdentity(app);
  let dmg;
  if (dmgArgument) {
    const dmgPath = path.resolve(dmgArgument);
    const mount = fs.mkdtempSync(path.join(directory, 'mount-'));
    let attached = false;
    try {
      execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmgPath], { stdio: 'pipe' });
      attached = true;
      const deliveredApp = path.join(mount, path.basename(app));
      assert.deepEqual(bundleIdentity(deliveredApp), appPayload, 'DMG contains a different App');
      execFileSync('codesign', ['--verify', '--deep', '--strict', deliveredApp], { stdio: 'pipe' });
      dmg = { path: path.relative(root, dmgPath), bytes: fs.statSync(dmgPath).size, sha256: sha256(fs.readFileSync(dmgPath)) };
    } finally {
      if (attached) execFileSync('hdiutil', ['detach', mount], { stdio: 'pipe' });
      fs.rmdirSync(mount);
    }
  }
  verifySourceIdentity(provenance.source, root);
  const result = {
    schemaVersion: 1, provenance, platform: 'macOS arm64',
    app: { path: path.relative(root, app), ...appPayload },
    dmg: dmg ?? null,
    checks: { sourceUnchanged: true, appSignatureValid: true, dmgPayloadMatches: dmg ? true : null },
    acceptance: { gatekeeper: 'not-verified', installation: 'not-verified', signedUpdate: 'not-verified' },
    verifiedAt: new Date().toISOString(),
  };
  const output = dmg ? path.dirname(path.resolve(dmgArgument)) : path.dirname(app);
  fs.writeFileSync(path.join(output, 'delivery-manifest.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error('Usage: mac-provenance.mjs begin qa|release OR finish <provenance-directory> <app> [dmg]');
}
