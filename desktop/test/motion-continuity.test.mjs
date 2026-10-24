import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFlightSample } from "./motion-continuity.mjs";
import { flightStyle } from "../generated/ui/flight.mjs";

for (const reduced of [false, true]) test(`Motion evidence distinguishes landing from interruption (reduced=${reduced})`, () => {
  const initial = { id: "flight", start: 1000, reduced };
  const deadline = initial.start + 1000 * (reduced ? flightStyle.reducedDuration : flightStyle.duration);
  assertFlightSample(initial, { ...initial }, 1001);
  assert.throws(() => assertFlightSample(initial, undefined, deadline - 1), /before its deadline/);
  assertFlightSample(initial, undefined, deadline);
  assertFlightSample(initial, undefined, deadline + 500);
  assert.throws(() => assertFlightSample(initial, { ...initial, start: 1001 }, 1001), /restarted/);
  assert.throws(() => assertFlightSample(initial, { ...initial, id: "other" }, 1001), /replaced/);
});
