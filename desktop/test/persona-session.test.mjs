import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PersonaSession } from "../core/sessions.mjs";
const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/persona-session/cases.json", import.meta.url,
)));
const item = { ordinal: "1", choice: "A", summary: "scene" };
for (const scenario of cases) test(`Shared persona session: ${scenario.id}`, () => {
  const session = new PersonaSession(), tokens = [];
  for (const step of scenario.steps) {
    if (step.action === "begin") { session.begin(step.scope, step.time); tokens.push(session.currentToken); }
    if (step.action === "finish") session.finish(step.valid ? { last: item, referenceable: [item] } : null, step.time, step.tokenIndex === undefined ? session.currentToken : tokens[step.tokenIndex]);
    if (step.action === "reset") session.reset();
    if (step.action === "check") {
      const value = JSON.parse(session.contextBlock().split("\n")[1]);
      assert.equal(value.immediate_previous.status, step.status);
      assert.equal(value.immediate_previous.capture_sequence ?? null, step.sequence);
      assert.deepEqual(value.older_referenceable.map((x) => x.capture_sequence), step.older);
    }
  }
});
