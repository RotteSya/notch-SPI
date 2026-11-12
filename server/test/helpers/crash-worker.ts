// Disposable local worker used only by the process-death behavior test.
import Fastify from 'fastify';
import {config} from '../../src/config.ts';
import {registerRoutes} from '../../src/routes.ts';
import {PostgresStore} from '../../src/db-postgres.ts';
import {StubPaymentProvider} from '../../src/payments.ts';
import type {Provider} from '../../src/providers/types.ts';
const url=new URL(process.env.TEST_POSTGRES_URL!);
if(url.hostname!=='127.0.0.1'||!/test/.test(url.pathname))throw Error('Isolated local database required');
const store=new PostgresStore(url.toString(),false),app=Fastify();
app.addHook('onError',async(_req,_reply,error)=>{process.stderr.write(String(error.stack)+'\n');});
const provider:Provider={name:'openai',estimateReservation:async()=>({micros:1000000,inputUpper:9640,outputUpper:8192}),
  stream:async()=>new Promise(()=>{})};
registerRoutes(app,{config:{...config,provider:'mock',objectiveProvider:'mock',model:'fixture',objectiveModel:'fixture',
  requestHmacKeyVersion:'test',requestHmacKeysJSON:JSON.stringify({test:Buffer.alloc(32,1).toString('base64')}),
  requestBudgetMode:'guarded-request',modelCostCurrency:'USD',modelDailyBudgetMicros:100000000,attemptBudgetUpperMicros:1000000,
  modelPricingJSON:JSON.stringify([{model:'openai:fixture',input_micros_per_million_tokens:10000000,output_micros_per_million_tokens:10000000}])},
  store,storeKind:'postgres',provider,objectiveProvider:provider,providerDegraded:null,objectiveProviderDegraded:null,payment:new StubPaymentProvider()});
await app.listen({host:'127.0.0.1',port:0});console.log((app.server.address() as {port:number}).port);
