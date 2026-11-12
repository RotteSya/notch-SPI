import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('approved Astra Standard policy boots with guarded USD limits and no Fast route',()=>{
  const policy=JSON.parse(readFileSync(new URL('../../deploy/production-model-budget.json',import.meta.url),'utf8'));
  const env=policy.environment;
  for (const slot of ['OFFICIAL','OBJECTIVE_RESULT_V1']) {
    assert.equal(env[slot+'_PROVIDER'],'openai');
    assert.equal(env[slot+'_MODEL'],'gpt-6-astra');
    assert.equal(env[slot+'_MAX_TOKENS'],'8192');
  }
  assert.equal(env.OBJECTIVE_RESULT_V1_ASTRA_FAST_REVIEW,'0');
  assert.equal(env.OPENAI_BASE_URL,'https://api.openai.com');
  assert.equal(env.EXPLANATION_MAX_TOKENS,'8192');
  assert.equal(env.ASTRA_REQUEST_BUDGET_MODE,'guarded-request');
  assert.equal(env.MODEL_COST_CURRENCY,'USD');
  assert.equal(env.MODEL_DAILY_BUDGET_MICROS,'100000000');
  assert.equal(env.MODEL_BUDGET_WARNING_MICROS,'15000000');
  assert.equal(env.ATTEMPT_BUDGET_UPPER_MICROS,'3000000');
  assert.equal(policy.auto_increase,false);
  const run=spawnSync(process.execPath,['--input-type=module','-e',
    "import {config,validateTrialPolicy} from './src/config.ts'; validateTrialPolicy(config)"],{
    cwd:new URL('../',import.meta.url),env:{PATH:process.env.PATH,...env,REQUIRE_DURABLE_STORAGE:'1'},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
});
