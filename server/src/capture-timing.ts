/** Content-free, opt-in monotonic timing. Off by default; never changes the SSE contract. */
export type ProviderTimingStage = 'upstreamRequest' | 'upstreamHeaders' | 'upstreamFirstEvent' | 'upstreamFirstReasoning' | 'upstreamFirstAnswer';

/** Boot-time diagnostic whitelist; never spread config or log arbitrary configured strings. */
export function captureRuntimePolicy(config: {
  model: string; objectiveModel: string; maxTokens: number; objectiveMaxTokens: number;
  deepseekReasoningEffort: string; objectiveDeepseekReasoningEffort: string;
}) {
  const limit = (n: number) => Number.isSafeInteger(n) && n > 0 ? n : null;
  const effort = (s: string) => ['none', 'low', 'high', 'max'].includes(s) ? s : 'other';
  return {
    officialMaxTokens: limit(config.maxTokens), objectiveMaxTokens: limit(config.objectiveMaxTokens),
    officialModelIsDeepseekFlash: config.model === 'deepseek-flash',
    objectiveModelIsDeepseekFlash: config.objectiveModel === 'deepseek-flash',
    officialReasoningEffort: effort(config.deepseekReasoningEffort),
    objectiveReasoningEffort: effort(config.objectiveDeepseekReasoningEffort),
  };
}
export type CaptureTimingStage = ProviderTimingStage | 'handlerStarted' | 'authReady' | 'validationReady' | 'reapReady' | 'duplicateCheckReady' | 'budgetReady' | 'admissionReady' | 'providerStarted' | 'firstDeltaSent' | 'providerCompleted' | 'handlerFinished' | 'responseFinishing';
export class CaptureTiming {
  private readonly started: number;
  private readonly now: () => number;
  readonly offsets: Partial<Record<CaptureTimingStage, number>> = {};
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.started = now();
    this.offsets.handlerStarted = 0;
  }
  mark(stage: CaptureTimingStage): void {
    if (this.offsets[stage] === undefined) this.offsets[stage] = Math.max(0, this.now() - this.started);
  }
}
