#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { captureLatencyReport } from './lib/capture-latency.mts';
const args = process.argv.slice(2), files = [], options = new Map();
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (value.startsWith('--')) {
    if (value === '--draw-stage') {
      if (options.has(value) || !['renderStarted','renderCompleted'].includes(args[index+1])) throw new Error('Invalid or duplicate draw stage');
      options.set(value,args[++index]); continue;
    }
    if (!['--target-ms','--single-limit-ms'].includes(value) || options.has(value)
        || !/^\d+(?:\.\d+)?$/.test(args[index+1] ?? '')) throw new Error('Invalid or duplicate latency option');
    options.set(value,Number(args[++index]));
  } else files.push(value);
}
if (!files.length) throw new Error('Usage: node scripts/report-capture-latency.mjs [--target-ms 6000 --single-limit-ms 10000 --draw-stage renderCompleted] <QA log> [<QA log> ...]');
const target = options.get('--target-ms') ?? 2000;
console.log(JSON.stringify(captureLatencyReport(files.map(file => readFileSync(file, 'utf8')),
  target,options.get('--single-limit-ms') ?? target,options.get('--draw-stage') ?? 'renderStarted'), null, 2));
