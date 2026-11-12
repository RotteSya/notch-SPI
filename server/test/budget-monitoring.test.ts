import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {budgetStatus,emptyControl,type BudgetInspection} from '../src/budget-policy.ts';
import {MemoryStore} from '../src/db-memory.ts';
import {SqliteStore} from '../src/db-sqlite.ts';
import Fastify from 'fastify';
import {config as defaults} from '../src/config.ts';
import {registerRoutes} from '../src/routes.ts';
import {StubPaymentProvider} from '../src/payments.ts';

const now=Date.parse('2026-11-11T13:00:00Z');
const config={modelCostCurrency:'USD',modelDailyBudgetMicros:100_000_000,modelBudgetWarningMicros:15_000_000,
  modelBudgetUtcOffsetMinutes:480,attemptBudgetUpperMicros:3_000_000,requestBudgetMode:'guarded-request'};
function inspection(spent:number,held=0,limit=100_000_000):BudgetInspection {
  return {controls:[],provisional:[],windows:[{scope:'official',currency:'USD',start:'2026-11-10T16:00:00.000Z',
    expiresAt:'2026-11-11T16:00:00.000Z',limit,spent,held}]};
}
test('incident replay uses persisted limit; warning never disables admission',()=>{
  const incident=budgetStatus(inspection(11_161_002,0,15_000_000),config,now);
  assert.equal(incident.available_micros,838_998);
  assert.equal(incident.max_request_admissible,false);
  const warning=budgetStatus(inspection(15_000_000),config,now);
  assert.equal(warning.level,1);
  assert.equal(warning.max_request_admissible,true);
  assert.equal(warning.available_micros,65_000_000);
  assert.equal(budgetStatus(inspection(59_000_000,1_000_000),config,now).level,2);
  assert.equal(budgetStatus(inspection(80_000_000),config,now).level,3);
});
test('reset ignores prior day and currency; active circuit is visible',()=>{
  assert.equal(budgetStatus(inspection(80_000_000),config,Date.parse('2026-11-11T16:00:00Z')).spent_micros,0);
  const other=inspection(80_000_000);other.windows[0]!.currency='CNY';
  assert.equal(budgetStatus(other,config,now).level,0);
  const blocked=inspection(0);blocked.controls.push({...emptyControl(JSON.stringify(['official','USD','model'])),blockedUntil:-1});
  assert.equal(budgetStatus(blocked,config,now).level,3);
  assert.equal(budgetStatus(blocked,config,now).max_request_admissible,false);
});
for(const kind of ['memory','sqlite'])test(`${kind}: warning leaves model requests usable and window inspection read-only`,async()=>{
  const store=kind==='memory'?new MemoryStore():new SqliteStore(':memory:');
  try{
    const {token}=await store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30});
    for(let i=0;i<6;i++){
      const id=randomUUID();
      assert.equal(await store.billing.reserveBudget(token,id,'official','USD',3_000_000,100_000_000,86_400_000,Date.now(),480,true),true);
      await store.billing.settleBudget(token,id,3_000_000);
    }
    const before=await store.billing.inspectBudget();
    assert.equal(before.windows.length,1);
    assert.equal(budgetStatus(before,config).level,1);
    assert.equal(budgetStatus(before,config).max_request_admissible,true);
    assert.deepEqual(await store.billing.inspectBudget(),before);
    assert.equal(await store.billing.reserveBudget(token,randomUUID(),'official','USD',855_401,100_000_000,86_400_000,Date.now(),480,true),true);
  }finally{await store.close();}
});

test('authenticated readiness and scheduled monitoring expose durable capacity; public liveness stays lightweight',async()=>{
  const store=new MemoryStore(),app=Fastify();
  const settings={...defaults,...config,cronSecret:'test-budget-monitoring-secret-0123456789',adminToken:'test-admin'};
  const provider={name:'test',async stream(){throw new Error('monitoring must not call model');}};
  registerRoutes(app,{config:settings,store,storeKind:'memory',provider,objectiveProvider:provider,
    providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
  try{
    const {token}=await store.registerDevice({platform:'test',appVersion:'3',trialQuestions:30});
    const headers={authorization:'Bearer '+settings.cronSecret};
    const old=randomUUID();
    await store.billing.reserveBudget(token,old,'official','USD',11_161_002,15_000_000,86_400_000,Date.now(),480,true);
    await store.billing.settleBudget(token,old,11_161_002);
    assert.equal((await app.inject('/readyz')).statusCode,401);
    const ready=await app.inject({url:'/readyz',headers});
    assert.equal(ready.statusCode,503);
    assert.equal(ready.json().database,'available');
    assert.equal(ready.json().model_budget.available_micros,838_998);
    const reap=await app.inject({url:'/api/internal/reap',headers});
    assert.equal(reap.statusCode,200,'budget warning must not stop recovery');
    assert.equal(reap.json().model_budget.level,2);
    assert.equal((await app.inject('/healthz')).statusCode,200);
  }finally{await app.close();await store.close();}
});
