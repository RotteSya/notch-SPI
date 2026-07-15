import type { FastifyRequest } from 'fastify';

// Best-effort, dependency-free, in-memory rate limiting — a DEFENSE-IN-DEPTH layer, not an
// authoritative quota. On serverless each warm instance keeps its own counters, so a hard,
// global guarantee still needs a platform WAF / edge rule (documented in .env.example). What
// this buys us:
//   • A per-IP cap on anonymous POST /v1/devices, so free-quota farming (each registration
//     grants TRIAL_QUESTIONS worth of paid model calls) costs an attacker something instead of
//     being free and unbounded.
//   • A per-token concurrency cap on POST /v1/captures, so one token can't open many streams in
//     parallel to drive its balance deeply negative before the pre-request gate catches up.
// Both fail OPEN (allow) under memory pressure rather than lock out real users.

export interface FixedWindowLimiter {
  /** Record a hit for `key`; returns true if still within budget, false once the window is spent. */
  hit(key: string): boolean;
}

/** A fixed-window counter per key. `maxHits <= 0` disables limiting (always allows). */
export function createFixedWindowLimiter(maxHits: number, windowMs: number): FixedWindowLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const MAX_KEYS = 100_000; // hard cap so a flood of distinct keys can't grow memory without bound

  return {
    hit(key: string): boolean {
      if (maxHits <= 0) return true;
      const now = Date.now();
      let b = buckets.get(key);
      if (b === undefined || now >= b.resetAt) {
        if (buckets.size > MAX_KEYS) {
          for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
          if (buckets.size > MAX_KEYS) return true; // fail open rather than risk unbounded memory
        }
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
      }
      if (b.count >= maxHits) return false;
      b.count += 1;
      return true;
    },
  };
}

export interface ConcurrencyLimiter {
  /** Reserve a slot for `key`; returns false if it already holds `maxConcurrent` in-flight. */
  tryAcquire(key: string): boolean;
  /** Release a slot previously acquired for `key`. Safe to over-release (floors at 0). */
  release(key: string): void;
}

/** In-flight counter per key. `maxConcurrent <= 0` disables limiting (always acquires). */
export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  const inFlight = new Map<string, number>();
  return {
    tryAcquire(key: string): boolean {
      if (maxConcurrent <= 0) return true;
      const n = inFlight.get(key) ?? 0;
      if (n >= maxConcurrent) return false;
      inFlight.set(key, n + 1);
      return true;
    },
    release(key: string): void {
      if (maxConcurrent <= 0) return;
      const n = inFlight.get(key) ?? 0;
      if (n <= 1) inFlight.delete(key);
      else inFlight.set(key, n - 1);
    },
  };
}

/**
 * The client IP for rate-limit bucketing. Vercel (and most CDNs) OVERWRITE `x-forwarded-for`
 * with the true client address, so its first entry is trustworthy on that platform; fall back to
 * `x-real-ip`, then Fastify's socket-derived `req.ip` for local/dev. Best-effort by design —
 * spoof-resistance is the platform's job, not this in-memory layer's.
 */
export function clientIp(req: FastifyRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  if (first) return first;
  const real = req.headers['x-real-ip'];
  const realStr = (Array.isArray(real) ? real[0] : real)?.trim();
  if (realStr) return realStr;
  return req.ip || 'unknown';
}
