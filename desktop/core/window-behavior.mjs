export const pointerExitDelay = 450; // Native NotchController.hover(false).
export function containsPoint(rect, point) {
  return rect && point.x >= rect.x && point.y >= rect.y &&
    point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}
export function canCollapseOnLeave(state, menu) {
  return !state.qaPinned && !state.onboarding && !state.collecting && !state.preview && !menu;
}
export function canQueryCapture(run, owner, now, retentionSeconds) {
  return Boolean(run && run.owner === owner && now - run.createdAt <= retentionSeconds * 1000);
}
