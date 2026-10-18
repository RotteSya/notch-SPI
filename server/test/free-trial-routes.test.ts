import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_PROVIDER = 'mock';
process.env.FREE_TRIAL_ENABLED = '1';
process.env.LOG_LEVEL = 'silent';
const {buildApp} = await import('../src/index.ts');
const {config} = await import('../src/config.ts');
const trialConfig = config as {freeTrialEnabled: boolean};

test('trial HTTP contract authenticates, preserves old users and returns one durable receipt with account quota', async () => {
  const app = await buildApp();
  try {
    const register = async () => (await app.inject({method: 'POST', url: '/v1/devices', payload: {platform: 'macos', app_version: 'test'}})).json().device_token as string;
    const headers = (token: string) => ({authorization: 'Bearer ' + token});
    const claim = (token: string) => app.inject({method: 'POST', url: '/v1/free-trial/claim', headers: headers(token)});
    assert.equal((await claim('missing')).statusCode, 401);
    trialConfig.freeTrialEnabled = false;
    const old = await register();
    assert.equal((await claim(old)).json().error.code, 'trial_unavailable');
    trialConfig.freeTrialEnabled = true;
    assert.equal((await claim(old)).json().error.code, 'trial_ineligible');
    const token = await register();
    const before = (await app.inject({url: '/v1/account', headers: headers(token)})).json();
    assert.equal(before.free_trial.status, 'eligible');
    assert.equal(before.balance_questions, 0);
    assert.equal(before.initial_grant, 0);
    assert.equal(before.allowance_sources.trial, 0);
    assert.equal(before.policy_version, 'trial3d400-2026-10-16');
    const configResponse = (await app.inject({url: '/v1/client-config', headers: headers(token)})).json();
    assert.equal(configResponse.screen_query.trial_policy.initial_grant, 0);
    trialConfig.freeTrialEnabled = false;
    assert.equal((await app.inject({url: '/v1/account', headers: headers(token)})).json().free_trial, undefined);
    trialConfig.freeTrialEnabled = true;
    const first = await claim(token), receipt = first.json();
    assert.equal(first.statusCode, 200); assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(receipt.balance_questions, 400); assert.equal(receipt.free_trial.daily_remaining, 400);
    assert.equal(receipt.free_trial.daily_limit, 400); assert.equal(receipt.free_trial.status, 'active');
    assert.equal(Date.parse(receipt.free_trial.expires_at) - Date.parse(receipt.free_trial.activated_at), 72 * 3_600_000);
    trialConfig.freeTrialEnabled = false;
    const retried = (await claim(token)).json();
    assert.equal(retried.free_trial.expires_at, receipt.free_trial.expires_at);
    assert.equal(retried.balance_questions, 400);
    const after = (await app.inject({url: '/v1/account', headers: headers(token)})).json();
    assert.equal(after.free_trial.expires_at, receipt.free_trial.expires_at);
    assert.equal(after.balance_version, receipt.balance_version);
  } finally { trialConfig.freeTrialEnabled = true; await app.close(); }
});

test('a real mock capture streams the settled daily receipt and keeps account quota consistent', async () => {
  const app = await buildApp();
  try {
    const base = await app.listen({port: 0, host: '127.0.0.1'});
    const token = (await app.inject({method: 'POST', url: '/v1/devices', payload: {platform: 'macos', app_version: 'test'}})).json().device_token;
    const headers = {authorization: 'Bearer ' + token, 'content-type': 'application/json'};
    await app.inject({method: 'POST', url: '/v1/free-trial/claim', headers});
    const response = await fetch(base + '/v1/captures', {method: 'POST', headers,
      body: JSON.stringify({system: 'test', task: 'test', image_base64: 'QUJDREVG', image_media_type: 'image/jpeg'})});
    assert.equal(response.status, 200);
    const frames = (await response.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
    const usages = frames.filter(frame => frame.type === 'usage');
    assert.equal(usages.length, 1);
    const usage = usages[0];
    assert.equal(usage.questions_charged, 1); assert.equal(usage.balance_questions, 399);
    assert.equal(usage.free_trial.daily_used, 1); assert.equal(usage.free_trial.daily_remaining, 399);
    assert.equal(usage.free_trial.daily_held, 0);
    const account = (await app.inject({url: '/v1/account', headers})).json();
    assert.equal(account.balance_version, usage.balance_version);
    assert.equal(account.free_trial.expires_at, usage.free_trial.expires_at);
    assert.equal(account.free_trial.daily_used, 1);
  } finally { await app.close(); }
});
