#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureLatencyReport} from './lib/capture-latency.mts';
import {loadComparisonPlan} from './run-model-comparison.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

/** Join the existing DEBUG CaptureLatency trace; never invent a draw time from TTFT.
 * The mapping binds exact input scope, output and capture identity. A replay stays a replay. */
export function joinClientTiming(result,trace,mapping,plan){
  assert.equal(mapping.config_sha256,plan.sourceIdentity.config_sha256);
  assert.equal(mapping.trace_sha256,sha(trace));
  assert.ok(['synthetic_replay','native_live_isolated'].includes(mapping.provenance));
  assert.match(mapping.client_build_sha256,/^[a-f0-9]{64}$/u);
  if(mapping.provenance==='native_live_isolated')assert.equal(result.metricsAreModelMeasurements,true);
  const report=captureLatencyReport([trace],2000,2000,'renderCompleted');
  const captures=report.groups.flatMap(g=>g.samples),used=new Set(),pairs=new Set();
  const rows=mapping.entries.map(link=>{
    assert.ok(!used.has(link.capture_id),'Duplicate capture mapping');used.add(link.capture_id);
    const pair=`${link.case_id}:${link.model}`;assert.ok(!pairs.has(pair),'Duplicate question mapping');pairs.add(pair);
    const item=plan.cases.find(c=>c.id===link.case_id);assert.ok(item);
    assert.deepEqual(link.image_sha256,item.images.map(i=>i.sha256));
    const row=result.rows.find(r=>r.caseId===link.case_id&&r.model===link.model);assert.ok(row);
    const attempt=result.attempts.find(a=>a.id===row.attemptIds.at(-1));assert.ok(attempt);
    assert.equal(link.output_sha256,attempt.outputSHA256,'Timing must belong to this complete answer');
    const capture=captures.find(c=>c.id===link.capture_id);assert.ok(capture);
    const eligible=item.expected?.expectation==='answerable'&&row.score.valid&&row.score.answer!==null&&!row.failure;
    const draw=capture.stages.renderCompleted;
    return {case_id:link.case_id,model:link.model,capture_id:link.capture_id,
      native_complete_valid_answer_ms:eligible&&draw!==undefined?draw:null,
      native_first_answer_draw_ms:capture.stages.firstAnswerDraw??null,
      complete_trace:draw!==undefined,answer_correct:row.score.correct,
      provenance:mapping.provenance,measurement:'trigger_to_completed_answer_draw_not_display_scanout'};
  });
  return {rows,unmapped_logical_results:result.rows.length-rows.length,
    native_model_e2e_measured:mapping.provenance==='native_live_isolated'&&rows.some(r=>r.native_complete_valid_answer_ms!==null),
    result_kind:mapping.provenance,trace_sha256:mapping.trace_sha256};
}
function localOutput(path){const root=process.cwd(),absolute=resolve(root,path);
  assert.ok(relative(root,absolute).startsWith('output/'),'Timing inputs must be under project output');
  assert.equal(realpathSync(absolute),absolute);return readFileSync(absolute,'utf8');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    assert.ok(args.length===6&&args[0]==='--results'&&args[2]==='--trace'&&args[4]==='--mapping',
      'Use --results output/... --trace output/... --mapping output/... (read-only)');
    process.stdout.write(JSON.stringify(joinClientTiming(JSON.parse(localOutput(args[1])),localOutput(args[3]),JSON.parse(localOutput(args[5])),loadComparisonPlan()),null,2)+'\n');
  }catch{process.stderr.write('Client timing import rejected; check scope, hashes and complete trace.\n');process.exitCode=1;}
}
