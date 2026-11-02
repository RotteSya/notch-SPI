// Fixed roles/events and booleans only: never read titles, URLs, or exception text.
export function windowState(window) {
  const destroyed = window.isDestroyed();
  return { destroyed, ...(!destroyed ? {
    visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(),
  } : {}) };
}
export function observeWindow(window, role, record, expectedVisible = () => undefined) {
  const snapshot = () => ({window_role: role, ...windowState(window), expected_visible: expectedVisible()});
  // Native notifications can be absent (observed for hide/show on the Mac host).
  // Poll only in local-report builds; persist transitions, never every tick.
  let previous = JSON.stringify(snapshot());
  const timer = setInterval(() => {
    const state = snapshot(), signature = JSON.stringify(state);
    if (signature !== previous) {
      previous = signature;
      record('window_state', {...state, window_event: 'state_changed'});
    }
  }, 250);
  timer.unref();
  window.once('closed', () => clearInterval(timer));
  for (const event of ['show','hide','minimize','restore','focus','blur','unresponsive','responsive','closed']) {
    window.on(event, () => {
      const state = snapshot();
      previous = JSON.stringify(state);
      record('window_state', {...state, window_event: event});
    });
  }
  window.webContents.on('render-process-gone', (_event, details) =>
    record('renderer_gone', {...snapshot(), reason: details.reason}));
  record('window_state', {...snapshot(), window_event: 'created'});
}
