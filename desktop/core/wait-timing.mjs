import {randomUUID} from 'node:crypto';
// Monotonic, per-run milestones. No content or transport errors enter the report.
export function createWaitTiming(record, now = () => performance.now()) {
  const id = randomUUID(), started = now(), seen = new Set();
  return {id, mark(phase) {
    if (seen.has(phase)) return;
    seen.add(phase);
    record('wait_timing', {timing_id:id, phase, total_ms:Math.max(0, now()-started)});
  }};
}
