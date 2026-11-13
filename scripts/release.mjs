#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishRelease} from './lib/release-publish.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [mode,tag,...extra] = process.argv.slice(2);
if (mode==='--help') {
  console.log('node scripts/release.mjs publish|sync vX.Y.Z\nRequires existing gh and Quark login; local config: output/release-local.json.\npublish: publish a prepared draft, then sync and read back Quark. sync: repair a published release only.');
} else {
  try {
    if (extra.length || process.env.CI || process.env.GITHUB_ACTIONS) throw Error('Local explicit release command only; not for CI or package.sh');
    const config=JSON.parse(fs.readFileSync(path.join(root,'output/release-local.json'),'utf8'));
    const state=publishRelease({root,mode,tag,config});
    console.log(`Release ${state.tag}: GitHub published; Quark upload and SHA-256 readback complete.`);
  } catch (error) { console.error(`release: ${error.message}`);process.exitCode=1; }
}
