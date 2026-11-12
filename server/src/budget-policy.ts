/** Shared durable policy; all amounts are integer millionths of the configured currency. */
export const BUDGET_POLICY = { failures: 3, cooldownMs: 60_000, probeMs: 120_000,
  orphanMs: 150_000, overrunRatio: 0.2 } as const;
export interface BudgetControl {
  channel: string; failures: number; overruns: number; blockedUntil: number;
  probe: string | null; reason: string | null; updatedAt: number;
}
export interface BudgetAccounting {
  attemptId: string; channel: string; reserved: number; booked: number;
  actual: number | null; state: 'pending' | 'provisional' | 'observed' | 'reconciled' | 'released';
  evidence: string | null; updatedAt: number;
}
export interface BudgetWindow {
  scope: string; currency: string; start: string; expiresAt: string;
  limit: number; spent: number; held: number;
}
export interface BudgetInspection { controls: BudgetControl[]; provisional: BudgetAccounting[]; windows: BudgetWindow[]; recentSpend?:Array<{currency:string;micros:number}> }

/** Operational warning only: admission continues to use the durable hard limit. */
export function budgetStatus(inspection: BudgetInspection, config: {
  modelCostCurrency: string; modelDailyBudgetMicros: number; modelBudgetWarningMicros: number;
  modelBudgetUtcOffsetMinutes: number; attemptBudgetUpperMicros: number; requestBudgetMode: string;
}, now = Date.now()) {
  const offset = config.modelBudgetUtcOffsetMinutes * 60_000;
  const start = Math.floor((now + offset) / 86_400_000) * 86_400_000 - offset;
  const window = inspection.windows.find(w => w.scope === 'official' && w.currency === config.modelCostCurrency
    && w.start === new Date(start).toISOString());
  const limit = window?.limit ?? config.modelDailyBudgetMicros;
  const spent = window?.spent ?? 0, held = window?.held ?? 0;
  const headroom = config.requestBudgetMode === 'guarded-request' ? Math.ceil(limit * 0.2) : 0;
  const available = Math.max(0, limit - headroom - spent - held);
  const blocked = inspection.controls.some(c => {
    try {
      const key = JSON.parse(c.channel.replace(/^legacy:/, ''));
      return key[0] === 'official' && key[1] === config.modelCostCurrency
        && (c.blockedUntil === -1 || c.blockedUntil > now);
    } catch { return false; }
  });
  const hourlyBurn=inspection.recentSpend?.find(r=>r.currency===config.modelCostCurrency)?.micros??0;
  const runway=hourlyBurn>0?Math.floor(available*3600/hourlyBurn):null;
  const enabled = limit > 0;
  const level = !enabled ? 0 : blocked || available === 0 ? 3
    : spent + held >= (limit - headroom) * 0.75 || available < config.attemptBudgetUpperMicros * 4 || (runway!==null&&runway<3600) ? 2
    : config.modelBudgetWarningMicros > 0 && spent + held >= config.modelBudgetWarningMicros ? 1 : 0;
  return { level, status: ['normal', 'warning', 'critical', 'blocked'][level],
    currency: config.modelCostCurrency, limit_micros: limit, warning_micros: config.modelBudgetWarningMicros,
    spent_micros: spent, held_micros: held, headroom_micros: headroom, available_micros: available,
    hourly_burn_micros:hourlyBurn,runway_seconds:runway,
    max_request_admissible: !enabled || (!blocked && available >= config.attemptBudgetUpperMicros),
    resets_at: window?.expiresAt ?? new Date(start + 86_400_000).toISOString() };
}
export function emptyControl(channel: string): BudgetControl {
  return {channel, failures: 0, overruns: 0, blockedUntil: 0, probe: null, reason: null, updatedAt: 0};
}
export function validCost(n: number | null): n is number { return n !== null && Number.isSafeInteger(n) && n >= 0; }
export function budgetOutcome(old: BudgetControl, id: string, reserved: number, actual: number | null,
  anomaly: boolean, now: number): BudgetControl {
  const next = {...old, updatedAt: now};
  const invalid = anomaly || (actual !== null && !validCost(actual));
  if (invalid) { next.blockedUntil = -1; next.reason = 'invalid_usage'; }
  else if (validCost(actual) && actual > reserved) {
    next.failures=0; next.overruns++;
    if (next.blockedUntil!==-1 && next.probe===id) next.blockedUntil=0;
    next.reason = 'estimate_overrun';
    if (actual > Math.ceil(reserved * (1 + BUDGET_POLICY.overrunRatio)) || next.overruns >= 3) next.blockedUntil = -1;
  } else if (actual === null) {
    next.failures++;
    // The complete reservation is already booked. Missing metering alone is not
    // evidence that the provider is unavailable; never stop unrelated users for it.
    if (next.blockedUntil !== -1) { next.blockedUntil=0; next.reason='metering_unavailable'; }
  } else if (next.blockedUntil !== -1 && (!next.probe || next.probe === id)) {
    // An older in-flight success must not cancel a newer open circuit.
    if (!next.blockedUntil || next.probe === id) {
      next.failures = 0; next.overruns = 0; next.blockedUntil = 0; next.reason = null;
    }
  }
  if (next.probe === id) next.probe = null;
  return next;
}
export function validateReconciliation(actual: number, evidence: string): void {
  if (!validCost(actual) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(evidence)) throw new Error('Invalid budget evidence');
}
