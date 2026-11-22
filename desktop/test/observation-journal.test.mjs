import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import * as journal from '../core/observation-journal.mjs';
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/observation-journal.json',import.meta.url)));
for(const scenario of cases)test('shared Mac observation: '+scenario.name,()=>{
 let now=1800000000000,data=journal.freshJournal(true,now),proof;
 for(const step of scenario.steps){
  now+=1000;
  switch(step.op){
   case 'append':for(let i=0;i<step.count;i++)journal.appendEvent(data,{event_id:randomUUID(),capture_id:step.capture?randomUUID():undefined,event_name:step.capture?'capture_started':'answer_action',occurred_at:new Date(now+(step.offset??0)*1000).toISOString()},now);break;
   case 'ackEvents':journal.acknowledgeEvents(data,data.queue,step.rejected??0);break;
   case 'prepare':{const next=journal.prepareCoverage(data,now);if(proof&&next)assert.equal(next.observation_id,proof.observation_id);proof=next;assert.equal(proof?.coverage_status??null,step.status);for(const [key,field]of [['reason','gap_reason'],['from','sequence_from'],['to','sequence_to'],['drops','queue_drop_count']])if(key in step)assert.equal(proof[field],step[key]);break;}
   case 'ackCoverage':journal.acknowledgeCoverage(data,proof);proof=null;break;
   case 'gap':journal.gap(data,step.reason);break;
   case 'shutdown':journal.shutdown(data);break;
   case 'resume':data=JSON.parse(JSON.stringify(data));journal.resume(data,now);break;
   case 'optOut':journal.resetSharing(data,false,now);proof=null;assert.equal(data.openCaptures.length,0);assert.equal(data.queue.length,0);break;
  }
 }
});
test('sequence overflow and oversized offline spans never claim complete observation',()=>{
 const now=1800000000000,data=journal.freshJournal(true,now);data.sequence=1e9;
 journal.appendEvent(data,{event_id:randomUUID(),event_name:'answer_action',occurred_at:new Date(now).toISOString()},now);
 assert.equal(data.sequence,1e9);assert.equal(data.queue.length,0);assert.equal(data.gap,'sequence_gap');
 const backlog=journal.freshJournal(true,now);backlog.sequence=10001;
 assert.equal(journal.prepareCoverage(backlog,now).coverage_status,'partial');assert.equal(backlog.gap,'sequence_gap');
});

test('15-minute silent coverage batching preserves event, gap, retry, and opt-out semantics',()=>{
 const start=1_800_000_000_000, interval=15*60_000, data=journal.freshJournal(true,start);
 assert.equal(journal.prepareCoverage(data,start+30_000,interval),null);
 assert.equal(journal.prepareCoverage(data,start+interval-1,interval),null);
 const empty=journal.prepareCoverage(data,start+interval,interval);
 assert.equal(empty.sequence_from,0);assert.equal(empty.sequence_to,0);assert.equal(empty.valid_from,new Date(start).toISOString());
 assert.equal(journal.prepareCoverage(data,start+interval+10_000,interval),empty,'retry keeps the same UUID');
 journal.acknowledgeCoverage(data,empty);
 assert.equal(journal.prepareCoverage(data,start+interval+30_000,interval),null);
 const eventTime=start+interval+40_000;
 journal.appendEvent(data,{event_id:randomUUID(),event_name:'answer_action',occurred_at:new Date(eventTime).toISOString()},eventTime);
 assert.equal(journal.prepareCoverage(data,eventTime,interval),null,'event receipt must come first');
 journal.acknowledgeEvents(data,data.queue,0);
 const actual=journal.prepareCoverage(data,eventTime,interval);
 assert.equal(actual.sequence_from,0);assert.equal(actual.sequence_to,1);
 journal.acknowledgeCoverage(data,actual);
 assert.equal(journal.prepareCoverage(data,eventTime+10_000,interval),null);
 journal.gap(data,'storage_failure');
 const gapProof=journal.prepareCoverage(data,eventTime+11_000,interval);
 assert.equal(gapProof.coverage_status,'partial');assert.equal(gapProof.gap_reason,'storage_failure');
 journal.acknowledgeCoverage(data,gapProof);
 assert.equal(journal.prepareCoverage(data,eventTime+12_000,interval),null);
 journal.resetSharing(data,false,eventTime+13_000);
 assert.equal(journal.prepareCoverage(data,eventTime+interval+13_000,interval),null);
});

test('silent coverage keeps continuous 15-minute windows with no new events',()=>{
 const start=1_800_000_000_000,interval=15*60_000,data=journal.freshJournal(true,start),proofs=[];
 for(let elapsed=30_000;elapsed<=60*60_000;elapsed+=30_000){
  const proof=journal.prepareCoverage(data,start+elapsed,interval);
  if(proof){proofs.push(proof);journal.acknowledgeCoverage(data,proof);}
 }
 assert.equal(proofs.length,4);
 for(let i=0;i<proofs.length;i++){
  assert.equal(proofs[i].sequence_from,0);assert.equal(proofs[i].sequence_to,0);
  assert.equal(Date.parse(proofs[i].valid_to)-Date.parse(proofs[i].valid_from),interval);
  if(i>0)assert.equal(proofs[i].valid_from,proofs[i-1].valid_to);
 }
});
