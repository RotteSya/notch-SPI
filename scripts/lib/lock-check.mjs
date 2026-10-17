#!/usr/bin/env node
// Compare package.json, package-lock.json, and the installed tree. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DECLARED = ['dependencies', 'devDependencies', 'optionalDependencies', 'engines'];

function readJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { error: err.message };
  }
}

function canonical(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = value[key];
  return out;
}

function matchesConstraint(list, current) {
  if (!Array.isArray(list) || list.length === 0) return true;
  let sawPositive = false;
  let positiveHit = false;
  for (const entry of list) {
    const text = String(entry);
    if (text.startsWith('!')) {
      if (text.slice(1) === current) return false;
    } else {
      sawPositive = true;
      if (text === current) positiveHit = true;
    }
  }
  return sawPositive ? positiveHit : true;
}

function hasPlatformConstraint(meta) {
  return (Array.isArray(meta.os) && meta.os.length > 0) || (Array.isArray(meta.cpu) && meta.cpu.length > 0);
}

function appliesTo(meta, platform, arch) {
  return matchesConstraint(meta.os, platform) && matchesConstraint(meta.cpu, arch);
}

function declarationErrors(name, manifest, lockRoot) {
  const errors = [];
  for (const field of DECLARED) {
    const left = canonical(manifest[field]);
    const right = canonical(lockRoot[field]);
    if (left === null || right === null) {
      errors.push(`${name}: ${field} is not an object`);
      continue;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      const label = `${name}: ${field}.${key}`;
      if (!Object.hasOwn(left, key)) errors.push(`${label} is in package-lock.json and not in package.json`);
      else if (!Object.hasOwn(right, key)) errors.push(`${label} is in package.json and not in package-lock.json`);
      else if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
        errors.push(`${label} package.json ${JSON.stringify(left[key])} package-lock.json ${JSON.stringify(right[key])}`);
      }
    }
  }
  return errors;
}

export function checkProject(dir, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const root = path.resolve(dir);
  const name = path.basename(root);
  const manifestPath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const errors = [];
  if (!fs.existsSync(manifestPath)) errors.push(`${name}: package.json is missing`);
  if (!fs.existsSync(lockPath)) errors.push(`${name}: package-lock.json is missing`);
  if (errors.length) return errors;

  const manifestRead = readJson(manifestPath);
  if (manifestRead.error) return [`${name}: package.json is not valid JSON: ${manifestRead.error}`];
  const lockRead = readJson(lockPath);
  if (lockRead.error) return [`${name}: package-lock.json is not valid JSON: ${lockRead.error}`];
  const manifest = manifestRead.value;
  const lock = lockRead.value;
  const lockRoot = lock && lock.packages ? lock.packages[''] : undefined;
  if (!lockRoot || typeof lockRoot !== 'object') {
    errors.push(`${name}: package-lock.json has no root package`);
    return errors;
  }
  errors.push(...declarationErrors(name, manifest, lockRoot));

  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    errors.push(`${name}: dependencies are not installed`);
    return errors;
  }
  for (const [rel, meta] of Object.entries(lock.packages ?? {})) {
    if (!rel || meta.link === true || typeof meta.version !== 'string') continue;
    const pkgJson = path.join(root, rel, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      if (meta.optional === true && (!hasPlatformConstraint(meta) || !appliesTo(meta, platform, arch))) continue;
      errors.push(`${name}: ${rel} is not installed`);
      continue;
    }
    let installed;
    try {
      installed = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    } catch (err) {
      errors.push(`${name}: ${rel} package.json is not valid JSON: ${err.message}`);
      continue;
    }
    if (installed.version !== meta.version) {
      errors.push(`${name}: ${rel} lock ${meta.version} installed ${installed.version ?? 'unknown'}`);
    }
  }
  return errors;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const self = fs.realpathSync.native(fileURLToPath(import.meta.url));
    const given = fs.realpathSync.native(path.resolve(entry));
    return self === given;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: lock-check.mjs <project-dir>');
    process.exit(2);
  }
  const errors = checkProject(target);
  for (const error of errors) console.error(`lock-check: ${error}`);
  if (errors.length) process.exit(1);
  console.log(`lock-check: ${target} matches package.json and package-lock.json`);
}
