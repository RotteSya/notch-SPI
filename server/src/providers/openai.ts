import type { CaptureRequest, Provider, Usage } from './types.ts';
import { readVendorSSE } from './types.ts';
import { vendorErrorMessage } from './anthropic.ts';

export type AstraTier = 'default' | 'fast';

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
    this.astraTier = options.astraTier;
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
      ...(tier ? { max_completion_tokens: maxTokens, reasoning_effort: 'low', service_tier: tier, store: false }
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
      },
      body: serialized,
      signal,
    });

    req.onTiming?.('upstreamHeaders');
    if (!res.ok || !res.body) {
      throw new Error(await vendorErrorMessage(res));
    }
    if (tier && !/^text\/event-stream\b/iu.test(res.headers.get('content-type') ?? '')) {
      await res.body.cancel().catch(() => {});
      throw new Error('Invalid Astra response content type');
    }

    const usage: Usage = { inputTokens: null, outputTokens: null };
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
        if (typeof ev.model !== 'string' || !/^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/u.test(ev.model) ||
            (responseModel !== undefined && ev.model !== responseModel)) throw new Error('Unexpected Astra response model');
        responseModel = ev.model;
        if (ev.service_tier != null) {
          if (ev.service_tier !== tier) throw new Error('Unexpected Astra service tier');
          tierConfirmed = true;
        }
        if (!Array.isArray(ev.choices) || ev.choices.length > 1 || usage.inputTokens !== null) {
          throw new Error('Invalid Astra response frame');
        }
        if (ev.choices[0]?.delta?.refusal) throw new Error('Astra refused the request');
        onProgress?.();
      }
      const finishReason = ev.choices?.[0]?.finish_reason;
      if (typeof finishReason === 'string') usage.finishReason = finishReason;
      const reasoning = ev.choices?.[0]?.delta?.reasoning_content;
      // Reasoning is activity, not answer text. Never forward its contents to clients.
      if (typeof reasoning === 'string' && reasoning.length > 0) {req.onTiming?.('upstreamFirstReasoning');onProgress?.();}
      const text = ev.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text.length > 0) {req.onTiming?.('upstreamFirstAnswer');onDelta(text);}
      if (ev.usage) {
        if (tier && (!Number.isSafeInteger(ev.usage.prompt_tokens) || (ev.usage.prompt_tokens ?? 0) < 1 ||
            !Number.isSafeInteger(ev.usage.completion_tokens) || (ev.usage.completion_tokens ?? 0) < 1 ||
            (ev.usage.completion_tokens ?? 0) > maxTokens)) throw new Error('Invalid Astra usage');
        usage.inputTokens = typeof ev.usage.prompt_tokens === 'number' ? ev.usage.prompt_tokens : usage.inputTokens;
        usage.outputTokens = typeof ev.usage.completion_tokens === 'number' ? ev.usage.completion_tokens : usage.outputTokens;
      }
    }, tier ? () => { done = true; } : undefined);
    if (tier && (!done || !tierConfirmed || usage.inputTokens === null || !usage.finishReason)) {
      throw new Error('Incomplete Astra response');
    }
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
