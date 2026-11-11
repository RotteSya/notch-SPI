import {CAPACITY,capacityAvailable,type CapacityLease} from './capacity-policy.ts';
import {withCompensation,type PlusCompensation} from './plus-compensation.ts';
import { BUDGET_POLICY, budgetOutcome, emptyControl, validCost, validateReconciliation, type BudgetAccounting, type BudgetControl, type BudgetInspection } from './budget-policy.ts';
import {PLUS,compensationPaidPeriod,plusEntitlement,type PlusRecord} from './plus.ts';
import { BudgetAdmissionError, assertAttemptBinding, combineAccountSnapshot, duplicateCapture, isRecoveredAnswerFor, newCapture, validQuestions, type AccountSnapshot, type Attempt, type NewAttempt, type BeginCapture, type BeginResult,
  type BillingStore, type CaptureRecord, type CaptureSettlement, type FinishCapture, type LotKind, type QuotaSnapshot } from './billing.ts';
import type { StoredUsageMetric } from './db.ts';
import { applyLotPolicy, type RefundLot, type RefundPolicy } from './payment-ledger.ts';
import { randomUUID } from 'node:crypto';
import {FREE_TRIAL_POLICY, trialWindow, trialSnapshot} from './free-trial.ts';
import { reportCapture, type ReportCapture, type ReportAttempt, type ReportLot } from './reporting.ts';

export interface MemoryQuotaDevice {
  id: number; balanceQuestions: number; totalQuestions: number; totalInputTokens: number;
  totalOutputTokens: number; updatedAt: string; cliEnabled: boolean;
}
interface Lot extends RefundLot { kind: LotKind; sourceRef?: string; expiresAt?: string; id:string;granted:number;createdAt:string;revocations:Array<{at:string;delta:number}> }
function newLot(kind:LotKind,remaining:number,sourceRef?:string):Lot {
  return {kind,remaining,held:0,revoked:0,frozen:false,target:0,id:randomUUID(),granted:remaining,createdAt:new Date().toISOString(),revocations:[],...(sourceRef?{sourceRef}:{})};
}
interface State {
  freeTrial?: {activatedAt: string | null; expiresAt: string | null};
  version: bigint; policy: string; initial: number | null; lots: Lot[];
  captures: Map<string, { record: CaptureRecord; lot: Lot; legacy: boolean }>;
  attempts: Map<string, Attempt>;
}
export class MemoryBilling implements BillingStore {
  private canceled=new Map<string,number>();
  async cancelCapture(token:string,id:string):Promise<void>{const d=this.lookup(token);if(!d)return;
    this.canceled.set(d.id+':'+id,Date.now()+900000);this.finishDevice(d,{token,captureId:id,charge:false,terminalState:'canceled'});
  }
  private capacity = new Map<string,CapacityLease>();
  async acquireCapacity(token:string,id:string,tokens:number,now=Date.now()):Promise<boolean> {
    if(!this.lookup(token)||!Number.isSafeInteger(tokens)||tokens<=0)return false;
    for(const [k,l] of this.capacity)if(l.expires<=now&&l.started<=now-60000)this.capacity.delete(k);
    const existing=this.capacity.get(id);if(existing)return existing.owner===token&&existing.active&&existing.expires>now;
    if(!capacityAvailable([...this.capacity.values()],tokens,now))return false;
    this.capacity.set(id,{id,owner:token,tokens,started:now,expires:now+CAPACITY.leaseMs,active:true});return true;
  }
  async releaseCapacity(token:string,id:string):Promise<void> {const l=this.capacity.get(id);if(l?.owner===token)l.active=false;}

  private states = new Map<number, State>();
  private devices = new Map<number, MemoryQuotaDevice>();
  private buckets = new Map<string, { count: number; end: number }>();
  private budgets = new Map<string, { scope:string; currency:string; start:number; limit: number; spent: number; held: number; end: number }>();
  private controls = new Map<string,BudgetControl>();
  private accounting = new Map<string,BudgetAccounting>();
  private controlResets = new Map<string,{channel:string;previous:BudgetControl}>();
  private guardedHolds = new Map<string,string>();
  private budgetHolds = new Map<string, { deviceId: number; key: string; group: string; reserved: number; createdAt: number; state: 'held'|'released'|'settled' }>();
  private lookup: (token: string) => MemoryQuotaDevice | undefined;
  private usage: (event: StoredUsageMetric & { createdAt: string }) => void;
  constructor(lookup: (token: string) => MemoryQuotaDevice | undefined,
    usage: (event: StoredUsageMetric & { createdAt: string }) => void,
    plus: (id:number)=>PlusRecord|null = () => null,manual:(id:number)=>import('./admin-store.ts').ManualPlus|null=()=>null,
    compensation:(id:number)=>PlusCompensation|null=()=>null) { this.lookup = lookup; this.usage = usage; this.plus=plus;this.manual=manual;this.compensation=compensation; }
  private manual:(id:number)=>import('./admin-store.ts').ManualPlus|null;
  private compensation:(id:number)=>PlusCompensation|null;
  private plus: (id:number)=>PlusRecord|null;
  plusUsage(token:string,source:string) {
    const d=this.lookup(token); if(!d)return null;
    const lot=this.state(d).lots.find(l=>l.sourceRef===source);
    return lot?{remaining:lot.remaining,held:lot.held,granted:lot.granted}:null;
  }
  register(d: MemoryQuotaDevice, policy: string, grant: number, freeTrialEligible = false): void {
    this.devices.set(d.id,d);
    this.states.set(d.id, { version: 1n, policy, initial: grant,
      ...(freeTrialEligible ? {freeTrial: {activatedAt: null, expiresAt: null}} : {}),
      lots: [newLot('trial',grant,'initial_grant')], captures: new Map(), attempts: new Map() });
  }
  private state(d: MemoryQuotaDevice): State {
    this.devices.set(d.id,d);
    let state = this.states.get(d.id);
    if (!state) {
      state = { version: 0n, policy: 'legacy', initial: null,
        lots: [newLot('legacy_unknown',d.balanceQuestions)], captures: new Map(), attempts: new Map() };
      this.states.set(d.id,state);
    }
    return state;
  }
  private snapshot(d: MemoryQuotaDevice): QuotaSnapshot {
    const now = Date.now();
    this.syncFreeTrial(d, now);
    const state = this.state(d);
    const result: QuotaSnapshot = { balanceQuestions: d.balanceQuestions, balanceVersion: String(state.version),
      heldQuestions: 0, policyVersion: state.policy, initialGrantQuestions: state.initial,
      quotaBreakdown: { trial: 0, paid: 0, goodwill: 0, legacy_unknown: 0 } };
    for (const lot of state.lots) {
      result.heldQuestions += lot.held; result.quotaBreakdown[lot.kind] += lot.frozen?0:lot.remaining-lot.held;
    }
    result.allowanceSources = {trial:0,plus:0,purchased:0,other:0};
    for (const lot of state.lots) {
      const key = lot.sourceRef?.startsWith('plus_daily:') ? 'plus' : lot.kind === 'trial' ? 'trial' : lot.kind === 'paid' ? 'purchased' : 'other';
      result.allowanceSources[key] += lot.frozen ? 0 : lot.remaining-lot.held;
    }
    if (state.freeTrial) {
      const trial = state.freeTrial;
      result.freeTrial = trialSnapshot(true, trial.activatedAt, trial.expiresAt,
        state.lots.find(l => l.sourceRef === 'trial_daily:' + trialWindow(now).key), now);
    }
    return result;
  }
  private syncFreeTrial(d: MemoryQuotaDevice, clock = Date.now()): void {
    const state = this.state(d), now = new Date(clock).toISOString();
    for (const lot of state.lots) if (lot.expiresAt && lot.expiresAt <= now && lot.target !== lot.granted) {
      const change = applyLotPolicy(lot, false, lot.granted);
      if (change.revokedDelta) lot.revocations.push({at: now, delta: change.revokedDelta});
      d.balanceQuestions += change.availableDelta; state.version++; d.updatedAt = now;
    }
    const paid=this.plus(d.id);
    const plan=withCompensation(plusEntitlement(paid,this.manual(d.id),clock),this.compensation(d.id),
      compensationPaidPeriod(paid,clock),clock);
    if(plan.active) {
      const window=trialWindow(clock),source='plus_daily:'+window.key;
      if(!state.lots.some(l=>l.sourceRef===source)) {
        const lot=newLot('paid',PLUS.dailyLimit,source);
        lot.expiresAt=window.end<plan.expiresAt!?window.end:plan.expiresAt!;
        state.lots.push(lot);d.balanceQuestions+=lot.granted;state.version++;d.updatedAt=now;
      } else {
        const lot=state.lots.find(l=>l.sourceRef===source)!;
        lot.expiresAt=window.end<plan.expiresAt!?window.end:plan.expiresAt!;
        if(lot.target!==0){const change=applyLotPolicy(lot,false,0);d.balanceQuestions+=change.availableDelta;state.version++;d.updatedAt=now;}
      }
    } else for(const lot of state.lots.filter(l=>l.sourceRef?.startsWith('plus_daily:')&&l.target!==l.granted)) {
      const change=applyLotPolicy(lot,false,lot.granted);d.balanceQuestions+=change.availableDelta;state.version++;d.updatedAt=now;
    }
    const trial = state.freeTrial;
    if (!trial?.activatedAt || !trial.expiresAt || trial.activatedAt > now || trial.expiresAt <= now) return;
    const window = trialWindow(clock), source = 'trial_daily:' + window.key;
    if (state.lots.some(l => l.sourceRef === source)) return;
    const lot = newLot('trial', FREE_TRIAL_POLICY.dailyLimit, source);
    lot.expiresAt = window.end < trial.expiresAt ? window.end : trial.expiresAt;
    state.lots.push(lot); d.balanceQuestions += lot.granted; state.version++; d.updatedAt = now;
  }
  async claimFreeTrial(token: string): Promise<AccountSnapshot | null> {
    const d = this.lookup(token); if (!d) return null;
    const state = this.state(d), trial = state.freeTrial;
    if (trial && !trial.activatedAt) {
      const now = Date.now();
      trial.activatedAt = new Date(now).toISOString();
      trial.expiresAt = new Date(now + FREE_TRIAL_POLICY.durationHours * 3_600_000).toISOString();
      // Replace the remaining onboarding grant, preserving paid/goodwill and held requests.
      for (const lot of state.lots) if (lot.sourceRef === 'initial_grant') lot.expiresAt = trial.activatedAt;
    }
    return this.accountFor(d);
  }
  async quota(token: string): Promise<QuotaSnapshot | null> { const d=this.lookup(token); return d ? this.snapshot(d) : null; }
  async accountSnapshot(token: string): Promise<AccountSnapshot | null> {
    const d = this.lookup(token);
    return d ? this.accountFor(d) : null;
  }
  private accountFor(d: MemoryQuotaDevice): AccountSnapshot {
    // No await: the device counters, permission and lot snapshot are copied in one turn.
    return combineAccountSnapshot(this.snapshot(d), {totalQuestions: d.totalQuestions,
      totalInputTokens: d.totalInputTokens, totalOutputTokens: d.totalOutputTokens, cliEnabled: d.cliEnabled});
  }
  credit(d: MemoryQuotaDevice, questions: number, kind: LotKind, sourceRef?:string): void {
    const state = this.state(d); state.lots.push(newLot(kind,questions,sourceRef)); state.version++;
    d.balanceQuestions += questions; d.updatedAt = new Date().toISOString();
  }
  refundPolicy(deviceId:number,reference:string,policy:RefundPolicy):void {
    const d=this.devices.get(deviceId); if(!d) throw new Error('Unknown payment device');
    const state=this.state(d),lot=state.lots.find(l=>l.sourceRef===reference);
    if(!lot) throw new Error('Payment quota source missing');
    const before=JSON.stringify(lot),change=applyLotPolicy(lot,policy.frozen,policy.revokeTarget);
    if(change.revokedDelta)lot.revocations.push({at:new Date().toISOString(),delta:change.revokedDelta});
    if(before!==JSON.stringify(lot)) {d.balanceQuestions+=change.availableDelta;state.version++;d.updatedAt=new Date().toISOString();}
  }
  async creditDevice(deviceId:number,input:{questions:number;amountCents:number;currency:string;provider:string;reference:string;note?:string}):Promise<number|null> {
    const d=this.devices.get(deviceId); if(!d) return null; validQuestions(input.questions); return (this.credit(d,input.questions,input.amountCents>0?'paid':'goodwill'),d.balanceQuestions);
  }
  async capture(token: string, captureId: string): Promise<CaptureRecord | null> {
    const d = this.lookup(token);
    return d ? this.captureFor(d, captureId) : null;
  }
  private captureFor(d: MemoryQuotaDevice, captureId: string): CaptureRecord | null {
    const record = this.state(d).captures.get(captureId)?.record;
    if (record && Date.now() - Date.parse(record.createdAt) >= 900_000 && (record.answerHmac !== null || record.sealedAnswer)) {
      record.answerHmac = null; delete record.sealedAnswer;
    }
    return record ? { ...record } : null;
  }
  async begin(input: BeginCapture): Promise<BeginResult> {
    return this.beginCapture(input);
  }
  async heartbeat(token:string,id:string,owner:string,now=Date.now()):Promise<boolean> {
    const d=this.lookup(token),c=d?this.state(d).captures.get(id)?.record:null;
    if(!c||c.settlementStatus!=='held'||c.deliveryOwner!==owner||Date.parse(c.expiresAt)<=now)return false;
    c.workerAliveUntil=now+8000;return true;
  }
  async beginWithAttempt(input: BeginCapture, attempt: NewAttempt): Promise<BeginResult> {
    assertAttemptBinding(input, attempt);
    // Validate uniqueness only after capture admission succeeds, but before changing quota.
    // Both writes occur without await; rejected duplicates retain the ordinary begin result.
    const d=this.lookup(input.token),previous=d?this.state(d).captures.get(input.captureId)?.record:null;
    if(d&&(this.canceled.get(d.id+':'+input.captureId)??0)<=Date.now()&&previous?.deliveryOwner&&input.deliveryRecovery&&previous.requestHmac===input.requestHmac&&previous.settlementStatus==='held'
      &&(previous.workerAliveUntil??Infinity)<Date.now()&&Date.parse(previous.expiresAt)>Date.now()){
      const attempts=[...this.state(d).attempts.values()].filter(a=>a.captureId===input.captureId);
      if(attempts.length<2){
        for(const a of attempts){this.finishAttemptFor(d,a.attemptId,{status:'unknown',inputTokens:null,outputTokens:null,costMicros:null});this.settleBudgetFor(d,a.attemptId,null);
          const lease=this.capacity.get(a.attemptId);if(lease)lease.active=false;}
        previous.deliveryOwner=input.requestId;previous.workerAliveUntil=Date.now()+8000;
        if(!this.startAttemptNow(input.token,attempt))throw Error('Recovery attempt unavailable');
        return {ok:true,capture:{...previous},quota:this.snapshot(d)};
      }
    }
    const result = this.beginCapture(input, () => {
      if ([...this.states.values()].some(state => state.attempts.has(attempt.attemptId))) throw new Error('Attempt already exists');
    });
    if (result.ok && !this.startAttemptNow(input.token, attempt)) throw new Error('Attempt could not start');
    if(result.ok&&d)return {...result,capture:this.captureFor(d,input.captureId)!};
    return result;
  }
  private beginCapture(input: BeginCapture, beforeCommit?: () => void): BeginResult {
    const d = this.lookup(input.token); if (!d) return { ok: false, reason: 'unknown_token' };
    if(input.deliveryRecovery&&(this.canceled.get(d.id+':'+input.captureId)??0)>Date.now())return {ok:false,reason:'capture_already_finalized'};
    this.syncFreeTrial(d);
    const state = this.state(d), previous = state.captures.get(input.captureId);
    if (previous) return duplicateCapture(previous.record,input);
    if (input.exclusive && [...state.captures.values()].some(c => c.record.settlementStatus === 'held')) return { ok: false, reason: 'device_busy' };
    if (input.operation && input.operation !== 'solve') {
      const parent = input.parentCaptureId ? state.captures.get(input.parentCaptureId)?.record : null;
      if (!parent || parent.operation !== 'solve' || parent.settlementStatus !== 'settled' || !parent.usableResult ||
          Date.now() - Date.parse(parent.createdAt) >= 900_000) return { ok: false, reason: 'idempotency_conflict' };
      if (input.answerCaptureId && input.answerCaptureId !== parent.captureId) {
        const answer = state.captures.get(input.answerCaptureId)?.record;
        if (input.operation !== 'explain' || !answer || !isRecoveredAnswerFor(parent, answer)) {
          return {ok: false, reason: 'idempotency_conflict'};
        }
      }
      const property = input.operation === 'explain' ? 'explanationCaptureId' : 'recoveryCaptureId';
      if (parent[property]) return { ok: false, reason: 'capture_already_finalized' };
      beforeCommit?.();
      const record = newCapture(input);
      parent[property] = record.captureId;
      state.captures.set(record.captureId,{record,lot:newLot('trial',0),legacy:false});
      return {ok:true,capture:{...record},quota:this.snapshot(d)};
    }
    if (d.balanceQuestions < 1) return { ok: false, reason: 'insufficient_quota' };
    const priority: LotKind[] = ['trial','legacy_unknown','goodwill','paid'];
    const available = state.lots.filter(l => !l.frozen && l.remaining>l.held && (input.allowPurchasedCredits !== false || l.kind !== 'paid' || l.sourceRef?.startsWith('plus_daily:')));
    const rank = (l:Lot) => l.kind==='trial'?0:l.sourceRef?.startsWith('plus_daily:')?1:priority.indexOf(l.kind)+2;
    const lot = available.sort((a,b)=>rank(a)-rank(b))[0];
    if (!lot) return {ok:false,reason:'paid_credits_disabled'};
    beforeCommit?.();
    const record = newCapture(input);
    state.captures.set(record.captureId,{record,lot,legacy:input.legacy??false});
    lot.held++; d.balanceQuestions--; state.version++; d.updatedAt=record.createdAt;
    return { ok:true,capture:{...record},quota:this.snapshot(d) };
  }
  private finishDevice(d: MemoryQuotaDevice, input: FinishCapture): void {
    const state=this.state(d);
    const capture = input.captureId ? state.captures.get(input.captureId)
      : [...state.captures.values()].find(c => c.legacy && c.record.settlementStatus==='held');
    if (!capture || capture.record.settlementStatus!=='held' || (input.owner&&capture.record.deliveryOwner!==input.owner)) return;
    if (capture.record.operation !== 'solve') {
      capture.record.settlementStatus = 'released'; capture.record.terminalState = input.terminalState;
      capture.record.finishedAt = new Date().toISOString();
      capture.record.terminalReason = input.terminalReason ?? null;
      capture.record.usableResult = input.terminalState === 'usable';
      capture.record.answerHmac = capture.record.usableResult ? input.answerHmac ?? null : null;
      capture.record.sealedAnswer = input.sealedAnswer;
      capture.record.resultState = input.resultState ?? null; capture.record.questionKind = input.questionKind ?? null;
      capture.record.parserPath = input.parserPath ?? null;
      if (capture.record.operation === 'recover' && input.compensateGoodwill && capture.record.parentCaptureId) {
        this.credit(d, 1, 'goodwill');
      }
      return;
    }
    const now=new Date().toISOString(), charge=input.charge && capture.record.expiresAt>now;
    capture.record={...capture.record,settlementStatus:charge?'settled':'released',
      terminalState:input.charge&&!charge?'failed':input.terminalState,usableResult:charge&&input.terminalState==='usable',
      sealedAnswer:input.sealedAnswer,answerHmac:charge?input.answerHmac??null:null,resultState:input.resultState??null,
      questionKind:input.questionKind??null,parserPath:input.parserPath??null,
      terminalReason:input.terminalReason??null,finishedAt:now};
    capture.lot.held--; if(charge) { capture.lot.remaining--; d.totalQuestions++; } else if(!capture.lot.frozen) d.balanceQuestions++;
    const refundChange=applyLotPolicy(capture.lot,capture.lot.frozen,capture.lot.target);
    if(refundChange.revokedDelta)capture.lot.revocations.push({at:now,delta:refundChange.revokedDelta});
    d.balanceQuestions+=refundChange.availableDelta;
    state.version++; d.totalInputTokens+=input.inputTokens??0; d.totalOutputTokens+=input.outputTokens??0; d.updatedAt=now;
    this.usage({deviceId:d.id,captureId:input.usageCaptureId??capture.record.captureId,inputTokens:input.inputTokens??0,
      outputTokens:input.outputTokens??0,questions:charge?1:0,estimatedCostMicros:input.estimatedCostMicros??null,createdAt:now});
  }
  async finish(input:FinishCapture):Promise<AccountSnapshot|null> {
    const d=this.lookup(input.token); if(!d) return null;
    this.finishDevice(d,input); return this.accountFor(d);
  }
  async finishWithCapture(input: FinishCapture & {captureId: string}): Promise<CaptureSettlement | null> {
    const d = this.lookup(input.token); if (!d) return null;
    if(input.attemptSettlement){const a=input.attemptSettlement;
      this.finishAttemptFor(d,a.id,a.result);this.settleBudgetFor(d,a.id,a.actual,a.anomaly);
    }
    // No await: settlement and both snapshots are copied before another operation can run.
    this.finishDevice(d, input);
    return {account: this.accountFor(d), capture: this.captureFor(d, input.captureId)};
  }
  async reap(now=new Date().toISOString()):Promise<number> {
    let count=0;
    for(const [key,expiry] of this.canceled)if(expiry<=Date.parse(now))this.canceled.delete(key);
    for(const [id,state] of this.states) for(const {record} of state.captures.values()) {
      if(count>=100) break;
      if(record.settlementStatus==='held' && record.expiresAt<=now) {
        this.finishDevice(this.devices.get(id)!,{token:'',captureId:record.captureId,charge:false,terminalState:'failed',
          terminalReason:'lease_expired',compensateGoodwill:record.operation==='recover'}); count++;
      }
    }
    for (const [deviceId,state] of this.states) {
      for (const attempt of state.attempts.values()) {
        if (attempt.status === 'running') {
          const capture = state.captures.get(attempt.captureId)?.record;
          if (capture && capture.expiresAt <= now) {
            this.settleBudgetFor(this.devices.get(deviceId)!,attempt.attemptId,null);
            attempt.status = 'unknown'; attempt.inputTokens = null; attempt.outputTokens = null; attempt.costMicros = null; attempt.finishedAt = now;
          }
        }
      }
    }
    for (const [id,hold] of this.budgetHolds) {
      if (hold.state==='held' && hold.createdAt<=Date.parse(now)-BUDGET_POLICY.orphanMs) {
        const d=this.devices.get(hold.deviceId); if (d) this.settleBudgetFor(d,id,null);
      }
    }
    for(const [key,bucket] of this.buckets) if(bucket.end<Date.parse(now)) this.buckets.delete(key);
    return count;
  }
  async startAttempt(token:string,input:Omit<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'|'startedAt'|'finishedAt'>):Promise<boolean> {
    return this.startAttemptNow(token, input);
  }
  private startAttemptNow(token: string, input: NewAttempt): boolean {
    const d=this.lookup(token); if(!d) return false;
    const state=this.state(d),capture=state.captures.get(input.captureId);
    if(!capture || capture.record.settlementStatus!=='held' || state.attempts.has(input.attemptId) || [...state.attempts.values()].filter(a=>a.captureId===input.captureId).length>=2 || [...state.attempts.values()].some(a=>a.captureId===input.captureId&&!['failed','unknown'].includes(a.status))) return false;
    if(capture.record.deliveryOwner){capture.record.workerAttemptId=input.attemptId;capture.record.deliveryAttempts=(capture.record.deliveryAttempts??0)+1;}
    state.attempts.set(input.attemptId,{...input,status:'running',inputTokens:null,outputTokens:null,costMicros:null,startedAt:new Date().toISOString(),finishedAt:null}); return true;
  }
  async finishAttempt(token:string,id:string,input:Pick<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'>):Promise<void> {
    const d=this.lookup(token); if(!d) return;
    this.finishAttemptFor(d, id, input);
  }
  private finishAttemptFor(d: MemoryQuotaDevice, id: string, input: Pick<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'>): void {
    const state=this.state(d),old=state.attempts.get(id);
    if(old?.status==='running') state.attempts.set(id,{...old,...input,finishedAt:new Date().toISOString()});
  }
  async finishAttemptAndBudget(token: string, attemptId: string, input: Pick<Attempt,'status'|'inputTokens'|'outputTokens'|'costMicros'>, actualMicros: number | null, anomaly = false): Promise<void> {
    const d=this.lookup(token); if(!d) return;
    // Both writes finish in the same synchronous turn, matching the SQL transaction.
    this.finishAttemptFor(d, attemptId, input);
    this.settleBudgetFor(d, attemptId, actualMicros, anomaly);
  }
  async reserveBudget(token:string,attemptId:string,scope:string,currency:string,reservedUpperMicros:number,limitMicros:number,windowMs=86_400_000,now=Date.now(),utcOffsetMinutes=0,guarded=false,channel='default'):Promise<boolean> {
    const d = this.lookup(token); if (!d) return false;
    this.devices.set(d.id,d);
    if (limitMicros<=0 || reservedUpperMicros<=0) return true;
    const offset=utcOffsetMinutes*60_000,start=Math.floor((now+offset)/windowMs)*windowMs-offset;
    const key=`${scope}:${start}:${currency}`,existing=this.budgetHolds.get(attemptId);
    if (existing) return existing.deviceId===d.id && (existing.state==='held'||existing.state==='settled');
    const guardKey=`${scope}:${currency}`;
    const channelKey=JSON.stringify([scope,currency,channel]);
    const control=this.controls.get(channelKey)??emptyControl(channelKey);
    if (guarded && control.blockedUntil===-1) throw new BudgetAdmissionError('guard_tripped');
    if (guarded && control.blockedUntil>now) throw new BudgetAdmissionError('cooldown',Math.max(1,Math.ceil((control.blockedUntil-now)/1000)));
    const budget=this.budgets.get(key)??{scope,currency,start,limit:limitMicros,spent:0,held:0,end:start+windowMs};
    if (budget.spent+budget.held+reservedUpperMicros+(guarded?Math.ceil(budget.limit*0.2):0)>budget.limit) return false;
    if (guarded) {
      if (control.blockedUntil>0) { control.probe=attemptId;control.blockedUntil=now+BUDGET_POLICY.probeMs; }
      this.controls.set(channelKey,control);this.guardedHolds.set(attemptId,channelKey);
    }
    this.accounting.set(attemptId,{attemptId,channel:channelKey,reserved:reservedUpperMicros,booked:0,actual:null,state:'pending',evidence:null,updatedAt:now});
    budget.held+=reservedUpperMicros; this.budgets.set(key,budget); this.budgetHolds.set(attemptId,{deviceId:d.id,key,group:guardKey,reserved:reservedUpperMicros,createdAt:now,state:'held'}); return true;
  }
  async releaseBudget(token:string,attemptId:string):Promise<void> {
    const d=this.lookup(token); if (!d) return; const hold=this.budgetHolds.get(attemptId); if (!hold||hold.deviceId!==d.id||hold.state!=='held') return;
    const budget=this.budgets.get(hold.key); if (budget) budget.held=Math.max(0,budget.held-hold.reserved); hold.state='released';
    const a=this.accounting.get(attemptId);if(a){a.state='released';a.actual=0;a.booked=0;a.updatedAt=Date.now();
      const c=this.controls.get(a.channel);if(c?.probe===attemptId){c.probe=null;c.blockedUntil=Date.now()+BUDGET_POLICY.cooldownMs;}}

  }
  async settleBudget(token:string,attemptId:string,actualMicros:number|null,anomaly=false):Promise<void> {
    const d=this.lookup(token); if (!d) return;
    this.settleBudgetFor(d, attemptId, actualMicros, anomaly);
  }
  private settleBudgetFor(d: MemoryQuotaDevice, attemptId: string, actualMicros: number | null, anomaly = false): void {
    const hold=this.budgetHolds.get(attemptId); if (!hold||hold.deviceId!==d.id||hold.state!=='held') return;
    const budget=this.budgets.get(hold.key); if (!budget) return;
    const observed=validCost(actualMicros)&&!anomaly, actual=observed?actualMicros!:hold.reserved;
    const channel=this.guardedHolds.get(attemptId);
    if(channel) this.controls.set(channel,budgetOutcome(this.controls.get(channel)??emptyControl(channel),attemptId,hold.reserved,actualMicros,anomaly,Date.now()));
    const a=this.accounting.get(attemptId)!;
    a.booked=actual;a.actual=observed?actual:null;a.state=observed?'observed':'provisional';a.updatedAt=Date.now();
    budget.held-=hold.reserved; budget.spent+=actual; hold.state='settled';
  }
  async inspectBudget(): Promise<BudgetInspection> {
    const recent=new Map<string,number>();
    for(const [id,h] of this.budgetHolds){const b=this.budgets.get(h.key);if(b?.scope==='official'&&h.createdAt>=Date.now()-3600000)recent.set(b.currency,(recent.get(b.currency)??0)+(this.accounting.get(id)?.booked??0));}
    return {recentSpend:[...recent].map(([currency,micros])=>({currency,micros})),controls:[...this.controls.values()].map(c=>({...c})),provisional:[...this.accounting.values()]
      .filter(a=>a.state==='provisional').sort((a,b)=>a.updatedAt-b.updatedAt).slice(0,200).map(a=>({...a})),
      windows:[...this.budgets.values()].filter(b=>b.start<=Date.now()&&b.end>Date.now()).map(b=>({scope:b.scope,currency:b.currency,
        start:new Date(b.start).toISOString(),expiresAt:new Date(b.end).toISOString(),limit:b.limit,spent:b.spent,held:b.held}))};
  }
  async reconcileBudget(attemptId: string, actualMicros: number, evidence: string): Promise<boolean> {
    validateReconciliation(actualMicros,evidence);
    const a=this.accounting.get(attemptId),hold=this.budgetHolds.get(attemptId);if(!a||!hold)return false;
    if(a.state==='reconciled')return a.actual===actualMicros&&a.evidence===evidence;
    if(a.state!=='provisional')return false;
    const c=this.controls.get(a.channel);
    if(c&&actualMicros>a.reserved)this.controls.set(a.channel,budgetOutcome(c,attemptId,a.reserved,actualMicros,false,Date.now()));
    this.budgets.get(hold.key)!.spent+=actualMicros-a.booked;
    a.booked=actualMicros;a.actual=actualMicros;a.state='reconciled';a.evidence=evidence;a.updatedAt=Date.now();return true;
  }
  async resetBudgetControl(channel: string, evidence: string): Promise<boolean> {
    validateReconciliation(0,evidence);
    const c=this.controls.get(channel);if(!c)return false;
    const previous=this.controlResets.get(evidence);if(previous)return previous.channel===channel;
    this.controlResets.set(evidence,{channel,previous:{...c}});this.controls.set(channel,emptyControl(channel));return true;
  }
  async attempts(token:string):Promise<Attempt[]> {
    const d=this.lookup(token); return d?[...this.state(d).attempts.values()].map(a=>({...a})):[];
  }
  adminTraffic() {
    const requests:import('./admin-store.ts').AdminRequest[]=[],attempts:Array<Attempt & {deviceId:number;requestAt:string}>=[];
    for(const [deviceId,state] of this.states){
      for(const {record:r} of state.captures.values())requests.push({id:r.requestId,deviceId,createdAt:r.createdAt,finishedAt:r.finishedAt,
        state:r.terminalState,operation:r.operation,error:r.terminalReason,latencyMs:r.finishedAt?Math.max(0,Date.parse(r.finishedAt)-Date.parse(r.createdAt)):null});
      for(const a of state.attempts.values()){const c=state.captures.get(a.captureId);if(c)attempts.push({...a,deviceId,requestAt:c.record.createdAt});}
    }
    return {requests,attempts};
  }
  report(ids:Set<number>,asOf:string):{captures:ReportCapture[];attempts:ReportAttempt[];lots:ReportLot[];policies:Map<number,string>} {
    const captures:ReportCapture[]=[],attempts:ReportAttempt[]=[],lots:ReportLot[]=[],policies=new Map<number,string>();
    for(const [id,state] of this.states){
      if(!ids.has(id))continue;policies.set(id,state.policy);
      const rows=[...state.captures.values()].filter(c=>c.record.createdAt<=asOf);
      for(const c of rows)captures.push({deviceId:id,quotaKind:c.record.operation==='solve'?c.lot.kind:null,record:reportCapture(c.record,asOf)});
      for(const a of state.attempts.values())if(a.startedAt<=asOf){
        const finished=a.finishedAt!==null&&a.finishedAt<=asOf,hold=this.budgetHolds.get(a.attemptId);
        const accounting=this.accounting.get(a.attemptId);
        const reconciled=accounting?.state==='reconciled'&&accounting.updatedAt<=Date.parse(asOf);
        attempts.push({id:a.attemptId,deviceId:id,captureId:a.captureId,purpose:a.purpose,currency:a.currency,
          costMicros:reconciled?String(accounting.actual):finished?a.costMicros:null,upperMicros:hold?String(hold.reserved):null,
          revision:reconciled?'3':finished?'2':'1',pricingVersion:a.pricingVersion,
          startedAt:a.startedAt,calculatedAt:reconciled?new Date(accounting.updatedAt).toISOString():finished?a.finishedAt!:a.startedAt,status:finished?a.status:'running'});
      }
      for(const l of state.lots)if(l.createdAt<=asOf){
        const related=rows.filter(c=>c.lot===l&&c.record.operation==='solve');
        const consumed=related.filter(c=>c.record.settlementStatus==='settled'&&c.record.finishedAt!==null&&c.record.finishedAt<=asOf).length;
        const held=related.filter(c=>c.record.finishedAt===null||c.record.finishedAt>asOf).length;
        const revoked=l.revocations.filter(r=>r.at<=asOf).reduce((s,r)=>s+r.delta,0);
        lots.push({id:l.id,deviceId:id,kind:l.kind,granted:String(l.granted),remaining:String(l.granted-consumed-revoked),held:String(held),revoked:String(revoked),
          createdAt:l.createdAt,sourceRef:l.sourceRef??(l.kind==='trial'?'initial_trial':'opening_balance')});
      }
    }
    return {captures,attempts,lots,policies};
  }
  async rateLimit(scope:string,limit:number,windowMs:number,now=Date.now()):Promise<boolean> {
    if(limit<=0) return true;
    const start=Math.floor(now/windowMs)*windowMs,key=scope+':'+start;
    const bucket=this.buckets.get(key)??{count:0,end:start+windowMs}; bucket.count++; this.buckets.set(key,bucket); return bucket.count<=limit;
  }
}
