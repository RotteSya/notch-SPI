import test from "node:test";
import assert from "node:assert/strict";
import { createCaptureVisibility } from "../platform/capture-visibility.mjs";
import { containsPoint, canCollapseOnLeave, pointerExitDelay, canQueryCapture } from "../core/window-behavior.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function harness() {
  const state = { visible: true, wanted: true, destroyed: false, paused: false, hides: 0, shows: 0 };
  const gate = createCaptureVisibility({
    host: () => ({
      isVisible: () => state.visible,
      isDestroyed: () => state.destroyed,
      hide() { state.visible = false; state.hides++; },
      showInactive() { state.visible = true; state.shows++; },
    }),
    flights: () => ({ suspend() { state.paused = true; return () => { state.paused = false; }; } }),
    shouldRestore: () => state.wanted,
    settle: async () => {},
  });
  return { state, gate };
}
test("overlapping captures keep notch and flights hidden until the final pixels arrive", async () => {
  const { state, gate } = harness(), first = deferred(), second = deferred();
  const a = gate(async () => {
    assert.equal(state.visible, false);
    assert.equal(state.paused, true);
    return first.promise;
  });
  const b = gate(() => second.promise);
  first.resolve("first image");
  assert.equal(await a, "first image");
  assert.equal(state.visible, false);
  assert.equal(state.paused, true);
  second.resolve("second image");
  assert.equal(await b, "second image");
  assert.equal(state.visible, true);
  assert.equal(state.paused, false);
  assert.equal(state.hides, 1);
  assert.equal(state.shows, 1);
});
test("capture failure restores overlays and allows the next capture", async () => {
  const { state, gate } = harness();
  await assert.rejects(gate(() => { throw new Error("screen permission"); }), /screen permission/);
  assert.equal(state.visible, true);
  assert.equal(state.paused, false);
  assert.equal(await gate(() => "retry"), "retry");
});
for (const scenario of ["user hides while capturing", "initially hidden", "window destroyed"]) {
  test(`capture must not reopen the notch: ${scenario}`, async () => {
    const { state, gate } = harness();
    if (scenario === "initially hidden") state.visible = false;
    await gate(() => {
      if (scenario === "window destroyed") state.destroyed = true;
      if (scenario === "user hides while capturing") state.wanted = false;
    });
    assert.equal(state.shows, 0);
    assert.equal(state.paused, false);
  });
}
test("global pointer jumps outside the notch are recognized across negative screen coordinates", () => {
  const windowOrigin = { x: -1200, y: -900 };
  const rect = { x: 40, y: 0, width: 600, height: 360 };
  const local = point => ({ x: point.x - windowOrigin.x, y: point.y - windowOrigin.y });
  assert.equal(containsPoint(rect, local({ x: -1000, y: -880 })), true);
  assert.equal(containsPoint(rect, local({ x: 30, y: 100 })), false);
  assert.equal(containsPoint(rect, { x: 640, y: 25 }), false);
  assert.equal(pointerExitDelay, 450);
});
test("mouseleave collapses idle/results but preserves capture, preview, guide and menu", () => {
  assert.equal(canCollapseOnLeave({ status: "done" }, false), true);
  assert.equal(canCollapseOnLeave({ status: "idle" }, false), true);
  for (const key of ["collecting", "preview", "onboarding", "qaPinned"])
    assert.equal(canCollapseOnLeave({ [key]: true }, false), false);
  assert.equal(canCollapseOnLeave({}, true), false);
});
test("settlement lookup only applies to a retained request owned by the current account", () => {
  const run = { owner: "current", createdAt: 1000 };
  assert.equal(canQueryCapture(null, "current", 2000, 60), false);
  assert.equal(canQueryCapture(run, "other", 2000, 60), false);
  assert.equal(canQueryCapture(run, "current", 2000, 60), true);
  assert.equal(canQueryCapture(run, "current", 61001, 60), false);
});
