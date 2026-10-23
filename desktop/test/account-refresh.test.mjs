import test from "node:test";
import assert from "node:assert/strict";
import { OfficialClient } from "../core/official.mjs";

function setup(respond) {
  const events = [], calls = [];
  const client = new OfficialClient({
    base: "https://example.test",
    store: { async get() { return "dev_existingaccount"; }, async set() {} },
    onChange() { events.push(client.accountSync.status); },
    async fetchImpl(url, options) {
      calls.push({ route: new URL(url).pathname, method: options.method });
      return respond(new URL(url).pathname);
    },
  });
  return { client, events, calls };
}
const success = route => Response.json(route === "/v1/account"
  ? { balance_questions: 17, balance_version: "1" }
  : route === "/v1/plus" ? { status: "inactive", available: false }
  : { schema_version: 1 });

test("opening account can publish loading then real balance; simultaneous refreshes share one request", async () => {
  const { client, calls, events } = setup(success);
  await client.initialize();
  const first = client.refresh(), second = client.refresh();
  assert.equal(first, second);
  assert.equal(client.accountSync.status, "loading");
  await first;
  assert.deepEqual(events, ["loading", "ready"]);
  assert.equal(client.account.balance_questions, 17);
  assert.equal(client.plus.status, "inactive");
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.method === "GET"));
});
test("failed account read is explicit and retryable, preserves the credential and never claims trial", async () => {
  let failed = true;
  const { client, calls } = setup(route => failed && route === "/v1/account"
    ? Response.json({ error: { message: "Account service unavailable" } }, { status: 503 })
    : success(route));
  await client.initialize();
  await assert.rejects(client.refresh(), /Account service unavailable/);
  assert.equal(client.accountSync.status, "error");
  assert.equal(client.accountSync.error, "Account service unavailable");
  assert.equal(client.account, null);
  assert.equal(client.token, "dev_existingaccount");
  failed = false;
  await client.refresh();
  assert.equal(client.accountSync.status, "ready");
  assert.equal(client.accountSync.error, null);
  assert.equal(client.account.balance_questions, 17);
  assert.ok(calls.every(call => call.method === "GET"));
});
test("subscription endpoint failure does not disguise a valid account balance", async () => {
  const { client } = setup(route => route === "/v1/plus"
    ? Response.json({ error: { message: "Subscription unavailable" } }, { status: 503 })
    : success(route));
  await client.initialize();
  await client.refresh();
  assert.equal(client.account.balance_questions, 17);
  assert.equal(client.accountSync.status, "ready");
  assert.equal(client.accountSync.plusError, "Subscription unavailable");
  assert.equal(client.plus, null);
});
test("an old account's refresh cannot replace the newly restored account or its refresh state", async () => {
  let rejectOld, oldStarted;
  const started = new Promise(resolve => { oldStarted = resolve; });
  const { client } = setup(route => route === "/v1/account" && client.generation === 0
    ? new Promise((_, reject) => { rejectOld = reject; oldStarted(); })
    : success(route));
  await client.initialize();
  const old = client.refresh();
  await started;
  // Same generation transition as a successfully validated restore().
  client.generation++;
  client.token = "dev_restoredaccount";
  await client.refresh();
  rejectOld(new Error("old account failed"));
  await old;
  assert.equal(client.accountSync.status, "ready");
  assert.equal(client.accountSync.error, null);
  assert.equal(client.account.balance_questions, 17);
});
