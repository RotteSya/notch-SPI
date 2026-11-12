import { composeObjectiveResult, normalizeObjectiveAnswer, OBJECTIVE_RESULT_MARKER } from '../objective-result.ts';
import { estimateAstraWire } from './astra-budget.ts';
import { OpenAIProvider } from './openai.ts';
import type { CaptureRequest, Provider, Usage } from './types.ts';

export const ASTRA_MODEL = 'gpt-6-astra';
export const ASTRA_STANDARD_PRICE_KEY = `openai:${ASTRA_MODEL}`;
export const ASTRA_FAST_PRICE_KEY = `${ASTRA_STANDARD_PRICE_KEY}:fast`;
export const ASTRA_CONTEXT_TOKENS = 1_050_000;
export const ASTRA_MAX_COMPLETION_TOKENS = 8192;

function parseReviewResult(raw: string) {
  const parsed = composeObjectiveResult(raw);
  if (!parsed.result || parsed.parserPath !== 'v1' || parsed.violations.length) return null;
  const lines = raw.replace(/\r\n?/gu, '\n').trimEnd().split('\n');
  const retake = parsed.state === 'retake';
  if (lines.length !== (retake ? 1 : 2) || (!retake && !lines[0]?.startsWith('FINAL: '))) return null;
  // The five flat fields must occur exactly once. JSON.parse alone allows duplicate keys.
  const payload = lines.at(-1)!.slice(OBJECTIVE_RESULT_MARKER.length);
  const tokens = payload.match(/"(?:[^"\\]|\\[\s\S])*"|:/gu);
  return tokens?.filter(token => token === ':').length === 5 ? parsed.result : null;
}

function optionLabel(answer: string): string | undefined {
  const match = /^([A-J])(?:$|[.、: ]\s*(\S.*))$/u.exec(normalizeObjectiveAnswer(answer));
  if (!match || match[2] && /(?:^|\b|[,、/|])(?:[A-J])(?:$|[.、: )])/u.test(match[2])) return undefined;
  return match[1];
}

function reviewPair(raw: string): string[] | null {
  const result = parseReviewResult(raw);
  if (result?.kind !== 'single_choice' || result.state !== 'review' || result.reason !== 'ambiguous_options') return null;
  const options = normalizeObjectiveAnswer(result.answer ?? '').split(' or ');
  const [first, second] = options.map(optionLabel);
  return options.length === 2 && first && second && first !== second ? [first, second] : null;
}

export class AstraProvider implements Provider {
  readonly name = 'openai';
  private readonly standard: OpenAIProvider;
  private readonly fast?: OpenAIProvider;
  private readonly globalEndpoint: boolean;

  constructor(key: string, baseURL: string, maxTokens: number, fastReview: boolean) {
    this.globalEndpoint = baseURL.replace(/\/+$/u, '') === 'https://api.openai.com';
    this.standard = new OpenAIProvider(key, baseURL, ASTRA_MODEL, maxTokens, { astraTier: 'default' });
    if (fastReview) this.fast = new OpenAIProvider(key, baseURL, ASTRA_MODEL, maxTokens, { astraTier: 'fast' });
  }

  async estimateReservation(req: CaptureRequest, pricingJSON: string) {
    if (!this.globalEndpoint) throw new Error('Request budget requires the global OpenAI endpoint');
    return estimateAstraWire(JSON.stringify(this.standard.requestBody(req)), pricingJSON,
      !!this.fast && (req.purpose === undefined || req.purpose === 'answer'));
  }

  async stream(req: CaptureRequest, onDelta: (text: string) => void, signal: AbortSignal, onProgress?: () => void): Promise<Usage> {
    const mayReview = !!this.fast && (req.purpose === undefined || req.purpose === 'answer') && !req.tutorResultV1;
    // A review route owns one aggregate reservation. A first-leg meter must never
    // reconcile the still-unknown second leg as though it had cost nothing.
    const meteredRequest = mayReview ? {...req, onHeaders: req.onHeaders, onUsage: undefined} : req;
    const collect = async (provider: OpenAIProvider) => {
      signal.throwIfAborted();
      let raw = '';
      const usage = await provider.stream(meteredRequest, chunk => {
        raw += chunk;
        if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('Astra answer is too large');
      }, signal, onProgress);
      return { raw, usage };
    };

    const first = await collect(this.standard);
    signal.throwIfAborted();
    const answering = req.purpose === undefined || req.purpose === 'answer';
    const pair = this.fast && answering && !req.tutorResultV1 && first.usage.finishReason === 'stop' ? reviewPair(first.raw) : null;
    if (!this.fast || !pair) {
      if (first.usage.finishReason === 'stop' && first.raw) onDelta(first.raw);
      if (mayReview) req.onUsage?.(first.usage);
      return first.usage;
    }

    const second = await collect(this.fast);
    signal.throwIfAborted();
    let finishReason = second.usage.finishReason;
    if (second.usage.finishReason === 'stop') {
      const result = parseReviewResult(second.raw);
      if (!result) finishReason = 'protocol_invalid';
      else {
        const label = result.kind === 'single_choice' && result.state === 'ready' ? optionLabel(result.answer ?? '') : undefined;
        onDelta(result.state === 'retake' || (label !== undefined && pair.includes(label)) ? second.raw : first.raw);
      }
    }

    // The Astra wire adapter rejects missing usage before returning a call.
    const attempts = [
      { pricingModel: ASTRA_STANDARD_PRICE_KEY, inputTokens: first.usage.inputTokens!, outputTokens: first.usage.outputTokens! },
      { pricingModel: ASTRA_FAST_PRICE_KEY, inputTokens: second.usage.inputTokens!, outputTokens: second.usage.outputTokens! },
    ];
    const combined: Usage = {
      inputTokens: attempts[0]!.inputTokens + attempts[1]!.inputTokens,
      outputTokens: attempts[0]!.outputTokens + attempts[1]!.outputTokens,
      finishReason,
      attempts,
    };
    req.onUsage?.(combined);
    return combined;
  }
}
