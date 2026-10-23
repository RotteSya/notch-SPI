// Keep overlays on screen. Windows removes WDA_EXCLUDEFROMCAPTURE windows
// during desktop composition; changing affinity and capturing immediately can race.
export function requireCaptureExclusionSupport(release) {
  const [major, , build] = release.split(".").map(Number);
  if (!(major > 10 || (major === 10 && build >= 19041)))
    throw new Error("Screenshot exclusion requires Windows 10 version 2004 or later.");
}

export function createCaptureExclusion({
  enabled = true,
  protect = window => window.setContentProtection(true),
  now = () => performance.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  settleMilliseconds = 120,
  validate = () => {},
} = {}) {
  const windows = new Map();
  let revision = 0, readyAt = 0;
  function refresh(window) {
    if (!enabled || !windows.has(window) || window.isDestroyed()) return;
    protect(window);
    revision++;
    readyAt = now() + settleMilliseconds;
  }
  return {
    enabled,
    register(window) {
      if (!enabled || windows.has(window)) return;
      const onChange = () => refresh(window);
      const onClose = () => {
        windows.delete(window);
        revision++;
      };
      windows.set(window, { onChange, onClose });
      // Call after native window styles (click-through, z-order, bounds) are set.
      refresh(window);
      window.on("show", onChange);
      window.on("always-on-top-changed", onChange);
      window.once("closed", onClose);
    },
    refresh,
    async capture(takePixels) {
      if (!enabled) return takePixels();
      validate();
      // A new overlay may appear during enumeration. Discard only that local
      // frame, before it can enter a question/request; never replay an API call.
      for (let attempt = 0; attempt < 5; attempt++) {
        const version = revision;
        const remaining = readyAt - now();
        if (remaining > 0) await wait(remaining);
        if (version !== revision) continue;
        const image = await takePixels();
        if (version === revision) return image;
      }
      throw new Error("Screenshot windows changed repeatedly. Please try again.");
    },
    dispose() {
      for (const [window, { onChange, onClose }] of windows) {
        window.off("show", onChange);
        window.off("always-on-top-changed", onChange);
        window.off("closed", onClose);
      }
      windows.clear();
      revision++;
    },
  };
}
