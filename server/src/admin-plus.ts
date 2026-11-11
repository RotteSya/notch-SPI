import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {ApiError} from './http.ts';
import {entitlementVersion,type AdminDevice,type AdminGrantCommand} from './admin-store.ts';
import {plusEntitlement} from './plus.ts';

// Confirmed manual-days-v1 policy. Deployment enablement remains an explicit operator action.
export const MANUAL_PLUS_POLICY='manual-days-v1';
interface GrantTicket extends Omit<AdminGrantCommand,'id'|'fingerprint'> {policy:typeof MANUAL_PLUS_POLICY; nonce:string; days:number}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function signed(value:string,key:string){return createHmac('sha256',key).update('admin-plus-v1:'+value).digest('hex');}
export function previewPlus(d:AdminDevice,input:Record<string,unknown>,key:string,now=Date.now()){
  const days=input.days,actor=typeof input.actor==='string'?input.actor.trim():'',reason=typeof input.reason==='string'?input.reason.trim():'';
  if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>365)throw new ApiError(400,'赠送时长必须是 1–365 的整数天');
  if(actor.length<2||actor.length>80||reason.length<5||reason.length>500)throw new ApiError(400,'请填写操作人（2–80 字）及原因（5–500 字）');
  if(/dev_[A-Za-z0-9_-]+/.test(actor+reason)||(key&&(actor+reason).includes(key)))throw new ApiError(400,'操作人或原因不能包含恢复码、管理员密钥');
  const coverage=plusEntitlement(d.paid,d.manual,now),base=coverage.expiresAt?Date.parse(coverage.expiresAt):now;
  const anchor=base;
  const startsAt=d.manual&&Date.parse(d.manual.startsAt)<=now&&Date.parse(d.manual.expiresAt)>now?d.manual.startsAt:new Date(now).toISOString();
  const manual={startsAt,expiresAt:new Date(anchor+days*86400000).toISOString(),version:(d.manual?.version??0)+1};
  const ticket:GrantTicket={deviceId:d.id,actor,credentialId:'shared:'+digest(key).slice(0,16),reason,expected:entitlementVersion(d),manual,
    expiresPreviewAt:new Date(now+10*60000).toISOString(),policy:MANUAL_PLUS_POLICY,nonce:randomUUID(),days,durationDays:days,previewActive:coverage.active};
  const payload=Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return {policy:MANUAL_PLUS_POLICY,device_id:d.id,days,actor,reason,starts_on_confirmation:!coverage.active,starts_at:new Date(anchor).toISOString(),expires_at:manual.expiresAt,
    preview_expires_at:ticket.expiresPreviewAt,ticket:payload+'.'+signed(payload,key)};
}
export function grantCommand(body:Record<string,unknown>,key:string):AdminGrantCommand{
  const raw=body.ticket,id=body.idempotency_key;
  if(typeof raw!=='string'||raw.length>6000||typeof id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))throw new ApiError(400,'预览凭据或幂等操作号无效');
  const [payload,signature,...extra]=raw.split('.');
  if(!payload||!signature||extra.length||!/^[a-f\d]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(signed(payload,key),'hex')))throw new ApiError(400,'预览凭据无效，请重新预览');
  let ticket:GrantTicket;try{ticket=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as GrantTicket;}catch{throw new ApiError(400,'预览凭据无效');}
  if(ticket.policy!==MANUAL_PLUS_POLICY||!Number.isSafeInteger(ticket.deviceId)||!ticket.manual)throw new ApiError(400,'预览策略无效');
  return {...ticket,id,fingerprint:digest(raw)};
}
