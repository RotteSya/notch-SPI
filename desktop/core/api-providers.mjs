// Windows adapter for Sources/NotchSPI/Cloud/APIProvider.swift (3.1/30).
// The native registry remains the reference; parity tests detect drift.
export const apiProviders = [
  { id: 'anthropic', consoleURL: 'https://console.anthropic.com/settings/keys', name: 'Claude', protocol: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-opus-4-8' },
  { id: 'deepseek', consoleURL: 'https://platform.deepseek.com/api_keys', name: 'DeepSeek · Vision Exp', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash-vision-exp' },
  { id: 'openai', consoleURL: 'https://platform.openai.com/api-keys', name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5' },
  { id: 'gemini', consoleURL: 'https://aistudio.google.com/app/apikey', name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash' },
  { id: 'grok', consoleURL: 'https://console.x.ai', name: 'xAI Grok', endpoint: 'https://api.x.ai/v1/chat/completions', model: 'grok-4' },
  { id: 'qwen', consoleURL: 'https://bailian.console.aliyun.com/', name: '通义千问 Qwen', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-max' },
  { id: 'zhipu', consoleURL: 'https://open.bigmodel.cn/usercenter/apikeys', name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v' },
  { id: 'moonshot', consoleURL: 'https://platform.moonshot.cn/console/api-keys', name: '月之暗面 Kimi', endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k-vision-preview' },
  { id: 'openrouter', consoleURL: 'https://openrouter.ai/keys', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o' },
  { id: 'custom', name: 'Custom', endpoint: '', model: '' },
].map(p => Object.freeze({ protocol: 'openai', keyPlaceholder: ({anthropic: 'sk-ant-…', gemini: 'AIza…', grok: 'xai-…', zhipu: '…', openrouter: 'sk-or-…'})[p.id] ?? 'sk-…', ...p }));

export function normalizeEndpoint(value) {
  const base = String(value ?? '').trim().replace(/\/$/, '');
  if (!base || base.includes('/chat/completions') || base.endsWith('/messages')) return base;
  return base + '/chat/completions';
}

// Custom providers have their own explicit endpoint (including local HTTP
// gateways/query parameters), unlike the official service's fixed HTTPS origin.
export function apiEndpoint(value) {
  const url = new URL(String(value ?? '').trim());
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash)
    throw new Error('Enter a valid HTTP or HTTPS API endpoint');
  return url.href;
}

export function providerSettings(current, patch = {}) {
  const next = { ...current, ...patch };
  const oldID = current.apiProvider ?? apiProviders.find(p => p.endpoint === current.endpoint)?.id ?? 'custom';
  const id = patch.apiProvider ?? oldID;
  const provider = apiProviders.find(p => p.id === id);
  if (!provider) throw new Error('Invalid API provider');
  const profiles = { ...(current.apiProfiles ?? {}) };
  profiles[oldID] = { endpoint: current.endpoint, model: current.model, protocol: current.protocol };
  if (id !== oldID) Object.assign(next, profiles[id] ?? {
    endpoint: provider.endpoint, model: provider.model, protocol: provider.protocol,
  });
  if (id !== 'custom') {
    next.endpoint = provider.endpoint;
    next.protocol = provider.protocol;
    next.model = String(next.model ?? '').trim() || provider.model;
  } else {
    next.endpoint = normalizeEndpoint(next.endpoint);
    next.model = String(next.model ?? '').trim();
    if (!['openai', 'anthropic'].includes(next.protocol)) throw new Error('Invalid API protocol');
  }
  profiles[id] = { endpoint: next.endpoint, model: next.model, protocol: next.protocol };
  return { ...next, apiProvider: id, apiProfiles: profiles };
}

export const apiCredentialKey = settings => settings.apiProvider
  ? 'api-provider:' + settings.apiProvider : 'api:' + settings.endpoint;

export async function providerKey(vault, settings) {
  const stored = await vault.get(apiCredentialKey(settings));
  if (stored != null) return stored; // An explicitly cleared key must not resurrect a legacy key.
  return (await vault.get('api:' + settings.endpoint)) ?? '';
}
