import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Intake,
  product,
  capturePrompt,
  spring,
  close,
  contentOpacity,
  acceptsVersion,
} from "../core/product.mjs";
import { compose, visibleStream, parseAnswer } from "../core/answer.mjs";
import { OfficialStream, SSEFramer } from "../core/stream.mjs";
import { AutoSession, PersonaSession } from "../core/sessions.mjs";
const fixtures = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../Tests/Fixtures/objective-result-v1/cases.json",
      import.meta.url,
    ),
  ),
);
for (const fixture of fixtures)
  test(`Shared Objective fixture: ${fixture.id}`, () => {
    const result = compose(fixture.raw);
    assert.equal(result.parserPath, fixture.path);
    assert.equal(result.state, fixture.state);
    assert.deepEqual(result.violations, fixture.violations);
  });
test("Machine prefixes never reach screen/clipboard at any chunk boundary", () => {
  for (const marker of [
    "NSPI_RESULT_V1:",
    "NSPI_NO_RESULT_V1:",
    "NSPI_CONTEXT_V1:",
    "NSPI_ERROR_V1:",
  ])
    for (let i = 1; i <= marker.length; i++)
      assert.equal(
        visibleStream("FINAL: A\n" + marker.slice(0, i)),
        "FINAL: A",
      );
  for (let i = 1; i < 6; i++)
    assert.equal(
      parseAnswer("work\nFINAL:".slice(0, 5 + i), true).working,
      "work",
    );
});
test("No-result blocks fallback including contradictory FINAL", () => {
  assert.equal(
    compose('FINAL: A\nNSPI_NO_RESULT_V1: {"v":1,"reason":"multiple_targets"}')
      .finalAnswer,
    null,
  );
  assert.equal(
    compose('NSPI_NO_RESULT_V1: {"v":1,"reason":"multiple_targets"}')
      .noResultReason,
    "multiple_targets",
  );
});
test("Intake waits for second image; capture/preview pause; cancel fences late callback", () => {
  const r = new Intake();
  let token = r.begin(0);
  r.finish(token, "first", 0);
  assert.equal(r.deadline, null);
  token = r.begin(1);
  r.finish(token, "second", 1);
  assert.equal(r.deadline, 1 + product.capture.submitDelay * 1000);
  r.preview(true, 2);
  assert.equal(r.take(99999), null);
  r.preview(false, 3);
  assert.equal(r.deadline, 3 + product.capture.submitDelay * 1000);
  token = r.begin(100);
  r.finish(token, null, 200);
  assert.equal(r.deadline, 103 + product.capture.submitDelay * 1000);
  token = r.begin(201);
  r.cancel();
  assert.equal(r.finish(token, "late", 300), false);
  assert.deepEqual(r.items, []);
});
test("Intake deletion resets countdown and cannot submit twice", () => {
  const r = new Intake();
  for (let i = 0; i < 4; i++) {
    let token = r.begin(i);
    r.finish(token, i, i);
  }
  assert.equal(r.begin(5), null);
  const removed = r.remove(2, 10);
  assert.equal(removed, 2);
  r.restore(removed, 2, 20);
  assert.deepEqual(
    r.take(20 + product.capture.submitDelay * 1000),
    [0, 1, 2, 3],
  );
  assert.equal(r.take(99999), null);
});
test("Motion closes monotonically, expands with original overshoot, reverses without alpha jump", () => {
  assert.equal(spring(0), 0);
  assert.ok(spring(0.5) > 1);
  let last = 0;
  for (let i = 0; i <= 100; i++) {
    const next = close(i / 100);
    assert.ok(next >= last);
    last = next;
  }
  assert.equal(close(1), 1);
  assert.equal(contentOpacity(0, 0.36, false), 0.36);
  assert.equal(contentOpacity(0, 0.36, true), 0.36);
});
const usage = {
  type: "usage",
  input_tokens: 5,
  output_tokens: 10,
  questions_charged: 1,
  balance_questions: 29,
  capture_id: "capture",
  balance_version: "9007199254740993",
  settlement_status: "settled",
};
function stream(values) {
  return values
    .map(
      (v) =>
        "data: " + (typeof v === "string" ? v : JSON.stringify(v)) + "\r\n\r\n",
    )
    .join("");
}
test("SSE frames BOM, CRLF, UTF-8 one byte at a time and enforces terminal receipt", () => {
  const f = new SSEFramer(),
    d = new OfficialStream("capture", false),
    bytes = new TextEncoder().encode(
      "\ufeff:comment\r\n" +
        stream([{ type: "delta", text: "FINAL: 答案" }, usage, "[DONE]"]),
    );
  for (const b of bytes)
    for (const event of f.feed(Uint8Array.of(b))) d.accept(event);
  f.finish();
  assert.equal(d.finish().questions_charged, 1);
  assert.equal(d.content, "FINAL: 答案");
});
for (const [label, values] of Object.entries({
  missingReceipt: [{ type: "delta", text: "FINAL: A" }, "[DONE]"],
  duplicateReceipt: [{ type: "delta", text: "FINAL: A" }, usage, usage],
  deltaAfterUsage: [
    { type: "delta", text: "FINAL: A" },
    usage,
    { type: "delta", text: "B" },
  ],
  wrongID: [
    { type: "delta", text: "FINAL: A" },
    { ...usage, capture_id: "other" },
  ],
  negative: [
    { type: "delta", text: "FINAL: A" },
    { ...usage, balance_questions: -1 },
  ],
  chargeWithoutContent: [usage],
  truncated: [{ type: "delta", text: "FINAL: A" }, usage],
}))
  test(`SSE rejects ${label}`, () => {
    const d = new OfficialStream("capture", false);
    assert.throws(() => {
      for (const v of values)
        d.accept(typeof v === "string" ? v : JSON.stringify(v));
      d.finish();
    });
  });
test("Version comparisons preserve integers beyond 2^53", () => {
  assert.equal(acceptsVersion("9007199254740992", "9007199254740993"), false);
  assert.equal(acceptsVersion("9007199254740994", "9007199254740993"), true);
  assert.equal(acceptsVersion("1e3", "2"), false);
});
test("Prompts use shared templates and do not expand user content", () => {
  const p = capturePrompt({
    mode: "personality",
    persona: { name: "{{sessionContext}}", description: "test" },
    sessionContext: "CONTEXT",
  });
  assert.match(p.system, /\{\{sessionContext\}\}/);
  assert.match(p.system, /CONTEXT/);
  assert.match(capturePrompt({ language: "ja" }).system, /Japanese/);
  assert.match(
    capturePrompt({ objective: true }).system,
    /OBJECTIVE RESULT V1/,
  );
});
const autoFixtures = JSON.parse(
  fs.readFileSync(new URL("../../Tests/Fixtures/auto-session/cases.json", import.meta.url)),
);
assert.ok(autoFixtures.length > 0);
for (const fixture of autoFixtures)
  test(`Shared AutoSession fixture: ${fixture.id}`, () => {
    const session = new AutoSession();
    session.start(20, 0);
    session.succeeded(100, false, 0);
    for (const [index, value] of fixture.luma.entries()) {
      assert.equal(
        session.tick(new Array(640).fill(value), (index + 1) * 500),
        fixture.triggerTicks.includes(index),
        `${fixture.id}, tick ${index}`,
      );
      assert.equal(session.active, true);
      assert.equal(session.count, 1, "Polling must not count a new success");
    }
  });

test("Auto mode counts only successes, waits for changed and stable screen; stops at cap/idle/failures", () => {
  const a = new AutoSession();
  a.start(5, 0);
  a.succeeded(10, false, 0);
  const h = new Array(640).fill(0),
    n = new Array(640).fill(50);
  assert.equal(a.tick(h, 10), false);
  assert.equal(a.tick(n, 20), false);
  assert.equal(a.tick(n, 30), false);
  assert.equal(a.tick(n, 40), true);
  a.start(-1, 0);
  a.succeeded(10, false, 0);
  a.tick(null, 1);
  a.tick(null, 2);
  a.tick(null, 3);
  assert.equal(a.active, false);
  a.start(-1, 0);
  a.succeeded(10, false, 0);
  a.tick(h, 900000);
  assert.equal(a.active, false);
});
test("Personality unavailable barrier and scope expiry", () => {
  const s = new PersonaSession();
  assert.match(s.begin("a", 0), /"status":"none"/);
  s.finish({
    last: { ordinal: "1", choice: "A", summary: "x" },
    referenceable: [],
  });
  assert.match(s.begin("a", 1), /available/);
  s.finish(null);
  assert.match(s.begin("a", 2), /unavailable/);
  assert.match(s.begin("b", 3), /"status":"none"/);
});
