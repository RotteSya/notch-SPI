import type {ProviderTimingStage} from './capture-timing.ts';

/** Operational metadata only. No prompts, images, answers, credentials or raw errors. */
export interface AttemptDiagnostics {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  startupLimitMs: number;
  outcome: 'completed' | 'startup_timeout' | 'generation_timeout' | 'canceled' | 'network_error' | 'incomplete_stream' | 'supplier_rejection' | 'client_disconnect' | 'worker_lease_lost' | 'output_limit' | 'upstream_error';
  stages: Partial<Record<ProviderTimingStage | 'firstProgress', number>>;
  httpStatus?: number;
  upstreamRequestId?: string;
  usageReceived: boolean;
  usageValidated: boolean;
  /** True only when the separate verified usage evidence exists durably (or in the test memory store). */
  usageEvidencePersisted: boolean;
}
export class AttemptTrace {
  private readonly started = performance.now();
  readonly startedAt = new Date().toISOString();
  readonly stages: AttemptDiagnostics['stages'] = {};
  httpStatus?: number;
  upstreamRequestId?: string;
  usageReceived = false;
  usageValidated = false;
  mark(stage: ProviderTimingStage | 'firstProgress') {
    if(stage==='upstreamUsage') this.usageReceived=true;
    this.stages[stage] ??= Math.round(performance.now() - this.started);
  }
  headers(headers: Record<string,string>, status?: number) {
    if (Number.isInteger(status) && status! >= 100 && status! <= 599) this.httpStatus = status;
    const id = headers['x-request-id'];
    if (id && /^[A-Za-z0-9_-]{1,200}$/.test(id)) this.upstreamRequestId = id;
  }
  finish(outcome: AttemptDiagnostics['outcome'], startupLimitMs: number): AttemptDiagnostics {
    return {startedAt:this.startedAt,endedAt:new Date().toISOString(),durationMs: Math.round(performance.now()-this.started),startupLimitMs,outcome,
      stages: {...this.stages},httpStatus:this.httpStatus,upstreamRequestId:this.upstreamRequestId,usageReceived:this.usageReceived,usageValidated:this.usageValidated,usageEvidencePersisted:false};
  }
}
