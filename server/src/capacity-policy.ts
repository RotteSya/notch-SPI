/** Supplier project limits verified 2026-11-12: 5,000 RPM / 1,000,000 TPM.
 * 24-user bursts are verified against the supplier and two local Postgres-backed
 * instances. Sustained acceptance also requires the independent rolling token
 * budget: 24 users at 15 s with a 9,640-token estimate would exceed that budget.
 * Rate headroom also covers estimation uncertainty and other project traffic.
 * This policy never changes the dollar budget or model configuration.
 */
export const CAPACITY = {concurrency:24, requestsPerMinute:4000, tokensPerMinute:800_000,
  leaseMs:120_000, burstWaitMs:1500} as const;
export interface CapacityLease {id:string; owner:string; tokens:number; started:number; expires:number; active:boolean}
export function capacityAvailable(leases:CapacityLease[],tokens:number,now:number):boolean {
  return leases.filter(l=>l.active&&l.expires>now).length<CAPACITY.concurrency
    && leases.filter(l=>l.started>now-60_000).length<CAPACITY.requestsPerMinute
    && leases.filter(l=>l.started>now-60_000).reduce((n,l)=>n+l.tokens,0)+tokens<=CAPACITY.tokensPerMinute;
}
