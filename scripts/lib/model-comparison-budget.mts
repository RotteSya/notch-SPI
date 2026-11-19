import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {estimateModelCostMicros} from '../../server/src/telemetry.ts';
import {tokenCostUpperMicros} from './evaluation-budget.mts';

export const MODEL_IDS = ['gpt-6-astra', 'gpt-6.1-terra', 'deepseek-flash'] as const;
export type ModelID = typeof MODEL_IDS[number];
export interface ComparisonModel {
  id: ModelID;
  rate: {inputMicrosPerMillion: number; outputMicrosPerMillion: number};
  reserveRate?: {inputMicrosPerMillion: number; outputMicrosPerMillion: number};
  bounds: {inputTokens: number; outputTokens: number};
}
export interface ComparisonUsage {
  inputTokens: number | null; outputTokens: number | null;
  details?: {cachedInputTokens:number|null;cacheWriteInputTokens:number|null;reasoningOutputTokens:number|null;cacheHitTokens:number|null;cacheMissTokens:number|null};
}
export type AttemptPurpose = 'answer' | 'retry' | 'recover' | 'fallback';
export interface ComparisonPhasePolicy {
  id:string; limitMicros:number; freezeSHA256:string; authorizationSHA256:string;
  baseOccupiedMicros:number; historicalDigest:string; maxPhysicalCalls:number;
  trials:Array<{key:string;model:ModelID}>;
}
export interface ComparisonBudgetSnapshot {
  currency: 'USD'; limitMicros: number; reservedMicros: number; remainingMicros: number;
  knownMeteredMicros: number; unknownAttempts: number; halted: boolean;
  activeHoldMicros: number; settledConservativeMicros: number; occupiedMicros: number;
}

function positive(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Budget values must be positive safe integers');
}
function identifier(value: string): void {
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(value)) throw new Error('Invalid local evaluation identifier');
}
export function modelCallUpperMicros(model: ComparisonModel): number {
  if (!MODEL_IDS.includes(model.id)) throw new Error('Unsupported comparison model');
  [model.bounds.inputTokens, model.bounds.outputTokens,
    model.rate.inputMicrosPerMillion, model.rate.outputMicrosPerMillion].forEach(positive);
  const reserve = model.reserveRate ?? model.rate;
  [reserve.inputMicrosPerMillion, reserve.outputMicrosPerMillion].forEach(positive);
  if (reserve.inputMicrosPerMillion < model.rate.inputMicrosPerMillion || reserve.outputMicrosPerMillion < model.rate.outputMicrosPerMillion) {
    throw new Error('Reservation rates cannot be lower than estimated rates');
  }
  return tokenCostUpperMicros(model.bounds.inputTokens, model.bounds.outputTokens,
    reserve.inputMicrosPerMillion, reserve.outputMicrosPerMillion);
}

/** USD-only offline ledger. It never opens credentials or invokes EvaluationBudget.fetchText.
 * The original evaluation ledger is CNY-specific, so its tables and audit history stay untouched.
 * Reservations use the same integer cost-bound helper; usage uses the production cost estimator.
 * Observing usage alone never releases a hold. Rolling campaigns require explicit terminal
 * receipt settlement; timeout, interrupted process and missing usage retain their holds.
 */
export class ComparisonBudget {
  private readonly db: DatabaseSync;
  private readonly campaignId: string;
  private readonly models: Map<ModelID, ComparisonModel>;
  private readonly rolling: boolean;

  constructor(path: string, policy: {campaignId: string; limitMicros: number; rolling?: boolean}, models: ComparisonModel[]) {
    identifier(policy.campaignId); positive(policy.limitMicros);
    if (!models.length || new Set(models.map(m => m.id)).size !== models.length) throw new Error('Duplicate or empty model catalog');
    models.forEach(modelCallUpperMicros);
    this.models = new Map(models.map(m => [m.id, structuredClone(m)]));
    this.campaignId = policy.campaignId;
    this.rolling = policy.rolling === true;
    const catalogHash = createHash('sha256').update(JSON.stringify({models:[...this.models.values()],rolling:this.rolling})).digest('hex');
    mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS comparison_campaigns (
          id TEXT PRIMARY KEY, currency TEXT NOT NULL CHECK(currency='USD'),
          limit_micros INTEGER NOT NULL, catalog_sha256 TEXT NOT NULL, halted INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS comparison_attempts (
          id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, logical_id TEXT NOT NULL, model TEXT NOT NULL,
          purpose TEXT NOT NULL, reserved_micros INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
          metered_micros INTEGER, created_at TEXT NOT NULL);`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS comparison_settlements (
        attempt_id TEXT PRIMARY KEY, charged_upper_micros INTEGER NOT NULL);`);
      const other = this.db.prepare('SELECT id FROM comparison_campaigns WHERE id<>?').get(policy.campaignId);
      if (other) throw new Error('A different campaign cannot reuse or reset this ledger');
      this.db.prepare(`INSERT INTO comparison_campaigns(id,currency,limit_micros,catalog_sha256)
        VALUES (?,'USD',?,?) ON CONFLICT(id) DO NOTHING`).run(policy.campaignId, policy.limitMicros, catalogHash);
      const row = this.db.prepare('SELECT limit_micros,catalog_sha256 FROM comparison_campaigns WHERE id=?').get(policy.campaignId)!;
      if (row.limit_micros !== policy.limitMicros || row.catalog_sha256 !== catalogHash) {
        throw new Error('Existing comparison campaign cap and model bounds cannot be changed');
      }
    } catch (error) {this.db.close(); throw error;}
  }

  reserve(id: string, logicalId: string, model: ModelID, purpose: AttemptPurpose, scope?:{phaseId:string;trialKey:string}): number {
    identifier(id); identifier(logicalId);
    const candidate = this.models.get(model);
    if (!candidate || !['answer','retry','recover','fallback'].includes(purpose)) throw new Error('Unknown comparison attempt');
    const upper = modelCallUpperMicros(candidate);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.snapshot();
      if (state.halted) throw new Error('Comparison campaign halted');
      if (state.remainingMicros < upper) throw new Error('Comparison budget exhausted');
      const hasPhases=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='comparison_phases'").get();
      if(hasPhases&&this.db.prepare('SELECT id FROM comparison_phases LIMIT 1').get()){
        if(!scope)throw new Error('Phase authorization required');
        const phase=this.phaseSnapshot(scope.phaseId), policy=phase.policy;
        if(phase.stopped||phase.remainingMicros<upper||phase.physicalCalls>=policy.maxPhysicalCalls
          ||phase.unknownAttempts>=3||phase.consecutiveFailures>=3)throw new Error('Phase gate stopped dispatch');
        const trial=policy.trials.find(t=>t.key===scope.trialKey);
        const claim=this.db.prepare('SELECT result_json FROM comparison_phase_trials WHERE phase_id=? AND trial_key=?').get(scope.phaseId,scope.trialKey);
        if(!trial||trial.model!==model||!claim||claim.result_json!==null)throw new Error('Unclaimed or completed trial');
        const prior=this.db.prepare('SELECT receipt_json FROM comparison_phase_attempts WHERE phase_id=? AND trial_key=? ORDER BY rowid').all(scope.phaseId,scope.trialKey);
        if(prior.length>=2||purpose!==(prior.length?'retry':'answer')||prior.some(p=>p.receipt_json===null))throw new Error('Duplicate or invalid phase attempt');
        if(prior.length&&!['startup_timeout','http_transient','network_error','incomplete_stream'].includes(JSON.parse(prior[0]!.receipt_json as string).failure))throw new Error('Nonretryable phase attempt');
        if(this.db.prepare('SELECT attempt_id FROM comparison_phase_attempts WHERE phase_id=? AND receipt_json IS NULL').get(scope.phaseId))throw new Error('Unreconciled phase attempt');
        this.db.prepare('INSERT INTO comparison_phase_attempts(attempt_id,phase_id,trial_key) VALUES (?,?,?)').run(id,scope.phaseId,scope.trialKey);
      }else if(scope)throw new Error('Phase not registered');
      this.db.prepare(`INSERT INTO comparison_attempts
        (id,campaign_id,logical_id,model,purpose,reserved_micros,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, this.campaignId, logicalId, model, purpose, upper, new Date().toISOString());
      this.db.exec('COMMIT');
      return upper;
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }

  historyDigest():string {
    return createHash('sha256').update(JSON.stringify({
      attempts:this.db.prepare('SELECT * FROM comparison_attempts ORDER BY rowid').all(),
      settlements:this.db.prepare('SELECT * FROM comparison_settlements ORDER BY rowid').all(),
    })).digest('hex');
  }

  registerPhase(policy:ComparisonPhasePolicy):void {
    identifier(policy.id);positive(policy.limitMicros);positive(policy.maxPhysicalCalls);
    if(![policy.freezeSHA256,policy.authorizationSHA256,policy.historicalDigest].every(s=>/^[a-f0-9]{64}$/u.test(s))
      ||!Number.isSafeInteger(policy.baseOccupiedMicros)||policy.baseOccupiedMicros<0
      ||!policy.trials.length||new Set(policy.trials.map(t=>t.key)).size!==policy.trials.length)throw new Error('Invalid phase policy');
    policy.trials.forEach(t=>{identifier(t.key);if(!this.models.has(t.model))throw new Error('Unknown phase model');});
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.exec(`CREATE TABLE IF NOT EXISTS comparison_phases(id TEXT PRIMARY KEY,policy_json TEXT NOT NULL,stopped TEXT);
        CREATE TABLE IF NOT EXISTS comparison_phase_trials(phase_id TEXT NOT NULL,trial_key TEXT NOT NULL,result_json TEXT,PRIMARY KEY(phase_id,trial_key));
        CREATE TABLE IF NOT EXISTS comparison_phase_attempts(attempt_id TEXT PRIMARY KEY,phase_id TEXT NOT NULL,trial_key TEXT NOT NULL,receipt_json TEXT);`);
      const existing=this.db.prepare('SELECT * FROM comparison_phases LIMIT 1').get();
      if(existing){
        if(existing.id!==policy.id||existing.policy_json!==JSON.stringify(policy))throw new Error('Existing phase cannot be reset or replaced');
      }else{
        const state=this.snapshot();
        if(state.occupiedMicros!==policy.baseOccupiedMicros||this.historyDigest()!==policy.historicalDigest
          ||state.activeHoldMicros||state.unknownAttempts||state.halted)throw new Error('Historical checkpoint mismatch');
        this.db.prepare('INSERT INTO comparison_phases(id,policy_json) VALUES (?,?)').run(policy.id,JSON.stringify(policy));
      }
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }

  phaseSnapshot(id:string) {
    const row=this.db.prepare('SELECT * FROM comparison_phases WHERE id=?').get(id);
    if(!row)throw new Error('Unknown phase');
    const policy=JSON.parse(row.policy_json as string) as ComparisonPhasePolicy;
    const entries=this.db.prepare(`SELECT p.*,a.metered_micros,a.reserved_micros,s.charged_upper_micros FROM comparison_phase_attempts p
      JOIN comparison_attempts a ON a.id=p.attempt_id LEFT JOIN comparison_settlements s ON s.attempt_id=a.id
      WHERE p.phase_id=? ORDER BY p.rowid`).all(id);
    const occupied=entries.reduce((s,x)=>s+Number(x.charged_upper_micros??x.reserved_micros),0);
    const unknown=entries.filter(x=>x.charged_upper_micros===null).length;
    let failures=0;
    for(const e of entries){const r=e.receipt_json?JSON.parse(e.receipt_json as string):null;failures=!r||r.failure||r.phaseFailure?failures+1:0;}
    const parent=this.snapshot();
    return {policy,stopped:row.stopped as string|null,physicalCalls:entries.length,occupiedMicros:occupied,
      knownMeteredMicros:entries.reduce((s,x)=>s+Number(x.metered_micros??0),0),unknownAttempts:Math.max(unknown,parent.unknownAttempts),
      consecutiveFailures:failures,remainingMicros:row.stopped?0:Math.max(0,Math.min(policy.limitMicros-occupied,
        policy.baseOccupiedMicros+policy.limitMicros-parent.occupiedMicros,parent.remainingMicros))};
  }

  claimPhaseTrial(id:string,key:string):void {
    const s=this.phaseSnapshot(id);
    if(s.stopped||!s.policy.trials.some(t=>t.key===key))throw new Error('Phase not available');
    if(this.db.prepare('SELECT trial_key FROM comparison_phase_trials WHERE phase_id=? AND result_json IS NULL').get(id))throw new Error('Unresolved prior trial');
    this.db.prepare('INSERT INTO comparison_phase_trials(phase_id,trial_key) VALUES (?,?)').run(id,key);
  }
  recordPhaseAttempt(id:string,receipt:unknown):void {
    const r=this.db.prepare('UPDATE comparison_phase_attempts SET receipt_json=? WHERE attempt_id=? AND receipt_json IS NULL').run(JSON.stringify(receipt),id);
    if(r.changes!==1)throw new Error('Duplicate or unknown phase receipt');
  }
  completePhaseTrial(id:string,key:string,result:unknown):void {
    const r=this.db.prepare('UPDATE comparison_phase_trials SET result_json=? WHERE phase_id=? AND trial_key=? AND result_json IS NULL').run(JSON.stringify(result),id,key);
    if(r.changes!==1)throw new Error('Duplicate or unknown phase result');
  }
  phaseRecords(id:string) {
    return {attempts:this.db.prepare('SELECT * FROM comparison_phase_attempts WHERE phase_id=? ORDER BY rowid').all(id),
      trials:this.db.prepare('SELECT * FROM comparison_phase_trials WHERE phase_id=? ORDER BY rowid').all(id)};
  }
  stopPhase(id:string,reason:string):void {
    identifier(reason);this.db.prepare('UPDATE comparison_phases SET stopped=COALESCE(stopped,?) WHERE id=?').run(reason,id);
  }

  assertModel(model: ComparisonModel): void {
    if (JSON.stringify(this.models.get(model.id)) !== JSON.stringify(model)) {
      throw new Error('Execution model rates or limits differ from the budget catalog');
    }
  }

  observe(id: string, usage: ComparisonUsage | null): number | null {
    const row = this.db.prepare('SELECT * FROM comparison_attempts WHERE id=? AND campaign_id=?').get(id, this.campaignId);
    if (!row) throw new Error('Unknown comparison dispatch');
    if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)
      || usage.inputTokens! < 0 || usage.outputTokens! < 0 || usage.inputTokens! + usage.outputTokens! === 0) return null;
    const model = this.models.get(row.model as ModelID)!;
    const pricing = JSON.stringify([{model: model.id,
      input_micros_per_million_tokens: model.rate.inputMicrosPerMillion,
      output_micros_per_million_tokens: model.rate.outputMicrosPerMillion}]);
    const cost = estimateModelCostMicros(pricing, model.id, usage.inputTokens!, usage.outputTokens!)!;
    const conflict = row.input_tokens !== null && (row.input_tokens !== usage.inputTokens || row.output_tokens !== usage.outputTokens);
    const exceeded = usage.inputTokens! > model.bounds.inputTokens || usage.outputTokens! > model.bounds.outputTokens
      || !Number.isSafeInteger(cost) || cost > Number(row.reserved_micros);
    if (conflict || exceeded) {
      // Retain the first actual token evidence even if it disproves the proposed upper bound.
      if (!conflict && Number.isSafeInteger(cost)) {
        this.db.prepare('UPDATE comparison_attempts SET input_tokens=?,output_tokens=?,metered_micros=? WHERE id=?')
          .run(usage.inputTokens, usage.outputTokens, cost, id);
      }
      this.db.prepare('UPDATE comparison_campaigns SET halted=1 WHERE id=?').run(this.campaignId);
      throw new Error(conflict ? 'Conflicting comparison usage; campaign halted' : 'Comparison cost bound violated; campaign halted');
    }
    this.db.prepare('UPDATE comparison_attempts SET input_tokens=?,output_tokens=?,metered_micros=? WHERE id=?')
      .run(usage.inputTokens, usage.outputTokens, cost, id);
    return cost;
  }

  attemptEvidence(id: string): {usage: ComparisonUsage | null; costMicros: number | null} {
    const row = this.db.prepare('SELECT input_tokens,output_tokens,metered_micros FROM comparison_attempts WHERE id=? AND campaign_id=?')
      .get(id, this.campaignId);
    if (!row) throw new Error('Unknown comparison dispatch');
    return {usage: row.input_tokens === null || row.output_tokens === null ? null
      : {inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens)},
      costMicros: row.metered_micros === null ? null : Number(row.metered_micros)};
  }

  /** Only a terminal, consistent supplier usage receipt may release unused reservation.
   * Charge all reported input/output at conservative rates, not the cheaper estimate.
   * This is budget reconciliation, not an invoice claim. Failures/unknown usage keep holds.
   */
  settleCompleteUsage(id: string): void {
    if (!this.rolling) return;
    const row = this.db.prepare('SELECT * FROM comparison_attempts WHERE id=? AND campaign_id=?').get(id,this.campaignId);
    if (!row || row.metered_micros === null || this.snapshot().halted) throw new Error('No terminal metering eligible for settlement');
    const model = this.models.get(row.model as ModelID)!;
    const rate = model.reserveRate ?? model.rate;
    const upper = tokenCostUpperMicros(Number(row.input_tokens),Number(row.output_tokens),rate.inputMicrosPerMillion,rate.outputMicrosPerMillion);
    if (upper > Number(row.reserved_micros)) throw new Error('Settlement exceeds reservation');
    this.db.prepare('INSERT INTO comparison_settlements(attempt_id,charged_upper_micros) VALUES (?,?) ON CONFLICT(attempt_id) DO NOTHING').run(id,upper);
  }

  snapshot(): ComparisonBudgetSnapshot {
    const campaign = this.db.prepare('SELECT limit_micros,halted FROM comparison_campaigns WHERE id=?').get(this.campaignId)!;
    const totals = this.db.prepare(`SELECT COALESCE(SUM(reserved_micros),0) AS reserved,
      COALESCE(SUM(metered_micros),0) AS known,
      COALESCE(SUM(CASE WHEN metered_micros IS NULL THEN 1 ELSE 0 END),0) AS unknown
      FROM comparison_attempts WHERE campaign_id=?`).get(this.campaignId)!;
    const accounted = this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN s.attempt_id IS NULL THEN a.reserved_micros ELSE 0 END),0) AS held,
      COALESCE(SUM(s.charged_upper_micros),0) AS settled
      FROM comparison_attempts a LEFT JOIN comparison_settlements s ON s.attempt_id=a.id
      WHERE a.campaign_id=?`).get(this.campaignId)!;
    const occupied = Number(accounted.held) + Number(accounted.settled);
    return {currency: 'USD', limitMicros: Number(campaign.limit_micros), reservedMicros: Number(totals.reserved),
      remainingMicros: campaign.halted ? 0 : Math.max(0, Number(campaign.limit_micros) - occupied),
      activeHoldMicros:Number(accounted.held),settledConservativeMicros:Number(accounted.settled),occupiedMicros:occupied,
      knownMeteredMicros: Number(totals.known), unknownAttempts: Number(totals.unknown), halted: !!campaign.halted};
  }
  close(): void {this.db.close();}
}
