import {hashToken} from './db.ts';
import {query, type Row, type Transaction, type RunTransaction} from './billing-sql.ts';
import {newPlus, mergePlus, reusablePlus, type PlusRecord, type PlusStore, type PlusUpdate} from './plus.ts';
export function plusRow(r: Row): PlusRecord {
  return {deviceId: Number(r.device_id), createdAt: String(r.created_at), intentId: String(r.intent_id), checkoutId: r.checkout_id as string|null,
    checkoutURL: r.checkout_url as string|null, subscriptionId: r.subscription_id as string|null, customerId: r.customer_id as string|null,
    status: String(r.status), paidFrom: r.paid_from as string|null, paidUntil: r.paid_until as string|null,
    cancelAtPeriodEnd: Number(r.cancel_at_period_end) === 1, generation: Number(r.generation)};
}
export class SQLPlus implements PlusStore {
  private run: RunTransaction;
  constructor(run: RunTransaction) { this.run = run; }
  get(token: string) { return this.run((function*(): Transaction<PlusRecord|null> {
    const r = (yield* query('SELECT p.* FROM plus_subscriptions p JOIN devices d ON d.id=p.device_id WHERE d.token_hash=?', hashToken(token)))[0];
    return r ? plusRow(r) : null;
  })()); }
  byIntent(id: string) { return this.run((function*(): Transaction<PlusRecord|null> {
    const r = (yield* query('SELECT * FROM plus_subscriptions WHERE intent_id=?', id))[0]; return r ? plusRow(r) : null;
  })()); }
  reserve(token: string) { return this.run((function*(): Transaction<PlusRecord|null> {
    const d = (yield* query('SELECT id FROM devices WHERE token_hash=? FOR UPDATE', hashToken(token)))[0]; if (!d) return null;
    const old = (yield* query('SELECT * FROM plus_subscriptions WHERE device_id=?', Number(d.id)))[0];
    if (old && reusablePlus(plusRow(old))) return plusRow(old);
    const r = newPlus(Number(d.id));
    yield* query(`INSERT INTO plus_subscriptions(device_id,intent_id,created_at,status) VALUES(?,?,?,'checkout_pending')
      ON CONFLICT(device_id) DO UPDATE SET intent_id=excluded.intent_id,status=excluded.status,created_at=excluded.created_at,
      checkout_id=NULL,checkout_url=NULL,subscription_id=NULL,customer_id=NULL,paid_from=NULL,paid_until=NULL,cancel_at_period_end=0,generation=0`, r.deviceId, r.intentId, r.createdAt);
    return r;
  })()); }
  attach(id: string, checkoutId: string, url: string) { return this.run((function*(): Transaction<boolean> {
    const rows = yield* query(`UPDATE plus_subscriptions SET checkout_id=?,checkout_url=? WHERE intent_id=?
      AND (checkout_id IS NULL OR checkout_id=?) RETURNING device_id`, checkoutId, url, id, checkoutId);
    return rows.length === 1;
  })()); }
  beginSync(id: string) { return this.run((function*(): Transaction<PlusRecord|null> {
    const r = (yield* query('UPDATE plus_subscriptions SET generation=generation+1 WHERE intent_id=? RETURNING *', id))[0]; return r ? plusRow(r) : null;
  })()); }
  apply(id: string, generation: number, update: PlusUpdate) { return this.run((function*(): Transaction<boolean> {
    // Match the billing lock order: device first, then plan. This serializes grants with changes.
    const identity = (yield* query('SELECT device_id FROM plus_subscriptions WHERE intent_id=?', id))[0]; if (!identity) return false;
    yield* query('SELECT id FROM devices WHERE id=? FOR UPDATE', Number(identity.device_id));
    const row = (yield* query('SELECT * FROM plus_subscriptions WHERE intent_id=? FOR UPDATE', id))[0];
    if (!row || Number(row.generation) !== generation) return false;
    const r = mergePlus(plusRow(row), update);
    if (update.invoiceId && update.paidFrom && update.paidUntil) {
      const existing = (yield* query('SELECT device_id,subscription_id FROM plus_paid_invoices WHERE invoice_id=?', update.invoiceId))[0];
      if (existing && (Number(existing.device_id)!==r.deviceId || existing.subscription_id!==r.subscriptionId)) throw new Error('Invoice binding mismatch');
      yield* query(`INSERT INTO plus_paid_invoices(invoice_id,device_id,subscription_id,paid_from,paid_until,amount_cents,currency)
        VALUES(?,?,?,?,?,6900,'CNY') ON CONFLICT(invoice_id) DO NOTHING`, update.invoiceId, r.deviceId, r.subscriptionId, update.paidFrom, update.paidUntil);
    }
    yield* query(`UPDATE plus_subscriptions SET subscription_id=?,customer_id=?,status=?,paid_from=?,paid_until=?,cancel_at_period_end=? WHERE intent_id=?`,
      r.subscriptionId, r.customerId, r.status, r.paidFrom, r.paidUntil, r.cancelAtPeriodEnd ? 1 : 0, id);
    return true;
  })()); }
  expireCheckout(id: string) { return this.run((function*(): Transaction<void> {
    yield* query("UPDATE plus_subscriptions SET status='checkout_expired' WHERE intent_id=? AND subscription_id IS NULL", id);
  })()); }
  usage(token: string, source: string) { return this.run((function*(): Transaction<{remaining:number; held:number; granted:number}|null> {
    const r = (yield* query('SELECT l.remaining,l.held,l.granted FROM quota_lots l JOIN devices d ON d.id=l.device_id WHERE d.token_hash=? AND l.source_ref=?', hashToken(token), source))[0];
    return r ? {remaining: Number(r.remaining), held: Number(r.held), granted: Number(r.granted)} : null;
  })()); }
}
