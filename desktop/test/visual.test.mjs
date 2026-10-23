import test from "node:test";
import assert from "node:assert/strict";
import {
  fit,
  flightFrame,
  flightSample,
  travel,
} from "../generated/ui/flight.mjs";
import { FlightQueue } from "../core/flights.mjs";
import { Sim } from "../generated/ui/ghost-engine.mjs";
import { notchPose, completionWeight } from "../generated/ui/ghost-motion.mjs";
import { readingSections, readingHTML } from "../generated/ui/reading.mjs";
test("flight preserves image aspect through negative, stacked and mixed-DPI display coordinates", () => {
  const source = { x: -1920, y: 100, width: 1920, height: 1080 };
  const image = { width: 3840, height: 2160 };
  const end = fit(image, { x: 450, y: -1000, width: 104, height: 68 }, 4),
    start = fit(image, source);
  assert.deepEqual(flightFrame(start, end, 0), start);
  assert.deepEqual(flightFrame(start, end, 1), end);
  let previous = 0;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100,
      p = travel(t),
      v = flightSample(start, end, t);
    assert.ok(p >= previous);
    previous = p;
    assert.ok(Object.values(v.frame).every(Number.isFinite));
    assert.ok(
      Math.abs(
        (v.frame.width - 2 * v.inset) / (v.frame.height - 2 * v.inset) - 16 / 9,
      ) < 1e-10,
    );
  }
  assert.deepEqual(flightSample(start, end, 0.5, true).frame, end);
});
test("flight cutout includes rotated corners and endpoints are stable", () => {
  const r = { x: 400, y: -30, width: 500, height: 300 },
    dest = { x: 520, y: 100, width: 104, height: 68 },
    c = { x: 480, y: 0, width: 240, height: 32 };
  const v = flightSample(r, dest, 0.5, false, [c]);
  const half =
    (Math.abs(Math.sin(v.angle)) * v.frame.width +
      Math.abs(Math.cos(v.angle)) * v.frame.height) /
    2;
  assert.ok(v.frame.y + v.frame.height / 2 - half >= 33 - 1e-9);
});
test("independent stable-ID flights follow moving targets, cancel/delete/reorder and cannot stay hidden", () => {
  let now = 0,
    changed = 0;
  const q = new FlightQueue({ now: () => now, changed: () => changed++ });
  const shot = (id) => ({
    id,
    base64: "a",
    width: 1600,
    height: 900,
    sourceBounds: { x: -1600, y: 0, width: 1600, height: 900 },
  });
  q.add(shot("a"));
  q.add(shot("b"));
  q.targets(
    [
      { id: "b", x: 500, y: 100, width: 104, height: 68 },
      { id: "a", x: 610, y: 100, width: 104, height: 68 },
    ],
    false,
  );
  assert.equal(q.frames.length, 0);
  q.targets(
    [
      { id: "a", x: 720, y: 120, width: 104, height: 68 },
      { id: "b", x: 500, y: 100, width: 104, height: 68 },
    ],
    true,
  );
  assert.equal(q.frames.length, 2);
  const start = q.frames[0].start;
  now = 200;
  q.targets([{ id: "a", x: 830, y: 150, width: 104, height: 68 }]);
  assert.equal(q.frames[0].start, start);
  assert.ok(q.frames[0].destination.x > 800);
  q.retain(["a"]);
  assert.deepEqual(q.ids, ["a"]);
  now = 681;
  q.tick();
  assert.deepEqual(q.ids, []);
  q.add(shot("orphan"));
  now = 2200;
  q.tick();
  assert.deepEqual(q.ids, []);
  assert.ok(changed >= 6);
});
test("reduced-motion and unknown-origin flights fade at destination; cancellation clears all", () => {
  let now = 0;
  const q = new FlightQueue({ now: () => now });
  q.add({ id: "file", base64: "a", width: 10, height: 10 });
  q.targets([{ id: "file", x: 1, y: 1, width: 30, height: 30 }]);
  assert.equal(q.frames[0].reduced, true);
  now = 181;
  q.tick();
  assert.equal(q.ids.length, 0);
  q.add({ id: "x", base64: "", width: 1, height: 1 });
  q.clear();
  assert.equal(q.ids.length, 0);
});
test("Ghost supports interruption, reduced motion, continuous completion and finite complete rig", () => {
  const sim = new Sim(0.37);
  let time = 0;
  for (let i = 0; i < 2400; i++) {
    if (i % 120 === 0) sim.setState(i % 240 ? "working" : "default");
    sim.update(1 / 60);
    time += 1 / 60;
    const p = notchPose(sim.pose, {
      time,
      blend: 0.6,
      busy: true,
      completion: i > 2000 ? (i - 2000) / 60 : null,
    });
    for (const [k, v] of Object.entries(p))
      if (k !== "w") assert.ok(Number.isFinite(v), k);
  }
  assert.equal(completionWeight(0), 0);
  assert.equal(completionWeight(1.25), 0);
  assert.equal(completionWeight(0.5, true), 0);
  const p = notchPose(sim.pose, { reduced: true, busy: true });
  assert.equal(p.y, -2.25);
  assert.equal(p.roll, 0);
});
test("shared reading structure supports review, streaming failure, localization and inert model HTML", () => {
  const rows = readingSections({
    answer: "B",
    detail: "explanation",
    needsReview: true,
    language: "zh",
  });
  assert.deepEqual(
    rows.map((x) => x.kind),
    ["section", "text", "text", "section", "text"],
  );
  assert.equal(rows[1].size, 24);
  const html = readingHTML({
    answer: '<img onerror="bad()">',
    explanationFailed: true,
    language: "en",
  });
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img/);
  assert.match(html, /original answer is preserved/);
});

test("billing return accepts existing Mac contract but never accepts credentials or arbitrary destinations", async () => {
  const { billingDestination } = await import("../core/platform-actions.mjs");
  assert.equal(billingDestination("notchspi://plus"), "account");
  assert.equal(billingDestination("notchspi://account?paid=true"), "account");
  for (const raw of [
    "https://example.com",
    "notchspi://token@plus",
    "notchspi://plus/evil",
    "notchspi://evil",
    "notchspi://plus:42",
  ])
    assert.equal(billingDestination(raw), null);
});
test("Windows cancellation targets the owned process tree with native taskkill and no shell", async () => {
  const { terminateTree } = await import("../core/platform-actions.mjs");
  const calls = [];
  const child = {
    pid: 456,
    exitCode: null,
    kill: () => calls.push("fallback"),
  };
  terminateTree(child, {
    platform: "win32",
    spawnImpl: (file, args, options) => {
      calls.push({ file, args, options });
      return {
        once() {
          return this;
        },
      };
    },
  });
  assert.match(calls[0].file, /System32\\taskkill.exe$/);
  assert.deepEqual(calls[0].args, ["/PID", "456", "/T", "/F"]);
  assert.equal(calls[0].options.shell, false);
  terminateTree(
    { ...child, exitCode: 0 },
    {
      platform: "win32",
      spawnImpl: () => assert.fail("finished process must not be killed"),
    },
  );
});

test("shared capture cards reserve stable slots and flight lands on the exact painted card", async () => {
  const { captureCard, captureStyle } =
    await import("../generated/ui/capture.mjs");
  const image = { width: 640, height: 360 },
    slot = { x: 0, y: 0, width: 128, height: 80 },
    card = captureCard(image, slot);
  assert.equal((card.width - 8) / (card.height - 8), 16 / 9);
  assert.equal(captureStyle.cardHeight, 80);
  const q = new FlightQueue({ now: () => 0 });
  q.add({ id: "x", base64: "x", ...image, sourceBounds: slot });
  q.targets([{ id: "x", ...card }]);
  assert.deepEqual(q.frames[0].destination, card);
  assert.deepEqual(
    captureCard(image, { ...slot, width: 52, height: 30 }, true),
    { ...slot, width: 52, height: 30 },
  );
});

test("capture shelf waits for every flight before compacting and keeps waiting slots large", async () => {
  const { captureIsCompact } = await import("../generated/ui/capture.mjs");
  assert.equal(
    captureIsCompact({ status: "running", answer: "", flying: [] }),
    false,
  );
  assert.equal(
    captureIsCompact({ status: "done", answer: "B", flying: ["photo"] }),
    false,
  );
  assert.equal(
    captureIsCompact({ status: "done", answer: "B", flying: [] }),
    true,
  );
  assert.equal(
    captureIsCompact({ status: "collecting", collecting: true, answer: "B" }),
    false,
  );
});
