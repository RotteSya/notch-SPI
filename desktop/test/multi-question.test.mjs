// Regression for "several screenshots submitted, one answer shown". The multi-image task line
// used to tell the model to answer only "the problem shown in the LAST image"; independent
// problems in earlier images were dropped before any parsing. These tests pin the corrected
// task on the request and prove a complete answer list survives parsing and the answer card.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { capturePrompt, contextTask, taskText } from "../core/product.mjs";
import { compose, parseAnswer, visibleStream } from "../core/answer.mjs";
import { directAPI } from "../core/providers.mjs";

const scenarios = JSON.parse(
  fs.readFileSync(
    new URL("../../Tests/Fixtures/answer-coverage/cases.json", import.meta.url),
  ),
);
const items = (final) =>
  final
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter(Boolean);

test("Multi-image task answers every independent problem, not only the last image", () => {
  assert.equal(contextTask.includes("problem shown in the LAST image"), false);
  assert.equal(
    contextTask.includes("The earlier images are reference material"),
    false,
  );
  for (const required of [
    "tutor me on every problem they show",
    "capture order",
    "is context for the problem it belongs to",
    "are still one problem, so answer it once",
    // A single problem keeps its usual unlabelled answer.
    "exactly as you would for a single image and without a label",
    "do not answer only the last image's",
    "answer every one of them in capture order",
    "label each result with its on-screen question number",
    "put all labelled results in that single line, separated by semicolons",
    "never silently drop one",
    // An unreadable image is listed, not skipped.
    "Account for every image before you answer",
    "still counts as a problem",
    "instead of guessing or skipping it",
    "still answer the others",
    "needs retake",
    "Such a partial result needs review: it is never ready or complete",
    "it is a retake only when not a single problem can be answered",
  ])
    assert.ok(contextTask.includes(required), required);
});

test("Single-image task is unchanged", () => {
  const legacy = capturePrompt({ language: "zh", objective: false, mode: "tutor" });
  assert.equal(
    taskText(legacy.task, 1),
    "Analyze the attached screenshot image, then tutor me on the problem it shows.",
  );
  const objective = capturePrompt({ language: "zh", objective: true, mode: "tutor" });
  assert.equal(taskText(objective.task, 1).includes("every problem they show"), false);
});

for (const protocol of ["openai", "anthropic"])
  test(`${protocol}: a 1-image request keeps its task and a 2–4 image request carries the multi-image contract`, async () => {
    for (const count of [1, 2, 3, 4]) {
      let body;
      await directAPI({
        images: Array.from({ length: count }, (_, i) => ({ base64: String(i) })),
        settings: {
          protocol,
          endpoint: "https://provider.invalid/v1/messages",
          model: "fixture",
          language: "zh",
        },
        mode: "tutor",
        key: "test-only",
        signal: new AbortController().signal,
        onDelta: () => {},
        fetchImpl: async (_url, o) => {
          body = JSON.parse(o.body);
          const event = (x) =>
            "data: " + (typeof x === "string" ? x : JSON.stringify(x)) + "\n\n";
          return new Response(
            protocol === "openai"
              ? event({
                  choices: [{ delta: { content: "FINAL: C" }, finish_reason: "stop" }],
                }) + event("[DONE]")
              : event({
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "FINAL: C" },
                }) +
                  event({ type: "message_delta", delta: { stop_reason: "end_turn" } }) +
                  event({ type: "message_stop" }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      });
      const texts = body.messages
        .at(-1)
        .content.filter((part) => part.type === "text")
        .map((part) => part.text);
      assert.equal(texts.length, 1);
      if (count === 1)
        assert.equal(texts[0].includes("every problem they show"), false);
      else assert.equal(texts[0], taskText(contextTask, count));
    }
  });

for (const scenario of scenarios)
  test(`Answer coverage: ${scenario.id}`, () => {
    const result = compose(scenario.raw, scenario.protocol);
    assert.equal(result.parserPath, scenario.path);
    assert.equal(result.state, scenario.state);
    assert.equal(result.finalAnswer, scenario.final);
    // The answer card: the whole list, in order, nothing demoted below the card.
    const card = parseAnswer(scenario.raw);
    assert.equal(card.final, scenario.final);
    assert.equal(card.overflow, "");
    assert.deepEqual(items(card.final), scenario.items);
    assert.equal(visibleStream(scenario.raw).includes("NSPI_RESULT_V1"), false);
    // Streamed, the card only ever shows a prefix of the full list and ends on all of it.
    for (let end = 1; end <= scenario.raw.length; end++) {
      const shown = parseAnswer(scenario.raw.slice(0, end), true).final;
      if (shown !== null)
        assert.ok(scenario.final.startsWith(shown), `${end}: ${shown}`);
    }
  });

test("Answer coverage fixture spans the four question shapes", () => {
  const byID = Object.fromEntries(scenarios.map((s) => [s.id, s]));
  assert.equal(byID["single-question"].items.length, 1);
  assert.equal(byID["one-question-across-images"].images, 3);
  assert.equal(byID["one-question-across-images"].items.length, 1);
  assert.equal(byID["subparts-one-question"].items.length, 3);
  assert.equal(byID["independent-questions-one-image"].items.length, 4);
  assert.equal(byID["independent-questions-across-images"].images, 4);
  assert.equal(byID["independent-questions-across-images"].items.length, 6);
  assert.equal(byID["one-unreadable-among-independent"].state, "review");
});

const machine = (kind, answer) =>
  "NSPI_RESULT_V1: " +
  JSON.stringify({ v: 1, kind, state: "ready", answer, reason: "none" });

test("One FINAL line per question needs review and keeps every answer readable", () => {
  const raw =
    "Q1 work\nFINAL: A\nQ2 work\nFINAL: C\nQ3 work\nFINAL: B\n" +
    machine("single_choice", "B");
  const result = compose(raw);
  assert.equal(result.parserPath, "legacy_fallback");
  assert.equal(result.state, "review");
  assert.deepEqual(result.violations, ["finalMismatch"]);
  const card = parseAnswer(raw);
  assert.equal(card.final, "B");
  assert.deepEqual(card.working.split("\n"), ["Q1 work", "A", "Q2 work", "C", "Q3 work"]);
});

test("Answers continued after FINAL need review and stay below the card", () => {
  const raw = "FINAL: Q1: A\nQ2: C\nQ3: B\n" + machine("other", "Q1: A");
  const result = compose(raw);
  assert.equal(result.parserPath, "legacy_fallback");
  assert.equal(result.state, "review");
  const card = parseAnswer(raw);
  assert.equal(card.final, "Q1: A");
  assert.equal(card.overflow, "Q2: C\nQ3: B");
});

test("The same conclusion stated twice stays a clean result", () => {
  const result = compose("FINAL: B\n\nFINAL: **b**\n" + machine("single_choice", "B"));
  assert.equal(result.parserPath, "v1");
  assert.equal(result.state, "ready");
});
