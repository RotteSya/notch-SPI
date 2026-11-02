import assert from 'node:assert/strict';
export async function verifyWindowDiagnostics(window, report) {
  const start = report.data.events.length;
  window.hide();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(window.isVisible(), false);
  window.showInactive();
  await new Promise(resolve => setTimeout(resolve, 350));
  const events = report.data.events.slice(start);
  const hidden = events.find(e => e.event === 'window_state' && e.visible === false);
  const shown = events.find(e => e.event === 'window_state' && e.visible === true);
  assert.equal(hidden?.window_role, 'notch');
  assert.equal(hidden.visible, false);
  assert.equal(hidden.expected_visible, true, 'unexpected native hiding must remain distinguishable from user hide intent');
  assert.equal(shown?.window_role, 'notch');
  assert.equal(shown.visible, true);
  assert.equal(window.isVisible(), true);
}
