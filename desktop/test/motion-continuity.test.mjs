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

test("A stretched smoke flight carries its own duration to expiry and to the motion evidence", async () => {
  const { FlightQueue } = await import("../core/flights.mjs");
  const shot = { id: "shot", base64: "", width: 640, height: 360, sourceBounds: { x: 0, y: 0, width: 600, height: 400 } };
  const target = [{ id: "shot", x: 10, y: 10, width: 120, height: 72 }];
  for (const timeScale of [1, 4]) {
    let now = 0;
    const queue = new FlightQueue({ now: () => now, timeScale });
    queue.add(shot);
    queue.targets(target);
    const [frame] = queue.frames, duration = flightStyle.duration * 1000 * timeScale;
    assert.equal(frame.duration, duration);
    now = duration - 1; queue.tick();
    assert.deepEqual(queue.ids, ["shot"], "the flight is still in the air before its own duration");
    assert.throws(() => assertFlightSample(frame, undefined, now), /before its deadline/);
    now = duration; queue.tick();
    assert.deepEqual(queue.ids, [], "the flight lands at its own duration");
    assertFlightSample(frame, undefined, now);
  }
});
