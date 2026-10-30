// Presentation follows the installed Mac 3.0 (27) reference. No service calls.
export function capsule(state) {
  if (state.auto.active) return { action: 'auto', value: null, kind: 'auto' };
  if (state.mode === 'personality') return { action: 'settings', value: 'personas', kind: 'persona' };
  return { action: 'cycleEffort', value: null, kind: 'effort' };
}

export function quickMenu(state) {
  const busy = ['running', 'streaming'].includes(state.status) || state.capturing;
  const items = ['single', 'multiple', 'personality'];
  if (state.collecting) items.push('cancel');
  items.push('separator', 'history', 'separator');
  if (state.mode !== 'personality') {
    if (!busy && state.status === 'error' && state.canCheckSettlement) items.push('status');
    if (state.canRecover) items.push('recover');
    if (state.canFeedback) items.push('exportFeedback');
    if (state.auto.reviewPending) items.push('confirmAutoReview');
    items.push('separator');
  }
  if (state.settings.channel === 'official') items.push('balance', 'topUp', 'separator');
  if (state.mode !== 'personality') items.push('effort', 'low', 'high', 'max', 'separator');
  else items.push('newQuestionnaire', 'separator');
  items.push('target');
  if (state.settings.personas?.length) items.push('personas');
  items.push('separator', 'settings', 'guideResume', 'quit');
  return items.filter((item, i) => item !== 'separator' || (i > 0 && items[i - 1] !== 'separator'));
}

export function compactStatus(status) {
  return status === 'error' ? '!' : ['running', 'streaming'].includes(status) ? '…' : '';
}
