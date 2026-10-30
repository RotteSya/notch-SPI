// Offline only: reads source text; never imports application startup or calls a model.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
for (const version of ['v1', 'v2']) {
const file = new URL(`docs/experiments/latency-prompt-decision-order-${version}.json`, root);
const bundle = JSON.parse(readFileSync(file, 'utf8'));
const source = readFileSync(new URL(bundle.baseline_source, root), 'utf8');
const section = source.match(/const prompt = \{\s*system:`([\s\S]*?)`,\s*task:'([^']+)'/);
assert.ok(section, 'Default prompt source shape changed; manually review the baseline');
assert.equal(section[1], bundle.baseline.system_template, 'Baseline drift');
assert.equal(section[2], bundle.baseline.task, 'Baseline task drift');
assert.equal(createHash('sha256').update(section[1]).digest('hex'), bundle.baseline_sha256);
assert.equal(bundle.candidate.task, bundle.baseline.task);
const clauses = value => value.split(/(?<=\.)\s+/u);
const before = clauses(bundle.baseline.system_template);
let preserved = bundle.candidate.system_template;
if (version === 'v2') {
  const sourceGate = source.match(/\n2\. (Check that[^\n]*)\n3\./u)?.[1];
  assert.ok(sourceGate, 'Existing completeness gate changed');
  assert.equal(bundle.completeness_gate, sourceGate, 'Gate must be copied without weakening');
  assert.equal(bundle.insert_before_original_clause, 7);
  assert.equal(preserved.split(sourceGate).length, 2, 'Gate occurs exactly once');
  assert.ok(preserved.includes(sourceGate + '\n' + before[6]), 'Gate must precede solving/output requirements');
  preserved = preserved.replace(sourceGate + '\n', '');
}
const after = clauses(preserved);
assert.equal(before.length, 20);
assert.deepEqual([...bundle.clause_order].sort((a, b) => a - b), before.map((_, i) => i + 1));
assert.deepEqual(after, bundle.clause_order.map(i => before[i - 1]), 'Only clause reordering is allowed');
assert.equal(bundle.status, 'local_unvalidated_not_routable');
assert.equal(bundle.paid_calls_authorized, 0);
console.log(JSON.stringify({ candidate: bundle.id, clauses_preserved: before.length, task_unchanged: true,
  completeness_gate_added: version === 'v2',
  baseline_sha256: bundle.baseline_sha256,
  candidate_sha256: createHash('sha256').update(bundle.candidate.system_template).digest('hex'),
  baseline_utf8_bytes: Buffer.byteLength(bundle.baseline.system_template),
  candidate_utf8_bytes: Buffer.byteLength(bundle.candidate.system_template),
  quality_equivalence_proven: false, latency_improvement_proven: false, model_calls: 0 }, null, 2));
}

// Grounded candidates preserve the deployed baseline intact and in its original order.
for (const version of ['v3', 'v4']) {
  const bundle = JSON.parse(readFileSync(new URL(`docs/experiments/latency-prompt-grounded-${version}.json`, root)));
  const source = readFileSync(new URL(bundle.baseline_source, root), 'utf8');
  const section = source.match(/const prompt = \{\s*system:`([\s\S]*?)`,\s*task:'([^']+)'/);
  assert.equal(section?.[1], bundle.baseline.system_template);
  assert.equal(section?.[2], bundle.baseline.task);
  let gate = '';
  if (version === 'v4') {
    gate = source.match(/\n2\. (Check that[^\n]*)\n3\./u)?.[1];
    assert.ok(gate);
    assert.equal(bundle.completeness_gate, gate);
    gate += '\n';
  }
  assert.equal(bundle.candidate.system_template, gate + bundle.baseline.system_template + '\n' + bundle.grounding_clause);
  assert.equal(bundle.candidate.task, bundle.baseline.task);
  assert.equal(createHash('sha256').update(bundle.candidate.system_template).digest('hex'), bundle.candidate_sha256);
  assert.equal(bundle.status, 'local_unvalidated_not_routable');
  assert.equal(bundle.paid_calls_authorized, 0);
  console.log(JSON.stringify({candidate:bundle.id, baseline_preserved_verbatim:true,
    quality_equivalence_proven:false, latency_improvement_proven:false, model_calls:0}));
}
