#!/usr/bin/env node
// Default is read-only dry-run. Paid execution is isolated behind a campaign-bound approval.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, realpathSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, relative, dirname, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseReadingAnswerScoring} from './lib/reading-answer-scoring.mts';
import {tokenCostUpperMicros} from './lib/evaluation-budget.mts';
import {MODEL_IDS, buildRequest, pairedSchedule, executeComparison} from './lib/model-comparison.mts';
import {ComparisonBudget} from './lib/model-comparison-budget.mts';
import {runAuthorized} from './lib/model-comparison-live.mjs';

export const DEFAULT_CONFIG = 'docs/experiments/model-comparison-20261117.json';
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const manifestPaths = new Set(['Tests/Fixtures/objective-v1/manifest.json',
  '.release-evidence/2026-09-13/full-regression/corpus/manifest.json']);
const imageRoots = ['Tests/Fixtures/objective-v1/images/', '.release-evidence/2026-09-13/full-regression/corpus/images/'];

function localFile(root, path) {
  assert.equal(typeof path, 'string', 'Artifact path required');
  assert.ok(path && !isAbsolute(path) && !path.split(/[\\/]/u).includes('..') && !path.includes('\\'), 'Invalid artifact path');
  assert.ok(!/(?:^|\/)(?:\.git|\.env[^/]*|private|credentials?|secrets?)(?:\/|$)/iu.test(path), 'Sensitive paths are not evaluation inputs');
  const absolute = resolve(root, path), real = realpathSync(absolute);
  assert.equal(real, absolute, 'Symlinked evaluation inputs are not accepted');
  assert.ok(!relative(realpathSync(root), real).startsWith('..'), 'Artifact leaves project');
  return absolute;
}

function boundBytes(root, reference) {
  assert.match(reference.sha256, /^[a-f0-9]{64}$/u, 'Artifact digest required');
  const bytes = readFileSync(localFile(root, reference.path));
  assert.equal(sha(bytes), reference.sha256, `Artifact drift: ${reference.path}`);
  return bytes;
}

function sourceCase(root, item) {
  assert.ok(manifestPaths.has(item.source_manifest), 'Unexpected source manifest');
  const manifest = JSON.parse(boundBytes(root, {path:item.source_manifest, sha256:item.source_manifest_sha256}));
  const rows = manifest.fixtures ?? manifest.cases;
  const originals = rows.filter(row => row.id === item.source_case_id);
  assert.equal(originals.length, 1, 'Source case must exist exactly once');
  const source = originals[0];
  assert.equal(item.kind, source.kind, 'Question kind drift');
  assert.equal(item.language, source.language, 'Question language drift');
  assert.deepEqual(item.expected.accepted_answers, source.accepted_answers ?? [], 'Gold differs from source');
  if (manifest.fixtures) assert.equal(item.expected.state, source.expected_state, 'Expected state drift');
  else {
    assert.equal(item.expected.expectation, source.expectation, 'Expectation drift');
    if (source.answer_scoring) assert.deepEqual(item.expected.answer_scoring, source.answer_scoring, 'Scoring policy drift');
  }
  const images = source.images ?? [{file:source.image, sha256:source.sha256}];
  assert.deepEqual(item.images.map(image => ({path:image.path,sha256:image.sha256})),
    images.map(image => ({path:relative(root, resolve(root, dirname(item.source_manifest), image.file)),sha256:image.sha256})),
    'Image bytes or ordering differ from source');
}

export function budgetQuote(config, availableSlots) {
  const expected = config.budget.average_assumption;
  const rows = config.models.map(model => {
    const average = tokenCostUpperMicros(expected.input_tokens, expected.total_output_tokens,
      model.rate.inputMicrosPerMillion, model.rate.outputMicrosPerMillion);
    const reserve = tokenCostUpperMicros(model.bounds.inputTokens, model.bounds.outputTokens,
      model.reserveRate.inputMicrosPerMillion, model.reserveRate.outputMicrosPerMillion);
    return {model:model.id,average_assumption_usd_micros:average,per_physical_call_reserve_usd_micros:reserve};
  });
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  const count = config.execution_slots, attempts = 1 + config.limits.maxRetries;
  return {currency:'USD',status:'proposal_not_authorization',planned_logical_cases:count,
    retained_inventory_slots:config.planned_slots,
    comparisons:config.models.length,initial_physical_calls:count * config.models.length,
    maximum_physical_calls:count * config.models.length * attempts,
    available_initial_calls:availableSlots * config.models.length,
    average_assumption_total_micros:count * sum('average_assumption_usd_micros'),
    retry_every_call_average_total_micros:count * attempts * sum('average_assumption_usd_micros'),
    twenty_percent_planning_allowance_total_micros:Math.ceil(count * sum('average_assumption_usd_micros') * 1.2),
    all_initial_reservations_micros:count * sum('per_physical_call_reserve_usd_micros'),
    all_allowed_attempt_reservations_micros:count * attempts * sum('per_physical_call_reserve_usd_micros'),
    proposed_campaign_cap_micros:config.budget.proposed_limit_micros,
    reservation_sum_is_not_required_campaign_cap:true,
    bounds_verified:false,invoice_cost_micros:null,rows};
}

export function loadComparisonPlan(root = rootDirectory, configRelative = DEFAULT_CONFIG) {
  root = realpathSync(root);
  assert.equal(configRelative, DEFAULT_CONFIG, 'Only the reviewed local experiment is supported');
  const configBytes = readFileSync(localFile(root, configRelative)), config = JSON.parse(configBytes);
  assert.equal(config.schema_version, 1);
  assert.equal(config.paid_calls_authorized, 0, 'This entry point supports local preparation only');
  assert.equal(config.network_transport, 'gated_explicit_live');
  assert.deepEqual(config.models.map(model => model.id), MODEL_IDS, 'Candidate scope changed');
  assert.equal(config.planned_slots, 40);
  assert.equal(config.execution_slots,28);
  assert.equal(config.route.result_protocol, 'objective_v1');
  assert.equal(config.route.response_contract, 'legacy');
  for (const ref of config.freeze.sources) boundBytes(root, ref);
  const shared = JSON.parse(readFileSync(localFile(root, 'shared/prompts.json')));
  const system = shared.objectiveBriefPrompt.replaceAll('{{objectiveResultClause}}', shared.objectiveResultClause);
  assert.equal(config.prompts.system, system, 'Frozen system prompt differs from current source');
  assert.equal(config.prompts.single_task, `Analyze the attached screenshot image, then ${shared.objectiveTask}`);
  assert.equal(config.prompts.multiple_task_template, `Analyze the {{imageCount}} attached screenshot images in order, then ${shared.contextTask}`);
  const corpus = JSON.parse(boundBytes(root, config.cases_manifest));
  const materials=JSON.parse(boundBytes(root,config.materials_manifest));
  assert.equal(corpus.planned_slots, 40); assert.equal(corpus.slots.length, 40);
  assert.equal(new Set(corpus.slots.map(item => item.id)).size, 40);
  const blockers = ['paid_budget_not_approved','external_processing_not_approved',
    'model_ids_versions_prices_and_account_access_need_execution_time_verification',
    'empirical_input_bound_limitation_requires_explicit_acknowledgement'];
  let head = null;
  try { head = execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); }
  catch { blockers.push('git_identity_unavailable'); }
  if (head !== null) assert.equal(head, config.freeze.git_head, 'Git source identity drift');
  const cases = [], missingSlots = [];
  for (const item of corpus.slots) {
    assert.ok(['available','missing'].includes(item.status));
    if (item.status === 'missing') { missingSlots.push({id:item.id,reason:item.missing_reason}); continue; }
    assert.ok(item.expected && item.images.length >= 1 && item.images.length <= 4);
    sourceCase(root, item);
    for (const image of item.images) {
      assert.ok(imageRoots.some(prefix => image.path.startsWith(prefix)), 'Unexpected image source');
      const bytes = boundBytes(root, image);
      assert.ok(bytes.length <= 6 * 1024 * 1024, 'Oversized evaluation image');
      assert.ok(image.media_type === 'image/png' && bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a'
        || image.media_type === 'image/jpeg' && bytes.subarray(0,3).toString('hex') === 'ffd8ff', 'Image media type mismatch');
    }
    if (item.expected.expectation === 'answerable') parseReadingAnswerScoring(item.expected.answer_scoring, item.kind, item.expected.accepted_answers);
    assert.equal(item.external_processing, 'pending_new_campaign_review');
    cases.push(item);
  }
  assert.equal(cases.length,28);
  assert.deepEqual(materials.items.map(i=>({case_id:i.case_id,images:i.images.map(j=>j.sha256)})),
    cases.map(i=>({case_id:i.id,images:i.images.map(j=>j.sha256)})),'Material approval scope changed');
  const limitations=['28_seen_regressions_not_independent_holdout','12_inventory_slots_missing',
    'japanese_reading_chart_and_natural_screenshot_quality_gaps','no_native_client_e2e_measurement',
    'historical_receipt_not_latest_runtime_proof','no_production_replacement_acceptance'];
  const promptFor = item => ({system:config.prompts.system,
    task:item.images.length === 1 ? config.prompts.single_task : config.prompts.multiple_task_template.replaceAll('{{imageCount}}', String(item.images.length))});
  const imagesFor = item => item.images.map(image => ({base64:boundBytes(root,image).toString('base64'),mediaType:image.media_type}));
  return {config,cases,materials,missingSlots,blockers,limitations,promptFor,imagesFor,
    sourceIdentity:{head,config_sha256:sha(configBytes),cases_sha256:config.cases_manifest.sha256,sources:config.freeze.sources},
    quote:budgetQuote(config,cases.length)};
}

function syntheticAnswer(item) {
  const expected = item.expected;
  const answer = expected.expectation === 'answerable' ? expected.accepted_answers[0] : null;
  const state = expected.state ?? 'retake', reason = expected.reason ?? (state === 'ready' ? 'none' : 'missing_context');
  return (answer === null ? '' : `FINAL: ${answer}\n`) + 'NSPI_RESULT_V1: ' + JSON.stringify({v:1,kind:item.kind,state,answer,reason});
}

export async function main(args = process.argv.slice(2), root = rootDirectory) {
  const live=args.length===3&&args[0]==='--live'&&args[1]==='--authorization';
  assert.ok(args.length === 0 || args.length === 3 && args[0] === '--mock' && args[1] === '--out' || live,
    'Usage: dry-run (no args), --mock --out output/<new-directory>, or --live --authorization <campaign-record>; no run/cap/ledger overrides');
  const plan = loadComparisonPlan(root);
  if(live)return runAuthorized(plan,root,args[2]);
  const preview = {mode:args.length ? 'offline-mock' : 'dry-run',paid_calls:0,network_transport:'absent',
    source_identity:plan.sourceIdentity,available_cases:plan.cases.length,missing_slots:plan.missingSlots,
    paid_execution_blockers:plan.blockers,scope_limitations:plan.limitations,budget:plan.quote,
    schedule:pairedSchedule(plan.cases,plan.config.models.map(model => model.id)),
    parameter_mappings:plan.config.models.map(model => ({model:model.id,
      mapping:buildRequest(model.id,{system:plan.config.prompts.system,task:plan.config.prompts.single_task,
        images:[{base64:'offline-placeholder',mediaType:'image/png'}]},8192).parameterMapping}))};
  if (!args.length) return preview;
  assert.ok(/^output\/[a-zA-Z0-9/_-]+$/u.test(args[2]) && !args[2].includes('..'), 'Mock evidence must stay under project output');
  const out = resolve(root,args[2]);
  assert.ok(!existsSync(out), 'Never overwrite a previous run');
  let ancestor = dirname(out);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  assert.equal(realpathSync(ancestor), ancestor, 'Output symlink rejected');
  mkdirSync(out,{recursive:true,mode:0o700});
  writeFileSync(resolve(out,'plan.json'),JSON.stringify(preview,null,2)+'\n',{mode:0o600,flag:'wx'});
  const budget = new ComparisonBudget(resolve(out,'mock-budget.sqlite3'),
    {campaignId:`mock-only-${plan.config.id}`,limitMicros:plan.config.budget.proposed_limit_micros,rolling:true},plan.config.models);
  const byId = new Map(plan.cases.map(item => [item.id,item]));
  try {
    const result = await executeComparison({cases:plan.cases,models:plan.config.models,promptFor:plan.promptFor,imagesFor:plan.imagesFor,budget,
      limits:plan.config.limits,transport:{kind:'offline-mock',async invoke({caseId,onDelta,onUsage,signal}) {
        signal.throwIfAborted();
        const usage = {inputTokens:100,outputTokens:20};
        onDelta(syntheticAnswer(byId.get(caseId))); onUsage(usage);
        return {usage,finishReason:'stop',meteringComplete:true};
      }}});
    writeFileSync(resolve(out,'results.json'),JSON.stringify({...result,
      evidence_kind:'synthetic_pipeline_check_not_model_performance',real_model_calls:0,
      upstream_network_calls:0,invoice_cost_micros:null,client_ui_e2e_ms:null},null,2)+'\n',{mode:0o600,flag:'wx'});
    return {...preview,output_directory:args[2],mock_summary:result.summary,stopped:result.stopped,
      evidence_kind:'synthetic_pipeline_check_not_model_performance'};
  } finally { budget.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error => {
    // Do not echo arbitrary provider errors, payloads or credentials into evidence.
    process.stderr.write(`Local model comparison stopped: ${error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'input or offline execution check failed'}\n`);
    process.exitCode = 1;
  });
}
