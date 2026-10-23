// Notch choreography. Both AppKit and Canvas consume these functions.
export const ghostStyle = {
  size: 20,
  bodyScale: 0.94,
  seed: 0.37,
  completionDuration: 1.25,
  shadow: 0.22,
  highlight: 0.65,
  depth: 0.45,
  ink: "#1E1A33",
};
export function completionWeight(time, reduced = false) {
  if (reduced || time == null) return 0;
  const x = Math.max(
    0,
    Math.min(1, time / 0.22, (ghostStyle.completionDuration - time) / 0.35),
  );
  return x * x * (3 - 2 * x);
}
export function notchPose(
  base,
  {
    reduced = false,
    busy = false,
    hero = false,
    time = 0,
    blend = 0,
    completion = null,
  } = {},
) {
  const pose = { ...base };
  pose.yaw = Math.sin(pose.yaw) * (hero ? 0.4 : 0.22);
  pose.pitch *= 0.45;
  pose.roll *= 0.25;
  pose.x *= 0.15;
  pose.y = pose.y * (hero ? 0.25 : 0.08) - 2.25;
  pose.sx = 1 + (pose.sx - 1) * 0.15;
  pose.sy = 1 + (pose.sy - 1) * 0.15;
  const weight = reduced ? (busy ? 1 : 0) : blend;
  const phase = reduced ? 0 : (time * 2 * Math.PI) / 1.4;
  pose.yaw += (0.24 * Math.sin(phase * 0.5) - pose.yaw) * weight;
  pose.roll += (0.09 * Math.sin(phase) - pose.roll) * weight;
  pose.y += (-2.25 - 3.5 * Math.sin(phase) - pose.y) * weight;
  pose.lookX += (0.55 * Math.sin(phase * 0.5) - pose.lookX) * weight;
  pose.lookY += (-0.35 - pose.lookY) * weight;
  pose.laugh *= 1 - weight;
  if (completion != null) {
    const finished = completionWeight(completion, reduced),
      nod = Math.sin(Math.min(1, completion / 0.8) * Math.PI);
    pose.pitch += (-0.2 * nod - pose.pitch) * finished;
    for (const k of ["yaw", "roll", "lookX", "lookY"]) pose[k] *= 1 - finished;
    pose.laugh += (0.75 - pose.laugh) * finished;
  }
  return pose;
}
export function thinkingDot(index, time, reduced, thinking, completed) {
  const pulse = reduced
    ? 1
    : (Math.sin((time * 2 * Math.PI) / 1.05 - index * 0.9) + 1) / 2;
  return {
    radius: 0.028 + 0.008 * pulse,
    opacity: thinking * (1 - completed) * (0.3 + 0.65 * pulse),
  };
}
