import assert from "node:assert/strict";
import { flightStyle } from "../generated/ui/flight.mjs";

export function assertFlightSample(initial, frame, observedAt) {
  if (frame) {
    assert.equal(frame.id, initial.id, "Capture replaced the screenshot flight");
    assert.equal(frame.start, initial.start, "Capture restarted the screenshot flight");
  } else {
    const duration = initial.duration ?? (initial.reduced ? flightStyle.reducedDuration : flightStyle.duration) * 1000;
    assert.ok(observedAt >= initial.start + duration,
      "Capture interrupted the screenshot flight before its deadline");
  }
}
