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
