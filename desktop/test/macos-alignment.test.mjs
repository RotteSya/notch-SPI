import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { apiProviders, providerSettings, providerKey, apiCredentialKey, normalizeEndpoint, apiEndpoint } from '../core/api-providers.mjs';
import { explanationPrompt } from '../core/product.mjs';
import { directAPI, localCLI } from '../core/providers.mjs';
import { ReadingSnapshot } from '../core/reading-snapshot.mjs';
import { validUpdateConfig, updateController, createUpdateFlow } from '../core/update-state.mjs';
import { SystemOperation } from '../core/system-operation.mjs';

test('A timed out OS capture remains occupied until its callback; late pixels never complete a newer caller', async () => {
  const gate = new SystemOperation(); let finish, accepted = 0;
  await assert.rejects(gate.run(() => new Promise(resolve => { finish = resolve; }), 5).then(() => accepted++), /timed out/);
  await assert.rejects(gate.run(() => 'new frame'), /busy/);
  finish('late frame'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted, 0);
  assert.equal(await gate.run(() => 'fresh frame'), 'fresh frame');
  await assert.rejects(gate.run(() => Promise.reject(new Error('OS failure'))), /OS failure/);
  assert.equal(await gate.run(() => 'recovered'), 'recovered');
});

test('Windows provider registry matches every native 3.1 provider/model/endpoint in picker order', () => {
  const swift = fs.readFileSync(new URL('../../Sources/NotchSPI/Cloud/APIProvider.swift', import.meta.url), 'utf8');
  const native = [...swift.matchAll(/APIProvider\(id: "([^"]+)"[\s\S]*?endpoint: ([^,]+),\s*defaultModel: "([^"]*)"/g)];
  assert.deepEqual(apiProviders.map(p => p.id), native.map(m => m[1]));
  for (const [i, row] of native.entries()) {
    assert.equal(apiProviders[i].model, row[3]);
    if (row[2].startsWith('"')) assert.equal(apiProviders[i].endpoint, JSON.parse(row[2]));
  }
});

test('Provider switching preserves per-provider models, custom URL, protocol and legacy encrypted credentials', async () => {
  let settings = providerSettings({ endpoint: 'https://api.openai.com/v1/chat/completions', model: 'my-model', protocol: 'openai' });
  assert.equal(settings.apiProvider, 'openai');
  settings = providerSettings(settings, { apiProvider: 'anthropic' });
  assert.equal(settings.model, 'claude-opus-4-8');
  assert.equal(settings.protocol, 'anthropic');
  settings = providerSettings(settings, { model: 'custom-claude' });
  settings = providerSettings(settings, { apiProvider: 'openai' });
  assert.equal(settings.model, 'my-model');
  settings = providerSettings(settings, { apiProvider: 'anthropic' });
  assert.equal(settings.model, 'custom-claude');
  settings = providerSettings(settings, { apiProvider: 'custom' });
  settings = providerSettings(settings, { endpoint: ' https://private.invalid/v1/ ', model: 'private' });
  const custom = settings.endpoint;
  settings = providerSettings(providerSettings(settings, { apiProvider: 'gemini' }), { apiProvider: 'custom' });
  assert.equal(settings.endpoint, custom);
  assert.equal(settings.model, 'private');
  assert.equal(normalizeEndpoint('https://private.invalid/v1/messages'), 'https://private.invalid/v1/messages');
  assert.equal(apiEndpoint('http://127.0.0.1:9999/v1/chat/completions?api-version=1'), 'http://127.0.0.1:9999/v1/chat/completions?api-version=1');
  for (const url of ['file:///etc/passwd', 'https://user:pass@host.invalid', 'javascript:alert(1)']) assert.throws(() => apiEndpoint(url));
  const secrets = new Map([['api:' + settings.endpoint, 'legacy']]);
  const vault = { get: async key => secrets.get(key) ?? null };
  assert.equal(await providerKey(vault, settings), 'legacy');
  secrets.set(apiCredentialKey(settings), 'new');
  assert.equal(await providerKey(vault, settings), 'new');
  secrets.set(apiCredentialKey(settings), '');
  assert.equal(await providerKey(vault, settings), '');
  assert.throws(() => providerSettings(settings, { apiProvider: 'unknown' }));
});

const sse = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
test('API explanations use the native prompt and original ordered images instead of resubmitting a solve', async () => {
  const prompt = explanationPrompt('ja', 'B. 60 km/h');
  const native = fs.readFileSync(new URL('../../Sources/NotchSPI/Notch/NotchController.swift', import.meta.url), 'utf8');
  assert.ok(native.includes(prompt.system));
  for (const provider of apiProviders.filter(p => p.id !== 'custom')) {
    let request;
    const body = provider.protocol === 'anthropic'
      ? sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Explanation' } }) + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + sse({ type: 'message_stop' })
      : sse({ choices: [{ delta: { content: 'Explanation' } }] }) + sse({ choices: [{ finish_reason: 'stop' }] }) + sse('[DONE]');
    const result = await directAPI({ images: [{ base64: 'first' }, { base64: 'last' }], settings: { ...provider, reasoning: 'high' },
      key: 'fixture', mode: 'tutor', prompt, signal: new AbortController().signal, onDelta() {},
      fetchImpl: async (_, options) => { request = JSON.parse(options.body); return new Response(body, { headers: { 'content-type': 'text/event-stream' } }); },
    });
    assert.equal(result.raw, 'Explanation');
    assert.ok(JSON.stringify(request).includes(prompt.task));
    assert.equal(request.messages.at(-1).content.length, 3);
    if (provider.id === 'deepseek') { assert.deepEqual(request.thinking, { type: 'enabled' }); assert.equal(request.reasoning_effort, 'high'); }
    else assert.equal(request.thinking, undefined);
  }
});

function fakeCLI(output, { exit = 0, wait = false } = {}) {
  let stops = 0, argv;
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.pid = 123; child.exitCode = null;
  return {
    spawnImpl(_file, args) {
      argv = args;
      if (!wait) setImmediate(() => { child.stdout.write(output); child.stdout.end(); child.exitCode = exit; child.emit('close', exit); });
      return child;
    },
    terminateImpl() { stops++; setImmediate(() => child.emit('close', 1)); },
    get stops() { return stops; }, get argv() { return argv; },
  };
}
const cliOptions = { images: [{ base64: 'aQ==' }], settings: { cliPath: process.execPath, cliKind: 'claude' }, mode: 'tutor', onDelta() {} };
test('Claude CLI drains result-only output and an unterminated final JSON line', async () => {
  for (const output of [JSON.stringify({ type: 'result', result: 'FINAL: B' }), JSON.stringify({ type: 'result', result: 'FINAL: B' }) + '\n']) {
    const fake = fakeCLI(output);
    const answer = await localCLI({ ...cliOptions, ...fake, signal: new AbortController().signal, prompt: explanationPrompt('en', 'B') });
    assert.equal(answer.raw, 'FINAL: B');
    assert.match(fake.argv[1], /Original answer: B/);
    assert.equal(fs.existsSync(fake.argv[1].match(/\/[^\n]+\/0.jpg/)?.[0] ?? '/not-a-file'), false);
  }
});
test('CLI cancellation before spawn, active abort, timeout, oversized output and nonzero exit cannot succeed', async () => {
  const aborted = new AbortController(); aborted.abort();
  let called = false;
  await assert.rejects(localCLI({ ...cliOptions, signal: aborted.signal, spawnImpl() { called = true; } }));
  assert.equal(called, false);
  const fake = fakeCLI('', { wait: true });
  const controller = new AbortController();
  const promise = localCLI({ ...cliOptions, ...fake, signal: controller.signal });
  while (!fake.argv) await new Promise(resolve => setTimeout(resolve, 2));
  controller.abort(); await assert.rejects(promise); assert.equal(fake.stops, 1);
  const timeout = fakeCLI('', { wait: true });
  await assert.rejects(localCLI({ ...cliOptions, ...timeout, signal: new AbortController().signal, timeoutMs: 5 }));
  assert.equal(timeout.stops, 1);
  for (const [output, exit] of [[JSON.stringify({ type: 'result', result: 'x'.repeat(65537) }), 0], ['partial', 1]])
    await assert.rejects(localCLI({ ...cliOptions, ...fakeCLI(output, { exit }), signal: new AbortController().signal }));
});

test('Independent reading freezes images, updates only its own explanation and detaches permanently on a new question', () => {
  const input = { id: 'old', images: [{ url: 'old-image' }], answer: 'B', detail: '', canExplain: true };
  const reader = new ReadingSnapshot(input);
  input.images[0].url = 'mutated';
  reader.update({ ...input, images: [], detail: 'Explanation' });
  assert.equal(reader.value.images[0].url, 'old-image');
  assert.equal(reader.copyAll, 'B\n\nExplanation');
  reader.update({ id: 'new', answer: 'C', canExplain: true });
  assert.equal(reader.value.canExplain, false);
  reader.update({ ...input, answer: 'late answer' });
  assert.equal(reader.value.answer, 'B');
});

test('Updater requires an HTTPS feed and certificate publisher', () => {
  const good = { url: 'https://updates.invalid/app', provider: 'generic', publisherName: ['Publisher'] };
  assert.equal(validUpdateConfig(good), true);
  for (const patch of [{ url: 'http://updates.invalid' }, { url: 'https://user:pass@updates.invalid' }, { publisherName: [] }, { publisherName: [''] }, { provider: 'github' }])
    assert.equal(Boolean(validUpdateConfig({ ...good, ...patch })), false);
});
test('Update cancellation rejects late progress/completion and permits a fresh check; double download is single flight', async () => {
  const updater = new EventEmitter(); let checks = 0, downloads = 0, installed = 0, finish;
  updater.checkForUpdates = async () => { checks++; updater.emit('update-available', { version: '3.1.31' }); return { cancellationToken: { cancel() { finish.reject(new Error('canceled')); } } }; };
  updater.downloadUpdate = () => { downloads++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); };
  updater.quitAndInstall = () => installed++;
  const controller = updateController(updater);
  await Promise.all([controller.check(), controller.check()]); assert.equal(checks, 1);
  const download = controller.download(); await controller.download(); assert.equal(downloads, 1);
  controller.cancel(); updater.emit('update-downloaded'); updater.emit('download-progress', { percent: 90 });
  await download; assert.equal(controller.state.status, 'canceled');
  controller.install(); assert.equal(installed, 0);
  await controller.check(); assert.equal(controller.state.status, 'available');
  const retry = controller.download(); updater.emit('update-downloaded'); finish.resolve(); await retry;
  controller.install(); controller.install(); assert.equal(installed, 1);
});

test('Update launch attempts persist daily, skip only suppresses automatic prompts, and accepted download restarts only when idle', async () => {
  let time = 86400000, preferences = {}, checks = 0, prompts = 0, installs = 0, allowed = true, choice = 2;
  const state = { status: 'idle', version: '3.2', notes: 'Release notes' };
  const controller = { state, async check() { checks++; state.status = 'available'; },
    async download() { state.status = 'downloaded'; }, install() { installs++; state.status = 'installing'; } };
  const flow = createUpdateFlow({ controller, load: () => preferences, save: x => { preferences = x; },
    choose: async () => { prompts++; return choice; }, show() {}, notify() {}, canInstall: () => allowed, now: () => time });
  await flow.check(false); assert.equal(checks, 1); assert.equal(prompts, 1); assert.equal(preferences.skippedVersion, '3.2');
  await flow.check(false); assert.equal(checks, 1);
  time += 86400000; await flow.check(false); assert.equal(checks, 2); assert.equal(prompts, 1);
  choice = 0; allowed = false; await flow.check(true); assert.equal(prompts, 2); assert.equal(installs, 0); assert.equal(state.status, 'downloaded');
  state.status = 'available'; allowed = true; await flow.download(); assert.equal(installs, 1);
});
