type Sample = { id: string; channel: string; mode: string; entry: string; stages: Record<string, number> };
const stages = ['triggered', 'captureReady', 'materialsReady', 'submitted', 'firstDelta',
  'receiptApplied', 'responseCompleted', 'completed', 'renderStarted', 'failed'];

/** Only the explicit, content-free QA records are accepted. Missing draws stay missing. */
export function captureLatencyReport(logs: string[], targetMS = 2000) {
  const samples = new Map<string, Sample>();
  for (const log of logs) for (const line of log.split('\n')) {
    if (!line.startsWith('[CaptureLatency] ')) continue;
    const event = JSON.parse(line.slice('[CaptureLatency] '.length));
    if (typeof event.id !== 'string' || !/^[a-f0-9-]{36}$/iu.test(event.id)
      || !['official', 'custom', 'cli'].includes(event.channel) || !['tutor', 'personality'].includes(event.mode)
      || !['single', 'multiple', 'direct', 'automatic'].includes(event.entry)
      || !stages.includes(event.stage) || typeof event.elapsed_ms !== 'number'
      || !Number.isFinite(event.elapsed_ms) || event.elapsed_ms < 0) throw new Error('Invalid latency record');
    const sample: Sample = samples.get(event.id) ?? { id: event.id, channel: event.channel, mode: event.mode, entry: event.entry, stages: {} };
    if (sample.channel !== event.channel || sample.mode !== event.mode || sample.entry !== event.entry
      || sample.stages[event.stage] !== undefined) throw new Error('Mixed or duplicate latency record');
    sample.stages[event.stage] = event.elapsed_ms;
    samples.set(event.id, sample);
  }
  const groups = new Map<string, Sample[]>();
  for (const sample of samples.values()) {
    const values = sample.stages;
    if (values.triggered !== 0) throw new Error('Missing trigger origin');
    const ordered = stages.filter(s => s !== 'failed').flatMap(s => values[s] === undefined ? [] : [values[s]!]);
    if (ordered.some((n, i) => i > 0 && n < ordered[i - 1]!)) throw new Error('Non-monotonic latency record');
    if (values.renderStarted !== undefined && (values.completed === undefined || values.failed !== undefined))
      throw new Error('Render cannot succeed without a completed answer');
    const key = `${sample.channel}/${sample.mode}/${sample.entry}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return {
    definition: 'trigger_to_first_visible_draw_of_completed_answer', target_ms: targetMS,
    environment: 'explicit_local_QA_trace_not_production_SLA',
    groups: [...groups].map(([group, rows]) => {
      const completed = rows.flatMap(r => r.stages.renderStarted === undefined ? [] : [r.stages.renderStarted]).sort((a, b) => a - b);
      const failed = rows.filter(r => r.stages.failed !== undefined).length;
      const missing = rows.length - completed.length - failed;
      const percentile = (p: number) => completed[Math.max(0, Math.ceil(completed.length * p) - 1)] ?? null;
      const maximum = completed.at(-1) ?? null;
      return { group, triggered: rows.length, rendered: completed.length, failed, missing,
        p50_ms: percentile(0.5), p95_ms: percentile(0.95), max_ms: maximum,
        over_target: completed.filter(n => n > targetMS).length,
        target_met_in_sample: maximum !== null && maximum <= targetMS && failed === 0 && missing === 0,
        samples: rows };
    }),
  };
}
