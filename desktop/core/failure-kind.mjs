// Only bounded categories leave the error boundary; never persist raw messages.
export function failureKind(error) {
  if (error?.code === 'service_maintenance') return 'maintenance';
  if (error?.code === 'device_busy') return 'busy';
  if (['idempotency_conflict','capture_in_progress','capture_already_finalized'].includes(error?.code)) return 'conflict';
  if (['insufficient_quota','paid_credits_disabled'].includes(error?.code)) return 'quota';
  if (error?.code === 'rate_limited') return 'rate_limit';
  if (error?.status === 401 || error?.status === 403) return 'account';
  if (error?.status === 402) return 'quota';
  if (error?.status === 429) return 'rate_limit';
  if (error?.status === 409) return 'conflict';
  if (error?.status || error?.code) return 'service';
  if (['TimeoutError','AbortError'].includes(error?.name) || /fetch failed|Failed to fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(error?.message ?? '')) return 'network';
  return 'service';
}
