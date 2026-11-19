import {createHash} from 'node:crypto';
import {readVendorSSE} from '../../server/src/providers/types.ts';
import {ComparisonFailure} from './model-comparison.mts';
import type {OfflineTransport} from './model-comparison.mts';
import type {ModelID, ComparisonUsage} from './model-comparison-budget.mts';

export const ENDPOINTS = {
  'gpt-6-astra':'https://api.openai.com/v1/chat/completions',
  'gpt-6.1-terra':'https://api.openai.com/v1/chat/completions',
  'deepseek-flash':'https://api.deepseek.com/chat/completions',
} as const;
const controlled = new WeakSet<object>();
export const isControlledTransport = (value: object) => controlled.has(value);
type RequestArgs = Parameters<OfflineTransport['invoke']>[0];

/** The CLI supplies the authorization recheck. Tests inject both HTTP and credentials;
 * this module never reads environment variables, files, or SDK credential stores. */
export function createControlledTransport(options: {
  assertAuthorized(): void;
  credentialFor(model:ModelID): string;
  fetchImpl?: typeof fetch;
  expectedModels: Record<ModelID,string[]>;
  effortExperiment?: {kind:'cab_effort_screening_v1'; assertRequest(args:RequestArgs):void};
}): OfflineTransport {
  options.assertAuthorized();
  const transport: OfflineTransport = {kind:'authorized-live', async invoke(args:RequestArgs) {
    try{options.assertAuthorized();}catch{throw new ComparisonFailure('authorization_revoked');}
    const {request,model,signal,onDelta,onProgress,onUsage} = args;
    if (request.url !== ENDPOINTS[model] || request.body.model !== model) throw new ComparisonFailure('endpoint_mismatch');
    if(options.effortExperiment){
      if(options.effortExperiment.kind!=='cab_effort_screening_v1')throw new ComparisonFailure('effort_scope_mismatch');
      try{options.effortExperiment.assertRequest(args);}catch{throw new ComparisonFailure('effort_scope_mismatch');}
    }else if(request.body.reasoning_effort!=='low')throw new ComparisonFailure('effort_scope_mismatch');
    signal.throwIfAborted();
    // Credential resolution is deliberately after every approval and budget gate.
    const key=options.credentialFor(model);
    if (!key || /[\r\n]/u.test(key)) throw new ComparisonFailure('credential_unavailable');
    let response:Response;
    try {
      response=await (options.fetchImpl ?? globalThis.fetch)(request.url, {
        method:'POST',redirect:'error',signal,
        headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(request.body),
      });
    } catch(error) {
      if (error instanceof TypeError && !signal.aborted) throw new ComparisonFailure('network_error',true,250);
      throw new ComparisonFailure('transport_error');
    }
    if (response.status===429) {
      const value=await response.clone().json().catch(()=>null) as {error?:{code?:string}}|null;
      if (['insufficient_quota','billing_hard_limit_reached'].includes(value?.error?.code ?? '')) {
        await response.body?.cancel().catch(()=>{});throw new ComparisonFailure('billing_quota');
      }
    }
    if ([429,502,503,504].includes(response.status)) {
      const header=response.headers.get('retry-after');
      const delay=header===null?500:/^\d+$/u.test(header)?Number(header)*1000:Date.parse(header)-Date.now();
      await response.body?.cancel().catch(()=>{});
      throw new ComparisonFailure('http_transient',true,Number.isFinite(delay)?Math.max(500,delay):500);
    }
    if (!response.ok || !response.body || !/^text\/event-stream\b/iu.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(()=>{});
      throw new ComparisonFailure(response.status===401||response.status===403?'account_rejected':'invalid_response');
    }
    let returnedModel:string|undefined,serviceTier:string|undefined,usage:ComparisonUsage|null=null;
    let finishReason:string|null=null,done=false,seenUsage=false,bytes=0,usageDigest:string|undefined;
    try {
      await readVendorSSE(response.body,payload=>{
        if (signal.aborted) throw new ComparisonFailure('transport_canceled');
        bytes+=Buffer.byteLength(JSON.stringify(payload));
        if(bytes>2*1024*1024)throw new ComparisonFailure('response_limit');
        const ev=payload as any;
        if(ev.error)throw new ComparisonFailure('upstream_stream_error');
        if(typeof ev.model!=='string'||!options.expectedModels[model].includes(ev.model)
          ||returnedModel!==undefined&&returnedModel!==ev.model)throw new ComparisonFailure('model_identity_mismatch');
        returnedModel=ev.model;
        if(ev.service_tier!=null){
          if(model!=='deepseek-flash'&&ev.service_tier!=='default')throw new ComparisonFailure('service_tier_mismatch');
          serviceTier=ev.service_tier;
        }
        if(!Array.isArray(ev.choices)||ev.choices.length>1||seenUsage)throw new ComparisonFailure('invalid_stream_frame');
        // Existing OpenAI provider treats a valid OpenAI event as first progress.
        if(model!=='deepseek-flash')onProgress();
        const choice=ev.choices[0];
        if(choice?.delta?.refusal)throw new ComparisonFailure('refusal');
        if(typeof choice?.delta?.reasoning_content==='string'&&choice.delta.reasoning_content.length)onProgress();
        if(typeof choice?.delta?.content==='string'&&choice.delta.content.length)onDelta(choice.delta.content);
        if(typeof choice?.finish_reason==='string')finishReason=choice.finish_reason;
        if(ev.usage){
          const u=ev.usage;
          if(!Number.isSafeInteger(u.prompt_tokens)||u.prompt_tokens<1||!Number.isSafeInteger(u.completion_tokens)
            ||u.completion_tokens<0||u.completion_tokens>8192)throw new ComparisonFailure('invalid_usage');
          const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;
          usage={inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens,details:{
            cachedInputTokens:count(u.prompt_tokens_details?.cached_tokens),cacheWriteInputTokens:count(u.prompt_tokens_details?.cache_creation_tokens),
            reasoningOutputTokens:count(u.completion_tokens_details?.reasoning_tokens),
            cacheHitTokens:count(u.prompt_cache_hit_tokens),cacheMissTokens:count(u.prompt_cache_miss_tokens)}};seenUsage=true;
          usageDigest=createHash('sha256').update(JSON.stringify(u)).digest('hex');
          onUsage(usage);
        }
      },()=>{done=true;});
    } catch(error){
      if(error instanceof ComparisonFailure)throw error;
      if(error instanceof TypeError&&!signal.aborted)throw new ComparisonFailure('network_error',true,250);
      throw new ComparisonFailure('invalid_stream');
    }
    if(!done)throw new ComparisonFailure('incomplete_stream',true,250);
    if(model!=='deepseek-flash'&&serviceTier!=='default')throw new ComparisonFailure('service_tier_unconfirmed');
    return {usage,finishReason,returnedModel,serviceTier,meteringComplete:!!usage&&!!finishReason&&done,usageDigest};
  }};
  controlled.add(transport);return transport;
}
