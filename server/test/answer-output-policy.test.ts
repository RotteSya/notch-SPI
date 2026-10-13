import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production output allowance fits the existing reservation without disabling thinking',()=>{
  const policy=JSON.parse(readFileSync(new URL('../../deploy/production-model-budget.json',import.meta.url),'utf8'));
  const env=policy.environment;
  assert.equal(env.OFFICIAL_MAX_TOKENS,'32768');
  assert.equal(env.OBJECTIVE_RESULT_V1_MAX_TOKENS,'32768');
  assert.equal(env.EXPLANATION_MAX_TOKENS,'8192');
  assert.equal(env.OFFICIAL_DEEPSEEK_REASONING_EFFORT,'low');
  assert.equal(env.OBJECTIVE_RESULT_V1_DEEPSEEK_REASONING_EFFORT,'low');
  const price=JSON.parse(env.MODEL_PRICING_JSON)[0];
  const bound=Math.ceil((policy.valuation.context_input_upper_tokens*price.input_micros_per_million_tokens
    +Number(env.OFFICIAL_MAX_TOKENS)*price.output_micros_per_million_tokens)/1_000_000);
  assert.equal(bound,policy.valuation.calculated_upper_micros);
  assert.ok(bound<=Number(env.ATTEMPT_BUDGET_UPPER_MICROS));
  assert.equal(env.MODEL_DAILY_BUDGET_MICROS,'120000000');
  assert.equal(policy.auto_increase,false);
});
