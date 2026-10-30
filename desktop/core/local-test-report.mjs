import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const events=new Set(['solve_no_answer','solve_failed','capture_attempt','capture_blocked','capture_pixels_ready','capture_pixels_failed','solve_attempt','launch','quit','recovered','sample','capture_started','capture_completed','auto_session_started','auto_session_ended','answer_action','renderer_gone','unresponsive','action']);
const enums={trial_status:['eligible','active','expired','ineligible'],outcome:['retake','no_result'],failure_kind:['network','service','account','quota','maintenance','busy','conflict','rate_limit'],stage:['preparation','request'],error_code:['service_maintenance','device_busy','idempotency_conflict','capture_in_progress','capture_already_finalized','insufficient_quota','paid_credits_disabled','rate_limited','invalid_token','unknown_error','protocol_invalid','invalid_scope','multiple_targets','unsupported_scope','no_usable_result','feature_disabled','budget_exceeded','upstream_error','model_output_limit','upstream_timeout','internal','transport_error','blank_capture','capture_failed','watchdog_timeout','user_toggled','capture_hotkey','stop_button','question_cap','quota_exhausted','run_failed','idle_timeout','hash_failures'],mode:['tutor','personality'],operation:['solve','explain'],channel:['official','custom_key','cli'],trigger:['auto','capture_hotkey','context_hotkey','personality_hotkey'],completion_kind:['usable','retake','no_result','failed','canceled'],action:['capture','preview','remove','undo','submit','cancel','auto','expand','settings','guideNext','guideBack','guideDismiss','retry','copy','explain','confirmReview'],reason:['crashed','killed','oom','launch-failed','abnormal-exit','clean-exit','integrity-failure']};
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function reportZip(data){
 const name=Buffer.from('report.json'),body=Buffer.from(JSON.stringify(data,null,2)),crc=crc32(body);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
 return Buffer.concat([local,name,body,central,name,end]);
}
export class LocalTestReport {
 constructor(directory,environment){
  this.directory=directory;fs.mkdirSync(directory,{recursive:true});this.pending=path.join(directory,'pending.json');
  if(fs.existsSync(this.pending)){
   try{const previous=JSON.parse(fs.readFileSync(this.pending,'utf8'));previous.termination='interrupted';this.writeReport(previous);}catch{ /* Preserve unreadable journal; never mix arbitrary bytes into reports. */ }
  }
  this.data={schema:1,session:randomUUID(),startedAt:new Date().toISOString(),environment,events:[],dropped:0,termination:'running',privacy:'Local only; no screenshots, answers, prompts, window titles, paths or credentials. Diagnostic transmission disabled.'};
  this.record('launch');
 }
 record(name,metadata={}){
  if(this.closed||!events.has(name))return;
  const entry={event:name,at:new Date().toISOString()};
  for(const [key,allowed] of Object.entries(enums))if(allowed.includes(metadata[key]))entry[key]=metadata[key];
  if(Number.isInteger(metadata.http_status)&&metadata.http_status>=100&&metadata.http_status<=599)entry.http_status=metadata.http_status;
  for(const key of ['available_credits','total_ms','cpu_percent','cpu_browser','cpu_renderer','cpu_gpu','memory_mb'])if(Number.isFinite(metadata[key])&&metadata[key]>=0)entry[key]=Math.min(10000000,Math.round(metadata[key]));
  if(typeof metadata.usable_result==='boolean')entry.usable_result=metadata.usable_result;
  if(this.data.events.length>=2000){this.data.events.shift();this.data.dropped++;}
  this.data.events.push(entry);
  try {const temp=this.pending+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data),{mode:0o600});fs.renameSync(temp,this.pending);}catch{this.data.storageFailures=(this.data.storageFailures??0)+1;}
 }
 writeReport(data){
  const file=path.join(this.directory,`NotchSPI-test-${Date.now()}-${randomUUID().slice(0,8)}.zip`);
  const summary={};for(const e of data.events??[])summary[e.event]=(summary[e.event]??0)+1;
  fs.writeFileSync(file,reportZip({...data,summary,exportedAt:new Date().toISOString()}),{mode:0o600});return file;
 }
 finish(){if(this.closed)return;this.record('quit');this.data.termination='normal';const file=this.writeReport(this.data);this.closed=true;fs.unlinkSync(this.pending);return file;}
}
