import { test } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
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

test('draw-completion acceptance never falls back to an earlier draw-entry timestamp', () => {
  const beginning = [event('triggered', 0), event('completed', 5900), event('renderStarted', 5990)];
  const logs = [...beginning, event('renderCompleted', 6010)].join('\n');
  const legacy = captureLatencyReport([logs], 6000, 10000);
  assert.equal(legacy.endpoint_is_draw_completion, false);
  assert.equal(legacy.groups[0]!.metrics.complete_answer.mean_ms, 5990);
  const strict = captureLatencyReport([logs], 6000, 10000, 'renderCompleted');
  assert.equal(strict.endpoint_is_draw_completion, true);
  assert.equal(strict.groups[0]!.metrics.complete_answer.mean_ms, 6010);
  assert.equal(strict.groups[0]!.complete_answer_timing_targets_met_in_sample, false);
  const missing = captureLatencyReport([beginning.join('\n')], 6000, 10000, 'renderCompleted').groups[0]!;
  assert.equal(missing.missing, 1); assert.equal(missing.rendered, 0);
  assert.equal(missing.complete_answer_timing_targets_met_in_sample, false);
  assert.throws(() => captureLatencyReport([[event('triggered', 0), event('completed', 5900), event('renderCompleted', 6010)].join('\n')]));
  assert.throws(() => captureLatencyReport([[...beginning, event('renderCompleted', 5980)].join('\n')]));
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

test('complete-answer mean accepts exactly six seconds with a separate ten-second limit', () => {
  const sample = (suffix:string,ms:number) => {
    const extra={id:id.slice(0,-1)+suffix};
    return [event('triggered',0,extra),event('firstDelta',100,extra),event('responseCompleted',ms-50,extra),
      event('completed',ms-20,extra),event('renderStarted',ms,extra)].join('\n');
  };
  const logs=[sample('1',4000),sample('2',6000),sample('3',8000)];
  const report=captureLatencyReport(logs,6000,10000),group=report.groups[0]!;
  assert.equal(report.quality_assessment,'not_present_in_timing_logs');
  assert.equal(group.metrics.complete_answer.mean_ms,6000);
  assert.equal(group.metrics.first_text.mean_ms,100);assert.equal(group.metrics.full_response.mean_ms,5950);
  assert.equal(group.target_met_in_sample,false);assert.equal(group.complete_answer_timing_targets_met_in_sample,true);
  assert.equal(group.over_target_rendered_fraction,1/3);assert.equal(group.over_single_limit_rendered_fraction,0);
  assert.equal(group.not_complete_within_target_fraction,1/3);assert.equal(group.p95_ms,null);
  const failed=[event('triggered',0,{id:id.slice(0,-1)+'4'}),event('failed',2000,{id:id.slice(0,-1)+'4'})].join('\n');
  const withFailure=captureLatencyReport([...logs,failed],6000,10000).groups[0]!;
  assert.equal(withFailure.complete_answer_timing_targets_met_in_sample,false);
  assert.equal(withFailure.failure_fraction,1/4);assert.equal(withFailure.not_complete_within_target_fraction,1/2);
  assert.equal(captureLatencyReport([sample('1',11000)],6000,10000).groups[0]!.over_single_question_limit,1);
  for (const limit of [0,5000,NaN,Infinity]) assert.throws(() => captureLatencyReport(logs,6000,limit));
});

test('both P95 fields remain absent below twenty samples', () => {
  const logs=Array.from({length:20},(_,index) => {
    const extra={id:'00000000-0000-0000-0000-'+(index+1).toString(16).padStart(12,'0')};
    return [event('triggered',0,extra),event('completed',index+1,extra),event('renderStarted',index+2,extra)].join('\n');
  });
  const small=captureLatencyReport(logs.slice(0,19)).groups[0]!;
  assert.equal(small.p95_ms,null);assert.equal(small.metrics.complete_answer.p95_ms,null);
  const full=captureLatencyReport(logs).groups[0]!;
  assert.equal(full.p95_ms,20);assert.equal(full.metrics.complete_answer.p95_ms,20);
});

test('CLI target options preserve the legacy default and reject malformed input', () => {
  const dir=mkdtempSync(join(tmpdir(),'nspi-latency-cli-'));
  try {
    const file=join(dir,'trace.log'),script=fileURLToPath(new URL('../../scripts/report-capture-latency.mjs',import.meta.url));
    writeFileSync(file,[event('triggered',0),event('completed',5900),event('renderStarted',6000)].join('\n'));
    const run=(args:string[]) => JSON.parse(execFileSync(process.execPath,[script,...args,file],{encoding:'utf8'}));
    assert.equal(run([]).target_ms,2000);
    const explicit=run(['--target-ms','6000','--single-limit-ms','10000']);
    assert.equal(explicit.single_question_limit_ms,10000);
    assert.equal(explicit.groups[0].complete_answer_timing_targets_met_in_sample,true);
    const strict=run(['--target-ms','6000','--single-limit-ms','10000','--draw-stage','renderCompleted']);
    assert.equal(strict.endpoint_stage,'renderCompleted');
    assert.equal(strict.groups[0].missing,1);
    assert.equal(strict.groups[0].complete_answer_timing_targets_met_in_sample,false);
    for (const args of [['--target-ms','0'],['--target-ms','6000','--target-ms','5000'],['--unknown','2'],['--target-ms','x'],['--draw-stage','unknown'],['--draw-stage','renderCompleted','--draw-stage','renderStarted']]) {
      assert.notEqual(spawnSync(process.execPath,[script,...args,file],{encoding:'utf8'}).status,0);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
