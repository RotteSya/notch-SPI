import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureLatencyReport } from '../../scripts/lib/capture-latency.mts';
const id = '00000000-0000-0000-0000-000000000001';
function event(stage: string, elapsed_ms: number, extra = {}) {
  return '[CaptureLatency] ' + JSON.stringify({ id, stage, elapsed_ms, channel: 'official', mode: 'tutor', entry: 'single', ...extra });
}
test('latency target uses full-answer draw and includes failures and missing endpoints', () => {
  const logs = [event('triggered', 0), event('firstDelta', 200), event('completed', 1980), event('renderStarted', 2010)].join('\n');
  const group = captureLatencyReport([logs]).groups[0]!;
  assert.equal(group.max_ms, 2010); assert.equal(group.target_met_in_sample, false);
  const missing = captureLatencyReport([event('triggered', 0)]).groups[0]!;
  assert.equal(missing.missing, 1); assert.equal(missing.max_ms, null); assert.equal(missing.target_met_in_sample, false);
  const failed = captureLatencyReport([[event('triggered', 0), event('failed', 30)].join('\n')]).groups[0]!;
  assert.equal(failed.failed, 1); assert.equal(failed.target_met_in_sample, false);
});
test('latency report keeps multi-image collection separate and accepts exactly 2000ms', () => {
  const single = [event('triggered', 0), event('completed', 1950), event('renderStarted', 2000)];
  const multi = [event('triggered', 0, {id: id.replace(/1$/, '2'), entry: 'multiple'})];
  const report = captureLatencyReport([[...single, ...multi].join('\n')]);
  assert.equal(report.groups[0]!.target_met_in_sample, true);
  assert.equal(report.groups[1]!.group, 'official/tutor/multiple');
  assert.equal(report.groups[1]!.missing, 1);
});
test('latency report rejects success without completion, duplicate records and time reversal', () => {
  for (const rows of [[event('triggered', 0), event('renderStarted', 100)],
    [event('triggered', 0), event('triggered', 0)],
    [event('triggered', 0), event('completed', 100), event('renderStarted', 90)]])
    assert.throws(() => captureLatencyReport([rows.join('\n')]));
});
