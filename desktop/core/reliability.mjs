import {freshJournal,gap,resetSharing,bindJournal,reconcile,prune,resume,appendEvent,acknowledgeEvents,prepareCoverage,acknowledgeCoverage,shutdown} from './observation-journal.mjs';
import { createHash, randomUUID } from 'node:crypto';

const enums={variant:['control','objective_v1'],trigger:['capture_hotkey','context_hotkey','personality_hotkey','auto','qa'],error_code:['protocol_invalid','invalid_scope','multiple_targets','unsupported_scope','no_usable_result','feature_disabled','budget_exceeded','upstream_error','model_output_limit','upstream_timeout','internal','transport_error','blank_capture','capture_failed','watchdog_timeout','user_toggled','capture_hotkey','stop_button','question_cap','quota_exhausted','run_failed','idle_timeout','hash_failures'],mode:['tutor','personality'],channel:['official','custom_key','cli'],operation:['solve','explain','recover'],completion_kind:['usable','retake','no_result','failed','canceled'],parser_path:['v1','legacy_fallback','legacy','none'],result_state:['ready','review','retake'],action:['copy','reveal_reasoning','retry','show_explanation','add_context','remove_context','start_new_session','select_region','confirm_review','recover_answer','export_feedback']};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function restoreJournal(stored,now) {
 if(stored?.formatVersion!==2)return null;
 const numberKeys=['sequence','coveredThrough','drops','intervalDrops','gapRevision'];
 if(!numberKeys.every(key=>Number.isInteger(stored[key])&&stored[key]>=0&&stored[key]<=1e9)||stored.coveredThrough>stored.sequence||!Array.isArray(stored.queue)||!Array.isArray(stored.openCaptures)||!stored.openCaptures.every(id=>uuid.test(id))||!Number.isFinite(Date.parse(stored.coverageFrom))||typeof stored.preference?.sharing_enabled!=='boolean'||!Number.isInteger(stored.preference.consent_epoch)||!Number.isFinite(Date.parse(stored.preference.valid_from)))return null;
 const data=Object.fromEntries(Object.keys(freshJournal(true,now)).map(key=>[key,stored[key]]));
 data.preference={consent_epoch:stored.preference.consent_epoch,sharing_enabled:stored.preference.sharing_enabled,valid_from:stored.preference.valid_from};
 const eventKeys=new Set(['event_id','occurred_at','event_name','capture_id','usable_result','total_ms','config_revision','source_group','source_method','consent_epoch','event_sequence','queue_drop_count',...Object.keys(enums)]);
 if(stored.queue.some(event=>!event||!uuid.test(event.event_id)||!Number.isFinite(Date.parse(event.occurred_at))||event.capture_id&&!uuid.test(event.capture_id)))return null;
 data.queue=stored.queue.map(event=>Object.fromEntries(Object.entries(event).filter(([key])=>eventKeys.has(key))));
 if(data.pendingCoverage){
  const keys=['observation_id','consent_epoch','valid_from','valid_to','sequence_from','sequence_to','queue_drop_count','coverage_status','gap_reason'];
  if(!uuid.test(data.pendingCoverage.observation_id))return null;
  data.pendingCoverage=Object.fromEntries(keys.map(key=>[key,data.pendingCoverage[key]]));
 }
 return data;
}

// Deliberately accepts categorical metadata only. No free-form content enters this journal.
export class Reliability {
  constructor({store,client,enabled=true,disabled=false,clock=()=>Date.now(),onPreference=()=>{}}) {
    Object.assign(this,{store,client,disabled,clock,onPreference});
    this.controller=null;this.running=null;this.retryIndex=0;this.timer=null;this.closed=false;
    let stored=null,storageFailed=false;
    try { stored=disabled?null:store.read('reliability',null); } catch { storageFailed=true; }
    const restored=restoreJournal(stored,this.clock());
    if(restored){this.data=restored;resume(this.data,this.clock());}
    else {this.data=freshJournal(enabled,this.clock());if(stored||storageFailed)gap(this.data,storageFailed||stored?.formatVersion?'storage_failure':'client_restart');}
    if(enabled!==this.data.preference.sharing_enabled)resetSharing(this.data,enabled,this.clock());
    if(!enabled){this.data.queue=[];this.data.openCaptures=[];this.data.pendingCoverage=null;}
    this.persist();
  }
  persist(strict=false) {if(!this.disabled)try{this.store.write('reliability',this.data);}catch(error){gap(this.data,'storage_failure');if(strict)throw error;}}
  bind() {
    if(!this.client.token)return false;
    const scope=createHash('sha256').update(this.client.base+'\0'+this.client.token).digest('hex');
    bindJournal(this.data,scope,this.clock());return true;
  }
  setEnabled(enabled) {
    if(typeof enabled!=='boolean')throw new Error('Invalid reliability preference');
    if(enabled===this.data.preference.sharing_enabled)return;
    this.controller?.abort();this.controller=null;this.running=null;
    this.data=structuredClone(this.data);resetSharing(this.data,enabled,this.clock());
    this.persist(true);this.onPreference(enabled);this.schedule(0);
  }
  start(){this.automatic=true;this.schedule(1000);}
  schedule(delay){if(!this.automatic||this.disabled||this.closed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),delay);this.timer.unref?.();}
  record(name,metadata={}) {
    if(this.disabled||this.closed||!this.data.preference.sharing_enabled)return;
    if(this.client.token)this.bind();
    if(!['capture_started','capture_completed','answer_action','auto_session_started','auto_session_ended'].includes(name))return;
    if(metadata.consent_epoch!==undefined&&metadata.consent_epoch!==this.data.preference.consent_epoch)return;
    if(this.client.config?.telemetry?.enabled===false){gap(this.data,'server_disabled');this.persist();return;}
    const event={event_id:randomUUID(),occurred_at:new Date(this.clock()).toISOString(),event_name:name};
    for(const [key,values] of Object.entries(enums))if(values.includes(metadata[key]))event[key]=metadata[key];
    if(typeof metadata.capture_id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(metadata.capture_id))event.capture_id=metadata.capture_id;
    if(typeof metadata.usable_result==='boolean')event.usable_result=metadata.usable_result;
    if(Number.isInteger(metadata.total_ms)&&metadata.total_ms>=0&&metadata.total_ms<=600000)event.total_ms=metadata.total_ms;
    if(name==='capture_completed'&&(!event.capture_id||!event.operation||!event.completion_kind||event.usable_result===undefined))return;
    if(typeof metadata.config_revision==='string'&&metadata.config_revision.length<=64)event.config_revision=metadata.config_revision;
    event.source_group='unknown';event.source_method='unknown';event.operation??='solve';
    appendEvent(this.data,event,this.clock());this.persist();
    if(this.automatic&&(name==='capture_completed'||this.data.queue.length>=20))void this.flush();else this.schedule(30000);
  }
  flush() {
    if(this.disabled||this.closed)return Promise.resolve();
    if(!this.bind()){this.schedule(30000);return Promise.resolve();}
    if(this.controller&&this.controller.scope!==this.data.scope){this.controller.abort();this.controller=null;this.running=null;}
    if(this.running)return this.running;
    const controller=this.controller=new AbortController(),data=this.data,token=this.client.token,base=this.client.base;
    controller.scope=data.scope;
    prune(data,this.clock());this.persist();
    if(!data.preference.sharing_enabled&&!data.preferencePending){this.controller=null;return Promise.resolve();}
    const request=(route,body)=>this.client.request(route,body,{token,signal:controller.signal,timeout:8000,expectedStatus:route==='/v1/events/batch'?202:200});
    const current=()=>{controller.signal.throwIfAborted();if(this.controller!==controller||this.data!==data||this.client.token!==token||this.client.base!==base)throw new Error('Observation scope changed');};
    this.running=(async()=>{
      if(data.preferencePending){
        const remote=await request('/v1/device-observation');current();
        if(!Number.isFinite(Date.parse(remote.server_time))||Math.abs(Date.parse(remote.server_time)-this.clock())>300000){gap(data,'invalid_time');throw new Error('Observation clock');}
        const pref=remote.preference;
        if(pref&&(!Number.isInteger(pref.consent_epoch)||pref.consent_epoch<0||pref.consent_epoch>1e9||typeof pref.sharing_enabled!=='boolean'||!Number.isFinite(Date.parse(pref.valid_from))))throw new Error('Observation preference');
        reconcile(data,pref,this.clock());this.onPreference(data.preference.sharing_enabled);
        if(data.preferencePending){
          const receipt=await request('/v1/device-observation',{schema_version:1,preference:data.preference});current();
          if(!receipt.accepted||receipt.preference?.consent_epoch!==data.preference.consent_epoch||receipt.preference?.sharing_enabled!==data.preference.sharing_enabled||!Number.isFinite(Date.parse(receipt.preference?.valid_from)))throw new Error('Preference receipt');
          data.preference={...receipt.preference};data.preferencePending=false;data.explicit=false;data.adoptRemote=false;
        }
        if(remote.telemetry_enabled===false)gap(data,'server_disabled');this.persist();
      }
      current();if(!data.preference.sharing_enabled)return;
      const limit=Math.min(50,Math.max(1,Number(this.client.config?.telemetry?.max_batch_size)||50));
      const batch=data.queue.slice(0,limit);
      if(batch.length){
        const ack=await request('/v1/events/batch',{schema_version:2,events:batch});current();
        if(![ack.accepted,ack.duplicate,ack.rejected].every(x=>Number.isInteger(x)&&x>=0))throw new Error('Event receipt');
        const count=ack.accepted+ack.duplicate+ack.rejected;
        if(count===batch.length){acknowledgeEvents(data,batch,ack.rejected);if(ack.rejected)data.preferencePending=true;}
        else if(count===0){acknowledgeEvents(data,batch,batch.length);gap(data,'server_disabled');}
        else throw new Error('Partial event receipt');this.persist();
      }
      if(!data.queue.length){
        const coverage=prepareCoverage(data,this.clock());
        if(coverage){
          this.persist();
          const receipt=await request('/v1/device-observation',{schema_version:1,coverage});current();
          if(!receipt.accepted||!['observation_id','consent_epoch','sequence_from','sequence_to'].every(key=>receipt.coverage?.[key]===coverage[key]))throw new Error('Coverage receipt');
          acknowledgeCoverage(data,coverage);this.persist();
        }
      }
      this.retryIndex=0;this.schedule(data.queue.length?100:30000);
    })().catch(()=>{
      if(this.controller!==controller||controller.signal.aborted||this.client.token!==token||this.client.base!==base)return;
      this.persist();this.schedule([60000,300000,1800000][Math.min(this.retryIndex++,2)]);
    }).finally(()=>{if(this.controller===controller){this.controller=null;this.running=null;}});
    return this.running;
  }
  stop(){this.closed=true;clearTimeout(this.timer);this.controller?.abort();shutdown(this.data);this.persist();}
}

// Same usable-result predicate as the native capture telemetry, including legacy exclusion.
export function captureObservation({mode,operation,parserPath='none',resultState,errorCode,canceled=false}) {
 const usable=!canceled&&!errorCode&&operation==='solve'&&mode==='tutor'&&
  (parserPath==='legacy_fallback'||(parserPath==='v1'&&['ready','review'].includes(resultState)));
 return {usable_result:usable,completion_kind:canceled?'canceled':['invalid_scope','multiple_targets','unsupported_scope'].includes(errorCode)?'no_result':errorCode?'failed':resultState==='retake'?'retake':usable?'usable':'failed',parser_path:parserPath,result_state:resultState,error_code:canceled?'stop_button':errorCode};
}
