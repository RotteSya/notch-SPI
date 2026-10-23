import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OfficialClient } from "../core/official.mjs";

const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/capture-isolation/cases.json", import.meta.url,
)));
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
for (const scenario of cases) test(`Shared capture isolation: ${scenario.id}`, async () => {
  const abort = new AbortController();
  let posts = 0, statuses = 0, deltas = 0, nextDeltas = 0, nextPromise;
  const receipt = (id) => ({
    type: "usage", capture_id: id, operation: "solve", terminal_state: "usable",
    settlement_status: "settled", questions_charged: 1, usable_result: true,
    balance_questions: 29, held_questions: 0, balance_version: "3",
    can_retry: false, can_recover: true, input_tokens: 2, output_tokens: 1,
  });
  const payload = (id) => frame({ type: "delta", text: "first" }) +
    frame({ type: "delta", text: "late" }) + frame(receipt(id)) + "data: [DONE]\n\n";
  const invalidate = () => {
    if (scenario.action === "replaceAccount") {
      client.generation++;
      client.token = "dev_replacement";
      client.account = { balance_questions: 100, balance_version: "1" };
    } else if (scenario.action !== "none") abort.abort();
  };
  const client = new OfficialClient({
    base: "http://127.0.0.1:9", development: true, store: {},
    fetchImpl: async (_url, options) => {
      // Deliberately ignore abort: late bytes must be fenced by the client itself.
      if (options.method === "GET") {
        statuses++;
        invalidate();
        return new Response(JSON.stringify(receipt("old")), {
          headers: { "content-type": "application/json" },
        });
      }
      posts++;
      const id = JSON.parse(options.body).capture_id;
      return new Response(scenario.phase === "status" ? "" : payload(id), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  client.token = "dev_original";
  client.account = { balance_questions: 100, balance_version: "1" };
  const run = (id) => ({ id, body: { capture_id: id }, owner: client.owner(),
    token: client.token, base: client.base, createdAt: Date.now(), screenQuery: true });
  const old = run("old");
  const promise = client.stream(old, { signal: abort.signal, onDelta: () => {
    deltas++;
    if (deltas !== 1) return;
    invalidate();
    if (scenario.action === "nextQuestion") {
      nextPromise = client.stream(run("new"), { onDelta: () => nextDeltas++ });
    }
  }});
  if (scenario.expectedSuccess) await promise;
  else await assert.rejects(promise);
  if (nextPromise) {
    const result = await nextPromise;
    assert.equal(result.receipt.capture_id, "new");
    assert.equal(nextDeltas, 2);
  }
  assert.equal(deltas, scenario.expectedDeltas);
  assert.equal(Number(Boolean(old.receipt)), scenario.expectedReceipts);
  assert.equal(old.status, undefined);
  assert.equal(statuses, scenario.expectedStatusRequests);
  assert.equal(posts, scenario.action === "nextQuestion" ? 2 : 1, "No automatic replay");
  if (!scenario.expectedSuccess && !nextPromise) assert.equal(client.account.balance_questions, 100);
});
