#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { captureLatencyReport } from './lib/capture-latency.mts';
const files = process.argv.slice(2);
if (!files.length) throw new Error('Usage: node scripts/report-capture-latency.mjs <QA log> [<QA log> ...]');
console.log(JSON.stringify(captureLatencyReport(files.map(file => readFileSync(file, 'utf8'))), null, 2));
