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
/** `share` below 1 is the part of every ceiling a request may fill; the rest stays free for others. */
export function capacityCeilings(share=1) {
  const part=(ceiling:number)=>share>=1?ceiling:Math.max(1,Math.floor(ceiling*Math.max(0,share)));
  return {concurrency:part(CAPACITY.concurrency),requestsPerMinute:part(CAPACITY.requestsPerMinute),tokensPerMinute:part(CAPACITY.tokensPerMinute)};
}
export function capacityAvailable(leases:CapacityLease[],tokens:number,now:number,share=1):boolean {
  const ceiling=capacityCeilings(share);
  return leases.filter(l=>l.active&&l.expires>now).length<ceiling.concurrency
    && leases.filter(l=>l.started>now-60_000).length<ceiling.requestsPerMinute
    && leases.filter(l=>l.started>now-60_000).reduce((n,l)=>n+l.tokens,0)+tokens<=ceiling.tokensPerMinute;
}
