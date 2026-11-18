import type { CaptureRequest, Provider, Usage } from './types.ts';
import { readVendorSSE, TransientProviderError } from './types.ts';
import { vendorErrorMessage } from './anthropic.ts';
import { estimateTerraWire } from './astra-budget.ts';

export type AstraTier = 'default' | 'fast';
export const TERRA_MODEL = 'gpt-6.1-terra';

// These are persisted client slot IDs, not the vendor's effort names.
export function terraReasoningEffort(selection: CaptureRequest['reasoningEffort'] = 'low') {
  return ({low:'low',high:'medium',max:'high'} as const)[selection];
}

// Proxies to the OpenAI Chat Completions API (streaming). `stream_options.include_usage`
// makes the final chunk carry token usage. Vision image travels as a data-URI image_url.
export class OpenAIProvider implements Provider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly extraBody: Record<string, unknown>;
  private readonly explanationExtraBody: Record<string, unknown>;
  private readonly astraTier?: AstraTier;

  constructor(
    apiKey: string,
    baseURL: string,
    model: string,
    maxTokens: number,
    options: {
      name?: string;
      endpointPath?: string;
      extraBody?: Record<string, unknown>;
      explanationExtraBody?: Record<string, unknown>;
      astraTier?: AstraTier;
    } = {},
  ) {
    this.name = options.name ?? 'openai';
    this.apiKey = apiKey;
    this.endpoint = `${baseURL.replace(/\/+$/u, '')}/${(options.endpointPath ?? 'v1/chat/completions').replace(/^\/+/, '')}`;
    this.model = model;
    this.maxTokens = maxTokens;
    this.extraBody = options.extraBody ?? {};
    this.explanationExtraBody = options.explanationExtraBody ?? this.extraBody;
    this.astraTier = this.name === 'openai' && model === TERRA_MODEL ? 'default' : options.astraTier;
  }

  async estimateReservation(req: CaptureRequest, pricingJSON: string) {
    if (this.name !== 'openai' || this.model !== TERRA_MODEL || this.endpoint !== 'https://api.openai.com/v1/chat/completions') {
      throw new Error('Request budget requires the global Terra endpoint');
    }
    return estimateTerraWire(JSON.stringify(this.requestBody(req)), pricingJSON);
  }

  requestBody(req: CaptureRequest) {
    const extraBody = { ...(req.purpose === 'explain' ? this.explanationExtraBody : this.extraBody) };
    if (this.name === 'deepseek' && req.reasoningEffort !== undefined) {
      extraBody.thinking = { type: 'enabled' };
      extraBody.reasoning_effort = req.reasoningEffort;
      delete extraBody.temperature;
    }
    const tier = this.astraTier;
    const maxTokens = Math.min(req.maxTokens ?? this.maxTokens, this.maxTokens);
    return {
      model: this.model,
      ...(tier ? { max_completion_tokens: maxTokens,
        reasoning_effort: this.model === TERRA_MODEL ? terraReasoningEffort(req.reasoningEffort) : 'low', service_tier: tier, store: false }
        : { max_tokens: maxTokens }),
      stream: true,
      stream_options: { include_usage: true },
      ...extraBody,
      messages: [
        { role: tier ? 'developer' : 'system', content: req.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: req.task },
            ...req.images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType};base64,${img.base64}`, ...(tier ? { detail: 'high' } : {}) },
            })),
          ],
        },
      ],
    };
  }

  async stream(
    req: CaptureRequest,
    onDelta: (text: string) => void,
    signal: AbortSignal,
    onProgress?: () => void,
  ): Promise<Usage> {
    signal.throwIfAborted();
    const tier = this.astraTier;
    const maxTokens = Math.min(req.maxTokens ?? this.maxTokens, this.maxTokens);
    const body = this.requestBody(req);
    const serialized = JSON.stringify(body);
    req.onTiming?.('upstreamRequest');
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        ...(req.clientRequestId && /^[0-9a-f-]{36}$/i.test(req.clientRequestId) ? {'X-Client-Request-Id':req.clientRequestId} : {}),
      },
      body: serialized,
      signal,
    }).catch(error=>{
      if(error instanceof TypeError&&!signal.aborted)throw new TransientProviderError(0,250,'network');
      throw error;
    });

    req.onTiming?.('upstreamHeaders');
    const diagnostics:Record<string,string>={};
    for(const name of ['x-ratelimit-limit-requests','x-ratelimit-limit-tokens','x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens','x-ratelimit-reset-requests','x-ratelimit-reset-tokens','x-ratelimit-limit-project-tokens','x-ratelimit-remaining-project-tokens','openai-organization','openai-project','x-request-id']){
      const value=res.headers.get(name);if(value&&value.length<=200)diagnostics[name]=value;
    }
    req.onHeaders?.(diagnostics, res.status);
    if(res.status===429){
      const body=await res.clone().json().catch(()=>null) as {error?:{code?:string}}|null;
      if(['insufficient_quota','billing_hard_limit_reached'].includes(body?.error?.code??'')){
        await res.body?.cancel().catch(()=>{});throw new Error('Upstream billing quota unavailable');
      }
    }
    if ([429,502,503,504].includes(res.status)) {
      const header=res.headers.get('retry-after');
      const after=header===null?500:/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-Date.now();
      await res.body?.cancel().catch(()=>{});
      throw new TransientProviderError(res.status,Number.isFinite(after)?Math.max(500,after):500);
    }
    if (!res.ok || !res.body) {
      throw new Error(await vendorErrorMessage(res));
    }
    if (tier && !/^text\/event-stream\b/iu.test(res.headers.get('content-type') ?? '')) {
      await res.body.cancel().catch(() => {});
      throw new Error('Invalid reasoning model response content type');
    }

    const usage: Usage = { inputTokens: null, outputTokens: null };
    // Preserve the official Astra path's complete-answer delivery for Terra too.
    const terra = this.name === 'openai' && this.model === TERRA_MODEL;
    let bufferedAnswer = '';
    let responseModel: string | undefined;
    let tierConfirmed = false;
    let done = false;
    await readVendorSSE(res.body, (payload) => {
      req.onTiming?.('upstreamFirstEvent');
      const ev = payload as OpenAIChunk;
      // An OpenAI-compatible endpoint can emit `{"error":{...}}` on an HTTP-200 stream. Throw so
      // the capture route treats it as a failure and never charges (mirrors the Anthropic
      // provider); otherwise it would look like an empty but successful answer.
      if (ev.error) throw new Error(ev.error.message ?? 'OpenAI 流式错误');
      if (tier) {
        if (typeof ev.model !== 'string' || !(terra ? ev.model === TERRA_MODEL : /^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/u.test(ev.model)) ||
            (responseModel !== undefined && ev.model !== responseModel)) throw new Error('Unexpected reasoning model response');
        responseModel = ev.model;
        if (ev.service_tier != null) {
          if (ev.service_tier !== tier) throw new Error('Unexpected reasoning model service tier');
          tierConfirmed = true;
        }
        if (!Array.isArray(ev.choices) || ev.choices.length > 1 || usage.inputTokens !== null) {
          throw new Error('Invalid reasoning model response frame');
        }
        if (ev.choices[0]?.delta?.refusal) throw new Error('Reasoning model refused the request');
        onProgress?.();
      }
      const finishReason = ev.choices?.[0]?.finish_reason;
      if (typeof finishReason === 'string') usage.finishReason = finishReason;
      const reasoning = ev.choices?.[0]?.delta?.reasoning_content;
      // Reasoning is activity, not answer text. Never forward its contents to clients.
      if (typeof reasoning === 'string' && reasoning.length > 0) {req.onTiming?.('upstreamFirstReasoning');onProgress?.();}
      const text = ev.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        req.onTiming?.('upstreamFirstAnswer');
        if (terra) {
          bufferedAnswer += text;
          if (Buffer.byteLength(bufferedAnswer) > 64 * 1024) throw new Error('Terra answer is too large');
        } else onDelta(text);
      }
      if (ev.usage) {
        req.onTiming?.('upstreamUsage');
        if (tier && (!Number.isSafeInteger(ev.usage.prompt_tokens) || (ev.usage.prompt_tokens ?? 0) < 1 ||
            !Number.isSafeInteger(ev.usage.completion_tokens) || (ev.usage.completion_tokens ?? 0) < 1 ||
            (ev.usage.completion_tokens ?? 0) > maxTokens)) throw new Error('Invalid reasoning model usage');
        usage.inputTokens = typeof ev.usage.prompt_tokens === 'number' ? ev.usage.prompt_tokens : usage.inputTokens;
        usage.outputTokens = typeof ev.usage.completion_tokens === 'number' ? ev.usage.completion_tokens : usage.outputTokens;
        if ((!tier || tierConfirmed) && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens)
          && usage.inputTokens! >= 0 && usage.outputTokens! >= 0) {
          req.onUsage?.({...usage, upstreamModel: responseModel, ...(tier ? {serviceTier: tier} : {})});
        }
      }
    }, tier ? () => { done = true; } : undefined).catch(error=>{
      if(error instanceof TypeError&&!signal.aborted)throw new TransientProviderError(0,250,'network');
      throw error;
    });
    if(tier&&!done&&!signal.aborted)throw new TransientProviderError(0,250,'incomplete_stream');
    if (tier && (!done || !tierConfirmed || usage.inputTokens === null || !usage.finishReason)) {
      throw new Error('Incomplete reasoning model response');
    }
    if (tier) {
      usage.upstreamModel = responseModel;
      usage.serviceTier = tier;
    }
    if (terra) { signal.throwIfAborted(); if (usage.finishReason === 'stop' && bufferedAnswer) onDelta(bufferedAnswer); }
    return usage;
  }
}

interface OpenAIChunk {
  model?: string;
  service_tier?: string | null;
  choices?: Array<{ finish_reason?: string | null; delta?: { content?: string; reasoning_content?: string; refusal?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}
