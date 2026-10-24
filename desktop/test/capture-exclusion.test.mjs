import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCaptureExclusion, requireCaptureExclusionSupport } from "../platform/capture-exclusion.mjs";
import { FlightQueue } from "../core/flights.mjs";
import { flightSample, flightStyle } from "../generated/ui/flight.mjs";

class Window extends EventEmitter {
  visible = true;
  destroyed = false;
  protected = false;
  isDestroyed() { return this.destroyed; }
  setContentProtection(value) { this.protected = value; }
  hide() { assert.fail("Capturing must never hide an overlay"); }
  showInactive() { assert.fail("Capturing must never restore a hidden overlay"); }
  setOpacity(value) { assert.equal(value, 1, "Capturing must never fade an overlay"); }
}
function setup() {
  let time = 0;
  const waits = [];
  const exclusion = createCaptureExclusion({
    now: () => time,
    wait: async ms => { waits.push(ms); time += ms; },
  });
  const notch = new Window();
  exclusion.register(notch);
  return { exclusion, notch, waits, now: () => time, advance: ms => { time += ms; } };
}
test("continuous captures retain visible overlays, protect before taking pixels and settle only after changes", async () => {
  const { exclusion, notch, waits } = setup();
  const flight = new Window(), settings = new Window();
  exclusion.register(flight);
  for (let i = 0; i < 20; i++) {
    assert.equal(await exclusion.capture(() => {
      assert.ok(notch.visible && flight.visible);
      assert.ok(notch.protected && flight.protected);
      assert.equal(settings.protected, false);
      return i;
    }), i);
  }
  assert.deepEqual(waits, [120]);
});
test("overlapping captures and errors never alter visibility or restart an animation", async () => {
  const { exclusion, notch } = setup();
  await exclusion.capture(() => "settled");
  let complete;
  const delayed = exclusion.capture(() => new Promise(resolve => { complete = resolve; }));
  const second = exclusion.capture(() => "second frame");
  assert.equal(await second, "second frame");
  await assert.rejects(exclusion.capture(() => { throw new Error("capture failed"); }), /capture failed/);
  assert.equal(notch.visible, true);
  notch.visible = false; // The user, not the capturer, hides the window.
  complete("first frame");
  assert.equal(await delayed, "first frame");
  assert.equal(notch.visible, false);
});
test("new flight windows during capture invalidate that local frame before it can be submitted", async () => {
  const { exclusion, waits } = setup();
  let frames = 0;
  const result = await exclusion.capture(() => {
    if (++frames === 1) exclusion.register(new Window());
    return frames;
  });
  assert.equal(result, 2);
  assert.deepEqual(waits, [120, 120]);
});
test("passthrough style changes and redisplay renew protection without hiding the window", async () => {
  const { exclusion, notch, waits } = setup();
  await exclusion.capture(() => {});
  notch.protected = false; // Simulate a native style update.
  exclusion.refresh(notch);
  await exclusion.capture(() => assert.equal(notch.protected, true));
  notch.emit("show");
  await exclusion.capture(() => {});
  assert.deepEqual(waits, [120, 120, 120]);
  exclusion.dispose();
  assert.equal(notch.listenerCount("show"), 0);
});
test("new overlays while awaiting composition are protected before any pixels are read", async () => {
  let done, frames = 0, time = 0;
  const exclusion = createCaptureExclusion({
    now: () => time,
    wait: () => new Promise(resolve => { done = () => { time += 120; resolve(); }; }),
  });
  exclusion.register(new Window());
  const result = exclusion.capture(() => ++frames);
  exclusion.register(new Window());
  done();
  assert.equal(await result, 1);
});
test("Windows establishes full-opacity layered style before requesting capture exclusion", async () => {
  const notch = new Window();
  let layered = false;
  notch.setOpacity = value => { assert.equal(value, 1); layered = true; };
  notch.setContentProtection = value => { notch.protected = layered && value; };
  const exclusion = createCaptureExclusion({ settleMilliseconds: 0 });
  exclusion.register(notch);
  await exclusion.capture(() => assert.equal(notch.protected, true));
  assert.equal(notch.visible, true);
});
test("capture does not change flight start time, progress, landing or cancellation", async () => {
  const { exclusion, now, advance } = setup();
  await exclusion.capture(() => {});
  const queue = new FlightQueue({ now });
  queue.add({ id: "first", base64: "", width: 640, height: 360, sourceBounds: { x: -900, y: 80, width: 600, height: 400 } });
  queue.targets([{ id: "first", x: 300, y: 100, width: 120, height: 72 }]);
  const start = queue.frames[0].start;
  const progress = [];
  for (let i = 0; i < 4; i++) {
    advance(100);
    await exclusion.capture(() => {
      queue.tick();
      const frame = queue.frames[0];
      assert.equal(frame.start, start);
      progress.push(flightSample(frame.source, frame.destination, (now() - start) / (flightStyle.duration * 1000)).frame.width);
    });
  }
  assert.ok(progress.every((width, i) => !i || width < progress[i - 1]));
  advance(300);
  queue.tick();
  assert.deepEqual(queue.ids, []);
  queue.add({ id: "cancel", base64: "", width: 640, height: 360 });
  queue.clear();
  await exclusion.capture(() => assert.deepEqual(queue.ids, []));
});
test("unsupported Windows rejects capture rather than using a black rectangle or hiding fallback", async () => {
  for (const release of ["6.3.9600", "10.0.18363", "unknown"])
    assert.throws(() => requireCaptureExclusionSupport(release), /2004/);
  for (const release of ["10.0.19041", "10.0.22631", "10.0.26100"])
    requireCaptureExclusionSupport(release);
  const exclusion = createCaptureExclusion({ validate: () => requireCaptureExclusionSupport("10.0.18363") });
  await assert.rejects(exclusion.capture(() => assert.fail("No pixels from unsupported capture")), /2004/);
});
test("repeated window churn is bounded and does not release an uncertain frame", async () => {
  const { exclusion } = setup();
  let attempts = 0;
  await assert.rejects(exclusion.capture(() => {
    attempts++;
    exclusion.register(new Window());
    return "uncertain";
  }), /changed repeatedly/);
  assert.equal(attempts, 5);
});
