import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EvaluationBudget,type EvaluationCallBound,type EvaluationPolicy} from '../../scripts/lib/evaluation-budget.mts';
import {settleEvaluationBudget,settlementDigest,type EvaluationSettlementBatch} from '../../scripts/lib/evaluation-settlement.mts';

const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
function fixture(kind:'reading_response'|'objective_jsonl'='reading_response') {
  const dir=mkdtempSync(join(tmpdir(),'nspi-audited-budget-')),ledger=join(dir,'ledger.sqlite3');
  const policy:EvaluationPolicy={schema_version:1,campaign_id:'test-settlement',currency:'CNY',limit_micros:100_000};
  const bound:EvaluationCallBound={schema_version:1,model:'test',base_url:'https://candidate.example',billing_currency:'CNY',
    input_micros_per_million:3_000_000,output_micros_per_million:9_000_000,input_token_upper:10_000,output_token_upper:1000,
    cny_micros_per_currency_unit:1_000_000,pricing_source:'https://example.com/price',currency_evidence:'Test CNY account',
    bounds_evidence:'Test enforced limits',verified_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+3600_000).toISOString()};
  const budget=new EvaluationBudget(ledger,policy,bound,bound.model,bound.base_url);
  const purpose=kind==='objective_jsonl'?'baseline':'answer';
  budget.reserve('known','fixture',purpose);budget.observeUsage('known',10,10);
  budget.reserve('unknown','uncertain','answer');budget.observeUsage('unknown',0,0);
  const db=new DatabaseSync(ledger);db.prepare("UPDATE evaluation_dispatches SET outcome='response_received' WHERE id='known'").run();
  const row=db.prepare("SELECT * FROM evaluation_dispatches WHERE id='known'").get()!;db.close();
  const receipt=join(dir,kind==='objective_jsonl'?'result.jsonl':'response.json');
  const reading={dispatch_id:'known',case_id:'fixture',capture_id:'capture',purpose,upper_cny_micros:39_000,
    http_status:200,failure:null,finished_at:new Date().toISOString(),
    body:'data: '+JSON.stringify({type:'usage',capture_id:'capture',operation:'solve',input_tokens:10,output_tokens:10})+'\n\ndata: [DONE]\n\n'};
  writeFileSync(receipt,JSON.stringify(kind==='objective_jsonl'?{id:'fixture',model:'test',budget_dispatch_id:'known',
    budget_upper_cny_micros:39_000,input_tokens:10,output_tokens:10}:reading)+'\n');
  const batch:EvaluationSettlementBatch={schema_version:1,campaign_id:policy.campaign_id,executor:'test-executor',created_at:new Date().toISOString(),
    bounds:{[String(row.bound_sha256)]:bound},entries:[{dispatch_id:'known',dispatch_sha256:settlementDigest(row),
      receipt:{kind,path:receipt,sha256:hash(readFileSync(receipt)),...(kind==='objective_jsonl'?{line:1}:{})}}]};
  const batchFile=join(dir,'batch.json'),reviewFile=join(dir,'review.json');
  function options(apply=false) {
    writeFileSync(batchFile,JSON.stringify(batch));const batchSHA=hash(readFileSync(batchFile));
    writeFileSync(reviewFile,JSON.stringify({schema_version:1,campaign_id:policy.campaign_id,batch_sha256:batchSHA,
      reviewer:'independent-test-reviewer',reviewed_at:batch.created_at,decision:'approved_conservative_usage_settlement'}));
    return {ledger,policy,batchFile,batchSHA,reviewFile,reviewSHA:hash(readFileSync(reviewFile)),apply};
  }
  return {dir,ledger,policy,bound,budget,batch,receipt,options,close(){budget.close();rmSync(dir,{recursive:true,force:true});}};
}

for(const kind of ['reading_response','objective_jsonl'] as const)test(`${kind}: dry run is read-only, apply preserves original reservations and is idempotent`,()=>{
  const f=fixture(kind);
  try {
    const before=readFileSync(f.ledger),planned=settleEvaluationBudget(f.options());
    assert.equal(planned.after_cny_micros,39_120);assert.deepEqual(readFileSync(f.ledger),before);
    const first=settleEvaluationBudget(f.options(true));assert.equal(first.new_settlements,1);
    assert.equal(first.released_cny_micros,38_880);assert.equal(f.budget.remainingMicros(),60_880);
    const second=settleEvaluationBudget(f.options(true));assert.equal(second.new_settlements,0);assert.equal(second.existing_settlements,1);
    assert.equal(second.released_cny_micros,0);assert.equal(f.budget.remainingMicros(),60_880);
    const db=new DatabaseSync(f.ledger);
    try {
      assert.equal(db.prepare('SELECT SUM(upper_cny_micros) AS n FROM evaluation_dispatches').get()!.n,78_000);
      assert.throws(()=>db.exec('DELETE FROM evaluation_settlements'),/immutable/);
      assert.throws(()=>db.exec('UPDATE evaluation_settlements SET settled_cny_micros=1'),/immutable/);
      assert.throws(()=>db.exec("UPDATE evaluation_dispatches SET input_tokens=1 WHERE id='known'"),/immutable/);
      assert.throws(()=>db.exec("DELETE FROM evaluation_dispatches WHERE id='known'"),/immutable/);
    } finally {db.close();}
    f.budget.reserve('third','f','answer');assert.throws(()=>f.budget.reserve('fourth','f','answer'),/exhausted/);
  } finally {f.close();}
});

test('unknown zero usage cannot be settled and a mixed batch rolls back all entries',()=>{
  const f=fixture();try {
    const db=new DatabaseSync(f.ledger);db.exec("UPDATE evaluation_dispatches SET outcome='response_received' WHERE id='unknown'");
    const row=db.prepare("SELECT * FROM evaluation_dispatches WHERE id='unknown'").get()!;db.close();
    f.batch.entries.push({...f.batch.entries[0]!,dispatch_id:'unknown',dispatch_sha256:settlementDigest(row)});
    assert.throws(()=>settleEvaluationBudget(f.options(true)),/positive usage/);
    assert.equal(f.budget.remainingMicros(),22_000);
    const check=new DatabaseSync(f.ledger);assert.equal(check.prepare('SELECT count(*) AS n FROM evaluation_settlements').get()!.n,0);check.close();
  }finally{f.close();}
});

test('objective treatment JSONL supports its historical answer purpose without relabelling the dispatch',()=>{
  const f=fixture('objective_jsonl');try {
    const db=new DatabaseSync(f.ledger);db.exec("UPDATE evaluation_dispatches SET purpose='answer' WHERE id='known'");
    f.batch.entries[0]!.dispatch_sha256=settlementDigest(db.prepare("SELECT * FROM evaluation_dispatches WHERE id='known'").get()!);db.close();
    assert.equal(settleEvaluationBudget(f.options(true)).after_cny_micros,39_120);
  }finally{f.close();}
});

test('receipt tampering, stale dispatches, false price bindings, and self-review never release budget',()=>{
  for(const mode of ['receipt','snapshot','price','self-review','usage-mismatch','missing-done','duplicate-usage','duplicate-entry','zero-output','policy','halted']) {
    const f=fixture();try {
      if(mode==='snapshot')f.batch.entries[0]!.dispatch_sha256='0'.repeat(64);
      if(mode==='price')f.bound.output_micros_per_million=1;
      if(mode==='duplicate-entry')f.batch.entries.push(f.batch.entries[0]!);
      if(['usage-mismatch','missing-done','duplicate-usage','zero-output'].includes(mode)) {
        const receipt=JSON.parse(readFileSync(f.receipt,'utf8'));
        if(mode==='usage-mismatch')receipt.body=receipt.body.replace('"input_tokens":10','"input_tokens":9');
        if(mode==='zero-output')receipt.body=receipt.body.replace('"output_tokens":10','"output_tokens":0');
        if(mode==='missing-done')receipt.body=receipt.body.replace('data: [DONE]\n\n','');
        if(mode==='duplicate-usage')receipt.body=receipt.body.replace('data: [DONE]',receipt.body.split('\n\n')[0]+'\n\ndata: [DONE]');
        writeFileSync(f.receipt,JSON.stringify(receipt));f.batch.entries[0]!.receipt.sha256=hash(readFileSync(f.receipt));
      }
      const opts=f.options(true);
      if(mode==='receipt')writeFileSync(f.receipt,'{}');
      if(mode==='self-review') {const review=JSON.parse(readFileSync(opts.reviewFile,'utf8'));review.reviewer=f.batch.executor;
        writeFileSync(opts.reviewFile,JSON.stringify(review));opts.reviewSHA=hash(readFileSync(opts.reviewFile));}
      if(mode==='policy')opts.policy={...opts.policy,limit_micros:200_000};
      if(mode==='halted'){const db=new DatabaseSync(f.ledger);db.exec('UPDATE evaluation_campaigns SET halted=1');db.close();}
      assert.throws(()=>settleEvaluationBudget(opts),/Evaluation settlement:/,mode);
      assert.equal(f.budget.remainingMicros(),mode==='halted'?0:22_000,mode);
    }finally{f.close();}
  }
});

test('concurrent reconciliation releases once; concurrent reservations still honor the shared cap',async()=>{
  const f=fixture();try {
    const options=f.options(true),moduleURL=new URL('../../scripts/lib/evaluation-settlement.mts',import.meta.url).href;
    const settleCode=`import {settleEvaluationBudget} from ${JSON.stringify(moduleURL)};console.log(JSON.stringify(settleEvaluationBudget(JSON.parse(process.argv[1]))));`;
    const run=promisify(execFile);
    const reports=await Promise.all(Array.from({length:4},()=>run(process.execPath,['--input-type=module','-e',settleCode,JSON.stringify(options)],{timeout:15_000})));
    assert.equal(reports.map(r=>JSON.parse(r.stdout).new_settlements).reduce((a,b)=>a+b,0),1);
    const budgetURL=new URL('../../scripts/lib/evaluation-budget.mts',import.meta.url).href;
    const code=`import {EvaluationBudget} from ${JSON.stringify(budgetURL)};const x=JSON.parse(process.argv[1]);const b=new EvaluationBudget(x.ledger,x.policy,x.bound,x.bound.model,x.bound.base_url);try{b.reserve(x.id,'f','answer');console.log('reserved')}catch(e){if(!String(e).includes('exhausted'))throw e;console.log('exhausted')}finally{b.close()}`;
    const calls=await Promise.all(Array.from({length:4},(_,i)=>run(process.execPath,['--input-type=module','-e',code,JSON.stringify({ledger:f.ledger,policy:f.policy,bound:f.bound,id:'parallel-'+i})],{timeout:15_000})));
    assert.equal(calls.filter(r=>r.stdout.trim()==='reserved').length,1);
    assert.equal(calls.filter(r=>r.stdout.trim()==='exhausted').length,3);
    assert.equal(f.budget.remainingMicros(),21_880);
  }finally{f.close();}
});

test('paid entrypoint requires the existing campaign and preserves spend across worktrees',async()=>{
  const f=fixture();try {
    mkdirSync(join(f.dir,'docs'));writeFileSync(join(f.dir,'docs/evaluation-budget.json'),JSON.stringify(f.policy));
    const boundFile=join(f.dir,'bound.json');writeFileSync(boundFile,JSON.stringify(f.bound));
    const moduleURL=new URL('../../scripts/lib/evaluation-budget.mts',import.meta.url).href;
    const code=`import {openEvaluationBudget} from ${JSON.stringify(moduleURL)};const b=openEvaluationBudget(process.argv[1],'test','https://candidate.example');try{console.log(b.remainingMicros())}finally{b.close()}`;
    const run=promisify(execFile);
    const invoke=(ledger?:string)=>{
      const env:NodeJS.ProcessEnv={...process.env,NSPI_EVAL_COST_BOUND:boundFile};
      delete env.NSPI_EVAL_LEDGER;if(ledger)env.NSPI_EVAL_LEDGER=ledger;
      return run(process.execPath,['--input-type=module','-e',code,f.dir],{env,timeout:15_000});
    };
    const missing=join(f.dir,'misspelled.sqlite3');
    await assert.rejects(invoke(missing),/ENOENT/);assert.equal(existsSync(missing),false);
    await assert.rejects(invoke(),/ENOENT/);assert.equal(existsSync(join(f.dir,'.eval-results')),false);
    const empty=join(f.dir,'empty.sqlite3');writeFileSync(empty,'');
    await assert.rejects(invoke(empty),/no such table/);assert.equal(readFileSync(empty).length,0);
    const foreign=join(f.dir,'foreign.sqlite3');
    const other=new EvaluationBudget(foreign,{...f.policy,campaign_id:'another'},f.bound,'test',f.bound.base_url);other.close();
    await assert.rejects(invoke(foreign),/existing matching evaluation campaign/);
    const db=new DatabaseSync(foreign,{readOnly:true});
    try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM evaluation_campaigns').get()!.n,1);}finally{db.close();}
    assert.equal((await invoke(f.ledger)).stdout.trim(),'22000');
    assert.equal(f.budget.remainingMicros(),22_000);
  }finally{f.close();}
});
