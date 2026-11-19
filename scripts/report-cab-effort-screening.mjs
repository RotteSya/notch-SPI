#!/usr/bin/env node
// Offline reporting only. No imports that can construct a model request or resolve credentials.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const DIR='output/cab-effort-screening-20261118';
const labels={'astra-low':'Astra low','terra-low':'Terra low','terra-medium':'Terra medium','terra-high':'Terra high'};
export function stats(values){const a=values.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b),n=a.length;
  return {n,median_ms:n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null,max_ms:n?a.at(-1):null,raw_ms:values};}
export function summarize(result){
  const byConfig=Object.keys(labels).map(configuration=>{
    const rows=result.rows.filter(r=>r.configuration===configuration),attempts=result.attempts.filter(a=>a.configuration===configuration);
    const correct=rows.filter(r=>r.content_score?.content_correct===true).length;
    const full=rows.filter(r=>r.protocolCompleteMs!==null).length,correctFull=rows.filter(r=>r.correctCompleteMs!==null).length;
    const protocolTiming=stats(rows.map(r=>r.protocolCompleteMs)),correctTiming=stats(rows.map(r=>r.correctCompleteMs));
    const unknown=attempts.filter(a=>a.costMicros===null||a.meteringComplete===false).length,known=attempts.reduce((s,a)=>s+(a.costMicros??0),0);
    const total=key=>attempts.reduce((s,a)=>s+(a.usage?.[key]??0),0);
    const details=key=>({known_total:attempts.reduce((s,a)=>s+(a.usage?.details?.[key]??0),0),missing_calls:attempts.filter(a=>a.usage?.details?.[key]==null).length});
    const cancelCorrect=rows.filter(r=>r.caseId==='F04'&&r.content_score?.content_correct).length;
    return {configuration,planned:8,started:rows.length,content_correct:correct,protocol_complete:full,correct_complete:correctFull,
      failures:rows.filter(r=>r.failure).length,format_issues:rows.filter(r=>!r.content_score?.protocol_valid).length,
      physical_calls:attempts.length,retries:attempts.filter(a=>a.purpose==='retry').length,
      protocol_timing:protocolTiming,correct_timing:correctTiming,all_attempted_wait:stats(rows.map(r=>r.timing.totalMs)),
      logical_first_answer:stats(rows.map(r=>r.timing.upstreamFirstAnswerMs)),physical_first_answer:stats(attempts.map(a=>a.upstreamFirstAnswerMs)),
      input_known_total:total('inputTokens'),output_known_total:total('outputTokens'),reasoning:details('reasoningOutputTokens'),cached:details('cachedInputTokens'),cacheWrite:details('cacheWriteInputTokens'),
      known_estimated_cost_usd:known/1e6,unknown_cost_calls:unknown,invoice_cost_usd:null,
      cost_per_correct_complete_usd:correctFull&&unknown===0?known/1e6/correctFull:null,
      cancel_correct:cancelCorrect,strict_correctness_met:rows.length===8&&correct===8&&full===8&&cancelCorrect===2,
      short_wait_met:full===8&&protocolTiming.median_ms<=5000&&protocolTiming.max_ms<=10000};
  });
  const paired=[];
  for(const configuration of Object.keys(labels).filter(c=>c!=='astra-low'))for(const base of ['astra-low','terra-low'].filter(x=>x!==configuration)){
    const rows=result.rows.filter(r=>r.configuration===configuration),values=rows.map(r=>{
      const b=result.rows.find(x=>x.caseId===r.caseId&&x.round===r.round&&x.configuration===base);
      return {caseId:r.caseId,round:r.round,protocol_delta_ms:r.protocolCompleteMs!==null&&b?.protocolCompleteMs!=null?r.protocolCompleteMs-b.protocolCompleteMs:null,
        correct_delta_ms:r.correctCompleteMs!==null&&b?.correctCompleteMs!=null?r.correctCompleteMs-b.correctCompleteMs:null};
    });paired.push({configuration,baseline:base,values,protocol_difference:stats(values.map(x=>x.protocol_delta_ms)),correct_difference:stats(values.map(x=>x.correct_delta_ms))});
  }
  return {byConfig,paired,stopped:result.stopped,completed_trials:result.rows.length,unattempted:result.unattempted,
    qualifying:byConfig.filter(x=>x.strict_correctness_met&&x.short_wait_met).map(x=>x.configuration),
    phase_known_usd:result.phase.knownMeteredMicros/1e6,phase_occupied_usd:result.phase.occupiedMicros/1e6,
    phase_remaining_usd:Math.max(0,(result.phase.policy.limitMicros-result.phase.occupiedMicros)/1e6),
    cumulative_known_usd:result.cumulative.knownMeteredMicros/1e6,cumulative_occupied_usd:result.cumulative.occupiedMicros/1e6,
    cumulative_remaining_usd:result.cumulative.remainingMicros/1e6,unknown_cost_calls:result.phase.unknownAttempts,
    semantics:'evaluator request through complete response and physical receipt persistence, then protocol-scored; excludes final logical scoring/rendering; not client end-to-end; usage-based estimate, invoice not reconciled'};
}
const sec=x=>x==null?'—':(x/1000).toFixed(3)+'秒';
const money=x=>x==null?'未知':`$${x.toFixed(6)}`;
const cell=x=>String(x??'—').replaceAll('|','\\|').replaceAll('\n',' / ');
const csvRow=values=>values.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',');
export function main(root=ROOT){
  const path=resolve(root,DIR,'paid'),result=JSON.parse(readFileSync(resolve(path,'results.json'))),s=summarize(result);
  assert.equal(new Set(result.rows.map(r=>r.trialKey)).size,result.rows.length);
  const cases=JSON.parse(readFileSync(resolve(root,'output/spi-screening-20261117/cases.json'))).questions.filter(q=>q.id.startsWith('F'));
  const lines=['# CAB推理档位同期筛选结果','',`执行结束：${result.finished_at}；停止状态：${result.stopped}。`,
    `完成${s.completed_trials}/32个逻辑试次，未执行${s.unattempted.length}；物理请求${result.attempts.length}次，其中重试${result.attempts.filter(a=>a.purpose==='retry').length}次。`,
    '','仅4道已见CAB练习题，不是SPI整体能力或泛化验证。各配置两轮同期执行，历史low结果不加入本次成绩。金标及评分在新请求前冻结，没有因新结果调整。',
    '','## 每题两轮答案','', '| 题目／金标 | Astra low | Terra low | Terra medium | Terra high |','|---|---|---|---|---|'];
  for(const q of cases){lines.push('| '+[q.title_zh+'；'+q.expected.accepted_answers[0],...Object.keys(labels).map(c=>[1,2].map(round=>{
    const r=result.rows.find(r=>r.caseId===q.id&&r.configuration===c&&r.round===round);
    return !r?`第${round}轮未执行`:`第${round}轮 ${cell(r.content_score?.answer)}（${r.content_score?.content_correct===true?'对':r.content_score?.content_correct===false?'错':'待核验'}${r.content_score?.protocol_valid?'':'；格式问题'}${r.failure?'；'+r.failure:''}）`;
  }).join('；'))].join(' | ')+' |');}
  lines.push('','## 正确性、格式与速度','', '| 配置 | 内容正确 | 协议完整 | 取消重排 | 完整协议耗时 中位/最慢 | 正确完整耗时 中位/最慢 | 首字中位 | 通过已选筛选标准 |', '|---|---|---|---|---|---|---|---|');
  for(const r of s.byConfig)lines.push(`| ${labels[r.configuration]} | ${r.content_correct}/${r.started} | ${r.protocol_complete}/${r.started} | ${r.cancel_correct}/2 | ${sec(r.protocol_timing.median_ms)} / ${sec(r.protocol_timing.max_ms)} | ${sec(r.correct_timing.median_ms)} / ${sec(r.correct_timing.max_ms)}（n=${r.correct_timing.n}） | ${sec(r.logical_first_answer.median_ms)} | ${r.strict_correctness_met&&r.short_wait_met?'是':'否'} |`);
  lines.push('','通过标准仅指本次已批准工程筛选：8/8正确、8/8协议完整、取消重排2/2，完整协议有效答案中位≤5秒且最慢≤10秒。不能直接作为生产替换验收。',
    '','完整协议耗时包括协议合规的错答；正确完整答案另列。所有失败、错误、重试及总等待保存在逐次清单，不把它们当0秒。首字是首个答案内容到达评测器，不是推理开始、网络首字节或客户端显示时间。本次没有客户端测速。',
    '','## 同题同轮时间差','', '| 配置减基准 | 协议有效配对数 | 时间差中位 | 双方正确配对数 | 时间差中位 |','|---|---|---|---|---|');
  for(const p of s.paired)lines.push(`| ${labels[p.configuration]} − ${labels[p.baseline]} | ${p.protocol_difference.n} | ${sec(p.protocol_difference.median_ms)} | ${p.correct_difference.n} | ${sec(p.correct_difference.median_ms)} |`);
  lines.push('','负数表示前者更快。每配置最多8个逻辑试次，不报告P95或统计显著性；缺失配对不填值。',
    '','## 用量和费用','', '| 配置 | 输入token | 推理token（总输出子项） | 总输出token | 物理调用/重试 | 用量估算 | 每道正确完整答案成本 |','|---|---|---|---|---|---|---|');
  for(const r of s.byConfig)lines.push(`| ${labels[r.configuration]} | ${r.input_known_total} | ${r.reasoning.known_total}${r.reasoning.missing_calls?'；缺'+r.reasoning.missing_calls+'次':''} | ${r.output_known_total} | ${r.physical_calls}/${r.retries} | ${money(r.known_estimated_cost_usd)}${r.unknown_cost_calls?'＋未知'+r.unknown_cost_calls+'次':''} | ${money(r.cost_per_correct_complete_usd)} |`);
  lines.push('',`本阶段已知usage估算${money(s.phase_known_usd)}，保守占用${money(s.phase_occupied_usd)}，3美元阶段额度剩余${money(s.phase_remaining_usd)}；未知费用${s.unknown_cost_calls}次。`,
    `原累计账本已知usage费用${money(s.cumulative_known_usd)}，保守占用${money(s.cumulative_occupied_usd)}，父额度保守余额${money(s.cumulative_remaining_usd)}。余额不会自动授权扩测。`,
    '','计价沿用冻结的Standard普通输入/输出费率：Astra $10/$50每百万token，Terra $1/$5。推理已经包含在总输出内，没有重复计费。供应商账单尚未核对；缓存读写明细原样记录，普通未缓存费率推算不冒充发票。未知usage保留全额预留。',
    '','## 判断及边界','',s.qualifying.length?`满足本轮已选正确性和等待条件的配置：${s.qualifying.map(c=>labels[c]).join('、')}。`:'没有配置同时满足本轮已选正确性和等待条件；暂不能选定。',
    '增加推理档位是否值得，需要同时查看取消重排题及其他题是否补回正确答案，以及新增的等待和费用。没有补回正确答案却更慢、更贵，不构成升级依据。若优劣互有取舍或只有单次差异，不自动选优胜者。',
    '本次仅为4道已见CAB的配置初筛，重复不增加独立题数；模型别名不是不可变日期版本，供应商内部计算量无法由effort名称验证。达到预定次数或停止条件后不扩测、不改生产。',
    '','原始回答见paid目录attempt文件；每次物理用量见physical-calls.csv，完整逻辑试次见trials.csv，机器可复核汇总见summary.json。');
  const trialHeader=['trial','question','configuration','round','answer','content_correct','protocol_valid','failure','logical_ms','protocol_complete_ms','correct_complete_ms','first_answer_ms','known_cost_usd','physical_calls'];
  const trialCsv=[csvRow(trialHeader),...result.rows.map(r=>csvRow([r.trialKey,r.caseId,r.configuration,r.round,r.content_score?.answer,r.content_score?.content_correct,r.content_score?.protocol_valid,r.failure,r.timing.totalMs,r.protocolCompleteMs,r.correctCompleteMs,r.timing.upstreamFirstAnswerMs,r.knownCostMicros/1e6,r.attemptIds.length]))];
  const callHeader=['attempt','trial','configuration','purpose','input_tokens','reasoning_tokens','total_output_tokens','cached_input','cache_write_input','cost_usd','reserved_usd','first_answer_ms','physical_total_ms','failure'];
  const calls=[csvRow(callHeader),...result.attempts.map(a=>csvRow([a.id,a.trialKey,a.configuration,a.purpose,a.usage?.inputTokens,a.usage?.details?.reasoningOutputTokens,a.usage?.outputTokens,a.usage?.details?.cachedInputTokens,a.usage?.details?.cacheWriteInputTokens,a.costMicros==null?null:a.costMicros/1e6,a.reservedMicros/1e6,a.upstreamFirstAnswerMs,a.totalMs,a.failure??a.phaseFailure]))];
  for(const [name,text] of [['report.md',lines.join('\n')+'\n'],['summary.json',JSON.stringify(s,null,2)+'\n'],['trials.csv',trialCsv.join('\n')+'\n'],['physical-calls.csv',calls.join('\n')+'\n']])writeFileSync(resolve(root,DIR,name),text,{flag:'wx',mode:0o600});
  return s;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(main(),null,2));
