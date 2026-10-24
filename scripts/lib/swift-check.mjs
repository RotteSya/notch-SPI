// Read-only preflight for builds that must not fetch Swift dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function checkSwiftCheckouts(root) {
  try {
    const pins = JSON.parse(fs.readFileSync(path.join(root, 'Package.resolved'), 'utf8')).pins;
    const state = JSON.parse(fs.readFileSync(path.join(root, '.build/workspace-state.json'), 'utf8'));
    const dependencies = state.object.dependencies;
    const errors = [];
    for (const pin of pins) {
      const dependency = dependencies.find(entry => entry.packageRef.identity === pin.identity);
      const revision = pin.state.revision;
      if (!dependency || dependency.state.checkoutState?.revision !== revision) {
        errors.push(`${pin.identity}: cached Swift resolution does not match Package.resolved`);
        continue;
      }
      const checkout = path.resolve(root, '.build/checkouts', dependency.subpath);
      const relative = path.relative(path.resolve(root, '.build/checkouts'), checkout);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(path.join(checkout, 'Package.swift'))) {
        errors.push(`${pin.identity}: Swift checkout is missing`);
        continue;
      }
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      if (head !== revision) errors.push(`${pin.identity}: Swift checkout revision does not match Package.resolved`);
    }
    return errors;
  } catch (error) {
    return [`Swift checkout preflight failed: ${error.message}`];
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const errors = checkSwiftCheckouts(path.resolve(process.argv[2] ?? '.'));
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log('swift-check: existing checkouts match Package.resolved');
}
