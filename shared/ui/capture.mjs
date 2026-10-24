import { fit, flightStyle } from "./flight.mjs";
export const captureStyle = {
  cardWidth: 128,
  cardHeight: 80,
  cardGap: 12,
  referenceWidth: 52,
  referenceHeight: 30,
  referenceGap: 8,
  radius: flightStyle.radius,
  inset: flightStyle.inset,
  referenceInset: 3,
  settleDuration: 0.22,
  reorderDuration: 0.22,
  referenceDuration: 0.32,
};
export function captureCard(image, slot, compact = false) {
  return compact ? { ...slot } : fit(image, slot, captureStyle.inset);
}
export function landingKeyframes() {
  return [
    { rotate: "0deg", offset: 0 },
    { rotate: "-1.2deg", offset: 0.3 },
    { rotate: ".45deg", offset: 0.65 },
    { rotate: "0deg", offset: 1 },
  ];
}

// Preserve the large capture slots until all photos land and usable content arrives.
export function captureIsCompact(state) {
  return (
    !state.collecting &&
    !state.flying?.length &&
    Boolean(
      state.answer ||
      state.working ||
      ["error", "retake", "empty", "canceled"].includes(state.status),
    )
  );
}
