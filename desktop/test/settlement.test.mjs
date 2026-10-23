import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validSettlement } from "../core/stream.mjs";

const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/settlement/cases.json", import.meta.url,
)));
for (const scenario of cases) test(`Shared settlement: ${scenario.id}`, () => {
  assert.equal(validSettlement(scenario.snapshot, scenario.snapshot.capture_id), scenario.valid);
});
