import {setTimeout as delay} from 'node:timers/promises';
import {BudgetAdmissionError} from './billing.ts';
import type {BillingStore} from './billing.ts';
// Only absorb brief reservation/transaction overlap. Capacity is provisioned separately.
export const ADMISSION_WAIT_MS=1500;
/** Only wait for recoverable occupancy, never pretend a spent budget will refill. */
export async function reserveWithWait(reserve:()=>Promise<boolean>,billing:BillingStore,
  currency:string,amount:number,guarded:boolean,signal:AbortSignal,waitMs=ADMISSION_WAIT_MS):Promise<boolean> {
  const end=performance.now()+waitMs;
  for(;;){
    signal.throwIfAborted();
    let result=false,error:BudgetAdmissionError|undefined;
    try{result=await reserve();}catch(e){if(!(e instanceof BudgetAdmissionError)||!['busy','cooldown'].includes(e.reason))throw e;error=e;}
    if(result)return true;
    const remaining=end-performance.now();
    if(error){if(remaining<=0||(error.reason==='cooldown'&&error.retryAfter*1000>remaining))throw error;}
    else {
      const windows=(await billing.inspectBudget()).windows;
      const w=windows.find(w=>w.scope==='official'&&w.currency===currency&&Date.parse(w.start)<=Date.now()&&Date.parse(w.expiresAt)>Date.now());
      if(!w||w.held===0||w.spent+amount+(guarded?Math.ceil(w.limit*0.2):0)>w.limit||remaining<=0)return false;
    }
    await delay(Math.min(remaining,150+Math.random()*150),undefined,{signal});
  }
}
