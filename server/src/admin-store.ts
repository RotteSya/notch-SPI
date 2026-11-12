import {createHash} from 'node:crypto';
import {plusEntitlement,type PlusRecord} from './plus.ts';
import {ApiError} from './http.ts';

export interface ManualPlus {startsAt:string; expiresAt:string; version:number}
export interface AdminDevice {
  id:number; platform:string|null; appVersion:string|null; isInternal?:boolean; createdAt:string; updatedAt:string;
  totalQuestions:number; balanceQuestions:number; onboarded:boolean; hotkeyPresses:number;
  cliEnabled:boolean; paid:PlusRecord|null; manual:ManualPlus|null;
}
export interface AdminWindow {from:string; to:string}
export interface AdminFilter extends AdminWindow {
  page:number; size:number; registrationOnly:boolean; search:string; plan:'all'|'active'|'expiring'|'inactive';
  sort:'newest'|'oldest'|'expiry'; deviceId:number|null; state:string;
}
export interface AdminAction {
  id:string; deviceId:number; actor:string; credentialId:string; reason:string; createdAt:string;
  kind:string; before:unknown; after:unknown;
}
export interface AdminRequest {
  id:string; deviceId:number; createdAt:string; finishedAt:string|null; state:string;
  operation:string; error:string|null; latencyMs:number|null;
}
export interface AdminOverview {
  registered:number; activeDevices:number; requests:number; completed:number; usable:number;
  latencyMs:number|null; latencySamples:number; totalDevices:number; activePlus:number; expiringPlus:number;
  trend:Array<{day:string; requests:number; usable:number; activeDevices:number}>;
  errors:Array<{error:string; count:number}>;
  costs:Array<{category:'internal'|'user'; currency:string; count:number; knownCostMicros:string|null; unknownCost:number; provisionalMicros:string; bookedMicros:string; unbooked:number}>;
  models:Array<{category:'internal'|'user'; model:string; provider:string; count:number; currency:string; knownCostMicros:string|null; unknownCost:number}>;
}
export interface AdminPage<T> {items:T[]; total:number; page:number; size:number}
export interface AdminGrantCommand {
  id:string; deviceId:number; actor:string; credentialId:string; reason:string; fingerprint:string;
  expected:string; manual:ManualPlus; expiresPreviewAt:string; durationDays?:number; previewActive?:boolean;
}
export function entitlementState(d:AdminDevice){return {paid:d.paid?{intentId:d.paid.intentId,status:d.paid.status,paidFrom:d.paid.paidFrom,paidUntil:d.paid.paidUntil,cancelAtPeriodEnd:d.paid.cancelAtPeriodEnd}:null,manual:d.manual};}
export function entitlementVersion(d:AdminDevice){return createHash('sha256').update(JSON.stringify(entitlementState(d))).digest('hex');}
export function grantAction(d:AdminDevice,c:AdminGrantCommand):AdminAction {
  if(c.expiresPreviewAt<new Date().toISOString())throw new ApiError(409,'预览已过期，请重新核对权益','expired');
  if(entitlementVersion(d)!==c.expected)throw new ApiError(409,'权益已变化，请重新查询并预览','report_changed');
  const coverage=plusEntitlement(d.paid,d.manual),now=new Date().toISOString();
  if(c.previewActive!==undefined&&c.previewActive!==coverage.active)throw new ApiError(409,'权益已跨过到期时间，请重新预览','report_changed');
  const manual=c.durationDays===undefined?c.manual:{startsAt:d.manual&&d.manual.startsAt<=now&&d.manual.expiresAt>now?d.manual.startsAt:now,
    expiresAt:new Date((coverage.expiresAt?Date.parse(coverage.expiresAt):Date.parse(now))+c.durationDays*86400000).toISOString(),version:(d.manual?.version??0)+1};
  return {id:c.id,deviceId:d.id,kind:'plus_grant',actor:c.actor,credentialId:c.credentialId,reason:c.reason,createdAt:new Date().toISOString(),before:entitlementState(d),after:entitlementState({...d,manual})};
}
export interface AdminStore {
  applyGrant(command:AdminGrantCommand):Promise<AdminAction>;

  lookup(token:string):Promise<AdminDevice|null>;
  device(id:number):Promise<AdminDevice|null>;
  overview(q:AdminWindow):Promise<AdminOverview>;
  devices(q:AdminFilter):Promise<AdminPage<AdminDevice>>;
  requests(q:AdminFilter):Promise<AdminPage<AdminRequest>>;
  actions(q:AdminFilter):Promise<AdminPage<AdminAction>>;
}
export function adminFilter(raw:Record<string,unknown>,now=Date.now()):AdminFilter {
  const date=(value:unknown,fallback:number)=>{
    if(value===undefined)return new Date(fallback).toISOString();
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||(!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19)))throw new ApiError(400,'请使用有效的 UTC 时间');
    return new Date(value).toISOString();
  };
  const from=date(raw.from,now-7*86400000),to=date(raw.to,now);
  if(from>=to||Date.parse(to)-Date.parse(from)>90*86400000)throw new ApiError(400,'时间范围必须大于 0 且不超过 90 天');
  const integer=(v:unknown,fallback:number,max:number)=>{if(v===undefined)return fallback;const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>max)throw new ApiError(400,'分页或设备编号无效');return n;};
  const search=typeof raw.search==='string'?raw.search.trim():'';
  if(search.length>80||search.includes('dev_'))throw new ApiError(400,'搜索仅接受设备编号、平台或版本；恢复码请使用专用表单');
  const plan=String(raw.plan??'all'),sort=String(raw.sort??'newest'),state=String(raw.state??'all');
  if(!['all','active','expiring','inactive'].includes(plan)||!['newest','oldest','expiry'].includes(sort)||!['all','pending','usable','retake','no_result','failed','canceled'].includes(state))throw new ApiError(400,'筛选条件无效');
  return {from,to,search,registrationOnly:raw.registration_only==='1',plan:plan as AdminFilter['plan'],sort:sort as AdminFilter['sort'],state,
    page:integer(raw.page,1,10000),size:integer(raw.size,25,100),deviceId:raw.device_id===undefined?null:integer(raw.device_id,1,Number.MAX_SAFE_INTEGER)};
}
export const ADMIN_SCHEMA=`
CREATE TABLE IF NOT EXISTS admin_plus_entitlements (
 device_id BIGINT PRIMARY KEY REFERENCES devices(id), starts_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 version BIGINT NOT NULL CHECK(version>0), CHECK(expires_at>starts_at)
);
CREATE TABLE IF NOT EXISTS admin_operations (
 operation_id TEXT PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES devices(id), kind TEXT NOT NULL,
 actor TEXT NOT NULL, credential_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
 fingerprint TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_operations_time ON admin_operations(created_at,operation_id);
CREATE INDEX IF NOT EXISTS idx_admin_operations_device ON admin_operations(device_id,created_at);
CREATE INDEX IF NOT EXISTS idx_admin_manual_expiry ON admin_plus_entitlements(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_capture_time ON capture_requests(created_at,request_id);
CREATE INDEX IF NOT EXISTS idx_admin_device_time ON devices(created_at,id);
`;
