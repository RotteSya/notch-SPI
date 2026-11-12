// Mirrors CaptureSystemOperation.swift: timeout releases the caller, never the
// underlying system operation. A late callback cannot start a second capture.
export class SystemOperation {
  pending = null;
  async run(operation, timeoutMs = 10000) {
    if (this.pending) throw new Error('Capture system is busy; wait for the previous capture to finish');
    const pending = Promise.resolve().then(operation);
    this.pending = pending;
    const release = () => { if (this.pending === pending) this.pending = null; };
    pending.then(release, release);
    let timer;
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Capture system timed out; try again when the target is available')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
}
