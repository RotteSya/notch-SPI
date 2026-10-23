import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PersonaSession } from "../core/sessions.mjs";
const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/personality-completion/cases.json", import.meta.url,
)));
for (const scenario of cases) test(`Shared personality completion: ${scenario.id}`, () => {
  const session = new PersonaSession();
  session.begin("a", 0);
  const item = { ordinal: "1", summary: "seed", choice: "A" };
  session.finish({ last: item, referenceable: [item] }, 0);
  session.begin("a", 1);
  const token = session.currentToken;
  if (scenario.stale) session.begin("a", 2);
  const result = session.complete(scenario.raw, { token, currentScope: scenario.scopeChanged ? "b" : "a",
    transportOK: scenario.transportOK, now: 3 });
  assert.equal(result.primary, scenario.primary);
  assert.equal(result.sessionMutation, scenario.mutation);
  assert.equal(session.records.length, scenario.count);
  const context = JSON.parse(session.contextBlock().split("\n")[1]);
  assert.equal(context.immediate_previous.status, scenario.status);
  assert.deepEqual(context.older_referenceable.map((x) => x.summary), scenario.summaries);
});
