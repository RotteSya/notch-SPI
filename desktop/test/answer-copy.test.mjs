import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canCopyAnswer } from "../generated/ui/reading.mjs";

const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/answer-copy/cases.json", import.meta.url,
)));
for (const scenario of cases) test(`Shared answer copy: ${scenario.id}`, () => {
  assert.equal(canCopyAnswer(scenario.input), scenario.allowed);
});
