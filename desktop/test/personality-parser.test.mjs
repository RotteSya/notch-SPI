import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { composePersonality, personality } from "../core/answer.mjs";
const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/personality-parser/cases.json", import.meta.url,
)));
for (const scenario of cases) test(`Shared personality parser: ${scenario.id}`, () => {
  assert.deepEqual(composePersonality(scenario.raw, scenario.streaming), scenario.expected);
  const ui = personality(scenario.raw, scenario.streaming);
  assert.equal(ui.visible, scenario.expected.visibleChoices);
  assert.deepEqual(ui.context, scenario.expected.context);
  assert.equal(ui.error, scenario.expected.errorCode);
});
