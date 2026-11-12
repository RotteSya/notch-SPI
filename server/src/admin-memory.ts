import {grantAction,type AdminGrantCommand} from './admin-store.ts';
import type {AdminStore,AdminDevice,AdminFilter,AdminWindow,AdminOverview,AdminRequest,AdminAction,AdminPage,ManualPlus} from './admin-store.ts';
import type {Attempt} from './billing.ts';
import type {BudgetAccounting} from './budget-policy.ts';
import {plusEntitlement} from './plus.ts';
import {ApiError} from './http.ts';

export class MemoryAdmin implements AdminStore {
  readonly grants=new Map<number,ManualPlus>();
  readonly audit=new Map<string,AdminAction & {fingerprint:string}>();
  private source:()=>AdminDevice[]; private credential:(token:string)=>number|null;
  private traffic:()=>{requests:AdminRequest[];attempts:Array<Attempt & {deviceId:number;requestAt:string;accounting?:BudgetAccounting}>};
  constructor(source:MemoryAdmin['source'],credential:MemoryAdmin['credential'],traffic:MemoryAdmin['traffic']){this.source=source;this.credential=credential;this.traffic=traffic;}
  private all(){return this.source().map(d=>({...d,manual:this.grants.get(d.id)??null}));}
  async applyGrant(c:AdminGrantCommand):Promise<AdminAction>{
    // No await inside this mutation: identity, version, audit and grant commit in one JS turn.
    const d=this.all().find(d=>d.id===c.deviceId);if(!d)throw new ApiError(404,'设备账户不存在');
    const previous=this.audit.get(c.id);
    if(previous){if(previous.fingerprint!==c.fingerprint||previous.deviceId!==c.deviceId)throw new ApiError(409,'操作号已用于其他变更','idempotency_conflict');const {fingerprint,...action}=previous;return action;}
    const action=grantAction(d,c);this.audit.set(c.id,{...action,fingerprint:c.fingerprint});this.grants.set(d.id,{...(action.after as {manual:ManualPlus}).manual});return action;
  }
  async lookup(token:string){const id=this.credential(token);const found=this.all().filter(d=>d.id===id);if(found.length>1)throw new ApiError(409,'恢复码关联不明确','binding_mismatch');return found[0]??null;}
  async device(id:number){return this.all().find(d=>d.id===id)??null;}
  private until(d:AdminDevice){return plusEntitlement(d.paid,d.manual).expiresAt;}
  private page<T>(items:T[],q:AdminFilter):AdminPage<T>{return {items:items.slice((q.page-1)*q.size,q.page*q.size),total:items.length,page:q.page,size:q.size};}
  async devices(q:AdminFilter){const soon=new Date(Date.now()+7*86400000).toISOString(),search=q.search.toLowerCase();
    const items=this.all().filter(d=>(!q.registrationOnly||(d.createdAt>=q.from&&d.createdAt<q.to))&&(q.deviceId===null||q.deviceId===d.id)&&(!search||String(d.id)===search||d.platform?.toLowerCase().includes(search)||d.appVersion?.toLowerCase().includes(search))&&
      (q.plan==='all'||(q.plan==='inactive'?!this.until(d):q.plan==='active'?!!this.until(d):!!this.until(d)&&this.until(d)!<=soon)));
    items.sort((a,b)=>q.sort==='expiry'?(this.until(a)??'z').localeCompare(this.until(b)??'z')||a.id-b.id:q.sort==='oldest'?a.createdAt.localeCompare(b.createdAt)||a.id-b.id:b.createdAt.localeCompare(a.createdAt)||b.id-a.id);
    return this.page(items,q);
  }
  async requests(q:AdminFilter){return this.page(this.traffic().requests.filter(r=>r.createdAt>=q.from&&r.createdAt<q.to&&(q.deviceId===null||q.deviceId===r.deviceId)&&(q.state==='all'||q.state===r.state)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)),q);}
  async actions(q:AdminFilter){return this.page([...this.audit.values()].filter(r=>r.createdAt>=q.from&&r.createdAt<q.to&&(q.deviceId===null||q.deviceId===r.deviceId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).map(({fingerprint,...action})=>action),q);}
  async overview(q:AdminWindow):Promise<AdminOverview>{
    const devices=this.all(),traffic=this.traffic(),requests=traffic.requests.filter(r=>r.createdAt>=q.from&&r.createdAt<q.to),latencies=requests.flatMap(r=>r.latencyMs===null?[]:[r.latencyMs]);
    const days=new Map<string,AdminRequest[]>(),errors=new Map<string,number>(),models=new Map<string,AdminOverview['models'][number]>();
    for(const r of requests){const day=new Date(Date.parse(r.createdAt)+8*3600000).toISOString().slice(0,10);days.set(day,[...(days.get(day)??[]),r]);if(r.state==='failed')errors.set(r.error??'unknown',(errors.get(r.error??'unknown')??0)+1);}
    const costs=new Map<string,AdminOverview['costs'][number]>();
    for(const a of traffic.attempts.filter(a=>a.requestAt>=q.from&&a.requestAt<q.to)){const device=devices.find(d=>d.id===a.deviceId),category=device?.isInternal||device?.platform==='release-qa'?'internal':'user';const key=JSON.stringify([category,a.provider,a.model,a.currency]),m=models.get(key)??{category,provider:a.provider,model:a.model,currency:a.currency,count:0,knownCostMicros:null,unknownCost:0};m.count++;if(a.costMicros===null)m.unknownCost++;else m.knownCostMicros=(BigInt(m.knownCostMicros??0)+BigInt(a.costMicros)).toString();models.set(key,m);
      const ck=JSON.stringify([category,a.currency]),c=costs.get(ck)??{category,currency:a.currency,count:0,knownCostMicros:null,unknownCost:0,provisionalMicros:'0',bookedMicros:'0',unbooked:0};
      const b=a.accounting,value=b&&['observed','reconciled','released'].includes(b.state)?b.actual:a.costMicros;c.count++;
      if(value===null)c.unknownCost++;else c.knownCostMicros=(BigInt(c.knownCostMicros??0)+BigInt(value)).toString();
      if(!b)c.unbooked++;else {c.bookedMicros=(BigInt(c.bookedMicros)+BigInt(b.booked)).toString();if(b.state==='provisional')c.provisionalMicros=(BigInt(c.provisionalMicros)+BigInt(b.booked)).toString();}costs.set(ck,c);
    }
    const soon=new Date(Date.now()+7*86400000).toISOString();
    return {costs:[...costs.values()],registered:devices.filter(d=>d.createdAt>=q.from&&d.createdAt<q.to).length,totalDevices:devices.length,activePlus:devices.filter(d=>this.until(d)).length,expiringPlus:devices.filter(d=>this.until(d)&&this.until(d)!<=soon).length,
      requests:requests.length,activeDevices:new Set(requests.map(r=>r.deviceId)).size,completed:requests.filter(r=>r.state!=='pending').length,usable:requests.filter(r=>r.state==='usable').length,
      latencyMs:latencies.length?Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length):null,latencySamples:latencies.length,
      trend:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,rs])=>({day,requests:rs.length,usable:rs.filter(r=>r.state==='usable').length,activeDevices:new Set(rs.map(r=>r.deviceId)).size})),
      errors:[...errors].map(([error,count])=>({error,count})).sort((a,b)=>b.count-a.count).slice(0,20),models:[...models.values()].sort((a,b)=>b.count-a.count).slice(0,50)};
  }
}
