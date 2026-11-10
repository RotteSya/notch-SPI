/** Shared durable policy; all amounts are integer millionths of the configured currency. */
export const BUDGET_POLICY = { failures: 3, cooldownMs: 60_000, probeMs: 120_000,
  orphanMs: 300_000, overrunRatio: 0.2 } as const;
export interface BudgetControl {
  channel: string; failures: number; overruns: number; blockedUntil: number;
  probe: string | null; reason: string | null; updatedAt: number;
}
export interface BudgetAccounting {
  attemptId: string; channel: string; reserved: number; booked: number;
  actual: number | null; state: 'pending' | 'provisional' | 'observed' | 'reconciled' | 'released';
  evidence: string | null; updatedAt: number;
}
export interface BudgetInspection { controls: BudgetControl[]; provisional: BudgetAccounting[] }
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
    if (next.blockedUntil !== -1 && (next.failures >= BUDGET_POLICY.failures || next.probe === id)) {
      next.blockedUntil = now + BUDGET_POLICY.cooldownMs; next.reason = 'metering_unavailable';
    }
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
