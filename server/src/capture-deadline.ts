/** One solve lease; phase limits consume this lease and never restart it. */
export const CAPTURE_DEADLINE = {
  leaseMs: 120_000, generationMs: 90_000, firstProgressMs: 20_000,
  settlementMarginMs: 2_000, workerLeaseMs: 8_000, heartbeatMs: 2_000,
} as const;

/** A failed acknowledgement is not proof of lost ownership. Retry the idempotent
 * renewal inside the last confirmed lease, with an independent expiry timer. */
export class WorkerLease {
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private until: number;
  private readonly renew: (now: number) => Promise<boolean>;
  private readonly lost: () => void;
  private readonly expires: number;
  constructor(until: number, renew: (now: number) => Promise<boolean>, lost: () => void, expires: number) {
    this.until=until; this.renew=renew; this.lost=lost; this.expires=expires;
    this.armExpiry(); this.schedule(CAPTURE_DEADLINE.heartbeatMs);
  }
  stop() { this.stopped = true; clearTimeout(this.timer); clearTimeout(this.expiry); }
  private fail() { if (!this.stopped) { this.stop(); this.lost(); } }
  private armExpiry() {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => this.fail(), Math.max(0, Math.min(this.until, this.expires) - Date.now()));
  }
  private schedule(ms: number) { this.timer = setTimeout(() => { void this.tick(); }, ms); }
  private async tick() {
    if (this.stopped) return;
    const started = Date.now();
    try {
      const owned = await this.renew(started);
      if (this.stopped) return;
      if (!owned || started + CAPTURE_DEADLINE.workerLeaseMs <= Date.now()) { this.fail(); return; }
      this.until = started + CAPTURE_DEADLINE.workerLeaseMs;
      this.armExpiry(); this.schedule(CAPTURE_DEADLINE.heartbeatMs);
    } catch {
      if (!this.stopped) this.schedule(250);
    }
  }
}
