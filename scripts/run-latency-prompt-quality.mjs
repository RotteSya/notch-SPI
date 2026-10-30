// Default is offline preflight. Paid mode requires a separately approved, hash-bound permit.
// This checks provider quality only; it is NOT shortcut-to-answer acceptance or billing QA.
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../server/src/providers/openai.ts';
import { composeObjectiveResult, extractFinalAnswer } from '../server/src/objective-result.ts';
import { parseNoResult } from '../server/src/screen-query.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const endpoint = 'https://api.deepseek.com';

// The revision label is not a parameter contract: the checked-in production budget
// changed its token limits without renaming that label. Never infer limits from it.
export function productionComparison(experiment, bytes = readFileSync(resolve(root, 'deploy/production-model-budget.json'))) {
  const env = JSON.parse(bytes).environment;
  const expected = {
    model: env.OBJECTIVE_RESULT_V1_MODEL || env.OFFICIAL_MODEL,
    reasoning_effort: env.OBJECTIVE_RESULT_V1_DEEPSEEK_REASONING_EFFORT || env.OFFICIAL_DEEPSEEK_REASONING_EFFORT,
    max_tokens: Number(env.OBJECTIVE_RESULT_V1_MAX_TOKENS || env.OFFICIAL_MAX_TOKENS),
  };
  assert.ok(expected.model && expected.reasoning_effort && Number.isSafeInteger(expected.max_tokens) && expected.max_tokens > 0);
  return {
    profile_sha256: sha(bytes), source: 'checked_in_budget_not_live_environment',
    live_parameters_verified: false, expected,
    mismatches: Object.keys(expected).filter(key => experiment[key] !== expected[key]),
    end_to_end_equivalence: false,
  };
}

export function claimPermit(permitPath, output) {
  // A permit cannot be replayed with a different output directory after interruption.
  writeFileSync(permitPath + '.claimed', JSON.stringify({output}), {mode: 0o600, flag: 'wx', flush: true});
}

export function assess(raw, reason) {
  const noResult = parseNoResult(raw);
  if (['multiple_targets', 'unsupported_scope'].includes(reason)) {
    return noResult.reason === reason && !raw.includes('FINAL:') && !raw.includes('NSPI_RESULT_V1:');
  }
  const result = composeObjectiveResult(raw, true);
  return !noResult.present && result.parserPath === 'v1' && result.state === 'retake'
    && result.result?.reason === reason && result.result?.answer === null
    && !raw.includes('FINAL:') && result.violations.length === 0;
}

export function remainingPlan(plan) {
  assert.equal(plan.bindings.scope, 'prompt-quality-only');
  assert.deepEqual(plan.cases.map(c => c.expected_reason), ['multiple_targets', 'missing_context', 'cropped', 'unsupported_scope']);
  return {...plan, cases: plan.cases.slice(2), bindings: {...plan.bindings,
    scope: 'prompt-quality-remaining-boundaries-only', approved_calls: 4}};
}

export function completenessPlan(plan) {
  assert.equal(plan.bindings.scope, 'prompt-quality-only');
  assert.deepEqual(plan.cases.map(c => c.expected_reason), ['multiple_targets', 'missing_context', 'cropped', 'unsupported_scope']);
  const bundle = JSON.parse(readFileSync(resolve(root, 'docs/experiments/latency-prompt-decision-order-v2.json')));
  const source = readFileSync(resolve(root, bundle.baseline_source), 'utf8');
  const gate = source.match(/\n2\. (Check that[^\n]*)\n3\./u)?.[1];
  assert.ok(gate);
  assert.deepEqual(bundle.baseline, plan.bundle.baseline);
  assert.equal(bundle.candidate.task, plan.bundle.candidate.task);
  assert.equal(bundle.completeness_gate, gate);
  const anchor = bundle.baseline.system_template.split(/(?<=\.)\s+/u)[6];
  assert.equal(bundle.candidate.system_template, plan.bundle.candidate.system_template.replace(anchor, gate+'\n'+anchor));
  return {...plan, bundle, cases: plan.cases.map(c => ({...c, variants: ['B']})),
    bindings: {...plan.bindings, scope: 'prompt-quality-v2-completeness-only', approved_calls: 4,
      candidate_sha256: sha(bundle.candidate.system_template)}};
}

export function preflight(directory, remaining = false) {
  const bundle = JSON.parse(readFileSync(resolve(root, 'docs/experiments/latency-prompt-decision-order-v1.json')));
  const source = readFileSync(resolve(root, bundle.baseline_source), 'utf8');
  const matched = source.match(/const prompt = \{\s*system:`([\s\S]*?)`,\s*task:'([^']+)'/);
  assert.equal(matched?.[1], bundle.baseline.system_template, 'Baseline source drift');
  assert.equal(matched?.[2], bundle.baseline.task);
  assert.equal(sha(bundle.baseline.system_template), bundle.baseline_sha256);
  const before = bundle.baseline.system_template.split(/(?<=\.)\s+/u);
  assert.deepEqual([...bundle.clause_order].sort((a,b) => a-b), before.map((_,i) => i+1));
  assert.deepEqual(bundle.candidate.system_template.split(/(?<=\.)\s+/u), bundle.clause_order.map(i => before[i-1]));
  assert.equal(bundle.candidate.task, bundle.baseline.task);
  const manifestBytes = readFileSync(resolve(directory, 'fixtures.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.scope, 'prompt-quality-only');
  const reasons = ['multiple_targets', 'missing_context', 'cropped', 'unsupported_scope'];
  assert.deepEqual(manifest.cases.map(c => c.expected_reason), reasons);
  const cases = manifest.cases.map((c, i) => {
    assert.match(c.image, /^[a-z-]+\.png$/u);
    assert.deepEqual(c.variants, i % 2 ? ['B', 'A'] : ['A', 'B']);
    const image = readFileSync(resolve(directory, c.image));
    assert.equal(sha(image), c.sha256, 'Fixture drift');
    assert.ok(image.length < 1024 * 1024);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    return {...c, base64: image.toString('base64')};
  });
  const plan = {bundle, cases, bindings: {scope: 'prompt-quality-only', approved_calls: 8,
    endpoint, model: 'deepseek-flash', reasoning_effort: 'low', max_tokens: 2048,
    profile: 'reading_practice', language: 'zh',
    baseline_sha256: sha(bundle.baseline.system_template),
    candidate_sha256: sha(bundle.candidate.system_template), fixture_manifest_sha256: sha(manifestBytes)}};
  // This is part of the hash-bound permit, so a budget/profile change requires a
  // newly reviewed plan. It does not silently raise the paid experiment's limit.
  plan.bindings.production_comparison = productionComparison(plan.bindings);
  return remaining ? remainingPlan(plan) : plan;
}

export function dailyPlan(boundaryPlan, directory) {
  const plan = completenessPlan(boundaryPlan);
  const bytes = readFileSync(resolve(directory, 'fixtures.json'));
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.scope, 'daily-v2-provider-quality-and-timing-only');
  assert.deepEqual(manifest.cases.map(c => c.id), ['Q1','Q2','Q8','Q9','Q10','Q11']);
  assert.deepEqual(manifest.cases.map(c => c.expected_label), [null,'B','A','D','D','B']);
  const cases = manifest.cases.map(c => {
    assert.equal(c.image, c.id + '.jpg');
    assert.deepEqual(c.variants, ['B']);
    const image = readFileSync(resolve(directory, c.image));
    assert.equal(sha(image), c.sha256, 'Daily fixture drift');
    assert.equal(image.subarray(0,3).toString('hex'), 'ffd8ff');
    assert.ok(image.length < 10 * 1024 * 1024);
    return {...c, mediaType: 'image/jpeg', base64: image.toString('base64')};
  });
  return {...plan, cases, bindings: {...plan.bindings, scope: manifest.scope,
    approved_calls: 6, fixture_manifest_sha256: sha(bytes)}};
}

export function pairedDailyPlan(plan) {
  assert.ok(['daily-v2-provider-quality-and-timing-only','daily-v4-provider-quality-and-timing-only'].includes(plan.bindings.scope));
  assert.equal(plan.bindings.approved_calls, 6);
  assert.deepEqual(plan.cases.map(c => c.id), ['Q1','Q2','Q8','Q9','Q10','Q11']);
  assert.ok(plan.cases.every(c => c.variants.length === 1 && c.variants[0] === 'B'));
  return {...plan, cases: plan.cases.map((c,i) => ({...c, variants: i % 2 ? ['B','A'] : ['A','B']})),
    bindings: {...plan.bindings, scope: plan.bindings.scope === 'daily-v4-provider-quality-and-timing-only'
      ? 'daily-v4-paired-provider-only' : 'daily-v2-paired-provider-only', approved_calls: 12,
      order: 'Q1:AB,Q2:BA,Q8:AB,Q9:BA,Q10:AB,Q11:BA'}};
}

export function groundedPlan(boundaryPlan, directory) {
  const daily = dailyPlan(boundaryPlan, directory);
  const bundle = JSON.parse(readFileSync(resolve(root, 'docs/experiments/latency-prompt-grounded-v3.json')));
  assert.deepEqual(bundle.baseline, boundaryPlan.bundle.baseline);
  assert.equal(bundle.candidate.task, bundle.baseline.task);
  assert.equal(bundle.candidate.system_template, bundle.baseline.system_template + '\n' + bundle.grounding_clause);
  assert.equal(sha(bundle.candidate.system_template), bundle.candidate_sha256);
  const bindings = {...daily.bindings, scope: 'grounded-v3-screening-only', approved_calls: 4,
    profile: 'general', language: 'zh', max_tokens: 32768,
    candidate_sha256: bundle.candidate_sha256,
    boundary_fixture_manifest_sha256: boundaryPlan.bindings.fixture_manifest_sha256,
    order: 'Q11:AB,missing-context:B,cropped:B'};
  bindings.production_comparison = productionComparison(bindings);
  assert.deepEqual(bindings.production_comparison.mismatches, []);
  return {bundle, bindings, cases: [
    {...daily.cases.find(c => c.id === 'Q11'), variants: ['A', 'B']},
    ...boundaryPlan.cases.filter(c => ['missing_context', 'cropped'].includes(c.expected_reason))
      .map(c => ({...c, variants: ['B']})),
  ]};
}

export function groundedCompletenessPlan(boundaryPlan) {
  assert.equal(boundaryPlan.bindings.scope, 'prompt-quality-only');
  const bundle = JSON.parse(readFileSync(resolve(root, 'docs/experiments/latency-prompt-grounded-v4.json')));
  assert.deepEqual(bundle.baseline, boundaryPlan.bundle.baseline);
  const source = readFileSync(resolve(root, bundle.baseline_source), 'utf8');
  const gate = source.match(/\n2\. (Check that[^\n]*)\n3\./u)?.[1];
  assert.ok(gate);
  assert.equal(bundle.completeness_gate, gate);
  assert.equal(bundle.candidate.system_template, gate + '\n' + bundle.baseline.system_template + '\n' + bundle.grounding_clause);
  assert.equal(bundle.candidate.task, bundle.baseline.task);
  assert.equal(sha(bundle.candidate.system_template), bundle.candidate_sha256);
  const bindings = {...boundaryPlan.bindings, scope:'grounded-v4-boundaries-only', approved_calls:4,
    profile:'general', language:'zh', max_tokens:32768, candidate_sha256:bundle.candidate_sha256};
  bindings.production_comparison = productionComparison(bindings);
  assert.deepEqual(bindings.production_comparison.mismatches, []);
  return {bundle, bindings, cases:boundaryPlan.cases.map(c => ({...c,variants:['B']}))};
}

export function groundedDailyPlan(boundaryPlan, directory) {
  const daily = dailyPlan(boundaryPlan, directory);
  const grounded = groundedCompletenessPlan(boundaryPlan);
  return {...grounded, cases:daily.cases, bindings:{...grounded.bindings,
    scope:'daily-v4-provider-quality-and-timing-only', approved_calls:6,
    fixture_manifest_sha256:daily.bindings.fixture_manifest_sha256}};
}

export function assessDaily(raw, item) {
  const result = composeObjectiveResult(raw, true);
  if (parseNoResult(raw).present || result.parserPath !== 'v1' || result.violations.length
      || !['ready','review'].includes(result.state) || !result.finalAnswer) return false;
  // This is a screening gate, not proof of reasoning correctness or manual acceptance.
  if (item.expected_label === null) return true;
  const label = /^([A-F])(?:$|[.．、:：\s（(])/u.exec(result.finalAnswer.trim())?.[1];
  return label === item.expected_label;
}

export function assessLegacy(raw, expected) {
  const result = composeObjectiveResult(raw, true);
  if (parseNoResult(raw).present || result.parserPath !== 'v1' || result.violations.length
      || result.state !== expected.state || result.result?.reason !== expected.reason) return false;
  if (expected.kind && result.result.kind !== expected.kind) return false;
  if (expected.state === 'retake') return result.result.answer === null && !raw.includes('FINAL:');
  if (!result.finalAnswer) return false;
  // Explicit fixture answers, not arbitrary prose judged equivalent by its first letter.
  const normalize = text => text.normalize('NFKC').replace(/\s+/gu, '').trim();
  return !expected.answers || [result.finalAnswer, extractFinalAnswer(raw)].every(value =>
    value && expected.answers.some(answer => normalize(answer) === normalize(value)));
}

export function legacyScreeningPlan(boundaryPlan, directory) {
  const daily = dailyPlan(boundaryPlan, directory);
  const source = JSON.parse(readFileSync(resolve(root, 'shared/prompts.json')));
  const bundle = JSON.parse(readFileSync(resolve(root, 'docs/experiments/latency-legacy-objective-grounding-v1.json')));
  const baseline = {system: source.objectiveBriefPrompt.replace('{{objectiveResultClause}}', source.objectiveResultClause),
    task: 'Analyze the attached screenshot image, then ' + source.objectiveTask};
  assert.deepEqual(bundle.baseline, baseline);
  assert.deepEqual(bundle.candidate, {system: bundle.grounding + '\n\n' + baseline.system, task: baseline.task});
  assert.equal(bundle.route.response_contract, 'legacy');
  const cases = [{...daily.cases.find(c => c.id === 'Q11'), variants:['A','B'],
    legacy_expected:{state:'ready', reason:'none', kind:'single_choice', answers:['B','B. イだけ','B：イだけ','B、イだけ','B イだけ','B（イだけ）']}}];
  for (const id of ['missing-context','cropped-options','unsupported-essay']) {
    const item = boundaryPlan.cases.find(c => c.id === id);
    assert.ok(item);
    cases.push({...item, variants:['B'], legacy_expected: id === 'unsupported-essay'
      ? {state:'review', reason:'unsupported', kind:'other'}
      : {state:'retake', reason: item.expected_reason}});
  }
  const bindings = {...daily.bindings, scope:'legacy-objective-grounding-screening-only', approved_calls:5,
    profile:'general', language:'zh', max_tokens:32768, response_contract:'legacy', result_protocol:'objective_v1',
    baseline_sha256:sha(JSON.stringify(bundle.baseline)), candidate_sha256:sha(JSON.stringify(bundle.candidate)),
    boundary_fixture_manifest_sha256:boundaryPlan.bindings.fixture_manifest_sha256,
    cases_sha256:sha(JSON.stringify(cases.map(({base64,...item}) => item))),
    order:'Q11:AB,missing-context:B,cropped-options:B,unsupported-essay:B'};
  bindings.production_comparison = productionComparison(bindings);
  assert.deepEqual(bindings.production_comparison.mismatches, []);
  return {cases, bindings, bundle: {baseline:{system_template:baseline.system,task:baseline.task},
    candidate:{system_template:bundle.candidate.system,task:bundle.candidate.task}}};
}

export function legacyRemainingPlan(plan, previousDirectory) {
  assert.equal(plan.bindings.scope, 'legacy-objective-grounding-screening-only');
  assert.equal(plan.bindings.approved_calls, 5);
  const priorPermit = JSON.parse(readFileSync(resolve(previousDirectory, 'permit.json')));
  assert.deepEqual(priorPermit, plan.bindings, 'Original batch must match the current frozen plan');
  const bytes = readFileSync(resolve(previousDirectory, 'dispatches.jsonl'));
  const sent = bytes.toString().trim().split('\n').map(line => JSON.parse(line));
  const order = plan.cases.flatMap(item => item.variants.map(variant => ({id:item.id,variant})));
  assert.equal(sent.length, 4, 'Only the four-call stopped batch can resume');
  const records = sent.map((record, index) => {
    assert.deepEqual(record, {ordinal:index+1,...order[index]});
    const bytes = readFileSync(resolve(previousDirectory, `${index+1}.json`));
    const result = JSON.parse(bytes);
    assert.equal(result.passed, index < 3);
    assert.equal(result.id, record.id); assert.equal(result.variant, record.variant);
    return sha(bytes);
  });
  const cases = plan.cases.slice(-1);
  assert.equal(cases[0].id, 'unsupported-essay');
  assert.deepEqual(cases[0].variants, ['B']);
  return {...plan,cases,bindings:{...plan.bindings,approved_calls:1,order:'unsupported-essay:B',
    cases_sha256:sha(JSON.stringify(cases.map(({base64,...item}) => item))),
    previous_dispatches_sha256:sha(bytes),previous_results_sha256:records}};
}

export function legacyProtocolPlan(plan) {
  assert.equal(plan.bindings.scope, 'legacy-objective-grounding-screening-only');
  assert.equal(plan.bindings.approved_calls, 5);
  const bundle = JSON.parse(readFileSync(resolve(root, 'docs/experiments/latency-legacy-objective-protocol-v2.json')));
  assert.equal(bundle.baseline.system, plan.bundle.baseline.system_template);
  assert.equal(bundle.baseline.task, plan.bundle.baseline.task);
  const prefix = bundle.baseline.system.slice(bundle.baseline.system.indexOf('FINAL=answer.'));
  assert.ok(prefix.startsWith('FINAL=answer.'));
  assert.equal(bundle.protocol_prefix, prefix);
  assert.equal(bundle.candidate.system, prefix+'\n\n'+plan.bundle.candidate.system_template);
  assert.equal(bundle.candidate.task, plan.bundle.candidate.task);
  const cases = ['unsupported-essay','Q11'].map(id => {
    const item = plan.cases.find(c => c.id === id); assert.ok(item); return item;
  });
  return {...plan,cases,bundle:{...plan.bundle,candidate:{system_template:bundle.candidate.system,task:bundle.candidate.task}},
    bindings:{...plan.bindings,approved_calls:3,order:'unsupported-essay:B,Q11:AB',
      candidate_sha256:sha(JSON.stringify(bundle.candidate)),
      cases_sha256:sha(JSON.stringify(cases.map(({base64,...item}) => item)))}};
}

export function legacyBaselineBoundaryPlan(plan) {
  assert.equal(plan.bindings.scope, 'legacy-objective-grounding-screening-only');
  assert.equal(plan.bindings.approved_calls, 5);
  const item = plan.cases.find(c => c.id === 'unsupported-essay');
  assert.ok(item);
  assert.deepEqual(item.legacy_expected, {state:'review',reason:'unsupported',kind:'other'});
  const cases = [{...item,variants:['A']}];
  return {...plan,cases,bindings:{...plan.bindings,approved_calls:1,order:'unsupported-essay:A',
    purpose:'baseline_failure_attribution_only',
    cases_sha256:sha(JSON.stringify(cases.map(({base64,...record}) => record)))}};
}

export function legacyDailyPairedPlan(legacy, daily) {
  assert.equal(legacy.bindings.scope, 'legacy-objective-grounding-screening-only');
  assert.equal(legacy.bindings.approved_calls, 5);
  assert.equal(daily.bindings.scope, 'daily-v2-provider-quality-and-timing-only');
  assert.deepEqual(daily.cases.map(c => c.id), ['Q1','Q2','Q8','Q9','Q10','Q11']);
  assert.deepEqual(daily.cases.map(c => c.expected_label), [null,'B','A','D','D','B']);
  const cases = daily.cases.map((item,index) => ({...item,
    ...(item.id === 'Q1' ? {expected_label:'D',reference_status:'manual_synonym_reference_not_official_key'} : {}),
    variants:index % 2 ? ['B','A'] : ['A','B']}));
  return {...legacy,cases,bindings:{...legacy.bindings,scope:'daily-legacy-grounded-paired-only',approved_calls:12,
    fixture_manifest_sha256:daily.bindings.fixture_manifest_sha256,
    cases_sha256:sha(JSON.stringify(cases.map(({base64,...item}) => item))),
    order:'Q1:AB,Q2:BA,Q8:AB,Q9:BA,Q10:AB,Q11:BA'}};
}

export function assessLegacyDaily(raw, item) {
  const result = composeObjectiveResult(raw, true);
  return result.state === 'ready' && result.result?.kind === 'single_choice'
    && result.result.reason === 'none' && assessDaily(raw, item);
}

export function completedFinal(raw, ended = false) {
  // A chunk containing just FINAL: or a partial answer is not a completed answer line.
  const complete = ended ? raw : raw.slice(0, raw.lastIndexOf('\n') + 1);
  return extractFinalAnswer(complete) !== null;
}

// Local diagnostics only. Provider callbacks occur per parsed SSE event, not per token
// or network packet. Aggregates cannot identify whether a gap originated at the vendor
// or in transport; they expose pauses that first-event-only timing previously discarded.
export function upstreamCadence(clock = () => performance.now()) {
  let closed = false;
  let lastEvent = null;
  let firstEvent = null;
  let answerAt = null;
  let events = 0;
  let reasoningEvents = 0;
  let maxGap = 0;
  let gapsOver250 = 0;
  let gapsOver1000 = 0;
  const gap = duration => {
    maxGap = Math.max(maxGap, duration);
    if (duration > 250) gapsOver250++;
    if (duration > 1000) gapsOver1000++;
  };
  return {
    mark(stage) {
      if (closed || !['upstreamFirstEvent', 'upstreamFirstReasoning', 'upstreamFirstAnswer'].includes(stage)) return;
      const now = clock();
      if (stage === 'upstreamFirstEvent') {
        if (lastEvent !== null) gap(now - lastEvent);
        firstEvent ??= now;
        lastEvent = now;
        events++;
      } else if (stage === 'upstreamFirstReasoning') reasoningEvents++;
      else { answerAt = now; closed = true; }
    },
    snapshot() {
      const end = answerAt ?? clock();
      return {
        answer_observed: closed,
        parsed_events_before_answer: events,
        reasoning_events_before_answer: reasoningEvents,
        first_event_to_end_ms: firstEvent === null ? null : end - firstEvent,
        max_inter_event_gap_ms: events < 2 ? null : maxGap,
        gaps_over_250ms: gapsOver250,
        gaps_over_1000ms: gapsOver1000,
        last_event_to_end_ms: lastEvent === null ? null : end - lastEvent,
      };
    },
  };
}

export async function execute(plan, permit, output, provider) {
  assert.deepEqual(permit, plan.bindings, 'Permit must match the complete frozen plan');
  assert.equal(plan.cases.reduce((count, item) => count + item.variants.length, 0), permit.approved_calls,
    'Plan count must match the permit before any dispatch');
  assert.ok(['general', 'spi', 'reading_practice'].includes(permit.profile), 'Explicit approved profile required');
  assert.ok(['zh', 'ja', 'en'].includes(permit.language), 'Explicit approved language required');
  assert.ok([2048, 32768].includes(permit.max_tokens), 'Explicit approved token limit required');
  assert.ok(output.startsWith('/tmp/') || output.startsWith('/private/tmp/'));
  // Exclusive directory creation: interrupted or completed runs cannot silently restart.
  mkdirSync(output, {mode: 0o700});
  writeFileSync(resolve(output, 'permit.json'), JSON.stringify(permit), {mode: 0o600, flag: 'wx'});
  let ordinal = 0;
  for (const item of plan.cases) for (const variant of item.variants) {
    assert.ok(ordinal < permit.approved_calls);
    const record = {ordinal: ++ordinal, id: item.id, variant};
    // Count before dispatch; errors and interruption never refund this local request budget.
    appendFileSync(resolve(output, 'dispatches.jsonl'), JSON.stringify(record)+'\n', {mode: 0o600, flush: true});
    const prompt = variant === 'A' ? plan.bundle.baseline : plan.bundle.candidate;
    let raw = '';
    const started = performance.now();
    const timing = {first_content_ms: null, completed_final_line_ms: null, response_complete_ms: null};
    const providerTiming = {};
    const cadence = upstreamCadence();
    try {
      const usage = await provider.stream({system: prompt.system_template.replaceAll('${profile}', permit.profile)
        .replaceAll('${language}', permit.language), task: prompt.task,
        images: [{mediaType: item.mediaType ?? 'image/png', base64: item.base64}], reasoningEffort: 'low', maxTokens: permit.max_tokens,
        onTiming: stage => {
          cadence.mark(stage);
          if (['upstreamRequest','upstreamHeaders','upstreamFirstEvent','upstreamFirstReasoning','upstreamFirstAnswer'].includes(stage)
              && providerTiming[stage] === undefined) providerTiming[stage] = performance.now() - started;
        }},
      text => {
        raw += text;
        if (Buffer.byteLength(raw) > 65536) throw new Error('Output size limit');
        if (text.trim() && timing.first_content_ms === null) timing.first_content_ms = performance.now() - started;
        if (timing.completed_final_line_ms === null && completedFinal(raw)) timing.completed_final_line_ms = performance.now() - started;
      }, AbortSignal.timeout(120000));
      timing.response_complete_ms = performance.now() - started;
      if (timing.completed_final_line_ms === null && completedFinal(raw, true)) timing.completed_final_line_ms = timing.response_complete_ms;
      const legacyDaily = plan.bindings.scope === 'daily-legacy-grounded-paired-only';
      const daily = legacyDaily || ['daily-v2-provider-quality-and-timing-only', 'daily-v2-paired-provider-only', 'daily-v4-provider-quality-and-timing-only', 'daily-v4-paired-provider-only'].includes(plan.bindings.scope)
        || (plan.bindings.scope === 'grounded-v3-screening-only' && item.id === 'Q11');
      const usageValid = Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 && usage.inputTokens <= 6000
        && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 && usage.outputTokens <= permit.max_tokens;
      const legacy = plan.bindings.scope === 'legacy-objective-grounding-screening-only';
      const passed = usageValid && usage.finishReason === 'stop' && (legacy ? assessLegacy(raw, item.legacy_expected)
        : legacyDaily ? assessLegacyDaily(raw, item) : daily ? assessDaily(raw, item) : assess(raw, item.expected_reason));
      // Quality evidence stays in this private directory, never in performance logs or console.
      writeFileSync(resolve(output, `${ordinal}.json`), JSON.stringify({...record, usage, passed, raw, timing, provider_timing_ms:providerTiming, upstream_cadence:cadence.snapshot(), manual_quality_review_required: daily || legacy}), {mode: 0o600, flag: 'wx'});
      if (!passed) return {calls: ordinal, passed: false, stopped: 'quality_gate'};
    } catch {
      writeFileSync(resolve(output, `${ordinal}-error.json`), JSON.stringify({...record, failed: true, provider_timing_ms:providerTiming, upstream_cadence:cadence.snapshot()}), {mode: 0o600, flag: 'wx'});
      return {calls: ordinal, passed: false, stopped: 'request_error_no_retry'};
    }
  }
  return {calls: ordinal, passed: true, end_to_end_acceptance: false};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, mode, permitPath, output, dailyDirectory, previousDirectory] = process.argv.slice(2);
  assert.ok(directory, 'Provide the private fixture directory');
  let plan = preflight(resolve(directory), mode === '--preflight-remaining' || mode === '--run-remaining');
  if (['--preflight-legacy-protocol','--run-legacy-protocol','--preflight-legacy','--run-legacy','--preflight-legacy-remaining','--run-legacy-remaining'].includes(mode)) {
    assert.ok(dailyDirectory, 'Provide the frozen daily fixture directory as argument five');
    plan = legacyScreeningPlan(plan, resolve(dailyDirectory));
    if (mode.endsWith('-protocol')) plan = legacyProtocolPlan(plan);
    if (mode.endsWith('-remaining')) {
      assert.ok(previousDirectory);
      plan = legacyRemainingPlan(plan, resolve(previousDirectory));
    }
  }
  if (['--preflight-v4-daily','--run-v4-daily','--preflight-v4-paired','--run-v4-paired'].includes(mode)) {
    assert.ok(dailyDirectory, 'Provide the frozen daily fixture directory as argument five');
    plan = groundedDailyPlan(plan, resolve(dailyDirectory));
    if (mode.endsWith('-paired')) plan = pairedDailyPlan(plan);
  }
  if (mode === '--preflight-grounded-completeness' || mode === '--run-grounded-completeness') {
    plan = groundedCompletenessPlan(plan);
  }
  if (mode === '--preflight-grounded' || mode === '--run-grounded') {
    assert.ok(dailyDirectory, 'Provide the frozen daily fixture directory as argument five');
    plan = groundedPlan(plan, resolve(dailyDirectory));
  }
  if (mode === '--preflight-completeness' || mode === '--run-completeness') plan = completenessPlan(plan);
  if (['--preflight-daily','--run-daily','--preflight-paired-daily','--run-paired-daily'].includes(mode)) {
    assert.ok(dailyDirectory, 'Provide the frozen daily fixture directory as argument five');
    plan = dailyPlan(plan, resolve(dailyDirectory));
    if (mode.endsWith('-paired-daily')) plan = pairedDailyPlan(plan);
  }
  if (mode === undefined || mode === '--preflight-legacy-protocol' || mode === '--preflight-legacy-remaining' || mode === '--preflight-legacy' || mode === '--preflight' || mode === '--preflight-remaining' || mode === '--preflight-completeness' || mode === '--preflight-daily' || mode === '--preflight-paired-daily' || mode === '--preflight-grounded' || mode === '--preflight-grounded-completeness' || mode === '--preflight-v4-daily' || mode === '--preflight-v4-paired') {
    console.log(JSON.stringify({...plan.bindings, proposed_calls: plan.bindings.approved_calls,
      approved_calls: 0, mode: 'offline', model_calls: 0}, null, 2));
  } else {
    assert.ok(mode === '--run-legacy-protocol' || mode === '--run-legacy-remaining' || mode === '--run-legacy' || mode === '--run' || mode === '--run-remaining' || mode === '--run-completeness' || mode === '--run-daily' || mode === '--run-paired-daily' || mode === '--run-grounded' || mode === '--run-grounded-completeness' || mode === '--run-v4-daily' || mode === '--run-v4-paired');
    assert.ok(permitPath && output, 'Paid run requires a reviewed permit and new private output directory');
    const permit = JSON.parse(readFileSync(permitPath));
    assert.deepEqual(permit, plan.bindings);
    const key = readFileSync(0, 'utf8').trim();
    assert.ok(key.length > 10 && !/\s/u.test(key), 'Supply the existing provider key through stdin only');
    claimPermit(resolve(permitPath), resolve(output));
    const transport = globalThis.fetch;
    globalThis.fetch = (url, options) => {
      assert.equal(String(url), endpoint + '/chat/completions');
      return transport(url, {...options, redirect: 'error'});
    };
    const provider = new OpenAIProvider(key, endpoint, 'deepseek-flash', plan.bindings.max_tokens,
      {name: 'deepseek', endpointPath: 'chat/completions', extraBody: {thinking: {type: 'enabled'}, reasoning_effort: 'low'}});
    console.log(JSON.stringify(await execute(plan, permit, resolve(output), provider)));
  }
}
