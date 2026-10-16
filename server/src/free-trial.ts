/** One claim per eligible device; server time owns both expiry and Beijing daily buckets. */
export const FREE_TRIAL_POLICY = {version: 'trial3d400-2026-10-16', durationHours: 72, dailyLimit: 400} as const;
export interface FreeTrialSnapshot {
  status: 'eligible' | 'active' | 'expired' | 'ineligible';
  policy_version: string;
  daily_limit: number;
  activated_at: string | null;
  expires_at: string | null;
  resets_at: string | null;
  daily_used: number;
  daily_held: number;
  daily_remaining: number;
  server_time: string;
}
export function trialWindow(now = Date.now()) {
  const day = 86_400_000, offset = 8 * 3_600_000;
  const start = Math.floor((now + offset) / day) * day - offset;
  return {key: new Date(start + offset).toISOString().slice(0, 10), end: new Date(start + day).toISOString()};
}
export function trialSnapshot(eligible: boolean, activatedAt: string | null, expiresAt: string | null,
  lot?: {remaining: number; held: number}, now = Date.now()): FreeTrialSnapshot {
  const active = activatedAt !== null && expiresAt !== null && Date.parse(activatedAt) <= now && now < Date.parse(expiresAt);
  return {status: !eligible ? 'ineligible' : activatedAt === null ? 'eligible' : active ? 'active' : 'expired',
    policy_version: FREE_TRIAL_POLICY.version, daily_limit: FREE_TRIAL_POLICY.dailyLimit,
    activated_at: activatedAt, expires_at: expiresAt, resets_at: active ? trialWindow(now).end : null,
    daily_used: active && lot ? FREE_TRIAL_POLICY.dailyLimit - lot.remaining : 0,
    daily_held: active && lot ? lot.held : 0,
    daily_remaining: active && lot ? lot.remaining - lot.held : 0, server_time: new Date(now).toISOString()};
}
