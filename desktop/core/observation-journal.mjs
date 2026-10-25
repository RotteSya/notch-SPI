import {randomUUID} from 'node:crypto';
const maximum=1_000_000_000,week=7*86400000;
const iso=now=>new Date(now).toISOString();
export function freshJournal(enabled,now) {
 return {formatVersion:2,scope:null,preference:{consent_epoch:0,sharing_enabled:enabled,valid_from:iso(now)},preferencePending:true,explicit:false,adoptRemote:true,sequence:0,coveredThrough:0,coverageFrom:iso(now),drops:0,intervalDrops:0,gap:'none',gapRevision:0,pendingCoverage:null,pendingGapRevision:null,queue:[],openCaptures:[],cleanShutdown:false};
}
export function gap(data,reason){data.gap=reason;data.gapRevision=Math.min(maximum,data.gapRevision+1);}
export function resetSharing(data,enabled,now){
 if(enabled===data.preference.sharing_enabled)return;
 const epoch=Math.min(maximum,data.preference.consent_epoch+1),scope=data.scope;
 Object.assign(data,freshJournal(enabled,now),{scope,explicit:true,adoptRemote:false});data.preference.consent_epoch=epoch;
}
export function bindJournal(data,scope,now){
 if(data.scope&&data.scope!==scope){Object.assign(data,freshJournal(data.preference.sharing_enabled,now));gap(data,'preference_unsynced');}
 data.scope=scope;
}
export function reconcile(data,remote,now){
 if(!remote){data.adoptRemote=false;return;}
 if(remote.consent_epoch===data.preference.consent_epoch&&remote.sharing_enabled===data.preference.sharing_enabled&&Date.parse(remote.valid_from)===Date.parse(data.preference.valid_from)){
  data.preferencePending=false;data.explicit=false;data.adoptRemote=false;return;
 }
 if(data.adoptRemote||(!data.explicit&&remote.consent_epoch>=data.preference.consent_epoch)){
  const scope=data.scope;Object.assign(data,freshJournal(remote.sharing_enabled,now),{scope});
  data.preference=remote.sharing_enabled?{consent_epoch:Math.min(maximum,remote.consent_epoch+1),sharing_enabled:true,valid_from:iso(now)}:{...remote};
  data.preferencePending=remote.sharing_enabled;data.adoptRemote=false;gap(data,'client_restart');
 }else if(remote.consent_epoch>=data.preference.consent_epoch){
  data.preference.consent_epoch=Math.min(maximum,remote.consent_epoch+1);
  for(const event of data.queue)event.consent_epoch=data.preference.consent_epoch;
  data.pendingCoverage=null;gap(data,'preference_unsynced');
 }
}
export function prune(data,now){
 const future=data.queue.some(x=>Date.parse(x.occurred_at)-now>300000);
 const retained=data.queue.filter(x=>now-Date.parse(x.occurred_at)<=week&&Date.parse(x.occurred_at)-now<=300000).slice(-100);
 const count=data.queue.length-retained.length;data.queue=retained;
 if(count){data.drops=Math.min(maximum,data.drops+count);data.intervalDrops=Math.min(maximum,data.intervalDrops+count);gap(data,future?'invalid_time':'queue_drop');}
 if(now-Date.parse(data.coverageFrom)>week){data.coverageFrom=iso(now-week+1);data.pendingCoverage=null;gap(data,'client_restart');}
}
export function resume(data,now){if(!data.cleanShutdown||data.openCaptures.length)gap(data,'client_restart');data.cleanShutdown=false;data.openCaptures=[];data.preferencePending=true;prune(data,now);}
export function appendEvent(data,event,now){
 if(!data.preference.sharing_enabled)return;
 if(data.sequence>=maximum){gap(data,'sequence_gap');return;}
 prune(data,now);
 event={...event,consent_epoch:data.preference.consent_epoch,event_sequence:data.sequence++};
 if(event.capture_id){
  if(event.event_name==='capture_started'&&!data.openCaptures.includes(event.capture_id))data.openCaptures.push(event.capture_id);
  if(event.event_name==='capture_completed')data.openCaptures=data.openCaptures.filter(x=>x!==event.capture_id);
 }
 data.queue.push(event);prune(data,now);
 const saved=data.queue.find(x=>x.event_id===event.event_id);if(saved)saved.queue_drop_count=data.drops;
}
export function acknowledgeEvents(data,batch,rejected){
 const ids=new Set(batch.map(x=>x.event_id));data.queue=data.queue.filter(x=>!ids.has(x.event_id));
 if(rejected){data.drops=Math.min(maximum,data.drops+rejected);data.intervalDrops=Math.min(maximum,data.intervalDrops+rejected);gap(data,'event_rejected');}
}
export function prepareCoverage(data,now){
 if(!data.preference.sharing_enabled)return null;
 if(data.pendingCoverage)return data.pendingCoverage;
 if(data.queue.length||now<Date.parse(data.coverageFrom))return null;
 if(data.sequence-data.coveredThrough>10000&&data.gap==='none')gap(data,'sequence_gap');
 const coverage={observation_id:randomUUID(),consent_epoch:data.preference.consent_epoch,valid_from:data.coverageFrom,valid_to:iso(now),sequence_from:data.coveredThrough,sequence_to:data.sequence,queue_drop_count:data.intervalDrops,coverage_status:data.gap==='none'?'complete':'partial',gap_reason:data.gap};
 data.pendingCoverage=coverage;data.pendingGapRevision=data.gapRevision;return coverage;
}
export function acknowledgeCoverage(data,value){
 if(data.pendingCoverage?.observation_id!==value.observation_id||data.preference.consent_epoch!==value.consent_epoch)return;
 data.coveredThrough=value.sequence_to;data.coverageFrom=value.valid_to;data.intervalDrops=Math.max(0,data.intervalDrops-value.queue_drop_count);
 if(data.pendingGapRevision===data.gapRevision)data.gap='none';data.pendingCoverage=null;data.pendingGapRevision=null;
}
export function shutdown(data){data.cleanShutdown=data.openCaptures.length===0;if(!data.cleanShutdown)gap(data,'client_restart');}
