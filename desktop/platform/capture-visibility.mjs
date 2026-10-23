// A capture may outlive another capture or a user hide action. Keep every overlay
// out of the compositor until the last pending capture has taken its pixels.
export function createCaptureVisibility({ host, flights, shouldRestore, settle = () => new Promise(resolve => setTimeout(resolve, 120)) }) {
  let pending = 0, window, restore = false, resume, settled;
  return async function withoutOverlay(capture) {
    if (pending++ === 0) {
      window = host();
      restore = !window.isDestroyed() && window.isVisible();
      resume = flights().suspend();
      if (restore) window.hide();
      settled = Promise.resolve().then(settle);
    }
    try {
      await settled;
      return await capture();
    } finally {
      if (--pending === 0) {
        resume();
        if (restore && !window.isDestroyed() && shouldRestore()) window.showInactive();
      }
    }
  };
}
