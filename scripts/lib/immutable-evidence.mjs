#!/usr/bin/env node
// Check objective-eval-output bytes against scripts/fixtures/immutable-evidence.json.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkImmutableEvidence } from './repo-health-lib.mjs';

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = process.argv[2] ?? process.cwd();
  const manifestPath = process.argv[3];
  const errors = checkImmutableEvidence(root, manifestPath ? { manifestPath } : {});
  for (const error of errors) console.error(`immutable-evidence: ${error}`);
  if (errors.length) process.exit(1);
  console.log('immutable-evidence: ok');
}
