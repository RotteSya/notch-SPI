import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validFreeTrial } from "../generated/free-trial.mjs";
import { validAccount } from "../core/stream.mjs";
const cases = JSON.parse(fs.readFileSync(new URL("../../Tests/Fixtures/free-trial/cases.json", import.meta.url)));
for (const scenario of cases) test(`Shared free trial: ${scenario.id}`, () => {
  assert.equal(validFreeTrial(scenario.snapshot), scenario.valid);
  assert.equal(validAccount({balance_questions: 10, balance_version: "3", free_trial: scenario.snapshot}), scenario.valid);
});
