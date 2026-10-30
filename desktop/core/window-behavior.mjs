export const pointerExitDelay = 450; // Native NotchController.hover(false).
export function containsPoint(rect, point) {
  return rect && point.x >= rect.x && point.y >= rect.y &&
    point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}
// Same quadratic shoulder and lower corner used by NotchShape, in local DIP.
// Test the painted contour, not its rectangular transparent window.
export function containsSlab(rect, point, topRadius, bottomRadius) {
  if (!containsPoint(rect, point)) return false;
  const x = Math.min(point.x - rect.x, rect.x + rect.width - point.x);
  const y = point.y - rect.y;
  const r = Math.max(0, Math.min(topRadius, rect.width / 2));
  const b = Math.max(0, Math.min(bottomRadius, rect.width / 2 - r, rect.height - r));
  if (r && y < r) {
    const t = Math.sqrt(y / r);
    return x >= r * (2 * t - t * t);
  }
  if (b && y > rect.height - b) {
    const t = 1 - Math.sqrt((rect.height - y) / b);
    return x >= r + b * t * t;
  }
  return x >= r;
}

export function notchGeometry(open, width, height) {
  return open ? { width, height, offset: 0 } : { width: 260, height: 28, offset: -30 };
}
export function canCollapseOnLeave(state, menu) {
  return !state.qaPinned && !state.onboarding && !state.collecting && !state.preview && !menu;
}
export function canQueryCapture(run, owner, now, retentionSeconds) {
  return Boolean(run && run.owner === owner && now - run.createdAt <= retentionSeconds * 1000);
}
