import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Store} from '../src/db.ts';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import {entitlementVersion,type AdminGrantCommand,adminFilter} from '../src/admin-store.ts';
import {plusEntitlement} from '../src/plus.ts';
const makers:Array<[string,()=>Store|Promise<Store>]>=[['memory',()=>new MemoryStore()],['sqlite',()=>new SqliteStore(':memory:')]];
if(process.env.TEST_POSTGRES_URL){
 const url=new URL(process.env.TEST_POSTGRES_URL);if(!/test/i.test(url.pathname))throw new Error('Isolated test database required');
 const {PostgresStore,resolvePostgresSSL}=await import('../src/db-postgres.ts');const pg=(await import('pg')).default;
 const pool=new pg.Pool({connectionString:url.toString(),ssl:resolvePostgresSSL({connectionString:url.toString()})}),schema='admin_test_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options','-c search_path='+schema);
 after(async()=>{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
 makers.push(['postgres',async()=>{const s=new PostgresStore(url.toString(),resolvePostgresSSL({connectionString:url.toString()}));await s.getAccount('__test_schema__');await pool.query(`TRUNCATE ${schema}.devices RESTART IDENTITY CASCADE`);return s;}]);
 test('postgres: failed grant transaction leaves no audit or entitlement, then retries safely',async()=>{
  const s=new PostgresStore(url.toString(),resolvePostgresSSL({connectionString:url.toString()}));
  try{
   const d=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0}),target=(await s.admin.device(d.id))!,now=Date.now();
   const c:AdminGrantCommand={id:randomUUID(),deviceId:d.id,actor:'test',credentialId:'fixture',reason:'Postgres rollback fixture',fingerprint:'rollback',expected:entitlementVersion(target),expiresPreviewAt:new Date(now+60000).toISOString(),manual:{startsAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),version:1}};
   await pool.query(`CREATE FUNCTION ${schema}.reject_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated grant write failure'; END $$; CREATE TRIGGER test_grant_failure BEFORE INSERT ON ${schema}.admin_plus_entitlements FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_grant()`);
   await assert.rejects(s.admin.applyGrant(c),/simulated grant write failure/);
   assert.equal(await s.plus.manual(d.token),null);const filter=adminFilter({device_id:d.id,to:new Date(now+60000).toISOString()});assert.equal((await s.admin.actions(filter)).total,0);
   await pool.query(`DROP TRIGGER test_grant_failure ON ${schema}.admin_plus_entitlements`);
   await s.admin.applyGrant(c);assert.equal((await s.admin.actions(filter)).total,1);assert.equal((await s.billing.quota(d.token))!.allowanceSources!.plus,400);
  }finally{await s.close();}
 });
}
for(const [name,make] of makers)test(name+': manual rights are atomic, idempotent, audited, read by quota and independent of Stripe',async t=>{
 const now=Date.parse('2026-11-11T04:00:00.000Z');t.mock.timers.enable({apis:['Date'],now});const s=await make();
 try{
 const d=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0});
 const state=await s.admin.lookup(d.token);const command:AdminGrantCommand={id:randomUUID(),deviceId:d.id,actor:'测试管理员',credentialId:'fixture-key-id',reason:'隔离测试权益发放',fingerprint:'same-body',expected:entitlementVersion(state!),expiresPreviewAt:'2026-11-11T04:10:00.000Z',manual:{startsAt:'2026-11-11T04:00:00.000Z',expiresAt:'2026-11-12T04:00:00.000Z',version:1}};
 const results=await Promise.all(Array.from({length:8},()=>s.admin.applyGrant(command)));assert.equal(new Set(results.map(r=>r.id)).size,1);
 assert.equal((await s.plus.manual(d.token))!.version,1);assert.equal(await s.plus.get(d.token),null);assert.equal((await s.billing.quota(d.token))!.allowanceSources!.plus,400);
 const captureId=randomUUID();await s.billing.begin({token:d.token,captureId,requestHmac:'test'});await s.billing.finish({token:d.token,captureId,charge:true,terminalState:'usable'});
 assert.equal((await s.billing.quota(d.token))!.balanceQuestions,399);await s.admin.applyGrant(command);assert.equal((await s.billing.quota(d.token))!.balanceQuestions,399);
 await assert.rejects(s.admin.applyGrant({...command,fingerprint:'different'}),/其他变更/);
 await assert.rejects(s.admin.applyGrant({...command,id:randomUUID()}),/权益已变化/);
 assert.equal((await s.listRecentTopups(20)).length,0,'manual Plus is never revenue or a question topup');
 const q=adminFilter({from:'2026-11-11T00:00:00.000Z',to:'2026-11-13T00:00:00.000Z'});const audit=await s.admin.actions(q);assert.equal(audit.total,1);assert.equal(audit.items[0]!.reason,command.reason);assert.equal(audit.items[0]!.actor,command.actor);assert.ok(!JSON.stringify(audit).includes(d.token));
 assert.equal((await s.admin.overview(q)).activePlus,1);assert.equal((await s.admin.devices({...q,plan:'expiring'})).total,1);
 // A provider sync modifies the paid subscription only; manual grant survives it.
 const paid=await s.plus.reserve(d.token),ticket=await s.plus.beginSync(paid!.intentId);
 await s.plus.apply(ticket!.intentId,ticket!.generation,{subscriptionId:'sub_admin_test',customerId:'cus_admin_test',status:'active',cancelAtPeriodEnd:false,paidFrom:'2026-11-11T16:00:00.000Z',paidUntil:'2026-12-11T04:00:00.000Z',invoiceId:'in_admin_test'});
 assert.deepEqual(await s.plus.manual(d.token),command.manual);assert.equal(plusEntitlement(await s.plus.get(d.token),await s.plus.manual(d.token)).expiresAt,'2026-12-11T04:00:00.000Z');
 assert.equal((await s.admin.overview(q)).expiringPlus,0,'continuous future paid period extends the active manual coverage');
 assert.equal((await s.admin.devices({...q,plan:'expiring'})).total,0,'expiry drilldown agrees with client entitlement');
 const canceled=await s.plus.beginSync(paid!.intentId);await s.plus.apply(canceled!.intentId,canceled!.generation,{subscriptionId:'sub_admin_test',customerId:'cus_admin_test',status:'canceled',cancelAtPeriodEnd:false,paidFrom:null,paidUntil:null,invoiceId:null});
 assert.equal((await s.billing.quota(d.token))!.balanceQuestions,399,'manual access survives cancellation of independent paid plan');
 t.mock.timers.setTime(Date.parse(command.manual.expiresAt));assert.equal((await s.billing.quota(d.token))!.balanceQuestions,0,'expiry is exclusive');
 // An uncertain commit can be replayed after preview expiry, without changing rights.
 assert.equal((await s.admin.applyGrant(command)).id,command.id);
 }finally{await s.close();}
});
test('coverage joins adjacent periods and preserves gaps',()=>{
 const paid={deviceId:1,createdAt:'',intentId:'',checkoutId:null,checkoutURL:null,subscriptionId:null,customerId:null,status:'active',paidFrom:'2026-11-01T00:00:00.000Z',paidUntil:'2026-11-20T00:00:00.000Z',cancelAtPeriodEnd:false,generation:0};
 const now=Date.parse('2026-11-11T00:00:00.000Z');
 assert.equal(plusEntitlement(paid,{startsAt:paid.paidUntil,expiresAt:'2026-11-25T00:00:00.000Z',version:1},now).expiresAt,'2026-11-25T00:00:00.000Z');
 assert.equal(plusEntitlement(paid,{startsAt:'2026-11-21T00:00:00.000Z',expiresAt:'2026-11-25T00:00:00.000Z',version:1},now).expiresAt,paid.paidUntil);
 const future={...paid,paidFrom:'2026-11-15T00:00:00.000Z'};
 assert.equal(plusEntitlement(future,{startsAt:'2026-11-10T00:00:00.000Z',expiresAt:future.paidFrom,version:1},now).expiresAt,paid.paidUntil);
 assert.equal(plusEntitlement(future,{startsAt:'2026-11-10T00:00:00.000Z',expiresAt:'2026-11-14T00:00:00.000Z',version:1},now).expiresAt,'2026-11-14T00:00:00.000Z');
 assert.equal(plusEntitlement(future,null,now).active,false,'future payment alone never starts access early');
});
test('SQLite rolls back both audit and entitlement when the grant write fails',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{DatabaseSync}=await import('node:sqlite');
 const dir=await mkdtemp(join(tmpdir(),'nspi-admin-atomic-')),file=join(dir,'test.sqlite'),s=new SqliteStore(file),db=new DatabaseSync(file);
 try{
 const d=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0}),target=await s.admin.device(d.id),now=Date.now();
 const c:AdminGrantCommand={id:randomUUID(),deviceId:d.id,actor:'test',credentialId:'fixture',reason:'rollback fixture',fingerprint:'rollback',expected:entitlementVersion(target!),expiresPreviewAt:new Date(now+60000).toISOString(),manual:{startsAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),version:1}};
 db.exec("CREATE TRIGGER test_grant_failure BEFORE INSERT ON admin_plus_entitlements BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
 await assert.rejects(s.admin.applyGrant(c),/simulated write failure/);assert.equal(await s.plus.manual(d.token),null);assert.equal((await s.admin.actions(adminFilter({to:new Date(Date.now()+60000).toISOString()}))).total,0);
 db.exec('DROP TRIGGER test_grant_failure');await s.admin.applyGrant(c);assert.equal((await s.admin.actions(adminFilter({to:new Date(Date.now()+60000).toISOString()}))).total,1);
 }finally{db.close();await s.close();await rm(dir,{recursive:true,force:true});}
});
test('confirmed duration preview extends active rights, starts expired rights now, binds identity and expiration',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-11T01:00:00.000Z')});
 const {previewPlus,grantCommand}=await import('../src/admin-plus.ts');const s=new MemoryStore(),now=Date.parse('2026-11-11T00:00:00.000Z');
 try{
 const {token}=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0}),device=(await s.admin.lookup(token))!;
 const input={days:30,actor:'operator',reason:'fixture compensation'},first=previewPlus(device,input,'test-key',now);
 assert.equal(first.starts_at,new Date(now).toISOString());assert.equal(first.expires_at,new Date(now+30*86400000).toISOString());
 const active={...device,manual:{startsAt:new Date(now-86400000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),version:1}};
 const next=previewPlus(active,{...input,days:2},'test-key',now);assert.equal(next.expires_at,new Date(now+3*86400000).toISOString());
 const expired={...device,manual:{...active.manual,expiresAt:new Date(now-1).toISOString()}};
 assert.equal(previewPlus(expired,input,'test-key',now).starts_at,new Date(now).toISOString());
 assert.throws(()=>grantCommand({ticket:first.ticket,idempotency_key:randomUUID()},'wrong-key'),/无效/);
 const command=grantCommand({ticket:first.ticket,idempotency_key:randomUUID()},'test-key');assert.equal(command.deviceId,device.id);
 await assert.rejects(s.admin.applyGrant(command),/预览已过期/);
 }finally{await s.close();}
});
test('new grants use commit time, while expiry between preview and confirm requires fresh review',async t=>{
 const {previewPlus,grantCommand}=await import('../src/admin-plus.ts');const now=Date.parse('2026-11-11T00:00:00.000Z');t.mock.timers.enable({apis:['Date'],now});const s=new MemoryStore();
 try{
 const d=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0}),device=(await s.admin.lookup(d.token))!,p=previewPlus(device,{days:1,actor:'tester',reason:'delayed confirmation'},'test-key');
 t.mock.timers.setTime(now+120000);const action=await s.admin.applyGrant(grantCommand({ticket:p.ticket,idempotency_key:randomUUID()},'test-key'));
 assert.equal((action.after as {manual:{expiresAt:string}}).manual.expiresAt,new Date(now+120000+86400000).toISOString());
 t.mock.timers.setTime(now+120000+86400000-1000);const p2=previewPlus((await s.admin.lookup(d.token))!,{days:1,actor:'tester',reason:'boundary confirmation'},'test-key');
 t.mock.timers.setTime(now+120000+86400000);await assert.rejects(s.admin.applyGrant(grantCommand({ticket:p2.ticket,idempotency_key:randomUUID()},'test-key')),/跨过到期时间/);
 }finally{await s.close();}
});
