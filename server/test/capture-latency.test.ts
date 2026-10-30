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

test('three visible metrics accept interleaved draws and keep absent endpoints missing', () => {
  const logs = [event('triggered', 0), event('feedbackRequested', 2), event('captureReady', 10),
    event('firstDelta', 20), event('feedbackDraw', 25), event('completed', 30),
    event('firstAnswerDraw', 31), event('renderStarted', 32)].join('\n');
  const group = captureLatencyReport([logs]).groups[0]!;
  assert.equal(group.metrics.feedback.median_ms, 25);
  assert.equal(group.metrics.first_answer.median_ms, 31);
  assert.equal(group.metrics.complete_answer.median_ms, 32);
  assert.equal(group.metrics.complete_answer.p95_ms, null);
  const absent = captureLatencyReport([event('triggered', 0)]).groups[0]!;
  assert.equal(absent.metrics.first_answer.n, 0);
  assert.equal(absent.metrics.first_answer.median_ms, null);
  assert.throws(() => captureLatencyReport([[event('triggered', 0), event('firstDelta', 20), event('firstAnswerDraw', 10)].join('\n')]));
});


test('first-answer mean target differs from full-answer maximum and never hides failed attempts', () => {
  const sample = (suffix: string, first: number, terminal = 'renderStarted') => {
    const extra = {id: id.slice(0, -1) + suffix};
    return [event('triggered', 0, extra), event('firstDelta', first - 20, extra),
      event('firstAnswerDraw', first, extra),
      ...(terminal === 'renderStarted' ? [event('completed', first + 100, extra)] : []),
      event(terminal, first + 200, extra)].join('\n');
  };
  const logs = [sample('1', 4000), sample('2', 7000)];
  const group = captureLatencyReport(logs, 6000).groups[0]!;
  assert.equal(group.metrics.first_answer.mean_ms, 5500);
  assert.equal(group.metrics.first_answer.max_ms, 7000);
  assert.equal(group.first_answer_mean_target_met_in_sample, true);
  assert.equal(group.target_met_in_sample, false);
  assert.equal(captureLatencyReport([sample('1', 6000)], 6000).groups[0]!.first_answer_mean_target_met_in_sample, false);
  for (const incomplete of [sample('3', 100, 'failed'), event('triggered', 0, {id: id.slice(0, -1) + '3'})]) {
    assert.equal(captureLatencyReport([...logs, incomplete], 6000).groups[0]!.first_answer_mean_target_met_in_sample, false);
  }
  for (const target of [0, -1, NaN, Infinity]) assert.throws(() => captureLatencyReport(logs, target));
});
