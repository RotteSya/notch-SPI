import {grantAction,type AdminGrantCommand} from './admin-store.ts';
import {query,type Row,type Transaction,type RunTransaction} from './billing-sql.ts';
import {hashToken} from './db.ts';
import {plusRow} from './plus-sql.ts';
import {ApiError} from './http.ts';
import type {AdminStore,AdminDevice,AdminFilter,AdminWindow,AdminOverview,AdminRequest,AdminAction,AdminPage} from './admin-store.ts';

const iso=(v:unknown)=>new Date(String(v)).toISOString();
const bool=(v:unknown)=>v===true||Number(v)===1;
export function adminDevice(r:Row):AdminDevice {
  return {id:Number(r.id),platform:r.platform as string|null,appVersion:r.app_version as string|null,isInternal:bool(r.is_internal),createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),
    totalQuestions:Number(r.total_questions),balanceQuestions:Number(r.balance_questions),onboarded:bool(r.onboarded),hotkeyPresses:Number(r.hotkey_presses),cliEnabled:bool(r.cli_enabled),
    paid:r.intent_id?plusRow({...r,device_id:r.id,created_at:r.plan_created}):null,
    manual:r.manual_until?{startsAt:String(r.manual_from),expiresAt:String(r.manual_until),version:Number(r.manual_version)}:null};
}
export const DEVICE_SELECT=`SELECT d.id,d.platform,d.app_version,d.is_internal,d.created_at,d.updated_at,d.total_questions,d.balance_questions,d.onboarded,d.hotkey_presses,d.cli_enabled,
 p.intent_id,p.created_at AS plan_created,p.checkout_id,p.checkout_url,p.subscription_id,p.customer_id,p.status,p.paid_from,p.paid_until,p.cancel_at_period_end,p.generation,
 g.starts_at AS manual_from,g.expires_at AS manual_until,g.version AS manual_version
 FROM devices d LEFT JOIN plus_subscriptions p ON p.device_id=d.id LEFT JOIN admin_plus_entitlements g ON g.device_id=d.id`;
export function* readAdminDevice(id:number,lock=false):Transaction<AdminDevice|null> {
  if(lock)yield* query('SELECT id FROM devices WHERE id=? FOR UPDATE',id);
  const r=(yield* query(DEVICE_SELECT+' WHERE d.id=?',id))[0];return r?adminDevice(r):null;
}
export const activeSQL=(now:string)=>{
  // now is a server-created ISO timestamp, never user SQL.
  const paid=`p.paid_from<='${now}' AND p.paid_until>'${now}' AND p.status NOT IN ('canceled','unpaid','incomplete_expired','paused')`;
  const manual=`g.starts_at<='${now}' AND g.expires_at>'${now}'`;
  const joined=`g.expires_at>'${now}' AND (g.starts_at<='${now}' OR ((${paid}) AND g.starts_at<=p.paid_until))`;
  const joinedPaid=`p.paid_until>'${now}' AND p.status NOT IN ('canceled','unpaid','incomplete_expired','paused') AND (p.paid_from<='${now}' OR ((${manual}) AND p.paid_from<=g.expires_at))`;
  return {active:`((${paid}) OR (${manual}))`,until:`CASE WHEN (${joined}) AND (NOT COALESCE((${joinedPaid}),FALSE) OR g.expires_at>p.paid_until) THEN g.expires_at WHEN (${joinedPaid}) THEN p.paid_until ELSE NULL END`};
};
export class SQLAdmin implements AdminStore {
  protected run:RunTransaction; private pg:boolean;
  constructor(run:RunTransaction,pg=false){this.run=run;this.pg=pg;}
  private json(column:string,key:string){return this.pg?`(${column}::jsonb->>'${key}')`:`json_extract(${column},'$.${key}')`;}
  private day(column:string){return this.pg?`to_char((${column})::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`:`strftime('%Y-%m-%d',${column},'+8 hours')`;}
  private duration(){const a=this.json('c.metadata','finishedAt'),b=this.json('c.metadata','createdAt');return this.pg?`EXTRACT(EPOCH FROM (${a})::timestamptz-(${b})::timestamptz)*1000`:`(julianday(${a})-julianday(${b}))*86400000`;}
  applyGrant(c:AdminGrantCommand){return this.run((function*():Transaction<AdminAction>{
    const d=yield* readAdminDevice(c.deviceId,true);if(!d)throw new ApiError(404,'设备账户不存在');
    const previous=(yield* query('SELECT * FROM admin_operations WHERE operation_id=?',c.id))[0];
    if(previous){if(previous.fingerprint!==c.fingerprint||Number(previous.device_id)!==c.deviceId)throw new ApiError(409,'操作号已用于其他变更','idempotency_conflict');
      return {id:String(previous.operation_id),deviceId:Number(previous.device_id),kind:String(previous.kind),actor:String(previous.actor),credentialId:String(previous.credential_id),reason:String(previous.reason),createdAt:String(previous.created_at),before:JSON.parse(String(previous.before_json)),after:JSON.parse(String(previous.after_json))};}
    const action=grantAction(d,c),manual=(action.after as {manual:import('./admin-store.ts').ManualPlus}).manual;
    yield* query(`INSERT INTO admin_operations(operation_id,device_id,kind,actor,credential_id,reason,created_at,fingerprint,before_json,after_json) VALUES(?,?,'plus_grant',?,?,?,?,?,?,?)`,
      c.id,d.id,c.actor,c.credentialId,c.reason,action.createdAt,c.fingerprint,JSON.stringify(action.before),JSON.stringify(action.after));
    yield* query(`INSERT INTO admin_plus_entitlements(device_id,starts_at,expires_at,version) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET starts_at=excluded.starts_at,expires_at=excluded.expires_at,version=excluded.version`,d.id,manual.startsAt,manual.expiresAt,manual.version);
    return action;
  })());}
  lookup(token:string){return this.run((function*():Transaction<AdminDevice|null>{
    const rows=yield* query(DEVICE_SELECT+' WHERE d.token_hash=? LIMIT 2',hashToken(token));
    if(rows.length>1)throw new ApiError(409,'恢复码关联不明确，请排查数据后重试','binding_mismatch');
    return rows[0]?adminDevice(rows[0]):null;
  })());}
  device(id:number){return this.run(readAdminDevice(id));}
  devices(q:AdminFilter){const a=activeSQL(new Date().toISOString()),soon=new Date(Date.now()+7*86400000).toISOString();
    const where=q.registrationOnly?['d.created_at>=?','d.created_at<?']:['1=1'],args:Array<string|number|null>=q.registrationOnly?[q.from,q.to]:[];
    if(q.search){where.push("(CAST(d.id AS TEXT)=? OR LOWER(COALESCE(d.platform,'')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(d.app_version,'')) LIKE ? ESCAPE '!')");const s='%'+q.search.toLowerCase().replace(/[!%_]/g,'!$&')+'%';args.push(q.search,s,s);}
    if(q.deviceId!==null){where.push('d.id=?');args.push(q.deviceId);}
    if(q.plan==='active')where.push(a.active);
    if(q.plan==='expiring'){where.push(a.active,`(${a.until})<=?`);args.push(soon);}
    if(q.plan==='inactive')where.push(`NOT COALESCE(${a.active},FALSE)`);
    const filter=' WHERE '+where.join(' AND '),joins=DEVICE_SELECT.slice(DEVICE_SELECT.indexOf(' FROM devices'));
    const order=q.sort==='oldest'?'d.created_at,d.id':q.sort==='expiry'?`(${a.until}) IS NULL,(${a.until}),d.id`:'d.created_at DESC,d.id DESC';
    return this.run((function*():Transaction<AdminPage<AdminDevice>>{
      const total=Number((yield* query('SELECT COUNT(*) AS n'+joins+filter,...args))[0]!.n);
      const rows=yield* query(DEVICE_SELECT+filter+' ORDER BY '+order+' LIMIT ? OFFSET ?',...args,q.size,(q.page-1)*q.size);
      return {items:rows.map(adminDevice),total,page:q.page,size:q.size};
    })(),{readOnlySnapshot:true});
  }
  requests(q:AdminFilter){const state=this.json('c.metadata','terminalState'),error=this.json('c.metadata','terminalReason'),operation=this.json('c.metadata','operation'),finished=this.json('c.metadata','finishedAt'),duration=this.duration();
    const where=['c.created_at>=?','c.created_at<?'],args:Array<string|number|null>=[q.from,q.to];
    if(q.deviceId!==null){where.push('c.device_id=?');args.push(q.deviceId);}if(q.state!=='all'){where.push(`${state}=?`);args.push(q.state);}
    const filter=' WHERE '+where.join(' AND ');
    return this.run((function*():Transaction<AdminPage<AdminRequest>>{
      const total=Number((yield* query('SELECT COUNT(*) AS n FROM capture_requests c'+filter,...args))[0]!.n);
      const rows=yield* query(`SELECT c.request_id,c.device_id,c.created_at,${state} AS terminal,${error} AS error,${operation} AS operation,${finished} AS finished,${duration} AS duration FROM capture_requests c`+filter+' ORDER BY c.created_at DESC,c.request_id DESC LIMIT ? OFFSET ?',...args,q.size,(q.page-1)*q.size);
      return {total,page:q.page,size:q.size,items:rows.map(r=>({id:String(r.request_id),deviceId:Number(r.device_id),createdAt:iso(r.created_at),finishedAt:r.finished?iso(r.finished):null,state:String(r.terminal),error:r.error as string|null,operation:String(r.operation),latencyMs:r.duration===null?null:Math.max(0,Math.round(Number(r.duration)))}))};
    })(),{readOnlySnapshot:true});
  }
  actions(q:AdminFilter){return this.run((function*():Transaction<AdminPage<AdminAction>>{
    const filter=' WHERE created_at>=? AND created_at<?'+(q.deviceId!==null?' AND device_id=?':''),args:Array<string|number>=[q.from,q.to,...(q.deviceId!==null?[q.deviceId]:[])];
    const total=Number((yield* query('SELECT COUNT(*) AS n FROM admin_operations'+filter,...args))[0]!.n);
    const rows=yield* query('SELECT operation_id,device_id,kind,actor,credential_id,reason,created_at,before_json,after_json FROM admin_operations'+filter+' ORDER BY created_at DESC,operation_id DESC LIMIT ? OFFSET ?',...args,q.size,(q.page-1)*q.size);
    return {total,page:q.page,size:q.size,items:rows.map(r=>({id:String(r.operation_id),deviceId:Number(r.device_id),kind:String(r.kind),actor:String(r.actor),credentialId:String(r.credential_id),reason:String(r.reason),createdAt:String(r.created_at),before:JSON.parse(String(r.before_json)),after:JSON.parse(String(r.after_json))}))};
  })(),{readOnlySnapshot:true});}
  overview(q:AdminWindow){const now=new Date().toISOString(),a=activeSQL(now),soon=new Date(Date.now()+7*86400000).toISOString(),state=this.json('c.metadata','terminalState'),duration=this.duration(),day=this.day('c.created_at'),error=this.json('c.metadata','terminalReason');
    const model=this.json('a.metadata','model'),provider=this.json('a.metadata','provider'),currency=this.json('a.metadata','currency'),cost=this.json('a.metadata','costMicros');
    const category="CASE WHEN d.is_internal=1 OR d.platform='release-qa' THEN 'internal' ELSE 'user' END";
    return this.run((function*():Transaction<AdminOverview>{
      const devices=(yield* query(`SELECT COUNT(*) AS total,SUM(CASE WHEN d.created_at>=? AND d.created_at<? THEN 1 ELSE 0 END) AS registered,
        SUM(CASE WHEN ${a.active} THEN 1 ELSE 0 END) AS plus,SUM(CASE WHEN (${a.until})<=? THEN 1 ELSE 0 END) AS expiring`+DEVICE_SELECT.slice(DEVICE_SELECT.indexOf(' FROM devices')),q.from,q.to,soon))[0]!;
      const captures=(yield* query(`SELECT COUNT(*) AS n,COUNT(DISTINCT c.device_id) AS active,SUM(CASE WHEN ${state}<>'pending' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN ${state}='usable' THEN 1 ELSE 0 END) AS usable,AVG(${duration}) AS latency,COUNT(${duration}) AS samples FROM capture_requests c WHERE c.created_at>=? AND c.created_at<?`,q.from,q.to))[0]!;
      const trend=yield* query(`SELECT ${day} AS day,COUNT(*) AS n,SUM(CASE WHEN ${state}='usable' THEN 1 ELSE 0 END) AS usable,COUNT(DISTINCT c.device_id) AS active FROM capture_requests c WHERE c.created_at>=? AND c.created_at<? GROUP BY ${day} ORDER BY day`,q.from,q.to);
      const errors=yield* query(`SELECT COALESCE(${error},'unknown') AS error,COUNT(*) AS n FROM capture_requests c WHERE c.created_at>=? AND c.created_at<? AND ${state}='failed' GROUP BY COALESCE(${error},'unknown') ORDER BY n DESC LIMIT 20`,q.from,q.to);
      const models=yield* query(`SELECT ${category} AS category,${model} AS model,${provider} AS provider,${currency} AS currency,COUNT(*) AS n,SUM(CAST(${cost} AS BIGINT)) AS cost,SUM(CASE WHEN ${cost} IS NULL THEN 1 ELSE 0 END) AS unknown FROM model_attempts a JOIN capture_requests c ON c.request_id=a.request_id JOIN devices d ON d.id=a.device_id WHERE c.created_at>=? AND c.created_at<? GROUP BY ${category},${model},${provider},${currency} ORDER BY n DESC LIMIT 50`,q.from,q.to);
      const costs=yield* query(`SELECT ${category} AS category,${currency} AS currency,COUNT(*) AS n,
        SUM(CASE WHEN b.state IN ('observed','reconciled','released') THEN b.actual ELSE CAST(${cost} AS BIGINT) END) AS cost,
        SUM(CASE WHEN b.state IN ('observed','reconciled','released') OR ${cost} IS NOT NULL THEN 0 ELSE 1 END) AS unknown,
        COALESCE(SUM(CASE WHEN b.state='provisional' THEN b.booked ELSE 0 END),0) AS provisional,
        COALESCE(SUM(b.booked),0) AS booked,SUM(CASE WHEN b.attempt_id IS NULL THEN 1 ELSE 0 END) AS unbooked
        FROM model_attempts a JOIN capture_requests c ON c.request_id=a.request_id JOIN devices d ON d.id=a.device_id
        LEFT JOIN budget_accounting b ON b.attempt_id=a.attempt_id WHERE c.created_at>=? AND c.created_at<? GROUP BY ${category},${currency} ORDER BY ${currency},${category}`,q.from,q.to);
      return {costs:costs.map(r=>({category:r.category as 'internal'|'user',currency:String(r.currency),count:Number(r.n),knownCostMicros:r.cost===null?null:String(r.cost),unknownCost:Number(r.unknown),provisionalMicros:String(r.provisional),bookedMicros:String(r.booked),unbooked:Number(r.unbooked)})),registered:Number(devices.registered??0),totalDevices:Number(devices.total),activePlus:Number(devices.plus??0),expiringPlus:Number(devices.expiring??0),
        requests:Number(captures.n),activeDevices:Number(captures.active),completed:Number(captures.completed??0),usable:Number(captures.usable??0),latencyMs:captures.latency===null?null:Math.round(Number(captures.latency)),latencySamples:Number(captures.samples),
        trend:trend.map(r=>({day:String(r.day),requests:Number(r.n),usable:Number(r.usable),activeDevices:Number(r.active)})),errors:errors.map(r=>({error:String(r.error),count:Number(r.n)})),
        models:models.map(r=>({category:r.category as 'internal'|'user',model:String(r.model),provider:String(r.provider),currency:String(r.currency),count:Number(r.n),knownCostMicros:r.cost===null?null:String(r.cost),unknownCost:Number(r.unknown)}))};
    })(),{readOnlySnapshot:true});
  }
}
