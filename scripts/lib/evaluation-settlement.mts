import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {callUpperCNY,ensureEvaluationSettlementSchema,validateEvaluationPolicy,
  type EvaluationCallBound,type EvaluationPolicy,type EvaluationPurpose} from './evaluation-budget.mts';

export interface SettlementReceipt {
  kind:'reading_response'|'objective_jsonl';path:string;sha256:string;line?:number;
}
export interface EvaluationSettlementBatch {
  schema_version:1;campaign_id:string;executor:string;created_at:string;
  bounds:Record<string,EvaluationCallBound>;
  entries:Array<{dispatch_id:string;dispatch_sha256:string;receipt:SettlementReceipt}>;
}
export interface EvaluationSettlementReview {
  schema_version:1;campaign_id:string;batch_sha256:string;reviewer:string;reviewed_at:string;
  decision:'approved_conservative_usage_settlement';
}
export function settlementDigest(value:Record<string,unknown>):string {
  return sha(JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]]))));
}
function sha(value:string|Uint8Array):string {return createHash('sha256').update(value).digest('hex');}
function fail(message:string):never {throw new Error(`Evaluation settlement: ${message}`);}
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('expected an object');
  return value as Record<string,unknown>;
}
function hash(value:unknown):asserts value is string {
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('invalid evidence digest');
}
function positive(value:unknown):asserts value is number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)fail('complete positive usage is required; retain unknown/zero reservations');
}
function text(value:unknown):asserts value is string {
  if(typeof value!=='string'||!value.trim()||value.length>2048)fail('invalid identifier or path');
}
function at(value:unknown):number {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('invalid timestamp');
  return Date.parse(value);
}
function readBoundFile(path:string,expected:string,limit=8*1024*1024):Buffer {
  text(path);hash(expected);
  const info=statSync(path);
  if(!info.isFile()||info.size>limit)fail('evidence file exceeds limit or is not regular');
  const bytes=readFileSync(path);
  if(bytes.length>limit||sha(bytes)!==expected)fail('evidence bytes do not match review');
  return bytes;
}

function verifyReceipt(row:Record<string,unknown>,receipt:SettlementReceipt,bytes:Buffer):void {
  let value:Record<string,unknown>;
  if(receipt.kind==='objective_jsonl') {
    if(!['answer','baseline'].includes(String(row.purpose))||!Number.isSafeInteger(receipt.line)||Number(receipt.line)<1)fail('invalid objective receipt');
    const line=bytes.toString('utf8').split('\n')[Number(receipt.line)-1];
    if(!line)fail('missing baseline record');
    value=object(JSON.parse(line));
    if(value.budget_dispatch_id!==row.id||value.id!==row.fixture_id||value.model!==row.model||
       value.budget_upper_cny_micros!==row.upper_cny_micros)fail('baseline receipt does not match dispatch');
  } else if(receipt.kind==='reading_response') {
    if(receipt.line!==undefined)fail('unexpected reading line selector');
    const response=object(JSON.parse(bytes.toString('utf8')));
    if(response.dispatch_id!==row.id||response.case_id!==row.fixture_id||response.purpose!==row.purpose||
       response.upper_cny_micros!==row.upper_cny_micros||response.http_status!==200||response.failure!==null||
       typeof response.capture_id!=='string'||typeof response.body!=='string'||
       !response.body.endsWith('data: [DONE]\n\n')||at(response.finished_at)<at(row.created_at))fail('reading response is incomplete or mismatched');
    const events=response.body.split('\n').filter(line=>line.startsWith('data: {')).map(line=>object(JSON.parse(line.slice(6))));
    const usages=events.filter(event=>event.type==='usage');
    if(usages.length!==1)fail('reading response needs exactly one usage receipt');
    value=usages[0]!;
    const operation=row.purpose==='answer'?'solve':row.purpose==='explain'?'explain':row.purpose==='recover'?'recover':null;
    if(!operation||value.capture_id!==response.capture_id||value.operation!==operation)fail('reading usage belongs to another request');
  } else fail('unsupported receipt type');
  positive(value.input_tokens);positive(value.output_tokens);
  if(value.input_tokens!==row.input_tokens||value.output_tokens!==row.output_tokens)fail('receipt usage differs from ledger');
}

/** Offline transaction only. No vendor/API calls, no cap changes, and no rewriting reservations. */
export function settleEvaluationBudget(options:{ledger:string;policy:EvaluationPolicy;batchFile:string;batchSHA:string;
  reviewFile:string;reviewSHA:string;apply?:boolean;now?:number}) {
  validateEvaluationPolicy(options.policy);
  const now=options.now??Date.now(),batchBytes=readBoundFile(options.batchFile,options.batchSHA);
  const batch=object(JSON.parse(batchBytes.toString('utf8'))) as unknown as EvaluationSettlementBatch;
  const review=object(JSON.parse(readBoundFile(options.reviewFile,options.reviewSHA,1024*1024).toString('utf8'))) as unknown as EvaluationSettlementReview;
  text(batch.executor);text(review.reviewer);
  if(batch.schema_version!==1||review.schema_version!==1||batch.campaign_id!==options.policy.campaign_id||
     review.campaign_id!==batch.campaign_id||review.batch_sha256!==options.batchSHA||review.reviewer===batch.executor||
     review.decision!=='approved_conservative_usage_settlement'||at(batch.created_at)>at(review.reviewed_at)||
     at(review.reviewed_at)>now)fail('independent review does not authorize this exact batch');
  object(batch.bounds);
  if(!Array.isArray(batch.entries)||batch.entries.length<1||batch.entries.length>10_000)fail('invalid settlement batch size');
  const ids=new Set<string>(),cache=new Map<string,Buffer>();let evidenceBytes=0;
  for(const entry of batch.entries) {
    text(entry.dispatch_id);hash(entry.dispatch_sha256);object(entry.receipt);text(entry.receipt.path);hash(entry.receipt.sha256);
    if(ids.has(entry.dispatch_id))fail('duplicate dispatch in batch');ids.add(entry.dispatch_id);
    const key=resolve(entry.receipt.path)+'#'+entry.receipt.sha256;
    if(!cache.has(key)) {
      const bytes=readBoundFile(entry.receipt.path,entry.receipt.sha256);evidenceBytes+=bytes.length;
      if(evidenceBytes>64*1024*1024)fail('receipt batch exceeds 64 MiB');cache.set(key,bytes);
    }
  }
  // Never create a replacement ledger if a path is wrong, and never create a new campaign.
  if(!existsSync(options.ledger)||!statSync(options.ledger).isFile())fail('existing campaign ledger is required');
  const db=new DatabaseSync(options.ledger,{readOnly:!options.apply});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    db.exec(options.apply?'BEGIN IMMEDIATE':'BEGIN');
    try {
      const campaign=db.prepare('SELECT currency,limit_micros,halted FROM evaluation_campaigns WHERE id=?').get(batch.campaign_id);
      if(!campaign||campaign.currency!==options.policy.currency||campaign.limit_micros!==options.policy.limit_micros||campaign.halted!==0)
        fail('campaign cap/currency changed, is absent, or is halted');
      const hasTable=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='evaluation_settlements'").get());
      if(options.apply)ensureEvaluationSettlementSchema(db);
      const consumption=()=>Number(db.prepare(hasTable||options.apply?
        `SELECT COALESCE(SUM(COALESCE(s.settled_cny_micros,d.upper_cny_micros)),0) AS total
         FROM evaluation_dispatches d LEFT JOIN evaluation_settlements s ON s.dispatch_id=d.id AND s.campaign_id=d.campaign_id WHERE d.campaign_id=?`:
        'SELECT COALESCE(SUM(upper_cny_micros),0) AS total FROM evaluation_dispatches WHERE campaign_id=?').get(batch.campaign_id)!.total);
      const before=consumption();let released=0,inserted=0,existing=0;
      for(const entry of batch.entries) {
        const row=db.prepare('SELECT * FROM evaluation_dispatches WHERE id=? AND campaign_id=?').get(entry.dispatch_id,batch.campaign_id);
        if(!row||settlementDigest(row)!==entry.dispatch_sha256||row.outcome!=='response_received')fail('dispatch changed or is not completed');
        positive(row.input_tokens);positive(row.output_tokens);
        const bound=batch.bounds[String(row.bound_sha256)];
        if(!bound||sha(JSON.stringify(bound))!==row.bound_sha256)fail('historical price binding mismatch');
        if(!['answer','baseline','explain','recover'].includes(String(row.purpose)))fail('invalid dispatch purpose');
        const upper=callUpperCNY(bound,String(row.model),bound.base_url,at(row.created_at),row.purpose as EvaluationPurpose);
        if(upper!==row.upper_cny_micros||row.input_tokens>bound.input_token_upper||
           row.output_tokens>(row.purpose==='explain'?bound.explanation_output_token_upper??bound.output_token_upper:bound.output_token_upper))
          fail('usage or reservation exceeds its original bound');
        verifyReceipt(row,entry.receipt,cache.get(resolve(entry.receipt.path)+'#'+entry.receipt.sha256)!);
        const numerator=(BigInt(row.input_tokens)*BigInt(bound.input_micros_per_million)+
          BigInt(row.output_tokens)*BigInt(bound.output_micros_per_million))*BigInt(bound.cny_micros_per_currency_unit);
        const cost=Number((numerator+999_999_999_999n)/1_000_000_000_000n);
        positive(cost);if(cost>upper)fail('settled cost exceeds original reservation');
        const prior=hasTable||options.apply?db.prepare('SELECT * FROM evaluation_settlements WHERE dispatch_id=?').get(row.id!):null;
        if(prior) {
          if(prior.campaign_id!==batch.campaign_id||prior.dispatch_sha256!==entry.dispatch_sha256||prior.batch_sha256!==options.batchSHA||
             prior.review_sha256!==options.reviewSHA||prior.receipt_sha256!==entry.receipt.sha256||prior.settled_cny_micros!==cost)
            fail('dispatch already settled under different evidence');
          existing++;continue;
        }
        if(options.apply)db.prepare(`INSERT INTO evaluation_settlements
          (dispatch_id,campaign_id,dispatch_sha256,bound_sha256,receipt_sha256,batch_sha256,review_sha256,
           original_upper_cny_micros,settled_cny_micros,input_tokens,output_tokens,settled_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(String(row.id),batch.campaign_id,entry.dispatch_sha256,String(row.bound_sha256),
            entry.receipt.sha256,options.batchSHA,options.reviewSHA,upper,cost,row.input_tokens,row.output_tokens,new Date(now).toISOString());
        inserted++;released+=upper-cost;
      }
      const after=before-released;
      if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||after<0||after>options.policy.limit_micros||
         options.apply&&consumption()!==after)fail('campaign reconciliation totals invalid');
      db.exec('COMMIT');
      return {applied:Boolean(options.apply),campaign_id:batch.campaign_id,limit_cny_micros:options.policy.limit_micros,
        entries:batch.entries.length,new_settlements:inserted,existing_settlements:existing,before_cny_micros:before,
        released_cny_micros:released,after_cny_micros:after,remaining_cny_micros:options.policy.limit_micros-after,
        batch_sha256:options.batchSHA,review_sha256:options.reviewSHA};
    } catch(error) {db.exec('ROLLBACK');throw error;}
  } finally {db.close();}
}
