import {CAPACITY} from './capacity-policy.ts';
import {readCompensation} from './plus-compensation-sql.ts';
import {withCompensation} from './plus-compensation.ts';
import {ADMIN_SCHEMA} from './admin-store.ts';
import { BUDGET_POLICY, budgetOutcome, emptyControl, validCost, validateReconciliation, type BudgetAccounting, type BudgetControl, type BudgetInspection } from './budget-policy.ts';
import {PLUS_SCHEMA} from './plus-schema.ts';
import {plusRow} from './plus-sql.ts';
import {PLUS,compensationPaidPeriod,plusEntitlement} from './plus.ts';
import { randomUUID } from 'node:crypto';
import { hashToken, newToken, type RegisteredDevice } from './db.ts';
import { applyRefundLot } from './payment-ledger-sql.ts';
import {checkpointQuota} from './quota-migration.ts';
import {QUOTA_MIGRATION_SCHEMA} from './quota-migration-schema.ts';
import {FREE_TRIAL_POLICY, trialWindow, trialSnapshot, type FreeTrialSnapshot} from './free-trial.ts';
import { BudgetAdmissionError, assertAttemptBinding, combineAccountSnapshot, duplicateCapture, isRecoveredAnswerFor, newCapture, validQuestions, type AccountSnapshot, type Attempt, type NewAttempt, type BeginCapture, type BeginResult,
  type BillingStore, type CaptureRecord, type CaptureSettlement, type CreditInput, type FinishCapture, type QuotaSnapshot,
  type RegistrationInput } from './billing.ts';

// Generators describe one transaction. SQLite runs every step synchronously, without yielding
// its connection; Postgres awaits each query on a dedicated, row-locked transaction connection.
export interface Statement { sql: string; args: Array<string | number | null> }
export type Row = Record<string, unknown>;
export type Transaction<T> = Generator<Statement, T, Row[]>;
export type RunTransaction = <T>(transaction: Transaction<T>, options?: {readOnlySnapshot?: boolean}) => Promise<T>;
export function* query(sql: string, ...args: Statement['args']): Transaction<Row[]> { return yield { sql, args }; }

export const BILLING_SCHEMA = `
CREATE TABLE IF NOT EXISTS capture_cancellations (device_id BIGINT NOT NULL REFERENCES devices(id), capture_id TEXT NOT NULL, expires BIGINT NOT NULL, PRIMARY KEY(device_id,capture_id));
CREATE TABLE IF NOT EXISTS provider_capacity_guard (id INTEGER PRIMARY KEY);
INSERT INTO provider_capacity_guard(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS provider_capacity_leases (
 id TEXT PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES devices(id), tokens BIGINT NOT NULL,
 started BIGINT NOT NULL, expires BIGINT NOT NULL, active INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capacity_started ON provider_capacity_leases(started);

CREATE TABLE IF NOT EXISTS free_trials (
 device_id BIGINT PRIMARY KEY REFERENCES devices(id), activated_at TEXT, expires_at TEXT,
 CHECK((activated_at IS NULL AND expires_at IS NULL) OR (activated_at IS NOT NULL AND expires_at>activated_at))
);
CREATE TABLE IF NOT EXISTS quota_lots (
 lot_id TEXT PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES devices(id), kind TEXT NOT NULL,
 granted BIGINT NOT NULL CHECK(granted>=0), remaining BIGINT NOT NULL CHECK(remaining>=0),
 held BIGINT NOT NULL DEFAULT 0 CHECK(held>=0 AND held<=remaining AND remaining<=granted),
 source_ref TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(device_id, source_ref),
 CHECK(kind IN ('trial','paid','goodwill','legacy_unknown'))
);
CREATE TABLE IF NOT EXISTS capture_requests (
 request_id TEXT PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES devices(id),
 client_capture_id TEXT NOT NULL, request_hmac TEXT NOT NULL, metadata TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('held','settled','released')), legacy INTEGER NOT NULL,
 lease_expires_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(device_id, client_capture_id)
);
CREATE INDEX IF NOT EXISTS idx_capture_lease ON capture_requests(state,lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_capture_device ON capture_requests(device_id,state);
CREATE TABLE IF NOT EXISTS quota_reservations (
 reservation_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE REFERENCES capture_requests(request_id),
 device_id BIGINT NOT NULL REFERENCES devices(id), lot_id TEXT NOT NULL REFERENCES quota_lots(lot_id),
 questions INTEGER NOT NULL CHECK(questions=1), state TEXT NOT NULL CHECK(state IN ('held','settled','released')),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, settled_at TEXT
);
CREATE TABLE IF NOT EXISTS quota_ledger (
 entry_id TEXT PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES devices(id),
 lot_id TEXT NOT NULL REFERENCES quota_lots(lot_id), reservation_id TEXT,
 event TEXT NOT NULL CHECK(event IN ('grant','hold','settle','release','credit','revoke')),
 available_delta BIGINT NOT NULL, held_delta BIGINT NOT NULL, reference TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(device_id,reference,event)
);
CREATE TABLE IF NOT EXISTS explanation_requests (
 parent_request_id TEXT PRIMARY KEY REFERENCES capture_requests(request_id),
 explanation_request_id TEXT NOT NULL UNIQUE REFERENCES capture_requests(request_id)
);
CREATE TABLE IF NOT EXISTS recovery_requests (
 parent_request_id TEXT PRIMARY KEY REFERENCES capture_requests(request_id),
 recovery_request_id TEXT NOT NULL UNIQUE REFERENCES capture_requests(request_id)
);
CREATE TABLE IF NOT EXISTS model_attempts (
 attempt_id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES capture_requests(request_id),
 device_id BIGINT NOT NULL REFERENCES devices(id), ordinal INTEGER NOT NULL,
 metadata TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(request_id,ordinal)
);
CREATE TABLE IF NOT EXISTS attempt_costs (
 attempt_id TEXT NOT NULL REFERENCES model_attempts(attempt_id), revision INTEGER NOT NULL,
 currency TEXT NOT NULL, cost_micros TEXT, pricing_version TEXT NOT NULL, source TEXT NOT NULL,
 calculated_at TEXT NOT NULL, PRIMARY KEY(attempt_id,revision)
);
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
 scope_hash TEXT NOT NULL, window_start TEXT NOT NULL, count BIGINT NOT NULL,
 expires_at TEXT NOT NULL, PRIMARY KEY(scope_hash,window_start)
);
CREATE TABLE IF NOT EXISTS budget_windows (
 scope TEXT NOT NULL, window_start TEXT NOT NULL, currency TEXT NOT NULL,
 limit_micros BIGINT NOT NULL CHECK(limit_micros>0), spent_micros BIGINT NOT NULL DEFAULT 0 CHECK(spent_micros>=0),
 held_micros BIGINT NOT NULL DEFAULT 0 CHECK(held_micros>=0), expires_at TEXT NOT NULL,
 PRIMARY KEY(scope,window_start,currency)
);
CREATE TABLE IF NOT EXISTS attempt_budget_holds (
 attempt_id TEXT PRIMARY KEY, device_id BIGINT REFERENCES devices(id), scope TEXT NOT NULL, window_start TEXT NOT NULL, currency TEXT NOT NULL,
 reserved_upper_micros BIGINT NOT NULL CHECK(reserved_upper_micros>0), state TEXT NOT NULL CHECK(state IN ('held','released','settled')),
 actual_micros BIGINT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS request_budget_guards (
 scope TEXT NOT NULL, currency TEXT NOT NULL, tripped INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(scope,currency)
);
CREATE TABLE IF NOT EXISTS guarded_budget_holds (
 attempt_id TEXT PRIMARY KEY REFERENCES attempt_budget_holds(attempt_id),
 scope TEXT NOT NULL, currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budget_accounting (
 attempt_id TEXT PRIMARY KEY REFERENCES attempt_budget_holds(attempt_id), channel TEXT NOT NULL,
 reserved BIGINT NOT NULL CHECK(reserved>0), booked BIGINT NOT NULL DEFAULT 0 CHECK(booked>=0), actual BIGINT CHECK(actual>=0),
 state TEXT NOT NULL CHECK(state IN ('pending','provisional','observed','reconciled','released')), evidence TEXT, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS budget_controls (
 channel TEXT PRIMARY KEY, metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budget_control_resets (
 evidence TEXT PRIMARY KEY, channel TEXT NOT NULL, previous_metadata TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_key ON devices(registration_key_hash);
${QUOTA_MIGRATION_SCHEMA}
${PLUS_SCHEMA}
${ADMIN_SCHEMA}
`;

export function* ledger(device: number, lot: string, event: string, available: number, held: number,
  reference: string, reservation: string | null = null): Transaction<void> {
  yield* query(`INSERT INTO quota_ledger
    (entry_id,device_id,lot_id,reservation_id,event,available_delta,held_delta,reference,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, randomUUID(), device, lot, reservation, event, available, held, reference, new Date().toISOString());
}
function* device(token: string): Transaction<Row | undefined> {
  return (yield* query('SELECT * FROM devices WHERE token_hash=? FOR UPDATE', hashToken(token)))[0];
}
export function* opening(d: Row): Transaction<void> {
  const lots = yield* query('SELECT lot_id FROM quota_lots WHERE device_id=? LIMIT 1', Number(d.id));
  if (lots.length) return;
  const balance = Number(d.balance_questions);
  validQuestions(balance);
  const id = randomUUID();
  yield* query(`INSERT INTO quota_lots (lot_id,device_id,kind,granted,remaining,source_ref,created_at)
    VALUES (?,?,?,?,?,?,?)`, id, Number(d.id), 'legacy_unknown', balance, balance, 'opening_balance', new Date().toISOString());
  yield* ledger(Number(d.id), id, 'grant', balance, 0, 'opening_balance');
  yield* checkpointQuota(d, id);
}
function* quotaFor(d: Row): Transaction<QuotaSnapshot> {
  yield* opening(d);
  const trial = yield* syncFreeTrial(d);
  yield* syncPlus(d);
  const lots = yield* query('SELECT kind,source_ref,remaining,held,refund_frozen FROM quota_lots WHERE device_id=?', Number(d.id));
  const quota: QuotaSnapshot = { balanceQuestions: Number(d.balance_questions), heldQuestions: 0,
    balanceVersion: String(d.balance_version), policyVersion: String(d.quota_policy_version),
    initialGrantQuestions: d.initial_grant_questions === null ? null : Number(d.initial_grant_questions),
    quotaBreakdown: { trial: 0, paid: 0, goodwill: 0, legacy_unknown: 0 },
    ...(trial ? {freeTrial: trial} : {}) };
  quota.allowanceSources = {trial:0,plus:0,purchased:0,other:0};
  for (const lot of lots) {
    const key = String(lot.source_ref).startsWith('plus_daily:') ? 'plus' : lot.kind === 'trial' ? 'trial' : lot.kind === 'paid' ? 'purchased' : 'other';
    quota.allowanceSources[key] += Number(lot.refund_frozen)===1 ? 0 : Number(lot.remaining)-Number(lot.held);
    quota.heldQuestions += Number(lot.held);
    quota.quotaBreakdown[lot.kind as keyof QuotaSnapshot['quotaBreakdown']] += Number(lot.refund_frozen)===1 ? 0 : Number(lot.remaining) - Number(lot.held);
  }
  if (Object.values(quota.quotaBreakdown).reduce((a,b) => a+b, 0) !== quota.balanceQuestions) {
    throw new Error('Quota ledger balance mismatch');
  }
  return quota;
}

/** Daily Plus lots use the existing expiry/release ledger, including in-flight reservations. */
function* syncPlus(d: Row): Transaction<void> {
  const id=Number(d.id), now=new Date().toISOString();
  const row=(yield* query('SELECT * FROM plus_subscriptions WHERE device_id=?',id))[0];
  const paid=row?plusRow(row):null;
  const manual=(yield* query('SELECT * FROM admin_plus_entitlements WHERE device_id=?',id))[0];
  const plan=withCompensation(plusEntitlement(paid,manual?{startsAt:String(manual.starts_at),expiresAt:String(manual.expires_at),version:Number(manual.version)}:null),yield* readCompensation(id),
    compensationPaidPeriod(paid));
  if (!plan.active) {
    const lots=yield* query("SELECT lot_id,granted FROM quota_lots WHERE device_id=? AND source_ref LIKE 'plus_daily:%' AND refund_target<>granted",id);
    for(const lot of lots) yield* applyRefundLot(String(lot.lot_id),false,Number(lot.granted),'plus-expiry');
  } else {
    const window=trialWindow(), source='plus_daily:'+window.key, lot=randomUUID();
    const expires=window.end<plan.expiresAt!?window.end:plan.expiresAt!;
    const inserted=yield* query(`INSERT INTO quota_lots(lot_id,device_id,kind,granted,remaining,source_ref,created_at,trial_expires_at)
      VALUES(?,?,'paid',?,?,?,?,?) ON CONFLICT(device_id,source_ref) DO NOTHING RETURNING lot_id`,lot,id,PLUS.dailyLimit,PLUS.dailyLimit,source,now,expires);
    if(!inserted.length) {
      const existing=(yield* query('SELECT lot_id FROM quota_lots WHERE device_id=? AND source_ref=?',id,source))[0]!;
      yield* query('UPDATE quota_lots SET trial_expires_at=? WHERE lot_id=?',expires,String(existing.lot_id));
      yield* applyRefundLot(String(existing.lot_id),false,0,'plus-renewal');
    }
    if(inserted.length) {
      yield* query('UPDATE devices SET balance_questions=balance_questions+?,balance_version=balance_version+1,updated_at=? WHERE id=?',PLUS.dailyLimit,now,id);
      yield* ledger(id,lot,'grant',PLUS.dailyLimit,0,source);
    }
  }
  Object.assign(d,(yield* query('SELECT * FROM devices WHERE id=?',id))[0]!);
}

/** Caller holds the device lock; daily grant, expiration and balance version commit together. */
function* syncFreeTrial(d: Row): Transaction<FreeTrialSnapshot | null> {
  const id = Number(d.id), now = new Date().toISOString();
  const trial = (yield* query('SELECT * FROM free_trials WHERE device_id=?', id))[0];

  const expired = yield* query('SELECT lot_id,granted FROM quota_lots WHERE device_id=? AND trial_expires_at<=? AND refund_target<>granted', id, now);
  for (const lot of expired) yield* applyRefundLot(String(lot.lot_id), false, Number(lot.granted), 'trial-expiry');
  if (!trial) { Object.assign(d, (yield* query('SELECT * FROM devices WHERE id=?', id))[0]!); return null; }
  const activatedAt = trial.activated_at === null ? null : String(trial.activated_at);
  const expiresAt = trial.expires_at === null ? null : String(trial.expires_at);
  const window = trialWindow(Date.parse(now)), source = 'trial_daily:' + window.key;
  if (activatedAt && expiresAt && activatedAt <= now && now < expiresAt) {
    const lot = randomUUID(), expires = window.end < expiresAt ? window.end : expiresAt;
    const inserted = yield* query(`INSERT INTO quota_lots
      (lot_id,device_id,kind,granted,remaining,source_ref,created_at,trial_expires_at)
      VALUES (?,?,'trial',?,?,?,?,?) ON CONFLICT(device_id,source_ref) DO NOTHING RETURNING lot_id`,
      lot, id, FREE_TRIAL_POLICY.dailyLimit, FREE_TRIAL_POLICY.dailyLimit, source, now, expires);
    if (inserted.length) {
      yield* query('UPDATE devices SET balance_questions=balance_questions+?,balance_version=balance_version+1,updated_at=? WHERE id=?', FREE_TRIAL_POLICY.dailyLimit, now, id);
      yield* ledger(id, lot, 'grant', FREE_TRIAL_POLICY.dailyLimit, 0, source);
    }
  }
  Object.assign(d, (yield* query('SELECT * FROM devices WHERE id=?', id))[0]!);
  const lot = (yield* query('SELECT remaining,held FROM quota_lots WHERE device_id=? AND source_ref=?', id, source))[0];
  return trialSnapshot(true, activatedAt, expiresAt, lot ? {remaining: Number(lot.remaining), held: Number(lot.held)} : undefined, Date.parse(now));
}
function* accountFor(d: Row): Transaction<AccountSnapshot> {
  // Device counters and quota lots share the caller's transaction and device lock.
  const cli = d.cli_enabled;
  if (![true, false, 0, 1, 0n, 1n].includes(cli as boolean | number | bigint)) {
    throw new Error('Invalid account permission');
  }
  return combineAccountSnapshot(yield* quotaFor(d), {totalQuestions: Number(d.total_questions),
    totalInputTokens: Number(d.total_input_tokens), totalOutputTokens: Number(d.total_output_tokens),
    cliEnabled: cli === true || cli === 1 || cli === 1n});
}
function* readCapture(d: Row, captureId?: string): Transaction<CaptureRecord | null> {
  const rows = captureId
    ? yield* query('SELECT metadata FROM capture_requests WHERE device_id=? AND client_capture_id=?', Number(d.id), captureId)
    : yield* query("SELECT metadata FROM capture_requests WHERE device_id=? AND legacy=1 AND state='held' ORDER BY created_at,request_id LIMIT 1", Number(d.id));
  return rows[0] ? JSON.parse(String(rows[0].metadata)) as CaptureRecord : null;
}
function* expireAnswer(capture: CaptureRecord | null): Transaction<CaptureRecord | null> {
  if (capture && Date.now() - Date.parse(capture.createdAt) >= 900_000 && (capture.answerHmac !== null || capture.sealedAnswer)) {
    capture.answerHmac = null; delete capture.sealedAnswer;
    yield* query('UPDATE capture_requests SET metadata=? WHERE request_id=?', JSON.stringify(capture), capture.requestId);
  }
  return capture;
}

export class SQLBilling implements BillingStore {
  acquireCapacity(token:string,id:string,tokens:number,now=Date.now()):Promise<boolean> {
    if(!Number.isSafeInteger(tokens)||tokens<=0)return Promise.resolve(false);
    return this.run((function*():Transaction<boolean>{
      const d=yield* device(token);if(!d)return false;
      yield* query('SELECT id FROM provider_capacity_guard WHERE id=1 FOR UPDATE');
      const prior=(yield* query('SELECT * FROM provider_capacity_leases WHERE id=?',id))[0];
      if(prior)return Number(prior.device_id)===Number(d.id)&&Number(prior.active)===1&&Number(prior.expires)>now;
      const stats=(yield* query(`SELECT SUM(CASE WHEN active=1 AND expires>? THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN started>? THEN 1 ELSE 0 END) AS requests,
        SUM(CASE WHEN started>? THEN tokens ELSE 0 END) AS tokens FROM provider_capacity_leases`,now,now-60000,now-60000))[0]!;
      if(Number(stats.active)>=CAPACITY.concurrency||Number(stats.requests)>=CAPACITY.requestsPerMinute||Number(stats.tokens)+tokens>CAPACITY.tokensPerMinute)return false;
      yield* query('INSERT INTO provider_capacity_leases(id,device_id,tokens,started,expires,active) VALUES(?,?,?,?,?,1)',id,Number(d.id),tokens,now,now+CAPACITY.leaseMs);
      yield* query('DELETE FROM provider_capacity_leases WHERE expires<=? AND started<=?',now,now-60000);
      return true;
    })());
  }
  releaseCapacity(token:string,id:string):Promise<void> {
    return this.run((function*():Transaction<void>{const d=yield* device(token);if(d)yield* query('UPDATE provider_capacity_leases SET active=0 WHERE id=? AND device_id=?',id,Number(d.id));})());
  }
  private run: RunTransaction;
  constructor(run: RunTransaction) { this.run = run; }
  register(input: RegistrationInput): Promise<RegisteredDevice> {
    return this.run((function* (): Transaction<RegisteredDevice> {
      validQuestions(input.trialQuestions);
      const token = input.token ?? newToken();
      const now = new Date().toISOString();
      // Both token_hash and registration_key_hash are unique. A concurrent replay may
      // encounter either index first; handle both, then verify the existing token binding.
      const inserted = yield* query(`INSERT INTO devices
        (token_hash,platform,app_version,balance_questions,created_at,updated_at,quota_policy_version,
         initial_grant_questions,balance_version,registration_key_hash,registration_key_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`,
        hashToken(token), input.platform, input.appVersion, input.trialQuestions, now, now,
        input.policyVersion ?? 'legacy', input.trialQuestions, 1, input.registrationKeyHash ?? null, input.registrationKeyVersion ?? null);
      const d = yield* device(token);
      if (!d || (input.registrationKeyHash !== undefined && d.registration_key_hash !== input.registrationKeyHash)) {
        throw new Error('Registration identity conflict');
      }
      if (inserted.length) {
        if (input.freeTrialEligible) yield* query('INSERT INTO free_trials (device_id) VALUES (?)', Number(d.id));
        const lot = randomUUID();
        yield* query(`INSERT INTO quota_lots (lot_id,device_id,kind,granted,remaining,source_ref,created_at)
          VALUES (?,?,?,?,?,?,?)`, lot, Number(d.id), 'trial', input.trialQuestions, input.trialQuestions, 'initial_grant', now);
        yield* ledger(Number(d.id), lot, 'grant', input.trialQuestions, 0, 'initial_grant');
        yield* checkpointQuota(d, null);
      }
      return { token, id: Number(d.id), balanceQuestions: Number(d.balance_questions) };
    })());
  }
  quota(token: string): Promise<QuotaSnapshot | null> {
    return this.run((function* (): Transaction<QuotaSnapshot | null> {
      const d = yield* device(token); return d ? yield* quotaFor(d) : null;
    })());
  }
  claimFreeTrial(token: string): Promise<AccountSnapshot | null> {
    return this.run((function* (): Transaction<AccountSnapshot | null> {
      const d = yield* device(token); if (!d) return null;
      const id = Number(d.id), now = Date.now();
      const started = new Date(now).toISOString();
      const expires = new Date(now + FREE_TRIAL_POLICY.durationHours * 3_600_000).toISOString();
      const claimed = yield* query('UPDATE free_trials SET activated_at=?,expires_at=? WHERE device_id=? AND activated_at IS NULL RETURNING device_id', started, expires, id);
      if (claimed.length) yield* query("UPDATE quota_lots SET trial_expires_at=? WHERE device_id=? AND source_ref='initial_grant'", started, id);
      return yield* accountFor(d);
    })());
  }
  accountSnapshot(token: string): Promise<AccountSnapshot | null> {
    return this.run((function* (): Transaction<AccountSnapshot | null> {
      const d = yield* device(token);
      return d ? yield* accountFor(d) : null;
    })());
  }
  capture(token: string, captureId: string): Promise<CaptureRecord | null> {
    return this.run((function* (): Transaction<CaptureRecord | null> {
      const d = yield* device(token); if (!d) return null;
      return yield* expireAnswer(yield* readCapture(d, captureId));
    })());
  }
  begin(input: BeginCapture): Promise<BeginResult> {
    return this.run(beginCapture(input));
  }
  cancelCapture(token:string,id:string):Promise<void>{
    return this.run((function*():Transaction<void>{const d=yield* device(token);if(!d)return;
      yield* query('INSERT INTO capture_cancellations(device_id,capture_id,expires) VALUES(?,?,?) ON CONFLICT(device_id,capture_id) DO NOTHING',Number(d.id),id,Date.now()+900000);
      yield* finishForDevice(d,{token,captureId:id,charge:false,terminalState:'canceled'});
    })());
  }
  heartbeat(token:string,id:string,owner:string,now=Date.now()):Promise<boolean> {
    return this.run((function*():Transaction<boolean>{
      const d=yield* device(token),c=d?yield* readCapture(d,id):null;
      if(!c||c.settlementStatus!=='held'||c.deliveryOwner!==owner||Date.parse(c.expiresAt)<=now)return false;
      c.workerAliveUntil=now+8000;yield* query('UPDATE capture_requests SET metadata=? WHERE request_id=?',JSON.stringify(c),c.requestId);return true;
    })());
  }
  beginWithAttempt(input: BeginCapture, attempt: NewAttempt): Promise<BeginResult> {
    assertAttemptBinding(input, attempt);
    return this.run((function* (): Transaction<BeginResult> {
      let result = yield* beginCapture(input);
      if(!result.ok&&result.reason==='capture_in_progress'&&input.deliveryRecovery&&result.capture?.deliveryOwner
        && (result.capture.workerAliveUntil??Infinity)<Date.now()&&Date.parse(result.capture.expiresAt)>Date.now()){
        const c=result.capture,d=(yield* device(input.token))!;
        const attempts=yield* query('SELECT attempt_id,metadata FROM model_attempts WHERE request_id=?',c.requestId);
        if(attempts.length>=2)return result;
        for(const row of attempts){
          yield* finishAttemptForDevice(d,String(row.attempt_id),{status:'unknown',inputTokens:null,outputTokens:null,costMicros:null});
          yield* settleBudgetForDevice(d,String(row.attempt_id),null);
          yield* query('UPDATE provider_capacity_leases SET active=0 WHERE id=? AND device_id=?',String(row.attempt_id),Number(d.id));
        }
        c.deliveryOwner=input.requestId;c.workerAliveUntil=Date.now()+8000;
        yield* query('UPDATE capture_requests SET metadata=? WHERE request_id=?',JSON.stringify(c),c.requestId);
        result={ok:true,capture:c,quota:yield* quotaFor(d)};
      }
      if(result.ok){
        if(!(yield* insertAttempt(result.capture,attempt)))throw new Error('Attempt could not start');
        if(result.capture.deliveryOwner){result.capture.workerAttemptId=attempt.attemptId;result.capture.deliveryAttempts=(result.capture.deliveryAttempts??0)+1;
          yield* query('UPDATE capture_requests SET metadata=? WHERE request_id=?',JSON.stringify(result.capture),result.capture.requestId);}
      }
      return result;
    })());
  }
  finish(input: FinishCapture): Promise<AccountSnapshot | null> {
    return this.run((function* (): Transaction<AccountSnapshot | null> {
      const d = yield* device(input.token);
      if (!d) return null;
      yield* finishForDevice(d, input);
      return yield* accountFor((yield* device(input.token))!);
    })());
  }
  finishWithCapture(input: FinishCapture & {captureId: string}): Promise<CaptureSettlement | null> {
    return this.run((function* (): Transaction<CaptureSettlement | null> {
      const d = yield* device(input.token); if (!d) return null;
      if(input.attemptSettlement){const a=input.attemptSettlement;
        yield* finishAttemptForDevice(d,a.id,a.result);yield* settleBudgetForDevice(d,a.id,a.actual,a.anomaly);
      }
      // Reuse the record read/written while settling under the device lock. run resolves
      // only after COMMIT, so callers never send a receipt for an uncommitted snapshot.
      const capture = yield* expireAnswer(yield* finishForDevice(d, input));
      return {account: yield* accountFor((yield* device(input.token))!), capture};
    })());
  }
  credit(input: CreditInput): Promise<number | null> {
    return this.run((function* (): Transaction<number | null> {
      validQuestions(input.questions); validQuestions(input.amountCents);
      const d = yield* device(input.token);
      if (!d) return null;
      yield* opening(d);
      const now = new Date().toISOString();
      const inserted = yield* query(`INSERT INTO topups (device_id,questions,amount_cents,currency,provider,reference,note,created_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(reference) DO NOTHING RETURNING id`, Number(d.id), input.questions,
        input.amountCents, input.currency, input.provider, input.reference, input.note ?? null, now);
      if (!inserted.length) return Number(d.balance_questions);
      const lot = randomUUID();
      yield* query(`INSERT INTO quota_lots (lot_id,device_id,kind,granted,remaining,source_ref,created_at)
        VALUES (?,?,?,?,?,?,?)`, lot, Number(d.id), input.amountCents > 0 ? 'paid' : 'goodwill',
        input.questions, input.questions, 'credit:' + input.reference, now);
      yield* query('UPDATE devices SET balance_questions=balance_questions+?,balance_version=balance_version+1,updated_at=? WHERE id=?', input.questions, now, Number(d.id));
      yield* ledger(Number(d.id), lot, 'credit', input.questions, 0, 'credit:' + input.reference);
      return Number(d.balance_questions) + input.questions;
    })());
  }
  creditDevice(deviceId: number, input: Omit<CreditInput, 'token'>): Promise<number | null> {
    return this.run((function* (): Transaction<number | null> {
      validQuestions(input.questions); validQuestions(input.amountCents);
      const d = (yield* query('SELECT * FROM devices WHERE id=? FOR UPDATE', deviceId))[0]; if (!d) return null;
      yield* opening(d);
      const now = new Date().toISOString();
      const inserted = yield* query(`INSERT INTO topups (device_id,questions,amount_cents,currency,provider,reference,note,created_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(reference) DO NOTHING RETURNING id`, deviceId, input.questions,
        input.amountCents, input.currency, input.provider, input.reference, input.note ?? null, now);
      if (!inserted.length) return Number(d.balance_questions);
      const lot = randomUUID();
      yield* query(`INSERT INTO quota_lots (lot_id,device_id,kind,granted,remaining,source_ref,created_at)
        VALUES (?,?,?,?,?,?,?)`, lot, deviceId, input.amountCents > 0 ? 'paid' : 'goodwill', input.questions, input.questions, 'credit:' + input.reference, now);
      yield* query('UPDATE devices SET balance_questions=balance_questions+?,balance_version=balance_version+1,updated_at=? WHERE id=?', input.questions, now, deviceId);
      yield* ledger(deviceId, lot, 'credit', input.questions, 0, 'credit:' + input.reference);
      return Number(d.balance_questions) + input.questions;
    })());
  }
  reap(now = new Date().toISOString()): Promise<number> {
    return this.run((function* (): Transaction<number> {
      const expired = yield* query("SELECT device_id,client_capture_id FROM capture_requests WHERE state='held' AND lease_expires_at<=? ORDER BY device_id LIMIT 100", now);
      const stale = yield* query("SELECT attempt_id,device_id FROM attempt_budget_holds WHERE state='held' AND created_at<=? ORDER BY device_id LIMIT 100",new Date(Date.parse(now)-BUDGET_POLICY.orphanMs).toISOString());
      const delivered=yield* query(`SELECT request_id,device_id,metadata FROM capture_requests WHERE state<>'held' AND created_at<=? AND metadata LIKE '%"sealedAnswer":%' LIMIT 100`,new Date(Date.parse(now)-900000).toISOString());
      // Acquire every device before any shared guard, including ciphertext cleanup.
      // Otherwise a batch could hold a guard while waiting for another request's device.
      for (const id of [...new Set([...expired,...stale,...delivered].map(r=>Number(r.device_id)))].sort((a,b)=>a-b)) {
        yield* query('SELECT id FROM devices WHERE id=? FOR UPDATE',id);
      }
      if(expired.length||stale.length)yield* query('SELECT scope,currency FROM request_budget_guards ORDER BY scope,currency FOR UPDATE');
      let count = 0;
      for (const row of expired) {
        const d = (yield* query('SELECT * FROM devices WHERE id=? FOR UPDATE', Number(row.device_id)))[0];
        if (!d) continue;
        const capture = yield* readCapture(d, String(row.client_capture_id));
        if (!capture || capture.settlementStatus !== 'held' || capture.expiresAt > now) continue;
        yield* finishForDevice(d, { token: '', captureId: capture.captureId, charge: false, terminalState: 'failed',
          terminalReason: 'lease_expired', compensateGoodwill: capture.operation === 'recover' });
        const attempts = yield* query('SELECT attempt_id,metadata FROM model_attempts WHERE request_id=? AND status=\'running\'', capture.requestId);
        for (const attempt of attempts) {
          yield* settleBudgetForDevice(d,String(attempt.attempt_id),null);
          const previous = JSON.parse(String(attempt.metadata)) as Attempt;
          const finishedAt = new Date().toISOString();
          const unknown: Attempt = { ...previous, status: 'unknown', inputTokens: null, outputTokens: null, costMicros: null, finishedAt };
          yield* query('UPDATE model_attempts SET metadata=?,status=\'unknown\' WHERE attempt_id=?', JSON.stringify(unknown), String(attempt.attempt_id));
          yield* query(`INSERT INTO attempt_costs (attempt_id,revision,currency,cost_micros,pricing_version,source,calculated_at)
            VALUES (?,2,?,NULL,?,'unknown',?) ON CONFLICT(attempt_id,revision) DO NOTHING`, String(attempt.attempt_id), previous.currency, previous.pricingVersion, finishedAt);
        }
        count++;
      }

      for (const row of stale) {
        const d=(yield* query('SELECT * FROM devices WHERE id=? FOR UPDATE',Number(row.device_id)))[0];
        if (d) yield* settleBudgetForDevice(d,String(row.attempt_id),null);
      }
      // Remove expired ciphertext independently of shared budget guards.
      for(const row of delivered){const c=JSON.parse(String(row.metadata)) as CaptureRecord;delete c.sealedAnswer;c.answerHmac=null;
        yield* query('UPDATE capture_requests SET metadata=? WHERE request_id=? AND metadata=?',JSON.stringify(c),String(row.request_id),String(row.metadata));}
      yield* query('DELETE FROM capture_cancellations WHERE expires<?',Date.parse(now));
      yield* query('DELETE FROM rate_limit_buckets WHERE expires_at<?', now);
      return count;
    })());
  }
  startAttempt(token: string, input: Omit<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'|'startedAt'|'finishedAt'>): Promise<boolean> {
    return this.run((function* (): Transaction<boolean> {
      const d = yield* device(token), capture = d ? yield* readCapture(d, input.captureId) : null;
      if (!d || !capture || capture.settlementStatus !== 'held') return false;
      const inserted=yield* insertAttempt(capture,input);
      if(inserted&&capture.deliveryOwner){capture.workerAttemptId=input.attemptId;capture.deliveryAttempts=(capture.deliveryAttempts??0)+1;
        yield* query('UPDATE capture_requests SET metadata=? WHERE request_id=?',JSON.stringify(capture),capture.requestId);}
      return inserted;
    })());
  }
  finishAttempt(token: string, attemptId: string, input: Pick<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'>): Promise<void> {
    return this.run((function* (): Transaction<void> {
      const d = yield* device(token); if (!d) return;
      yield* finishAttemptForDevice(d, attemptId, input);
    })());
  }
  finishAttemptAndBudget(token: string, attemptId: string, input: Pick<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'>, actualMicros: number | null, anomaly = false): Promise<void> {
    return this.run((function* (): Transaction<void> {
      const d = yield* device(token); if (!d) return;
      yield* finishAttemptForDevice(d, attemptId, input);
      yield* settleBudgetForDevice(d, attemptId, actualMicros, anomaly);
    })());
  }
  reserveBudget(token: string, attemptId: string, scope: string, currency: string, reservedUpperMicros: number,
    limitMicros: number, windowMs = 86_400_000, now = Date.now(), utcOffsetMinutes = 0, guarded = false, channel = 'default'): Promise<boolean> {
    if (limitMicros <= 0 || reservedUpperMicros <= 0) return Promise.resolve(true);
    return this.run((function* (): Transaction<boolean> {
      const d = yield* device(token); if (!d) return false;
      const offset = utcOffsetMinutes * 60_000;
      const start = Math.floor((now + offset) / windowMs) * windowMs - offset;
      const windowStart = new Date(start).toISOString(), expiresAt = new Date(start + windowMs).toISOString();
      const existing = yield* query('SELECT state,device_id FROM attempt_budget_holds WHERE attempt_id=?', attemptId);
      if (existing.length) return Number(existing[0]!.device_id)===Number(d.id)
        && (String(existing[0]!.state) === 'held' || String(existing[0]!.state) === 'settled');
      const channelKey = JSON.stringify([scope,currency,channel]);
      if (guarded) {
        yield* query('INSERT INTO request_budget_guards(scope,currency) VALUES (?,?) ON CONFLICT(scope,currency) DO NOTHING',scope,currency);
        const guard=(yield* query('SELECT tripped FROM request_budget_guards WHERE scope=? AND currency=? FOR UPDATE',scope,currency))[0];
        if (!guard || Number(guard.tripped)!==0) throw new BudgetAdmissionError('guard_tripped');
        yield* query('INSERT INTO budget_controls(channel,metadata) VALUES (?,?) ON CONFLICT(channel) DO NOTHING',channelKey,JSON.stringify(emptyControl(channelKey)));
        const control = JSON.parse(String((yield* query('SELECT metadata FROM budget_controls WHERE channel=? FOR UPDATE',channelKey))[0]!.metadata)) as BudgetControl;
        if (control.blockedUntil === -1) throw new BudgetAdmissionError('guard_tripped');
        if (control.blockedUntil > now) throw new BudgetAdmissionError('cooldown',Math.max(1,Math.ceil((control.blockedUntil-now)/1000)));
      }
      yield* query(`INSERT INTO budget_windows(scope,window_start,currency,limit_micros,expires_at)
        VALUES (?,?,?,?,?) ON CONFLICT(scope,window_start,currency) DO NOTHING`, scope, windowStart, currency, limitMicros, expiresAt);
      const row = (yield* query('SELECT spent_micros,held_micros,limit_micros FROM budget_windows WHERE scope=? AND window_start=? AND currency=? FOR UPDATE', scope, windowStart, currency))[0];
      if (!row || Number(row.spent_micros) + Number(row.held_micros) + reservedUpperMicros + (guarded?Math.ceil(Number(row.limit_micros)*0.2):0) > Number(row.limit_micros)) return false;
      yield* query(`INSERT INTO attempt_budget_holds(attempt_id,device_id,scope,window_start,currency,reserved_upper_micros,state,created_at)
        VALUES (?,?,?,?,?,?,'held',?)`, attemptId, Number(d.id), scope, windowStart, currency, reservedUpperMicros, new Date(now).toISOString());
      yield* query("INSERT INTO budget_accounting(attempt_id,channel,reserved,booked,state,updated_at) VALUES (?,?,?,0,'pending',?)",attemptId,channelKey,reservedUpperMicros,now);
      if (guarded) {
        const control = JSON.parse(String((yield* query('SELECT metadata FROM budget_controls WHERE channel=?',channelKey))[0]!.metadata)) as BudgetControl;
        if (control.blockedUntil > 0) {
          control.probe = attemptId; control.blockedUntil = now + BUDGET_POLICY.probeMs;
          yield* query('UPDATE budget_controls SET metadata=? WHERE channel=?',JSON.stringify(control),channelKey);
        }
      }
      if (guarded) yield* query('INSERT INTO guarded_budget_holds(attempt_id,scope,currency) VALUES (?,?,?)',attemptId,scope,currency);
      yield* query('UPDATE budget_windows SET held_micros=held_micros+? WHERE scope=? AND window_start=? AND currency=?', reservedUpperMicros, scope, windowStart, currency);
      return true;
    })());
  }
  releaseBudget(token: string, attemptId: string): Promise<void> {
    return this.run((function* (): Transaction<void> {
      const d = yield* device(token); if (!d) return;
      yield* lockBudgetGuard(attemptId);
      const hold = (yield* query("SELECT * FROM attempt_budget_holds WHERE attempt_id=? AND device_id=? AND state='held' FOR UPDATE", attemptId, Number(d.id)))[0]; if (!hold) return;
      const accounting = (yield* query('SELECT * FROM budget_accounting WHERE attempt_id=?',attemptId))[0];
      if (accounting) {
        yield* query("UPDATE budget_accounting SET state='released',booked=0,actual=0,updated_at=? WHERE attempt_id=?",Date.now(),attemptId);
        const controlRow = (yield* query('SELECT metadata FROM budget_controls WHERE channel=? FOR UPDATE',String(accounting.channel)))[0];
        if (controlRow) {
          const c=JSON.parse(String(controlRow.metadata)) as BudgetControl;
          if (c.probe===attemptId) { c.probe=null; c.blockedUntil=Date.now()+BUDGET_POLICY.cooldownMs;
            yield* query('UPDATE budget_controls SET metadata=? WHERE channel=?',JSON.stringify(c),c.channel); }
        }
      }
      yield* query("UPDATE attempt_budget_holds SET state='released' WHERE attempt_id=?", attemptId);
      yield* query('UPDATE budget_windows SET held_micros=held_micros-? WHERE scope=? AND window_start=? AND currency=?', Number(hold.reserved_upper_micros), String(hold.scope), String(hold.window_start), String(hold.currency));
    })());
  }
  settleBudget(token: string, attemptId: string, actualMicros: number | null, anomaly = false): Promise<void> {
    return this.run((function* (): Transaction<void> {
      const d = yield* device(token); if (!d) return;
      yield* settleBudgetForDevice(d, attemptId, actualMicros, anomaly);
    })());
  }
  inspectBudget(): Promise<BudgetInspection> {
    return this.run((function* (): Transaction<BudgetInspection> {
      const controls=yield* query('SELECT metadata FROM budget_controls ORDER BY channel');
      const provisional=yield* query("SELECT * FROM budget_accounting WHERE state='provisional' ORDER BY updated_at LIMIT 200");
      const legacy=yield* query('SELECT scope,currency FROM request_budget_guards WHERE tripped<>0 ORDER BY scope,currency');
      const now = new Date().toISOString();
      const windows = yield* query('SELECT * FROM budget_windows WHERE window_start<=? AND expires_at>? ORDER BY scope,currency',now,now);
      const recent=yield* query("SELECT h.currency,SUM(a.booked) AS micros FROM budget_accounting a JOIN attempt_budget_holds h ON h.attempt_id=a.attempt_id WHERE h.scope='official' AND h.created_at>=? GROUP BY h.currency",new Date(Date.now()-3600000).toISOString());
      return {recentSpend:recent.map(r=>({currency:String(r.currency),micros:Number(r.micros)})),controls:[...controls.map(r=>JSON.parse(String(r.metadata)) as BudgetControl),
        ...legacy.map(r=>({...emptyControl('legacy:'+JSON.stringify([String(r.scope),String(r.currency)])),blockedUntil:-1,reason:'legacy_global_guard'}))],
        provisional:provisional.map(accountingRow), windows:windows.map(r=>({scope:String(r.scope),currency:String(r.currency),
          start:String(r.window_start),expiresAt:String(r.expires_at),limit:Number(r.limit_micros),spent:Number(r.spent_micros),held:Number(r.held_micros)}))};
    })());
  }
  reconcileBudget(attemptId: string, actualMicros: number, evidence: string): Promise<boolean> {
    validateReconciliation(actualMicros,evidence);
    return this.run((function* (): Transaction<boolean> {
      const owner=(yield* query('SELECT device_id FROM attempt_budget_holds WHERE attempt_id=?',attemptId))[0];
      if (!owner) return false;
      yield* query('SELECT id FROM devices WHERE id=? FOR UPDATE',Number(owner.device_id));
      yield* lockBudgetGuard(attemptId);
      const hold=(yield* query('SELECT * FROM attempt_budget_holds WHERE attempt_id=? FOR UPDATE',attemptId))[0]!;
      const row=(yield* query('SELECT * FROM budget_accounting WHERE attempt_id=? FOR UPDATE',attemptId))[0];
      if (!row) return false;
      if (row.state==='reconciled') return Number(row.actual)===actualMicros && row.evidence===evidence;
      if (row.state!=='provisional') return false;
      const cRow=(yield* query('SELECT metadata FROM budget_controls WHERE channel=? FOR UPDATE',String(row.channel)))[0];
      if (cRow && actualMicros>Number(row.reserved)) {
        const next=budgetOutcome(JSON.parse(String(cRow.metadata)),attemptId,Number(row.reserved),actualMicros,false,Date.now());
        yield* query('UPDATE budget_controls SET metadata=? WHERE channel=?',JSON.stringify(next),String(row.channel));
      }
      yield* query('UPDATE budget_windows SET spent_micros=spent_micros+? WHERE scope=? AND window_start=? AND currency=?',actualMicros-Number(row.booked),String(hold.scope),String(hold.window_start),String(hold.currency));
      yield* query("UPDATE budget_accounting SET state='reconciled',booked=?,actual=?,evidence=?,updated_at=? WHERE attempt_id=?",actualMicros,actualMicros,evidence,Date.now(),attemptId);
      yield* query('UPDATE attempt_budget_holds SET actual_micros=? WHERE attempt_id=?',actualMicros,attemptId);
      const attempt=(yield* query('SELECT metadata FROM model_attempts WHERE attempt_id=?',attemptId))[0];
      if (attempt) {
        const metadata=JSON.parse(String(attempt.metadata)) as Attempt;
        yield* query(`INSERT INTO attempt_costs(attempt_id,revision,currency,cost_micros,pricing_version,source,calculated_at)
          VALUES (?,3,?,?,?,'reconciled',?)`,attemptId,metadata.currency,String(actualMicros),metadata.pricingVersion,new Date().toISOString());
      }
      return true;
    })());
  }
  resetBudgetControl(channel: string, evidence: string): Promise<boolean> {
    validateReconciliation(0,evidence);
    return this.run((function* (): Transaction<boolean> {
      if (channel.startsWith('legacy:')) {
        let keys: unknown;
        try { keys=JSON.parse(channel.slice(7)); } catch { return false; }
        if (!Array.isArray(keys)||keys.length!==2||keys.some(k=>typeof k!=='string')) return false;
        const [scope,currency]=keys as [string,string];
        const guard=(yield* query('SELECT tripped FROM request_budget_guards WHERE scope=? AND currency=? FOR UPDATE',scope,currency))[0];
        if (!guard) return false;
        const previous=(yield* query('SELECT channel FROM budget_control_resets WHERE evidence=?',evidence))[0];
        if (previous) return previous.channel===channel;
        yield* query('INSERT INTO budget_control_resets(evidence,channel,previous_metadata,created_at) VALUES (?,?,?,?)',evidence,channel,JSON.stringify({tripped:Number(guard.tripped)}),Date.now());
        yield* query('UPDATE request_budget_guards SET tripped=0 WHERE scope=? AND currency=?',scope,currency);
        return true;
      }
      const row=(yield* query('SELECT metadata FROM budget_controls WHERE channel=? FOR UPDATE',channel))[0];
      if (!row) return false;
      const previous=(yield* query('SELECT channel FROM budget_control_resets WHERE evidence=?',evidence))[0];
      if (previous) return previous.channel===channel;
      yield* query('INSERT INTO budget_control_resets(evidence,channel,previous_metadata,created_at) VALUES (?,?,?,?)',evidence,channel,String(row.metadata),Date.now());
      yield* query('UPDATE budget_controls SET metadata=? WHERE channel=?',JSON.stringify(emptyControl(channel)),channel);
      return true;
    })());
  }
  attempts(token: string): Promise<Attempt[]> {
    return this.run((function* (): Transaction<Attempt[]> {
      const d = yield* device(token); if (!d) return [];
      const rows = yield* query('SELECT metadata FROM model_attempts WHERE device_id=?', Number(d.id));
      return rows.map(r => JSON.parse(String(r.metadata)) as Attempt);
    })());
  }
  rateLimit(scope: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
    if (limit <= 0) return Promise.resolve(true);
    return this.run((function* (): Transaction<boolean> {
      const start = Math.floor(now/windowMs)*windowMs;
      const rows = yield* query(`INSERT INTO rate_limit_buckets (scope_hash,window_start,count,expires_at)
        VALUES (?,?,1,?) ON CONFLICT(scope_hash,window_start) DO UPDATE SET count=rate_limit_buckets.count+1 RETURNING count`,
        scope, new Date(start).toISOString(), new Date(start+windowMs).toISOString());
      return Number(rows[0]!.count) <= limit;
    })());
  }
}

function* finishForDevice(d: Row, input: FinishCapture): Transaction<CaptureRecord | null> {
  const capture = yield* readCapture(d, input.captureId);
  if (!capture || capture.settlementStatus !== 'held' || (input.owner&&capture.deliveryOwner!==input.owner)) return capture;
  if (capture.operation !== 'solve') {
    capture.settlementStatus = 'released'; capture.terminalState = input.terminalState;
    capture.finishedAt = new Date().toISOString(); capture.terminalReason = input.terminalReason ?? null;
    capture.usableResult = input.terminalState === 'usable';
    if(input.sealedAnswer)capture.sealedAnswer = input.sealedAnswer;
    capture.answerHmac = capture.usableResult ? input.answerHmac ?? null : null;
    capture.resultState = input.resultState ?? null; capture.questionKind = input.questionKind ?? null;
    capture.parserPath = input.parserPath ?? null;
    if (capture.operation === 'recover' && input.compensateGoodwill && capture.parentCaptureId) {
      const reference = 'recovery:' + capture.parentCaptureId;
      const existing = yield* query('SELECT lot_id FROM quota_lots WHERE device_id=? AND source_ref=?', Number(d.id), 'credit:' + reference);
      if (!existing.length) {
        const lot = randomUUID();
        yield* query(`INSERT INTO quota_lots (lot_id,device_id,kind,granted,remaining,source_ref,created_at)
          VALUES (?,?,?,?,?,?,?)`, lot, Number(d.id), 'goodwill', 1, 1, 'credit:' + reference, capture.finishedAt);
        yield* query('UPDATE devices SET balance_questions=balance_questions+1,balance_version=balance_version+1,updated_at=? WHERE id=?', capture.finishedAt, Number(d.id));
        yield* ledger(Number(d.id), lot, 'credit', 1, 0, 'credit:' + reference);
      }
    }
    yield* query("UPDATE capture_requests SET state='released',metadata=? WHERE request_id=?", JSON.stringify(capture), capture.requestId);
    return capture;
  }
  const reservation = (yield* query('SELECT * FROM quota_reservations WHERE request_id=?', capture.requestId))[0]!;
  const lot = (yield* query('SELECT refund_frozen FROM quota_lots WHERE lot_id=?',String(reservation.lot_id)))[0]!;
  const now = new Date().toISOString();
  // An expired lease cannot be revived by a delayed vendor callback, even before the worker runs.
  const charge = input.charge && capture.expiresAt > now;
  const state = charge ? 'settled' : 'released';
  capture.settlementStatus = state;
  capture.terminalState = input.charge && !charge ? 'failed' : input.terminalState;
  capture.usableResult = charge && input.terminalState === 'usable';
  if(input.sealedAnswer)capture.sealedAnswer = input.sealedAnswer;
  capture.answerHmac = charge ? input.answerHmac ?? null : null;
  capture.resultState = input.resultState ?? null; capture.questionKind = input.questionKind ?? null;
  capture.parserPath = input.parserPath ?? null; capture.terminalReason = input.terminalReason ?? null; capture.finishedAt = now;
  yield* query('UPDATE capture_requests SET state=?,metadata=? WHERE request_id=?', state, JSON.stringify(capture), capture.requestId);
  yield* query('UPDATE quota_reservations SET state=?,settled_at=? WHERE request_id=?', state, now, capture.requestId);
  yield* query('UPDATE quota_lots SET held=held-1,remaining=remaining-? WHERE lot_id=?', charge ? 1 : 0, String(reservation.lot_id));
  yield* query(`UPDATE devices SET balance_questions=balance_questions+?,balance_version=balance_version+1,
    total_questions=total_questions+?,total_input_tokens=total_input_tokens+?,total_output_tokens=total_output_tokens+?,updated_at=? WHERE id=?`,
    charge || Number(lot.refund_frozen)===1 ? 0 : 1, charge ? 1 : 0, input.inputTokens ?? 0, input.outputTokens ?? 0, now, Number(d.id));
  yield* ledger(Number(d.id), String(reservation.lot_id), charge ? 'settle' : 'release', charge || Number(lot.refund_frozen)===1 ? 0 : 1, -1, capture.requestId, String(reservation.reservation_id));
  yield* applyRefundLot(String(reservation.lot_id));
  yield* query(`INSERT INTO usage_events
    (device_id,questions,input_tokens,output_tokens,model,created_at,capture_id,result_protocol,result_state,parser_path,estimated_cost_micros,pricing_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, Number(d.id), charge ? 1 : 0, input.inputTokens ?? 0,
    input.outputTokens ?? 0, input.model ?? null, now, input.usageCaptureId ?? capture.captureId,
    capture.resultProtocol, capture.resultState, capture.parserPath, input.estimatedCostMicros ?? null, input.pricingVersion ?? null);
  return capture;
}

function* beginCapture(input: BeginCapture): Transaction<BeginResult> {
  const admission = (yield* query('SELECT state FROM quota_migration_control WHERE id=1'))[0];
  if (!admission || admission.state !== 'active') return {ok: false, reason: 'service_maintenance'};
  const d = yield* device(input.token);
  if (!d) return { ok: false, reason: 'unknown_token' };
  if(input.deliveryRecovery&&(yield* query('SELECT capture_id FROM capture_cancellations WHERE device_id=? AND capture_id=? AND expires>?',Number(d.id),input.captureId,Date.now())).length)return {ok:false,reason:'capture_already_finalized'};
  yield* opening(d);
  yield* syncFreeTrial(d);
  yield* syncPlus(d);
  const existing = yield* readCapture(d, input.captureId);
  if (existing) return duplicateCapture(existing, input);
  if (input.exclusive) {
    const running = yield* query("SELECT request_id FROM capture_requests WHERE device_id=? AND state='held' LIMIT 1", Number(d.id));
    if (running.length) return { ok: false, reason: 'device_busy' };
  }
  if (input.operation && input.operation !== 'solve') {
    const parent = input.parentCaptureId ? yield* readCapture(d, input.parentCaptureId) : null;
    if (!parent || parent.operation !== 'solve' || parent.settlementStatus !== 'settled' || !parent.usableResult ||
        Date.now() - Date.parse(parent.createdAt) >= 900_000) return { ok: false, reason: 'idempotency_conflict' };
    if (input.answerCaptureId && input.answerCaptureId !== parent.captureId) {
      const answer = yield* readCapture(d, input.answerCaptureId);
      if (input.operation !== 'explain' || !answer || !isRecoveredAnswerFor(parent, answer)) {
        return {ok: false, reason: 'idempotency_conflict'};
      }
    }
    const property = input.operation === 'explain' ? 'explanationCaptureId' : 'recoveryCaptureId';
    if (parent[property]) return { ok: false, reason: 'capture_already_finalized' };
    const capture = newCapture(input);
    yield* query(`INSERT INTO capture_requests
      (request_id,device_id,client_capture_id,request_hmac,metadata,state,legacy,lease_expires_at,created_at)
      VALUES (?,?,?,?,?,'held',0,?,?)`, capture.requestId, Number(d.id), capture.captureId, capture.requestHmac,
      JSON.stringify(capture), capture.expiresAt, capture.createdAt);
    const table = input.operation === 'explain' ? 'explanation_requests' : 'recovery_requests';
    const column = input.operation === 'explain' ? 'explanation_request_id' : 'recovery_request_id';
    yield* query(`INSERT INTO ${table} (parent_request_id,${column}) VALUES (?,?)`, parent.requestId, capture.requestId);
    parent[property] = capture.captureId;
    yield* query('UPDATE capture_requests SET metadata=? WHERE request_id=?', JSON.stringify(parent), parent.requestId);
    return { ok: true, capture, quota: yield* quotaFor(d) };
  }
  if (Number(d.balance_questions) < 1) return { ok: false, reason: 'insufficient_quota' };
  const lot = (yield* query(`SELECT lot_id FROM quota_lots WHERE device_id=? AND remaining>held AND refund_frozen=0
    AND (?=1 OR kind<>'paid' OR source_ref LIKE 'plus_daily:%')
    ORDER BY CASE WHEN kind='trial' THEN 0 WHEN source_ref LIKE 'plus_daily:%' THEN 1 WHEN kind='legacy_unknown' THEN 2 WHEN kind='goodwill' THEN 3 ELSE 4 END,created_at,lot_id LIMIT 1`, Number(d.id), input.allowPurchasedCredits === false ? 0 : 1))[0];
  if (!lot) return {ok:false,reason:'paid_credits_disabled'};
  const capture = newCapture(input), reservation = randomUUID();
  yield* query(`INSERT INTO capture_requests
    (request_id,device_id,client_capture_id,request_hmac,metadata,state,legacy,lease_expires_at,created_at)
    VALUES (?,?,?,?,?,'held',?,?,?)`, capture.requestId, Number(d.id), capture.captureId, capture.requestHmac,
    JSON.stringify(capture), input.legacy ? 1 : 0, capture.expiresAt, capture.createdAt);
  yield* query(`INSERT INTO quota_reservations
    (reservation_id,request_id,device_id,lot_id,questions,state,created_at,expires_at)
    VALUES (?,?,?,?,1,'held',?,?)`, reservation, capture.requestId, Number(d.id), String(lot.lot_id), capture.createdAt, capture.expiresAt);
  yield* query('UPDATE quota_lots SET held=held+1 WHERE lot_id=?', String(lot.lot_id));
  yield* query('UPDATE devices SET balance_questions=balance_questions-1,balance_version=balance_version+1,updated_at=? WHERE id=?', capture.createdAt, Number(d.id));
  yield* ledger(Number(d.id), String(lot.lot_id), 'hold', -1, 1, capture.requestId, reservation);
  return { ok: true, capture, quota: yield* quotaFor((yield* device(input.token))!) };
}

function* insertAttempt(capture: CaptureRecord, input: NewAttempt): Transaction<boolean> {
  const prior=yield* query('SELECT status FROM model_attempts WHERE request_id=?',capture.requestId);
  if(prior.length>=2||prior.some(r=>!['failed','unknown'].includes(String(r.status))))return false;
  const attempt: Attempt = {...input, status: 'running', inputTokens: null, outputTokens: null,
    costMicros: null, startedAt: new Date().toISOString(), finishedAt: null};
  // The caller owns the device lock. Reuse the newly inserted capture instead of reading it
  // in another transaction; SELECT obtains the device ID without another network round trip.
  const rows = yield* query(`INSERT INTO model_attempts (attempt_id,request_id,device_id,ordinal,metadata,status)
    SELECT ?,request_id,device_id,?,?,'running' FROM capture_requests WHERE request_id=? AND state='held'
    ON CONFLICT(request_id,ordinal) DO NOTHING RETURNING attempt_id`, input.attemptId, prior.length+1, JSON.stringify(attempt), capture.requestId);
  if (!rows.length) return false;
  yield* query(`INSERT INTO attempt_costs (attempt_id,revision,currency,cost_micros,pricing_version,source,calculated_at)
    VALUES (?,1,?,NULL,?,'unknown',?)`, input.attemptId, input.currency, input.pricingVersion, attempt.startedAt);
  return true;
}

function* finishAttemptForDevice(d: Row, attemptId: string, input: Pick<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'>): Transaction<void> {
  const row = (yield* query('SELECT metadata FROM model_attempts WHERE attempt_id=? AND device_id=?', attemptId, Number(d.id)))[0];
  if (!row) return;
  const previous = JSON.parse(String(row.metadata)) as Attempt;
  if (previous.status !== 'running') return;
  const attempt: Attempt = { ...previous, ...input, finishedAt: new Date().toISOString() };
  yield* query('UPDATE model_attempts SET metadata=?,status=? WHERE attempt_id=?', JSON.stringify(attempt), attempt.status, attemptId);
  yield* query(`INSERT INTO attempt_costs (attempt_id,revision,currency,cost_micros,pricing_version,source,calculated_at)
    VALUES (?,2,?,?,?,?,?)`, attemptId, attempt.currency, attempt.costMicros, attempt.pricingVersion,
    attempt.costMicros === null ? 'unknown' : 'estimated', attempt.finishedAt);
}

function accountingRow(r: Row): BudgetAccounting {
  return {attemptId:String(r.attempt_id),channel:String(r.channel),reserved:Number(r.reserved),booked:Number(r.booked),
    actual:r.actual===null?null:Number(r.actual),state:String(r.state) as BudgetAccounting['state'],
    evidence:r.evidence===null?null:String(r.evidence),updatedAt:Number(r.updated_at)};
}
function* lockBudgetGuard(attemptId: string): Transaction<Row | undefined> {
  const guard=(yield* query('SELECT scope,currency FROM guarded_budget_holds WHERE attempt_id=?',attemptId))[0];
  if (guard) yield* query('SELECT tripped FROM request_budget_guards WHERE scope=? AND currency=? FOR UPDATE',String(guard.scope),String(guard.currency));
  return guard;
}
function* settleBudgetForDevice(d: Row, attemptId: string, actualMicros: number | null, anomaly = false): Transaction<void> {
  const guard=yield* lockBudgetGuard(attemptId);
  const hold = (yield* query("SELECT * FROM attempt_budget_holds WHERE attempt_id=? AND device_id=? AND state='held' FOR UPDATE", attemptId, Number(d.id)))[0]; if (!hold) return;
  const reserved=Number(hold.reserved_upper_micros), observed=validCost(actualMicros)&&!anomaly, actual=observed?actualMicros!:reserved;
  const accounting=(yield* query('SELECT * FROM budget_accounting WHERE attempt_id=?',attemptId))[0];
  const channel=accounting?String(accounting.channel):JSON.stringify([String(hold.scope),String(hold.currency),'default']);
  if (guard) {
    yield* query('INSERT INTO budget_controls(channel,metadata) VALUES (?,?) ON CONFLICT(channel) DO NOTHING',channel,JSON.stringify(emptyControl(channel)));
    const control=(yield* query('SELECT metadata FROM budget_controls WHERE channel=? FOR UPDATE',channel))[0]!;
    const next=budgetOutcome(JSON.parse(String(control.metadata)),attemptId,reserved,actualMicros,anomaly,Date.now());
    yield* query('UPDATE budget_controls SET metadata=? WHERE channel=?',JSON.stringify(next),channel);
  }
  yield* query(`INSERT INTO budget_accounting(attempt_id,channel,reserved,booked,actual,state,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET booked=excluded.booked,actual=excluded.actual,state=excluded.state,updated_at=excluded.updated_at`,
    attemptId,channel,reserved,actual,observed?actual:null,observed?'observed':'provisional',Date.now());
  yield* query("UPDATE attempt_budget_holds SET state='settled',actual_micros=? WHERE attempt_id=?", observed?actual:null, attemptId);
  yield* query('UPDATE budget_windows SET held_micros=held_micros-?,spent_micros=spent_micros+? WHERE scope=? AND window_start=? AND currency=?', reserved, actual, String(hold.scope), String(hold.window_start), String(hold.currency));
}
