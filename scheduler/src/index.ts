const REAP_URLS = {
  production: 'https://notchspi-api.vercel.app/api/internal/reap',
  candidate: 'https://notchspi-ckatjw33a-rottesyas-projects.vercel.app/api/internal/reap',
} as const;
type ReaperEnv = { CRON_SECRET: string; VERCEL_AUTOMATION_BYPASS_SECRET?: string };
const MAX_RESPONSE_BYTES = 4096;
const DEADLINE_MS = 45_000;
const COUNTERS = ['processed', 'refunds_reconciled', 'refunds_failed', 'checkouts_credited',
  'checkouts_review', 'checkouts_failed', 'finance_reconciled', 'finance_failed', 'events_pruned'] as const;

async function readResult(response: Response): Promise<Record<string, unknown>> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) {
    await response.body?.cancel();
    throw new Error('reaper_invalid_response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('reaper_response_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('reaper_invalid_response');
  const record = result as Record<string, unknown>;
  if (typeof record.checked_at !== 'string' || !Number.isFinite(Date.parse(record.checked_at)) ||
      typeof record.more_possible !== 'boolean' ||
      COUNTERS.some(key => !Number.isSafeInteger(record[key]) || Number(record[key]) < 0)) {
    throw new Error('reaper_invalid_response');
  }
  return record;
}

export function createReaper(target: keyof typeof REAP_URLS) {
  return {
  fetch() { return new Response(null, { status: 404 }); },
  async scheduled(controller: ScheduledController, env: ReaperEnv) {
    const started = Date.now();
    let status = 0;
    try {
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.CRON_SECRET ?? '')) throw new Error('reaper_missing_secret');
      const headers: Record<string, string> = {
        Authorization: `Bearer ${env.CRON_SECRET}`, Accept: 'application/json', 'Cache-Control': 'no-store',
      };
      if (target === 'candidate') {
        if (!/^[A-Za-z0-9]{32}$/.test(env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '')) {
          throw new Error('reaper_missing_protection_secret');
        }
        headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET!;
      }
      // The entrypoint fixes the origin; environment bindings cannot redirect credentials.
      // The candidate uses an immutable deployment URL, never a movable alias.
      // Each tick makes one attempt; the server's durable, idempotent sweep owns recovery.
      const response = await fetch(REAP_URLS[target], {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(DEADLINE_MS),
        headers,
      });
      status = response.status;
      if (status !== 200) {
        await response.body?.cancel();
        throw new Error('reaper_http_failed');
      }
      const result = await readResult(response);
      if (target === 'production') {
        const budget = result.model_budget as Record<string,unknown> | undefined;
        if (!budget || !Number.isInteger(budget.level) || Number(budget.level)<0 || Number(budget.level)>3
          || !['limit_micros','spent_micros','held_micros','available_micros'].every(k=>Number.isSafeInteger(budget[k])&&Number(budget[k])>=0)) {
          throw new Error('reaper_missing_budget_status');
        }
        console.log(JSON.stringify({event:'model_budget',level:budget.level,limit_micros:budget.limit_micros,
          spent_micros:budget.spent_micros,held_micros:budget.held_micros,available_micros:budget.available_micros}));
        // Stable messages group repeated occurrences. Platform Issues owns email delivery;
        // warnings must never throw or interrupt the reaper/account reconciliation work.
        if (budget.level===1) console.error(new Error('NotchSPI daily model budget warning: USD 15 threshold reached; service continues'));
        if (budget.level===2) console.error(new Error('NotchSPI model budget critical: capacity running low; review before service interruption'));
        if (budget.level===3) console.error(new Error('NotchSPI model budget blocked: official answering requires attention'));
      }
      const partial = ['refunds_failed', 'checkouts_failed', 'finance_failed'].some(key => Number(result[key]) > 0);
      console.log(JSON.stringify({ event: 'reaper_result', scheduled_at: controller.scheduledTime,
        duration_ms: Date.now() - started, status, more_possible: result.more_possible,
        ...Object.fromEntries(COUNTERS.map(key => [key, result[key]])) }));
      if (partial) throw new Error('reaper_partial_failure');
    } catch {
      // Never include response bodies, credentials or raw network/parser exceptions in logs.
      console.error(JSON.stringify({ event: 'reaper_failed', scheduled_at: controller.scheduledTime,
        duration_ms: Date.now() - started, status }));
      throw new Error('reaper_failed');
    }
  },
  } satisfies ExportedHandler<ReaperEnv>;
}

export default createReaper('production');
