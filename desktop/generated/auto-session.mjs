// Generated from shared/protocol/auto-session.mjs.
// Pure automatic-capture state machine; callers own clocks, capture and UI effects.
export const autoDefaults = Object.freeze({
  gridW: 32, gridH: 20, perPixelTolerance: 10, changedFraction: 0.02,
  stableTicksRequired: 2, maxHashFailures: 3, idleTimeout: 900,
});
export function autoDifference(a, b, tolerance = autoDefaults.perPixelTolerance) {
  if (!a.length || a.length !== b.length) return 1;
  return a.reduce((count, x, i) => count + (Math.abs(x - b[i]) > tolerance ? 1 : 0), 0) / a.length;
}
export function autoClamp(cap, fallback, maximum) {
  return cap === -1 ? -1 : cap === 0 ? fallback : Math.min(maximum, Math.max(1, cap));
}
export function createAutoEngine() { return new SharedAutoEngine(); }
export class SharedAutoEngine {
  state = "inactive";
  count = 0;
  lastStopReason = null;
  config = { ...autoDefaults, maxQuestions: 20 };
  resetWatch() {
    this.baseline = null; this.previous = null; this.changed = false;
    this.stable = 0; this.failures = 0; this.watchStart = null;
  }
  start(config) {
    this.config = { ...autoDefaults, ...config };
    this.count = 0; this.lastStopReason = null;
    this.resetWatch(); this.state = "running";
  }
  stop(reason) {
    if (this.state === "inactive") return "none";
    this.state = "inactive"; this.lastStopReason = reason;
    this.resetWatch(); return reason;
  }
  succeeded(balance, rejected, now) {
    if (this.state === "inactive") return "none";
    this.count++;
    if (this.config.maxQuestions !== -1 && this.count >= this.config.maxQuestions) return this.stop("questionCap");
    if (rejected || (balance !== null && balance <= 0)) return this.stop("quotaExhausted");
    this.resetWatch(); this.watchStart = now; this.state = "baselinePending";
    return "none";
  }
  failed() { return this.stop("runFailed"); }
  paused(now) {
    if (this.state === "inactive" || this.state === "running") return "none";
    if (this.watchStart !== null && now - this.watchStart >= this.config.idleTimeout) return this.stop("idleTimeout");
    return "none";
  }
  tick(hash, now) {
    const timeout = this.paused(now);
    if (timeout !== "none") return timeout;
    if (this.state === "inactive" || this.state === "running") return "none";
    if (hash === null) {
      if (++this.failures >= this.config.maxHashFailures) return this.stop("hashFailures");
      return "none";
    }
    this.failures = 0;
    if (this.state === "baselinePending") {
      this.baseline = hash; this.previous = hash; this.changed = false; this.stable = 0;
      this.state = "watching"; return "none";
    }
    if (this.baseline === null || this.previous === null) {
      this.baseline = hash; this.previous = hash; return "none";
    }
    const previous = this.previous; this.previous = hash;
    const changed = (a, b) => autoDifference(a, b) >= autoDefaults.changedFraction;
    if (!this.changed) {
      if (changed(hash, this.baseline)) { this.changed = true; this.stable = 0; }
      return "none";
    }
    if (changed(hash, previous)) { this.stable = 0; return "none"; }
    if (++this.stable < this.config.stableTicksRequired) return "none";
    if (!changed(hash, this.baseline)) { this.changed = false; this.stable = 0; return "none"; }
    this.state = "running"; return "trigger";
  }
}
