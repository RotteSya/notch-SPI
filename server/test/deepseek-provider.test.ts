import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.ts';
import { makeObjectiveProvider, makeProvider } from '../src/providers/index.ts';
import { OpenAIProvider } from '../src/providers/openai.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('DeepSeek provider uses the vision endpoint, non-thinking mode, and OpenAI SSE usage', async (t) => {
  let calledURL = '';
  let calledInit: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calledURL = String(input);
    calledInit = init;
    const stream = [
      'data: {"choices":[{"delta":{"content":"B"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":347,"completion_tokens":1}}',
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const provider = new OpenAIProvider('secret-value', 'https://api.deepseek.com/',
    'deepseek-v4-flash-vision-exp', 4096, {
      name: 'deepseek',
      endpointPath: 'chat/completions',
      extraBody: { thinking: { type: 'disabled' }, temperature: 0 },
    });
  let text = '';
  const usage = await provider.stream({
    system: 'system',
    task: 'task',
    images: [{ mediaType: 'image/png', base64: 'QUJD' }],
  }, (delta) => { text += delta; }, new AbortController().signal);

  assert.equal(provider.name, 'deepseek');
  assert.equal(calledURL, 'https://api.deepseek.com/chat/completions');
  assert.equal(calledInit?.headers && (calledInit.headers as Record<string, string>).authorization,
    'Bearer secret-value');
  const body = JSON.parse(String(calledInit?.body)) as Record<string, unknown>;
  assert.equal(body.model, 'deepseek-v4-flash-vision-exp');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.stream_options, { include_usage: true });
  const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
  assert.ok(messages[1]);
  assert.deepEqual(messages[1].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,QUJD' },
  });
  assert.equal(text, 'B');
  assert.deepEqual(usage, { inputTokens: 347, outputTokens: 1 });
});

test('DeepSeek configuration without its dedicated key fails closed', () => {
  const warnings: string[] = [];
  const built = makeProvider({ ...config, provider: 'deepseek', deepseekKey: '' },
    (warning) => warnings.push(warning));
  assert.equal(built.provider.name, 'mock');
  assert.match(built.degraded ?? '', /DEEPSEEK_API_KEY/);
  assert.equal(warnings.length, 1);
});

test('Objective treatment builds an isolated DeepSeek provider and model', () => {
  const warnings: string[] = [];
  const built = makeObjectiveProvider({
    ...config,
    provider: 'anthropic',
    model: 'claude-control',
    objectiveProvider: 'deepseek',
    objectiveProviderConfigurationError: null,
    objectiveModel: 'deepseek-treatment',
    deepseekKey: 'treatment-secret',
  }, (warning) => warnings.push(warning));
  assert.equal(built.provider.name, 'deepseek');
  assert.equal(built.degraded, null);
  assert.deepEqual(warnings, []);
});

test('invalid Objective provider configuration fails closed instead of inheriting control', () => {
  const warnings: string[] = [];
  const built = makeObjectiveProvider({
    ...config,
    objectiveProviderConfigurationError: 'OBJECTIVE_RESULT_V1_PROVIDER has unsupported value: typo',
  }, (warning) => warnings.push(warning));
  assert.equal(built.provider.name, 'mock');
  assert.match(built.degraded ?? '', /unsupported value/);
  assert.equal(warnings.length, 1);
});

test('thinking stays isolated to its slot, preserves token caps and never streams hidden reasoning', async (t) => {
  const bodies:Array<Record<string,unknown>>=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (_input,init)=>{
    bodies.push(JSON.parse(String(init?.body)));
    return new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}',
      'data: {"choices":[{"delta":{"content":"C"}}],"usage":{"prompt_tokens":150,"completion_tokens":350,"completion_tokens_details":{"reasoning_tokens":349}}}',
      'data: [DONE]','',
    ].join('\n'),{status:200,headers:{'content-type':'text/event-stream'}});
  };
  t.after(()=>{globalThis.fetch=originalFetch;});
  const selected={...config,provider:'deepseek' as const,objectiveProvider:'deepseek' as const,
    providerConfigurationError:null,objectiveProviderConfigurationError:null,deepseekKey:'test-key',
    deepseekReasoningEffort:'none' as const,objectiveDeepseekReasoningEffort:'low' as const,
    maxTokens:4096,objectiveMaxTokens:4096};
  const providers=[makeProvider(selected,()=>{}).provider,makeObjectiveProvider(selected,()=>{}).provider];
  for(const [i,provider] of providers.entries()) {
    let text='';
    const usage=await provider.stream({system:'system',task:'task',images:[],maxTokens:i===0?8192:768},
      delta=>{text+=delta;},new AbortController().signal);
    assert.equal(text,'C');assert.deepEqual(usage,{inputTokens:150,outputTokens:350});
  }
  assert.deepEqual(bodies[0]!.thinking,{type:'disabled'});assert.equal(bodies[0]!.temperature,0);
  assert.equal(bodies[0]!.reasoning_effort,undefined);assert.equal(bodies[0]!.max_tokens,4096);
  assert.deepEqual(bodies[1]!.thinking,{type:'enabled'});assert.equal(bodies[1]!.reasoning_effort,'low');
  assert.equal(bodies[1]!.temperature,undefined);assert.equal(bodies[1]!.max_tokens,768);
});

test('environment validates DeepSeek thinking settings and only inherits when omitted', async()=>{
  const code=`const {config}=await import(${JSON.stringify(new URL('../src/config.ts',import.meta.url).href)});console.log(JSON.stringify({official:config.deepseekReasoningEffort,objective:config.objectiveDeepseekReasoningEffort,officialError:config.providerConfigurationError,objectiveError:config.objectiveProviderConfigurationError}));`;
  const run=promisify(execFile);
  async function inspect(official:string,objective:string,provider='deepseek') {
    const result=await run(process.execPath,['--input-type=module','-e',code],{env:{...process.env,
      OFFICIAL_PROVIDER:provider,OBJECTIVE_RESULT_V1_PROVIDER:'deepseek',OFFICIAL_DEEPSEEK_REASONING_EFFORT:official,
      OBJECTIVE_RESULT_V1_DEEPSEEK_REASONING_EFFORT:objective},timeout:15_000});
    return JSON.parse(result.stdout);
  }
  assert.deepEqual(await inspect('',''),{official:'none',objective:'none',officialError:null,objectiveError:null});
  for(const effort of ['low','high','max']) {
    assert.deepEqual(await inspect(effort,''),{official:effort,objective:effort,officialError:null,objectiveError:null});
  }
  assert.deepEqual(await inspect('low','none'),{official:'low',objective:'none',officialError:null,objectiveError:null});
  const invalid=await inspect('none','typo');assert.equal(invalid.officialError,null);
  assert.match(invalid.objectiveError,/OBJECTIVE_RESULT_V1_DEEPSEEK_REASONING_EFFORT/);
  const inheritedInvalid=await inspect('typo','');assert.ok(inheritedInvalid.officialError);assert.ok(inheritedInvalid.objectiveError);
  const independent=await inspect('typo','low','anthropic');assert.equal(independent.officialError,null);assert.equal(independent.objectiveError,null);
});
