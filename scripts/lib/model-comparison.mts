import {createHash, randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {composeObjectiveResult} from '../../server/src/objective-result.ts';
import {parseNoResult} from '../../server/src/screen-query.ts';
import {parseReadingAnswerScoring, readingAnswerHit} from './reading-answer-scoring.mts';
import type {ReadingAnswerScoring} from './reading-answer-scoring.mts';
import {ComparisonBudget, MODEL_IDS, modelCallUpperMicros} from './model-comparison-budget.mts';
import type {AttemptPurpose, ComparisonModel, ComparisonUsage, ModelID} from './model-comparison-budget.mts';
import {isControlledTransport} from './model-comparison-transport.mts';

export {ComparisonBudget, MODEL_IDS, modelCallUpperMicros};
export type {ComparisonModel, ComparisonUsage, ModelID};

export interface ComparisonCase {
  id: string; category: string; status: 'available' | 'missing'; language: string | null;
  kind: string | null; origin: string | null; previously_seen: boolean | null; image_quality: string | null;
  expected: null | {expectation: string; state: string | null; reason: string | null;
    accepted_answers: string[]; answer_scoring: ReadingAnswerScoring | null};
}
export interface BusinessInput {system: string; task: string; images: Array<{base64: string; mediaType: string}>}

export const CAB_EFFORT_CONFIGURATIONS = {
  'astra-low': {model:'gpt-6-astra', effort:'low'},
  'terra-low': {model:'gpt-6.1-terra', effort:'low'},
  'terra-medium': {model:'gpt-6.1-terra', effort:'medium'},
  'terra-high': {model:'gpt-6.1-terra', effort:'high'},
} as const;
export type CABEffort = {kind:'cab_effort_screening_v1'; configuration:keyof typeof CAB_EFFORT_CONFIGURATIONS; round:1|2};
export function buildCABEffortRequest(experiment:CABEffort, input:BusinessInput) {
  const profile=CAB_EFFORT_CONFIGURATIONS[experiment.configuration];
  if(experiment.kind!=='cab_effort_screening_v1'||!profile||![1,2].includes(experiment.round))throw new Error('Unapproved effort experiment');
  const request=buildRequest(profile.model,input,8192);
  request.body.reasoning_effort=profile.effort;
  request.parameterMapping.effort=profile.effort;
  return request;
}

/** Pure wire construction. No provider instance, environment lookup, SDK or network access. */
export function buildRequest(model: ModelID, input: BusinessInput, maxOutputTokens = 8192) {
  if (!MODEL_IDS.includes(model) || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192) {
    throw new Error('Unsupported comparison request');
  }
  if (!input.system || !input.task || input.images.length < 1 || input.images.length > 4
    || input.images.some(image => !image.base64 || !['image/jpeg','image/png','image/webp'].includes(image.mediaType))) {
    throw new Error('Invalid comparison business input');
  }
  const openai = model !== 'deepseek-flash';
  return {
    url: openai ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions',
    body: {
      model, stream: true, stream_options: {include_usage: true}, reasoning_effort: 'low',
      ...(openai ? {max_completion_tokens: maxOutputTokens, service_tier: 'default', store: false}
        : {max_tokens: maxOutputTokens, thinking: {type: 'enabled'}}),
      messages: [
        {role: openai ? 'developer' : 'system', content: input.system},
        {role: 'user', content: [
          {type: 'text', text: input.task},
          ...input.images.map(image => ({type: 'image_url', image_url: {
            url: `data:${image.mediaType};base64,${image.base64}`, ...(openai ? {detail: 'high'} : {}),
          }})),
        ]},
      ],
    },
    parameterMapping: openai ? {
      instructionRole: 'developer', outputCap: 'max_completion_tokens', effort: 'low', imageDetail: 'high',
      meaning: 'same business input and requested low setting; reasoning work is not numerically equal across models',
    } : {
      instructionRole: 'system', outputCap: 'max_tokens', effort: 'low with thinking enabled', imageDetail: 'provider default; high omitted',
      meaning: 'necessary API mapping; no prompt optimization and no client-side image downsampling',
    },
  };
}

export function pairedSchedule(cases: ComparisonCase[], models: readonly ModelID[] = MODEL_IDS) {
  if (!models.length || new Set(models).size !== models.length || models.some(id => !MODEL_IDS.includes(id))) {
    throw new Error('Invalid comparison models');
  }
  if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Duplicate comparison case');
  return cases.filter(item => item.status === 'available').flatMap((item, index) =>
    models.map((_, offset) => ({caseId: item.id, model: models[(index + offset) % models.length]!})));
}

export interface AnswerScore {
  valid: boolean; correct: boolean | null; boundaryCorrect: boolean | null; failure: string | null; answer: string | null;
  stateCorrect?: boolean | null;
}
export function scoreAnswer(raw: string, item: ComparisonCase, finishReason: string | null): AnswerScore {
  const expected = item.expected;
  const answerable = expected?.expectation === 'answerable';
  const failure = (reason: string): AnswerScore => ({valid: false, correct: answerable ? false : null,
    boundaryCorrect: expected && !answerable ? false : null, failure: reason, answer: null});
  if (finishReason !== 'stop') return failure(finishReason === 'length' ? 'truncated'
    : ['content_filter','refusal'].includes(finishReason ?? '') ? 'refusal' : 'incomplete_response');
  if (!raw.trim()) return failure('empty_answer');
  const noResult = parseNoResult(raw);
  // This experiment freezes Objective V1, not the separate screen-query no-result protocol.
  if (noResult.present) return failure('unsupported_protocol');
  const parsed = composeObjectiveResult(raw, true);
  if (parsed.parserPath !== 'v1' || parsed.violations.length || !parsed.result) return failure('format_error');
  const result = parsed.result;
  if (result.state === 'retake') return {valid: true, correct: answerable ? false : null,
    boundaryCorrect: expected && !answerable ? result.state === expected.state
      && (expected.reason === null || result.reason === expected.reason) : null,
    failure: answerable ? 'refusal_or_retake' : null, answer: null};
  if (!result.answer) return failure('empty_answer');
  let correct: boolean | null = null;
  if (answerable && expected) {
    if (!expected.answer_scoring || !expected.accepted_answers.length) throw new Error('Answerable case requires reviewed scoring and gold');
    const policy = parseReadingAnswerScoring(expected.answer_scoring, item.kind ?? '', expected.accepted_answers);
    correct = result.kind === item.kind && readingAnswerHit(result.answer, expected.accepted_answers, policy);
  }
  return {valid: true, correct, boundaryCorrect: expected && !answerable ? false : null, failure: null, answer: result.answer,
    stateCorrect: expected ? result.state === expected.state && result.reason === (expected.reason ?? 'none') : null};
}

/** Codes only: provider error text is deliberately not copied into evidence. */
export class ComparisonFailure extends Error {
  readonly code: string; readonly transient: boolean; readonly retryAfterMs: number;
  constructor(code: string, transient = false, retryAfterMs = 0) {
    if (!/^[a-z_]{1,64}$/u.test(code) || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) throw new Error('Invalid comparison failure');
    super(code); this.code = code; this.transient = transient; this.retryAfterMs = retryAfterMs;
  }
}
interface TransportResult {
  usage: ComparisonUsage | null; finishReason: string | null; returnedModel?: string; serviceTier?: string;
  meteringComplete?: boolean; usageDigest?: string;
}
export interface OfflineTransport {
  kind: 'offline-mock' | 'authorized-live';
  invoke(args: {model: ModelID; caseId: string; attemptIndex: number; purpose: AttemptPurpose;
    request: ReturnType<typeof buildRequest>; signal: AbortSignal; onProgress(): void; onDelta(text: string): void;
    onUsage(usage: ComparisonUsage): void}): Promise<TransportResult>;
}
export interface AttemptRecord {
  id: string; logicalId: string; caseId: string; model: ModelID; purpose: AttemptPurpose;
  reservedMicros: number; costMicros: number | null; costBasis: 'pricing_estimate'; actualInvoiceCostMicros: null;
  usage: ComparisonUsage | null; returnedModel: string | null; serviceTier: string | null;
  firstProgressMs: number | null; upstreamFirstAnswerMs: number | null; totalMs: number;
  finishReason: string | null; failure: string | null; outputSHA256: string;
  /** Only persist inside the private run directory; never print in console/status summaries. */
  outputText: string;
  usageDigest?: string;
}
export interface LogicalRecord {
  caseId: string; model: ModelID; category: string; language: string | null; kind: string | null;
  imageQuality: string | null; origin: string | null; previouslySeen: boolean | null;
  score: AnswerScore; failure: string | null; attemptIds: string[]; costMicros: number | null;
  knownCostMicros: number; unknownCostAttempts: number; costBasis: 'pricing_estimate'; actualInvoiceCostMicros: null;
  timing: {upstreamFirstAnswerMs: number | null; evaluatorValidCompleteMs: number | null;
    evaluatorBoundaryCompleteMs: number | null; uiRenderCompleteMs: null; totalMs: number};
}
const DEFAULT_LIMITS = {firstProgressMs: 20_000, generationMs: 90_000, leaseMs: 120_000, maxRetries: 1, maxConsecutiveFailures: 3} as const;

/** Live transports must come from the gated factory; mocks never resolve credentials. */
export async function executeComparison(options: {
  cases: ComparisonCase[]; models: ComparisonModel[];
  promptFor(item: ComparisonCase): {system: string; task: string};
  imagesFor(item: ComparisonCase): BusinessInput['images'];
  budget: ComparisonBudget; transport: OfflineTransport;
  limits?: Partial<{firstProgressMs: number; generationMs: number; leaseMs: number; maxRetries: 0 | 1; maxConsecutiveFailures: number}>;
  auxiliary?: {recover?: boolean; fallbackModel?: ModelID};
  onEvidence?(kind:'attempt'|'logical',record:AttemptRecord|LogicalRecord):void;
  maxUnknownAttempts?:number;
  effortExperiment?:CABEffort;
}) {
  const live=options.transport.kind==='authorized-live';
  if (options.transport.kind !== 'offline-mock' && !(live&&isControlledTransport(options.transport))) throw new Error('Unauthorized comparison transport');
  if(live&&options.auxiliary)throw new Error('Live recovery and fallback are outside this approval');
  const limits = {...DEFAULT_LIMITS, ...options.limits};
  if (![limits.firstProgressMs, limits.generationMs, limits.leaseMs, limits.maxConsecutiveFailures].every(n => Number.isSafeInteger(n) && n > 0)
    || ![0,1].includes(limits.maxRetries) || limits.firstProgressMs > limits.generationMs || limits.generationMs > limits.leaseMs) {
    throw new Error('Invalid comparison deadlines');
  }
  const models = new Map(options.models.map(model => [model.id, model]));
  if(options.effortExperiment){
    const profile=CAB_EFFORT_CONFIGURATIONS[options.effortExperiment.configuration];
    if(!profile||options.effortExperiment.kind!=='cab_effort_screening_v1'||![1,2].includes(options.effortExperiment.round)
      ||options.models.length!==1||options.models[0]!.id!==profile.model||options.cases.length!==1
      ||!['F01','F02','F03','F04'].includes(options.cases[0]!.id)||options.models[0]!.bounds.outputTokens!==8192
      ||options.auxiliary)throw new Error('Invalid CAB effort scope');
  }
  options.models.forEach(modelCallUpperMicros);
  options.models.forEach(model => options.budget.assertModel(model));
  if (options.auxiliary?.fallbackModel && !models.has(options.auxiliary.fallbackModel)) throw new Error('Fallback must be an explicitly planned model');
  const schedule = pairedSchedule(options.cases, options.models.map(model => model.id));
  const attempts: AttemptRecord[] = [], rows: LogicalRecord[] = [];
  let stopped: string | null = null, consecutiveFailures = 0;
  for (const scheduled of schedule) {
    const item = options.cases.find(candidate => candidate.id === scheduled.caseId)!;
    const input = {...options.promptFor(item), images: options.imagesFor(item)};
    const started = performance.now(), logicalId = randomUUID();
    const owned: AttemptRecord[] = [];
    let raw = '', finalResult: TransportResult | null = null, lastFailure: ComparisonFailure | null = null;
    let firstAnswerAcrossAttempts: number | null = null;
    const invoke = async (modelId: ModelID, purpose: AttemptPurpose) => {
      const model = models.get(modelId)!;
      const request = options.effortExperiment ? buildCABEffortRequest(options.effortExperiment,input)
        : buildRequest(modelId, input, model.bounds.outputTokens);
      const id = randomUUID(), attemptStarted = performance.now();
      const remaining = Math.min(limits.generationMs, limits.leaseMs) - (attemptStarted - started);
      if (remaining <= 0) {lastFailure = new ComparisonFailure('generation_timeout'); return;}
      let reservedMicros: number;
      try {reservedMicros = options.budget.reserve(id, logicalId, modelId, purpose);}
      catch {stopped = options.budget.snapshot().halted ? 'budget_halted' : 'budget_exhausted'; return;}
      const record: AttemptRecord = {id, logicalId, caseId: item.id, model: modelId, purpose, reservedMicros,
        costMicros: null, costBasis: 'pricing_estimate', actualInvoiceCostMicros: null, usage: null,
        returnedModel: null, serviceTier: null, firstProgressMs: null, upstreamFirstAnswerMs: null,
        totalMs: 0, finishReason: null, failure: null, outputSHA256: '', outputText: ''};
      owned.push(record); attempts.push(record);
      const abort = new AbortController();
      let closed = false, attemptRaw = '', result: TransportResult | null = null;
      let firstTimer: ReturnType<typeof setTimeout> | undefined, totalTimer: ReturnType<typeof setTimeout> | undefined;
      const meter = (usage: ComparisonUsage) => {
        if (closed || abort.signal.aborted) return;
        try {
          const cost = options.budget.observe(id, usage);
          if (cost !== null) {record.usage = {...usage}; record.costMicros = cost;}
        } catch {
          const retained = options.budget.attemptEvidence(id);
          record.usage = retained.usage; record.costMicros = retained.costMicros;
          throw new ComparisonFailure('cost_bound_violation');
        }
      };
      const deadline = new Promise<never>((_, reject) => {
        firstTimer = setTimeout(() => {abort.abort(); reject(new ComparisonFailure('startup_timeout', true));}, limits.firstProgressMs);
        totalTimer = setTimeout(() => {abort.abort(); reject(new ComparisonFailure('generation_timeout'));}, remaining);
      });
      try {
        result = await Promise.race([deadline, options.transport.invoke({model: modelId, caseId: item.id,
          attemptIndex: owned.length - 1, purpose, request, signal: abort.signal,
          onProgress() {
            if (closed || abort.signal.aborted) return;
            record.firstProgressMs ??= performance.now() - attemptStarted; clearTimeout(firstTimer);
          },
          onDelta(text) {
            if (closed || abort.signal.aborted || !text) return;
            record.firstProgressMs ??= performance.now() - attemptStarted;
            record.upstreamFirstAnswerMs ??= performance.now() - attemptStarted;
            firstAnswerAcrossAttempts ??= performance.now() - started;
            clearTimeout(firstTimer); attemptRaw += text;
            if (Buffer.byteLength(attemptRaw) > 64 * 1024) throw new ComparisonFailure('output_limit');
          }, onUsage: meter,
        })]);
        if (result.usage) meter(result.usage);
        record.returnedModel = typeof result.returnedModel === 'string' ? result.returnedModel : null;
        record.serviceTier = typeof result.serviceTier === 'string' ? result.serviceTier : null;
        record.finishReason = result.finishReason;
        record.usageDigest=result.usageDigest;
        if(result.meteringComplete&&record.usage)options.budget.settleCompleteUsage(id);
        lastFailure = null; raw = attemptRaw; finalResult = result;
      } catch (error) {
        lastFailure = error instanceof ComparisonFailure ? error : new ComparisonFailure('transport_error');
        record.failure = lastFailure.code; raw = attemptRaw; finalResult = null;
      } finally {
        closed = true; abort.abort(); clearTimeout(firstTimer); clearTimeout(totalTimer);
        record.totalMs = performance.now() - attemptStarted;
        record.outputSHA256 = createHash('sha256').update(attemptRaw).digest('hex');
        record.outputText = attemptRaw;
        options.onEvidence?.('attempt',record);
        // Check between physical calls so the retry cannot cross the unknown-cost limit.
        if(options.maxUnknownAttempts&&options.budget.snapshot().unknownAttempts>=options.maxUnknownAttempts)stopped='unknown_cost_limit';
      }
    };
    await invoke(scheduled.model, 'answer');
    const retryFailure = lastFailure as ComparisonFailure | null;
    if (!stopped && retryFailure?.transient && retryFailure.retryAfterMs <= 3000 && limits.maxRetries === 1) {
      const waitMs = retryFailure.retryAfterMs;
      if (performance.now() - started + waitMs >= Math.min(limits.generationMs, limits.leaseMs)) {
        lastFailure = new ComparisonFailure('generation_timeout');
      } else {
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        await invoke(scheduled.model, 'retry');
      }
    }
    if (!stopped && lastFailure && options.auxiliary?.recover) await invoke(scheduled.model, 'recover');
    if (!stopped && lastFailure && options.auxiliary?.fallbackModel) await invoke(options.auxiliary.fallbackModel, 'fallback');
    if (!owned.length) break;
    const finished = performance.now();
    const resultAfterAttempts = finalResult as TransportResult | null;
    const failureAfterAttempts = lastFailure as ComparisonFailure | null;
    const score = scoreAnswer(raw, item, failureAfterAttempts || !resultAfterAttempts ? null : resultAfterAttempts.finishReason);
    const failure: string|null = (stopped==='unknown_cost_limit'?null:stopped) ?? failureAfterAttempts?.code ?? score.failure;
    if (failure && item.expected?.expectation === 'answerable') score.correct = false;
    const knownCostMicros = owned.reduce((sum, attempt) => sum + (attempt.costMicros ?? 0), 0);
    const unknownCostAttempts = owned.filter(attempt => attempt.costMicros === null).length;
    rows.push({caseId: item.id, model: scheduled.model, category: item.category, language: item.language,
      kind: item.kind, imageQuality: item.image_quality, origin: item.origin, previouslySeen: item.previously_seen,
      score, failure, attemptIds: owned.map(attempt => attempt.id), knownCostMicros, unknownCostAttempts,
      costMicros: unknownCostAttempts ? null : knownCostMicros, costBasis: 'pricing_estimate', actualInvoiceCostMicros: null,
      timing: {upstreamFirstAnswerMs: firstAnswerAcrossAttempts,
        evaluatorValidCompleteMs: item.expected?.expectation === 'answerable'
          && score.valid && score.answer !== null && !failure ? finished - started : null,
        evaluatorBoundaryCompleteMs: item.expected !== null && item.expected.expectation !== 'answerable'
          && score.valid && score.answer === null && !failure ? finished - started : null,
        uiRenderCompleteMs: null, totalMs: finished - started}});
    options.onEvidence?.('logical',rows.at(-1)!);
    consecutiveFailures = failure ? consecutiveFailures + 1 : 0;
    if (options.budget.snapshot().halted) stopped = 'budget_halted';
    if(live&&failure&&['authorization_revoked','model_identity_mismatch','service_tier_mismatch','service_tier_unconfirmed','account_rejected','credential_unavailable','billing_quota','invalid_usage','endpoint_mismatch','effort_scope_mismatch'].includes(failure))stopped=failure;
    if(options.maxUnknownAttempts&&options.budget.snapshot().unknownAttempts>=options.maxUnknownAttempts)stopped='unknown_cost_limit';
    if (!stopped && consecutiveFailures >= limits.maxConsecutiveFailures) stopped = 'consecutive_failures';
    if (stopped) break;
  }
  const unattempted = schedule.filter(planned => !rows.some(row => row.caseId === planned.caseId && row.model === planned.model))
    .map(planned => ({...planned, status: 'unattempted' as const, reason: stopped ?? 'not_dispatched'}));
  return {mode: live?'authorized-live':'offline-mock', metricsAreModelMeasurements: live, rows, attempts, unattempted,
    timingScope:'evaluator_request_to_complete_valid_answer_not_native_client',
    summary: summarizeComparison(rows, schedule.length, schedule,live),budget:options.budget.snapshot(),stopped};
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  return [...values].sort((a,b) => a-b)[Math.ceil(values.length * fraction) - 1]!;
}
export function summarizeComparison(rows: LogicalRecord[], plannedLogicalCalls = rows.length,
  schedule: Array<{caseId: string; model: ModelID}> = rows.map(({caseId,model}) => ({caseId,model})),live=false) {
  const summarize = (selected: LogicalRecord[]) => {
    const scored = selected.filter(row => row.score.correct !== null), correct = scored.filter(row => row.score.correct).length;
    const boundary = selected.filter(row => row.score.boundaryCorrect !== null);
    const unknown = selected.reduce((sum,row) => sum + row.unknownCostAttempts, 0);
    const known = selected.reduce((sum,row) => sum + row.knownCostMicros, 0);
    const complete = selected.flatMap(row => row.timing.evaluatorValidCompleteMs === null ? [] : [row.timing.evaluatorValidCompleteMs]);
    const first = selected.flatMap(row => row.timing.upstreamFirstAnswerMs === null ? [] : [row.timing.upstreamFirstAnswerMs]);
    const failureReasons: Record<string, number> = {};
    for (const row of selected) if (row.failure) failureReasons[row.failure] = (failureReasons[row.failure] ?? 0) + 1;
    return {logicalCalls: selected.length, answerableScored: scored.length, correct,
      accuracy: scored.length ? correct / scored.length : null, boundaryScored: boundary.length,
      boundaryCorrect: boundary.filter(row => row.score.boundaryCorrect).length,
      validCompletions: complete.length, validCompletionRate: scored.length ? complete.length / scored.length : null,
      boundaryCompletions: selected.filter(row => row.timing.evaluatorBoundaryCompleteMs !== null).length,
      latencySource: live?'evaluator_consumer_not_native_UI':'offline_mock_consumer_not_native_UI', evaluatorValidCompleteP50Ms: percentile(complete, .5),
      evaluatorValidCompleteP95Ms: complete.length >= 20 ? percentile(complete, .95) : null,
      upstreamFirstAnswerP50Ms: percentile(first, .5), failureReasons,
      knownCostMicros: known, unknownCostAttempts: unknown, costMicros: unknown ? null : known,
      costPer1000Micros: !unknown && selected.length ? known / selected.length * 1000 : null,
      costPerCorrectMicros: !unknown && correct ? known / correct : null,
      costBasis: 'pricing_estimate', actualInvoiceCostMicros: null};
  };
  const strata: Record<string, ReturnType<typeof summarize>> = {};
  for (const field of ['model','category','language','kind','imageQuality','origin','previouslySeen'] as const) {
    for (const value of new Set(rows.map(row => String(row[field])))) strata[`${field}:${value}`] = summarize(rows.filter(row => String(row[field]) === value));
  }
  for (const model of new Set(rows.map(row => row.model))) for (const field of ['category','language','kind','imageQuality','origin','previouslySeen'] as const) {
    const selected = rows.filter(row => row.model === model);
    for (const value of new Set(selected.map(row => String(row[field])))) {
      strata[`model:${model}|${field}:${value}`] = summarize(selected.filter(row => String(row[field]) === value));
    }
  }
  const pairedCases = new Set(rows.map(row => row.caseId));
  const paired = MODEL_IDS.slice(1).map(candidate => {
    const plannedCases = [...new Set(schedule.filter(row => row.model === candidate).map(row => row.caseId))]
      .filter(caseId => schedule.some(row => row.caseId === caseId && row.model === MODEL_IDS[0]));
    let completePairs = 0, scoredPairs = 0, baselineCorrect = 0, candidateCorrect = 0;
    let candidateOnlyCorrect = 0, baselineOnlyCorrect = 0;
    for (const caseId of plannedCases) {
      const baseline = rows.find(row => row.caseId === caseId && row.model === MODEL_IDS[0]);
      const treatment = rows.find(row => row.caseId === caseId && row.model === candidate);
      if (!baseline || !treatment) continue;
      completePairs++;
      if (baseline.score.correct === null || treatment.score.correct === null) continue;
      scoredPairs++; baselineCorrect += Number(baseline.score.correct); candidateCorrect += Number(treatment.score.correct);
      candidateOnlyCorrect += Number(!baseline.score.correct && treatment.score.correct);
      baselineOnlyCorrect += Number(baseline.score.correct && !treatment.score.correct);
    }
    return {baseline: MODEL_IDS[0], candidate, plannedPairs: plannedCases.length, completePairs,
      incompletePairs: plannedCases.length - completePairs, scoredPairs, unscoredPairs: completePairs - scoredPairs,
      baselineCorrect, candidateCorrect, candidateOnlyCorrect, baselineOnlyCorrect,
      accuracyDifference: scoredPairs ? (candidateCorrect - baselineCorrect) / scoredPairs : null,
      statisticalClaim: 'screening_only_no_noninferiority_claim'};
  });
  return {plannedLogicalCalls, completedLogicalCalls: rows.length, notRunLogicalCalls: plannedLogicalCalls - rows.length,
    plannedCompletionRate: plannedLogicalCalls ? rows.length / plannedLogicalCalls : null,
    fullPlanValidAnswerRate: plannedLogicalCalls ? rows.filter(row => row.timing.evaluatorValidCompleteMs !== null).length / plannedLogicalCalls : null,
    distinctCases: pairedCases.size, paired, overall: summarize(rows), strata};
}
