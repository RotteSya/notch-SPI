// Generated from shared/protocol/free-trial.mjs.
// Receipt validation only. The server remains the authority for entitlement and charging.
export const freeTrialContract = Object.freeze({ policyVersion: "trial3d400-2026-10-16", dailyLimit: 400 });
function trialTimestamp(value) {
  if (typeof value !== "string" || value.length > 32) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d+)(Z|[+-]\d{2}:\d{2})$/);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  let offset = 0;
  if (m[8] !== "Z") {
    const hours = Number(m[8].slice(1, 3)), minutes = Number(m[8].slice(4));
    if (hours > 23 || minutes > 59) return null;
    offset = (hours * 60 + minutes) * (m[8][0] === "+" ? 1 : -1);
  }
  return date.getTime() + Number("0." + m[7]) * 1000 - offset * 60000;
}
export function validFreeTrial(value) {
  if (!value || value.policy_version !== freeTrialContract.policyVersion || value.daily_limit !== freeTrialContract.dailyLimit ||
      !["eligible", "active", "expired", "ineligible"].includes(value.status) ||
      ![value.daily_used, value.daily_held, value.daily_remaining].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= freeTrialContract.dailyLimit)) return false;
  const now = trialTimestamp(value.server_time);
  if (now === null) return false;
  const total = value.daily_used + value.daily_held + value.daily_remaining;
  if (value.status === "eligible" || value.status === "ineligible") {
    return value.activated_at == null && value.expires_at == null && value.resets_at == null && total === 0;
  }
  const start = trialTimestamp(value.activated_at), end = trialTimestamp(value.expires_at);
  if (start === null || end === null || end - start !== 72 * 3600000 || now < start) return false;
  if (value.status === "expired") return now >= end && value.resets_at == null && total === 0;
  const reset = trialTimestamp(value.resets_at);
  return now < end && reset !== null && reset > now && reset - now <= 86400000 && total === freeTrialContract.dailyLimit;
}
