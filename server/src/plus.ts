import {randomUUID} from 'node:crypto';
export const PLUS = {priceCents: 6900, currency: 'CNY', dailyLimit: 400, version: 'plus-monthly-400-v1'} as const;
export interface PlusRecord {
  deviceId: number; createdAt: string; intentId: string; checkoutId: string | null; checkoutURL: string | null;
  subscriptionId: string | null; customerId: string | null; status: string;
  paidFrom: string | null; paidUntil: string | null; cancelAtPeriodEnd: boolean; generation: number;
}
export interface PlusUpdate {
  subscriptionId: string; customerId: string; status: string; cancelAtPeriodEnd: boolean;
  paidFrom: string | null; paidUntil: string | null; invoiceId: string | null;
}
export interface PlusStore {
  get(token: string): Promise<PlusRecord | null>;
  reserve(token: string): Promise<PlusRecord | null>;
  attach(intentId: string, checkoutId: string, url: string): Promise<boolean>;
  byIntent(intentId: string): Promise<PlusRecord | null>;
  beginSync(intentId: string): Promise<PlusRecord | null>;
  apply(intentId: string, generation: number, update: PlusUpdate): Promise<boolean>;
  expireCheckout(intentId: string): Promise<void>;
  usage(token: string, source: string): Promise<{remaining: number; held: number; granted: number} | null>;
}
export function newPlus(deviceId: number): PlusRecord {
  return {deviceId, createdAt: new Date().toISOString(), intentId: randomUUID(), checkoutId: null, checkoutURL: null, subscriptionId: null,
    customerId: null, status: 'checkout_pending', paidFrom: null, paidUntil: null, cancelAtPeriodEnd: false, generation: 0};
}
export function plusActive(record: PlusRecord | null, now = Date.now()): boolean {
  return !!record?.paidFrom && !!record.paidUntil && Date.parse(record.paidFrom) <= now && now < Date.parse(record.paidUntil)
    && !['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(record.status);
}
export function reusablePlus(record: PlusRecord): boolean {
  return !['canceled', 'incomplete_expired', 'checkout_expired'].includes(record.status) || plusActive(record);
}
export function mergePlus(record: PlusRecord, update: PlusUpdate): PlusRecord {
  if (record.subscriptionId && record.subscriptionId !== update.subscriptionId) throw new Error('Plus subscription identity mismatch');
  if (!/^sub_[\w]+$/.test(update.subscriptionId) || !/^cus_[\w]+$/.test(update.customerId)) throw new Error('Plus identity invalid');
  if (update.paidUntil && (!update.paidFrom || !update.invoiceId || !(Date.parse(update.paidUntil) > Date.parse(update.paidFrom)))) throw new Error('Plus paid period invalid');
  // Payment failure never extends a previously paid period. Old invoice events cannot shorten it.
  const advances = update.paidUntil && (!record.paidUntil || update.paidUntil > record.paidUntil);
  return {...record, subscriptionId: update.subscriptionId, customerId: update.customerId,
    status: update.status, cancelAtPeriodEnd: update.cancelAtPeriodEnd,
    paidFrom: advances ? (record.paidUntil && update.paidFrom! <= record.paidUntil ? record.paidFrom : update.paidFrom) : record.paidFrom, paidUntil: advances ? update.paidUntil : record.paidUntil};
}
