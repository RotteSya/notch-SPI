import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PLUS_SCHEMA} from '../src/plus-schema.ts';

// Manual Plus lives in admin_plus_entitlements; a hand-written paid period without a Stripe
// subscription once hid a real subscriber's link and inflated paid counts.
test('plus_subscriptions refuses a paid period without a Stripe subscription',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE devices(id INTEGER PRIMARY KEY);INSERT INTO devices(id) VALUES(1),(2),(3)');db.exec(PLUS_SCHEMA);
 const insert=db.prepare('INSERT INTO plus_subscriptions(device_id,created_at,intent_id,subscription_id,status,paid_from,paid_until) VALUES(?,?,?,?,?,?,?)');
 insert.run(1,'2026-11-26T00:00:00.000Z','pending',null,'checkout_pending',null,null);
 insert.run(2,'2026-11-26T00:00:00.000Z','paid','sub_1','active','2026-11-26T00:00:00.000Z','2026-12-26T00:00:00.000Z');
 assert.throws(()=>insert.run(3,'2026-11-26T00:00:00.000Z','manual_plus_7d',null,'active','2026-11-26T00:00:00.000Z','2026-12-03T00:00:00.000Z'),/CHECK constraint failed/);
});
