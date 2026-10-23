// Global device-independent points, top-left origin. Native AppKit reflects Y at its boundary.
export const flightStyle = {
  duration: 0.68,
  reducedDuration: 0.18,
  inset: 4,
  radius: 8,
  lift: 30,
  angle: 2.2,
};
export const travel = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};
export function fit(image, area, inset = 0) {
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    area.width <= inset * 2 ||
    area.height <= inset * 2
  )
    return { ...area };
  const scale = Math.min(
    (area.width - inset * 2) / image.width,
    (area.height - inset * 2) / image.height,
  );
  const width = image.width * scale + inset * 2,
    height = image.height * scale + inset * 2;
  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
    height,
  };
}
export function flightFrame(source, destination, t, reduced = false) {
  if (reduced || t >= 1) return { ...destination };
  if (t <= 0) return { ...source };
  const p = travel(t),
    mix = (a, b) => a + (b - a) * p;
  const width = mix(source.width, destination.width),
    height = mix(source.height, destination.height);
  return {
    x:
      mix(source.x + source.width / 2, destination.x + destination.width / 2) -
      width / 2,
    y: mix(source.y, destination.y) - Math.sin(Math.PI * p) * flightStyle.lift,
    width,
    height,
  };
}
export function avoidCutouts(frame, angle, cutouts = []) {
  const width =
    Math.abs(Math.cos(angle)) * frame.width +
    Math.abs(Math.sin(angle)) * frame.height;
  const height =
    Math.abs(Math.sin(angle)) * frame.width +
    Math.abs(Math.cos(angle)) * frame.height;
  if (!(width > 0 && height > 0)) return frame;
  let lower = -Infinity,
    upper = Infinity;
  const cx = frame.x + frame.width / 2,
    cy = frame.y + frame.height / 2;
  for (const c of cutouts)
    if (cx + width / 2 > c.x && cx - width / 2 < c.x + c.width) {
      if (c.y + c.height <= cy) lower = Math.max(lower, c.y + c.height + 1);
      else upper = Math.min(upper, c.y - 1);
    }
  const scale = Math.min(1, Math.max(0, upper - lower) / height),
    w = frame.width * scale,
    h = frame.height * scale;
  const y = Math.min(
    Math.max(cy, lower + (height * scale) / 2),
    upper - (height * scale) / 2,
  );
  return { x: cx - w / 2, y: y - h / 2, width: w, height: h };
}
export function flightSample(
  source,
  destination,
  t,
  reduced = false,
  cutouts = [],
) {
  const p = reduced ? 1 : travel(t),
    direction =
      destination.x + destination.width / 2 < source.x + source.width / 2
        ? -1
        : 1;
  // AppKit's rotation has the opposite sign in top-left coordinates.
  const angle = reduced
    ? 0
    : ((-Math.sin(Math.PI * p) * flightStyle.angle * Math.PI) / 180) *
      direction;
  return {
    frame: avoidCutouts(
      flightFrame(source, destination, t, reduced),
      angle,
      cutouts,
    ),
    angle,
    inset: flightStyle.inset * p,
    radius: flightStyle.radius * p,
    opacity: Math.min(1, Math.max(0, t) / (reduced ? 1 : 0.04)),
    border: 0.5 * p,
    background: 0.14 * p,
    shadowOpacity: 0.3 * p,
    shadowRadius: 12 - 9 * p,
    shadowY: 8 - 5 * p,
  };
}
