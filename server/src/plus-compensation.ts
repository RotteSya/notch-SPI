/** One incident, one durable receipt per account. Enrollment is an explicit release operation. */
export const PLUS_COMPENSATION = {id:'service-budget-20261111',durationMs:48*60*60*1000} as const;
export interface PlusInterval {startsAt:string;expiresAt:string}
export interface PlusCompensation {
  campaignId:string;claimedAt:string|null;startsAt:string|null;expiresAt:string|null;
}
export interface PlusCoverage {active:boolean;expiresAt:string|null}
export function continuousPlus(intervals:PlusInterval[],now=Date.now()):PlusCoverage {
  let end=now;
  for(const [from,to] of intervals.map(r=>[Date.parse(r.startsAt),Date.parse(r.expiresAt)]).sort((a,b)=>a[0]!-b[0]!)) {
    if(from!<=end&&to!>end)end=to!;
  }
  return {active:end>now,expiresAt:end>now?new Date(end).toISOString():null};
}
export function claimCompensation(receipt:PlusCompensation,coverage:PlusCoverage,now=Date.now()):PlusCompensation {
  if(receipt.claimedAt)return receipt;
  const start=coverage.expiresAt?Date.parse(coverage.expiresAt):now;
  return {...receipt,claimedAt:new Date(now).toISOString(),startsAt:new Date(start).toISOString(),
    expiresAt:new Date(start+PLUS_COMPENSATION.durationMs).toISOString()};
}
/** Paid renewals carry unused gift time forward without editing Stripe's paid period.
 * A new paid period after the gift was fully consumed cannot resurrect it. */
export function compensationInterval(receipt:PlusCompensation|null,paid:PlusInterval|null):PlusInterval|null {
  if(!receipt?.claimedAt||!receipt.startsAt||!receipt.expiresAt)return null;
  let start=Date.parse(receipt.startsAt),end=Date.parse(receipt.expiresAt);
  if(paid){
    const from=Date.parse(paid.startsAt),to=Date.parse(paid.expiresAt);
    if(from<end&&to>start){const remaining=end-Math.max(start,from);start=to;end=to+remaining;}
  }
  return {startsAt:new Date(start).toISOString(),expiresAt:new Date(end).toISOString()};
}
export function withCompensation(base:PlusCoverage,receipt:PlusCompensation|null,paid:PlusInterval|null,now=Date.now()):PlusCoverage {
  const gift=compensationInterval(receipt,paid);
  return continuousPlus([...(base.active&&base.expiresAt?[{startsAt:new Date(now).toISOString(),expiresAt:base.expiresAt}]:[]),...(gift?[gift]:[])],now);
}
export const COMPENSATION_SCHEMA=`
CREATE TABLE IF NOT EXISTS plus_compensations (
 campaign_id TEXT NOT NULL, device_id BIGINT NOT NULL REFERENCES devices(id), enrolled_at TEXT NOT NULL,
 claimed_at TEXT, starts_at TEXT, expires_at TEXT,
 PRIMARY KEY(campaign_id,device_id),
 CHECK((claimed_at IS NULL AND starts_at IS NULL AND expires_at IS NULL) OR
       (claimed_at IS NOT NULL AND starts_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at>starts_at))
);`;
