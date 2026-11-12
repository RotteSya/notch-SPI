import {query,type Row,type Transaction} from './billing-sql.ts';
import {PLUS_COMPENSATION,type PlusCompensation} from './plus-compensation.ts';
export function compensationRow(r:Row):PlusCompensation {
  return {campaignId:String(r.campaign_id),claimedAt:r.claimed_at as string|null,startsAt:r.starts_at as string|null,expiresAt:r.expires_at as string|null};
}
export function* readCompensation(id:number):Transaction<PlusCompensation|null> {
  const r=(yield* query('SELECT * FROM plus_compensations WHERE campaign_id=? AND device_id=?',PLUS_COMPENSATION.id,id))[0];
  return r?compensationRow(r):null;
}
