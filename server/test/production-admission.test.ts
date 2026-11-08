import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, validateTrialPolicy, type Config } from '../src/config.ts';
import { FIXED_TRIAL_POLICY } from '../src/billing.ts';

function production(): Config {
  return { ...config, requireDurableStorage: true, isServerless: true,
    quotaPolicyVersion: FIXED_TRIAL_POLICY.version, trialQuestions: 30, trialMinQuestions: 30, trialMaxQuestions: 30,
    provider: 'anthropic', objectiveProvider: 'deepseek', model: 'control', objectiveModel: 'treatment',
    modelDailyBudgetMicros: 1000, attemptBudgetUpperMicros: 100, modelCostCurrency: 'CNY', modelPricingVersion: 'test',
    cronSecret: 'test-only-recovery-secret-32-characters',
    modelPricingJSON: JSON.stringify(['anthropic:control', 'deepseek:treatment'].map(model =>
      ({ model, input_micros_per_million_tokens: 100, output_micros_per_million_tokens: 200 }))),
  };
}
test('production admission requires real priced slots, fixed30, a finite shared budget and independent recovery', () => {
  assert.doesNotThrow(() => validateTrialPolicy(production()));
  for (const changes of [
    { trialMaxQuestions: 180 }, { quotaPolicyVersion: 'legacy' },
    { provider: 'mock' }, { objectiveProvider: 'mock' },
    { attemptBudgetUpperMicros: 0 }, { attemptBudgetUpperMicros: 1001 },
    { modelDailyBudgetMicros: Number.MAX_VALUE }, { modelPricingJSON: '[]' },
    { modelPricingVersion: 'unset' }, { modelCostCurrency: 'unknown' }, { cronSecret: '' },
  ] as Partial<Config>[]) {
    assert.throws(() => validateTrialPolicy({ ...production(), ...changes }));
  }
});

test('explanation output ceilings are explicit bounded integers and retain the default',()=>{
  assert.equal(config.explanationMaxTokens,768);
  for(const cap of [1,768,2048,4096,8192,32768])assert.doesNotThrow(()=>validateTrialPolicy({...production(),explanationMaxTokens:cap}));
  for(const cap of [0,-1,0.5,32769,NaN,Infinity])assert.throws(()=>validateTrialPolicy({...production(),explanationMaxTokens:cap}),/EXPLANATION_MAX_TOKENS/);
});

test('Astra production requires a USD reservation for Standard and any configured Fast review', () => {
  const rates = ['anthropic:control', 'openai:gpt-6-astra', 'openai:gpt-6-astra:fast'].map(model =>
    ({ model, input_micros_per_million_tokens: 1_000, output_micros_per_million_tokens: 1_000 }));
  const astra = { ...production(), objectiveProvider: 'openai' as const, objectiveModel: 'gpt-6-astra',
    objectiveMaxTokens: 8192, objectiveAstraFastReview: true, modelCostCurrency: 'USD',
    modelDailyBudgetMicros: 3000, attemptBudgetUpperMicros: 2116, modelPricingJSON: JSON.stringify(rates) };
  assert.doesNotThrow(() => validateTrialPolicy(astra));
  assert.throws(() => validateTrialPolicy({ ...astra, modelCostCurrency: 'CNY' }), /USD/);
  assert.throws(() => validateTrialPolicy({ ...astra, attemptBudgetUpperMicros: 2115 }), /reservation/);
  assert.throws(() => validateTrialPolicy({ ...astra, modelPricingJSON: JSON.stringify(rates.slice(0, 2)) }), /reservation/);
  assert.throws(() => validateTrialPolicy({ ...astra, objectiveMaxTokens: 8193 }), /ceiling/);
  assert.throws(() => validateTrialPolicy({ ...production(), objectiveAstraFastReview: true }), /objective slot/);
  assert.doesNotThrow(() => validateTrialPolicy({ ...astra, objectiveAstraFastReview: false,
    attemptBudgetUpperMicros: 1058, modelPricingJSON: JSON.stringify(rates.slice(0, 2)) }));
});

test('guarded Astra admits request ceilings below full context while retaining production controls',()=>{
  const c={...production(),requestBudgetMode:'guarded-request',provider:'openai' as const,objectiveProvider:'openai' as const,
    model:'gpt-6-astra',objectiveModel:'gpt-6-astra',openaiBaseURL:'https://api.openai.com',
    maxTokens:8192,objectiveMaxTokens:8192,modelCostCurrency:'USD',modelDailyBudgetMicros:10_000_000,attemptBudgetUpperMicros:3_000_000,
    modelPricingJSON:JSON.stringify([{model:'openai:gpt-6-astra',input_micros_per_million_tokens:25_000_000,output_micros_per_million_tokens:75_000_000}])};
  assert.doesNotThrow(()=>validateTrialPolicy(c));
  assert.throws(()=>validateTrialPolicy({...c,requestBudgetMode:'fixed'}),/reservation/);
  for(const patch of [{modelCostCurrency:'CNY'},{openaiBaseURL:'https://proxy.invalid'},
    {provider:'deepseek' as const},{modelPricingJSON:'[]'},{modelDailyBudgetMicros:0},{attemptBudgetUpperMicros:0},{cronSecret:''}]){
    assert.throws(()=>validateTrialPolicy({...c,...patch}));
  }
});
