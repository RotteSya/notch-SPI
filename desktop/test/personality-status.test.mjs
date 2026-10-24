import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { personalityStatusText, personalityLowQuotaThreshold } from "../generated/ui/reading.mjs";

const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/personality-status/cases.json", import.meta.url,
)));
for (const scenario of cases) test(`Shared personality status: ${scenario.id}`, () => {
  assert.equal(personalityStatusText(scenario.primary, scenario), scenario.text);
});
test("Desktop infers the same low-quota suffix from the shared threshold", () => {
  assert.match(personalityStatusText("done", { questionsRemaining: personalityLowQuotaThreshold }), /Running low$/);
  assert.doesNotMatch(personalityStatusText("done", { questionsRemaining: personalityLowQuotaThreshold + 1 }), /Running low/);
  assert.equal(personalityStatusText("done"), "Done");
});
