import test from "node:test";
import assert from "node:assert/strict";
import {
  Onboarding,
  onboardingCheckpoint,
  onboardingCopy,
  guideSteps,
} from "../generated/ui/onboarding.mjs";
import { practiceHTML } from "../core/practice.mjs";
import { Intake } from "../core/product.mjs";

test("guide checkpoints preserve Mac interruption and multi-image resume semantics", () => {
  assert.equal(onboardingCheckpoint("working"), "capture");
  assert.equal(onboardingCheckpoint("working", true), "multiple");
  assert.equal(onboardingCheckpoint("permission", true), "multiple");
  for (const step of ["firstAnswer", "multiCapture", "collecting"])
    assert.equal(onboardingCheckpoint(step), "multiple");
  assert.equal(onboardingCheckpoint("success"), "trial");
  assert.equal(onboardingCheckpoint("unknown"), "welcome");
  const g = new Onboarding();
  g.move("capture");
  g.startCapture("single");
  g.dismiss();
  const resumed = new Onboarding(g.saved);
  assert.equal(resumed.active, false);
  assert.equal(resumed.done, false);
  resumed.resume();
  assert.equal(resumed.step, "capture");
  assert.equal(resumed.active, true);
});
test("guide accepts only the requested capture mode and never advances from failure, cancel or dismissal", () => {
  const g = new Onboarding();
  assert.equal(g.startCapture("single"), false);
  g.finished(true);
  assert.equal(g.step, "welcome");
  g.move("capture");
  assert.equal(g.startCapture("multiple"), false);
  assert.equal(g.startCapture("single"), true);
  g.finished(false);
  assert.equal(g.failed, true);
  assert.equal(g.step, "working");
  g.cancel();
  assert.equal(g.step, "capture");
  assert.equal(g.failed, false);
  g.startCapture("single");
  g.dismiss();
  g.finished(true);
  assert.equal(g.done, false);
  assert.equal(g.saved.step, "capture");
});
test("real intake events and confirmed usable results advance single and multi-image exercises", () => {
  const g = new Onboarding(),
    intake = new Intake();
  g.move("capture");
  g.startCapture("single");
  g.finished(true);
  assert.equal(g.step, "firstAnswer");
  g.multiple = true;
  g.move("multiCapture");
  for (let i = 0; i < 2; i++) {
    assert.equal(g.startCapture("multiple"), true);
    const token = intake.begin(i * 100);
    intake.finish(token, { id: String(i) }, i * 100);
    if (i === 0) assert.equal(intake.take(10000), null);
  }
  assert.equal(g.step, "collecting");
  const batch = intake.take(4101);
  assert.equal(batch.length, 2);
  g.submitting();
  g.finished(true);
  assert.equal(g.step, "success");
  assert.equal(g.saved.step, "trial");
  assert.equal(g.done, false);
  g.move("trial");
  assert.equal(g.claiming, false);
  g.complete();
  assert.equal(g.active, false);
  assert.equal(g.saved.done, true);
});
test("practice is local, capturable, localized and escapes configured shortcut text", () => {
  for (const language of ["zh", "ja", "en"]) {
    for (const step of guideSteps)
      assert.equal(typeof onboardingCopy(step, language).body, "string");
    const html = practiceHTML({
      language,
      shortcut: "<script>bad()</script>",
      multiple: true,
    });
    assert.match(html, /120/);
    assert.match(html, /60 km\/h/);
    assert.match(html, /id="question" hidden/);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.ok(!html.includes("<script>bad()"));
    assert.ok(!html.includes("http"));
    assert.ok(!/FINAL:|data-answer|correct-answer/.test(html));
  }
});

test("trial UI follows the server state and old completed settings do not erase an explicit restart", () => {
  assert.match(
    onboardingCopy("trial", "en", { status: "active" }).title,
    /ready/,
  );
  assert.match(
    onboardingCopy("trial", "en", { status: "expired" }).title,
    /ended/,
  );
  const g = new Onboarding({ done: false, step: "multiple" }, true);
  assert.equal(g.active, true);
  assert.equal(g.step, "multiple");
});
