// Offline only. Fail closed if this candidate ceases to match the actual client template.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const bundle = read('docs/experiments/latency-legacy-objective-grounding-v1.json');
const prompts = read('shared/prompts.json');
const exported = read('docs/latency-actual-prompt-2026-10-30.json');
const sha = text => createHash('sha256').update(text).digest('hex');
const expected = {
  system: prompts.objectiveBriefPrompt.replace('{{objectiveResultClause}}', prompts.objectiveResultClause),
  task: 'Analyze the attached screenshot image, then ' + prompts.objectiveTask,
};
assert.deepEqual(bundle.baseline, expected, 'Actual legacy baseline drifted; do not run the experiment');
for (const key of ['system', 'task']) {
  assert.equal(sha(expected[key]), exported[`legacy_${key}_sha256`], 'Frozen Swift export must match');
  assert.equal(sha(expected[key]), bundle.baseline_sha256[key]);
}
assert.deepEqual(bundle.candidate, {system: bundle.grounding + '\n\n' + expected.system, task: expected.task});
assert.equal(bundle.route.response_contract, 'legacy');
assert.equal(bundle.route.result_protocol, 'objective_v1');
assert.equal(bundle.paid_calls_authorized, 0);
assert.equal(bundle.status, 'local_unvalidated_not_routable');
console.log(JSON.stringify({baseline_matches_frozen_swift_export: true, original_instructions_preserved: true,
  model_calls: 0, latency_improvement_proven: false, quality_equivalence_proven: false}));
