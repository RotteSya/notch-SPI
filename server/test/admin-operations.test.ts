import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import {adminFilter} from '../src/admin-store.ts';
import {ADMIN_SCRIPT} from '../src/admin-client.ts';
import {Script} from 'node:vm';
import type {Store} from '../src/db.ts';

const makers:Array<[string,()=>Store|Promise<Store>]>=[['memory',()=>new MemoryStore()],['sqlite',()=>new SqliteStore(':memory:')]];
let postgresConnection:(()=>Promise<string>)|undefined;
if(process.env.TEST_POSTGRES_URL){
 const original=new URL(process.env.TEST_POSTGRES_URL);if(!/test/i.test(original.pathname))throw new Error('Isolated test database required');
 const {PostgresStore,resolvePostgresSSL}=await import('../src/db-postgres.ts'),pg=(await import('pg')).default;
 const pool=new pg.Pool({connectionString:original.toString(),ssl:resolvePostgresSSL({connectionString:original.toString()})}),schemas:string[]=[];
 postgresConnection=async()=>{const schema='admin_ops_test_'+randomUUID().replaceAll('-','');await pool.query(`CREATE SCHEMA ${schema}`);schemas.push(schema);const url=new URL(original);url.searchParams.set('options','-c search_path='+schema);return url.toString();};
 after(async()=>{for(const schema of schemas)await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
 makers.push(['postgres',async()=>{const connection=await postgresConnection!();return new PostgresStore(connection,resolvePostgresSSL({connectionString:connection}));}]);
}
for(const [name,make] of makers){
 test(name+': operational aggregates and drilldowns agree, Beijing days, pagination, sensitive lookup',async t=>{
  const start=Date.parse('2026-11-10T15:59:00.000Z');t.mock.timers.enable({apis:['Date'],now:start});const s=await make();
  try{
   const one=await s.registerDevice({platform:'macos',appVersion:'3.1',trialQuestions:10}),two=await s.registerDevice({platform:'windows',appVersion:'3.0',trialQuestions:10});
   const before=await s.admin.lookup(one.token);assert.equal(before!.id,one.id);assert.ok(!JSON.stringify(before).includes(one.token));assert.equal(await s.admin.lookup('dev_'+'z'.repeat(32)),null);
   const q=adminFilter({from:'2026-11-10T00:00:00.000Z',to:'2026-11-12T00:00:00.000Z',size:'1'});
   const empty=await s.admin.overview(q);assert.equal(empty.requests,0);assert.equal(empty.latencyMs,null);
   const captureId=randomUUID(),attemptId=randomUUID();
   await s.billing.beginWithAttempt({token:one.token,captureId,requestHmac:'one'},{attemptId,captureId,purpose:'answer',provider:'mock',model:'mock-test',currency:'USD',policyVersion:'test',pricingVersion:'test'});
   t.mock.timers.setTime(start+1500);await s.billing.finishAttempt(one.token,attemptId,{status:'succeeded',inputTokens:20,outputTokens:10,costMicros:'120'});await s.billing.finish({token:one.token,captureId,charge:true,terminalState:'usable'});
   t.mock.timers.setTime(start+61000);
   const failed=randomUUID();await s.billing.begin({token:two.token,captureId:failed,requestHmac:'two'});
   t.mock.timers.setTime(start+64000);await s.billing.finish({token:two.token,captureId:failed,charge:false,terminalState:'failed',terminalReason:'upstream_timeout'});
   const overview=await s.admin.overview(q);assert.equal(overview.registered,2);assert.equal(overview.activeDevices,2);assert.equal(overview.requests,2);assert.equal(overview.usable,1);assert.equal(overview.completed,2);assert.equal(overview.latencyMs,2250);
   assert.deepEqual(overview.trend.map(d=>[d.day,d.requests]),[['2026-11-10',1],['2026-11-11',1]]);assert.deepEqual(overview.errors,[{error:'upstream_timeout',count:1}]);assert.equal(overview.models[0]!.knownCostMicros,'120');
   assert.equal((await s.admin.requests({...q,deviceId:one.id})).total,1);assert.equal((await s.admin.requests({...q,state:'failed'})).items[0]!.deviceId,two.id);
   const page1=await s.admin.devices(q),page2=await s.admin.devices({...q,page:2});assert.equal(page1.total,2);assert.notEqual(page1.items[0]!.id,page2.items[0]!.id);
   assert.equal((await s.admin.devices({...q,search:'Windows'})).items[0]!.id,two.id);assert.equal((await s.admin.devices({...q,search:'%'})).total,0);
   assert.equal((await s.admin.devices({...q,plan:'inactive'})).total,2);assert.equal((await s.admin.devices({...q,plan:'active'})).total,0);
   const later={...q,from:'2026-11-11T00:00:00.000Z',registrationOnly:true};assert.equal((await s.admin.devices(later)).total,0);assert.equal((await s.admin.devices({...later,registrationOnly:false})).total,2);
  }finally{await s.close();}
 });
}
test('operational filters reject invalid ranges, unsafe searches and pagination',()=>{
 for(const input of [{from:'garbage'},{from:'2026-01-01T00:00:00Z',to:'2026-11-01T00:00:00Z'},{page:0},{size:101},{device_id:-1},{plan:'sql'},{state:'bogus'},{search:'dev_secret'}])assert.throws(()=>adminFilter(input));
});
test('admin browser code parses and does not persist credentials or interpolate data as HTML',()=>{
 assert.doesNotThrow(()=>new Script(ADMIN_SCRIPT));assert.doesNotMatch(ADMIN_SCRIPT,/localStorage|sessionStorage|innerHTML/);
});

process.env.DB_PATH=':memory:';process.env.OFFICIAL_PROVIDER='mock';process.env.OBJECTIVE_RESULT_V1_PROVIDER='mock';process.env.PAYMENT_PROVIDER='stub';process.env.ADMIN_TOKEN='operations-fixture-key';process.env.LOG_LEVEL='silent';process.env.POSTGRES_URL='';process.env.DATABASE_URL='';process.env.VERCEL='';process.env.REQUIRE_DURABLE_STORAGE='0';
const {buildApp}=await import('../src/index.ts');
test('admin HTTP permissions, sensitive lookup, no-store and guarded errors',async()=>{
 const app=await buildApp();try{
 const headers={'x-admin-token':'operations-fixture-key'};
 for(const url of ['/admin/ops/overview','/admin/ops/devices','/admin/ops/devices/1','/admin/ops/requests','/admin/ops/actions']){
  assert.equal((await app.inject({url})).statusCode,401);
  assert.equal((await app.inject({url,headers:{'x-admin-token':'wrong'}})).statusCode,401);
 }
 const token=(await app.inject({method:'POST',url:'/v1/devices',payload:{platform:'test',app_version:'3.1'}})).json().device_token;
 const lookup=(recovery_code:string)=>app.inject({method:'POST',url:'/admin/ops/lookup',headers,payload:{recovery_code}});
 assert.equal((await lookup('bad')).statusCode,400);assert.equal((await lookup('dev_'+'z'.repeat(32))).statusCode,404);
 const found=await lookup(token);assert.equal(found.statusCode,200);assert.ok(!found.body.includes(token));assert.equal(found.headers['cache-control'],'no-store');
 const html=await app.inject({url:'/admin'});assert.match(String(html.headers['content-security-policy']),/frame-ancestors 'none'/);assert.ok(!html.body.includes('operations-fixture-key'));
 const invalid=await app.inject({url:'/admin/ops/requests?page=-1',headers});assert.equal(invalid.statusCode,400);
 const summary=await app.inject({url:'/admin/ops/overview',headers});assert.equal(summary.statusCode,200);assert.equal(summary.json().totalDevices,1);
 }finally{await app.close();}
});
for(const storage of postgresConnection?['sqlite','postgres']:['sqlite'])test(storage+': recovery lookup → signed preview → grant → real client endpoints; retry, tampering and feature gate',async()=>{
 const {config}=await import('../src/config.ts');const mutableConfig=config as {adminPlusGrantsEnabled:boolean;postgresUrl:string};mutableConfig.adminPlusGrantsEnabled=true;
 mutableConfig.postgresUrl=storage==='postgres'?await postgresConnection!():'';
 const app=await buildApp();const headers={'x-admin-token':'operations-fixture-key'};
 const post=(url:string,payload:Record<string,unknown>)=>app.inject({method:'POST',url,headers,payload});
 try{
  const token=(await app.inject({method:'POST',url:'/v1/devices',payload:{platform:'macos',app_version:'3.1'}})).json().device_token;
  const lookup=(await post('/admin/ops/lookup',{recovery_code:token})).json(),id=lookup.device.id;
  assert.equal(lookup.manual_grants_enabled,true);
  for(const url of ['/admin/ops/plus/preview','/admin/ops/plus/grant'])assert.equal((await app.inject({method:'POST',url,payload:{}})).statusCode,401);
  for(const days of [0,-1,366,1.5,'30',null])assert.equal((await post('/admin/ops/plus/preview',{device_id:id,days,actor:'tester',reason:'test entitlement'})).statusCode,400);
  assert.equal((await post('/admin/ops/plus/preview',{device_id:99999,days:1,actor:'tester',reason:'test entitlement'})).statusCode,404);
  assert.equal((await post('/admin/ops/plus/preview',{device_id:id,days:1,actor:'tester',reason:token})).statusCode,400);
  const p=await post('/admin/ops/plus/preview',{device_id:id,days:7,actor:'tester',reason:'test entitlement'});assert.equal(p.statusCode,200);const preview=p.json();
  assert.equal(Date.parse(preview.expires_at)-Date.parse(preview.starts_at),7*86400000);assert.ok(!JSON.stringify(preview).includes(token));
  const command={ticket:preview.ticket,idempotency_key:randomUUID()};
  assert.equal((await post('/admin/ops/plus/grant',{...command,ticket:preview.ticket+'x'})).statusCode,400);
  const grants=await Promise.all(Array.from({length:6},()=>post('/admin/ops/plus/grant',command)));
  const grantedUntil=grants[0]!.json().device.plus.expires_at;
  for(const r of grants){assert.equal(r.statusCode,200,r.body);assert.equal(r.json().device.plus.expires_at,grantedUntil);}assert.ok(Date.parse(grantedUntil)>=Date.parse(preview.expires_at));
  const clientHeaders={authorization:'Bearer '+token};
  const plus=(await app.inject({url:'/v1/plus',headers:clientHeaders})).json();assert.equal(plus.status,'active');assert.equal(plus.paid_until,grantedUntil);assert.equal(plus.daily_remaining,400);assert.equal(plus.can_manage,false);
  const account=(await app.inject({url:'/v1/account',headers:clientHeaders})).json();assert.equal(account.allowance_sources.plus,400);
  const p2=(await post('/admin/ops/plus/preview',{device_id:id,days:3,actor:'tester',reason:'test extension'})).json();assert.equal(p2.starts_at,grantedUntil);
  assert.equal((await post('/admin/ops/plus/grant',{ticket:p2.ticket,idempotency_key:command.idempotency_key})).statusCode,409);
  assert.equal((await post('/admin/ops/plus/grant',{ticket:p2.ticket,idempotency_key:randomUUID()})).statusCode,200);
  assert.equal((await post('/admin/ops/plus/grant',{ticket:preview.ticket,idempotency_key:randomUUID()})).statusCode,409);
  const plusAfter=(await app.inject({url:'/v1/plus',headers:clientHeaders})).json();assert.equal(plusAfter.paid_until,p2.expires_at);assert.equal(plusAfter.daily_remaining,400,'extension never grants another 400 on the same Beijing day');
  const to=new Date(Date.now()+60000).toISOString(),audit=(await app.inject({url:'/admin/ops/actions?to='+encodeURIComponent(to),headers})).json();assert.equal(audit.total,2);assert.ok(!JSON.stringify(audit).includes(token));
  mutableConfig.adminPlusGrantsEnabled=false;
  assert.equal((await post('/admin/ops/plus/preview',{device_id:id,days:1,actor:'tester',reason:'disabled policy'})).statusCode,503);
  assert.equal((await post('/admin/ops/plus/grant',command)).statusCode,503);
  assert.equal((await app.inject({url:'/v1/plus',headers:clientHeaders})).json().status,'active','disabling new grants preserves granted access');
 }finally{mutableConfig.adminPlusGrantsEnabled=false;mutableConfig.postgresUrl='';await app.close();}
});
test('ambiguous lookup fails closed, and unexpected save failures are redacted without changing rights',async()=>{
 const {MemoryAdmin}=await import('../src/admin-memory.ts'),{default:Fastify}=await import('fastify'),{registerAdminRoutes}=await import('../src/admin-routes.ts'),{config}=await import('../src/config.ts'),{MockProvider}=await import('../src/providers/mock.ts');
 const s=new MemoryStore(),d=await s.registerDevice({platform:'test',appVersion:'3.1',trialQuestions:0}),device=(await s.admin.lookup(d.token))!;
 const ambiguous=new MemoryAdmin(()=>[device,device],()=>device.id,()=>({requests:[],attempts:[]}));await assert.rejects(ambiguous.lookup(d.token),/不明确/);
 const app=Fastify({logger:false}),provider=new MockProvider();registerAdminRoutes(app,{config:{...config,adminPlusGrantsEnabled:true},store:s,storeKind:'memory',provider,objectiveProvider:provider,providerDegraded:null,objectiveProviderDegraded:null,payment:{name:'stub',renderTopUpPage:()=>''}},()=>{});
 try{
 const p=await app.inject({method:'POST',url:'/admin/ops/plus/preview',payload:{device_id:d.id,days:1,actor:'tester',reason:'failure fixture'}});assert.equal(p.statusCode,200);
 s.admin.applyGrant=async()=>{throw new Error('database error contains '+d.token);};
 const res=await app.inject({method:'POST',url:'/admin/ops/plus/grant',payload:{ticket:p.json().ticket,idempotency_key:randomUUID()}});assert.equal(res.statusCode,500);assert.ok(!res.body.includes(d.token));assert.equal((await s.billing.quota(d.token))!.allowanceSources!.plus,0);
 }finally{await app.close();await s.close();}
});
