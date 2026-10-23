import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { OfficialClient, serviceURL } from "../core/official.mjs";
import { compose } from "../core/answer.mjs";
for (const k of Object.keys(process.env))
  if (
    ![
      "PATH",
      "Path",
      "HOME",
      "USERPROFILE",
      "SystemRoot",
      "TMP",
      "TEMP",
      "TMPDIR",
      "NODE_TEST_CONTEXT",
    ].includes(k)
  )
    delete process.env[k];
Object.assign(process.env, {
  DB_PATH: ":memory:",
  OFFICIAL_PROVIDER: "mock",
  OBJECTIVE_RESULT_V1_PROVIDER: "mock",
  PAYMENT_PROVIDER: "stub",
  FREE_TRIAL_ENABLED: "1",
  SCREEN_QUERY_ENABLED: "1",
  EXPLANATION_ENABLED: "1",
  ENABLED_SUPPORT_PROFILES: "general",
  OBJECTIVE_RESULT_V1_BPS: "10000",
  OBJECTIVE_RESULT_EXPERIMENT_SALT: "test-local-only",
  LOG_LEVEL: "silent",
});
const { buildApp } = await import("../../server/src/index.ts");
const sharp = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("sharp");
const jpeg = await sharp({
  create: { width: 16, height: 16, channels: 3, background: "#fff" },
})
  .jpeg()
  .toBuffer();
const images = [{ base64: jpeg.toString("base64") }];
const settings = {
  language: "zh",
  reasoning: "low",
  allowPurchasedCredits: true,
};
let app,
  base,
  providerCalls = 0,
  responseKind = "ready";
const provider = {
  name: "mock",
  async stream(req, delta, signal) {
    providerCalls++;
    if (responseKind === "error") throw new Error("Injected model failure");
    if (responseKind === "slow") {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    }
    const value =
      req.purpose === "explain"
        ? JSON.stringify({
            consistent: true,
            explanation: "B follows from the supplied question.",
          })
        : responseKind === "retake"
          ? 'NSPI_RESULT_V1: {"v":1,"kind":"short_fill","state":"retake","answer":null,"reason":"cropped"}'
          : responseKind === "empty"
            ? 'NSPI_NO_RESULT_V1: {"v":1,"reason":"multiple_targets"}'
            : responseKind === "review"
              ? 'FINAL: A or C\nNSPI_RESULT_V1: {"v":1,"kind":"multiple_choice","state":"review","answer":"A or C","reason":"ambiguous_options"}'
              : 'FINAL: B\nNSPI_RESULT_V1: {"v":1,"kind":"single_choice","state":"ready","answer":"B","reason":"none"}';
    for (const chunk of value.match(/.{1,7}|\n/g)) {
      signal.throwIfAborted();
      delta(chunk);
    }
    return { inputTokens: 10, outputTokens: 10 };
  },
};
const memory = () => {
  const values = new Map();
  return {
    async get(k) {
      return values.get(k) ?? null;
    },
    async set(k, v) {
      values.set(k, v);
    },
  };
};
before(async () => {
  app = await buildApp({ provider });
  await app.listen({ host: "127.0.0.1", port: 0 });
  base = "http://127.0.0.1:" + app.server.address().port;
});
after(async () => {
  await app.close();
});
async function client() {
  const c = new OfficialClient({ base, store: memory(), development: true });
  await c.initialize();
  await c.register();
  await c.claimTrial();
  return c;
}
test("URL validation disallows credentials, insecure production and query fragments", () => {
  assert.throws(() => serviceURL("http://example.com"));
  assert.throws(() => serviceURL("https://user:secret@example.com"));
  assert.throws(() => serviceURL("https://example.com/?token=x"));
  assert.equal(
    serviceURL("http://127.0.0.1:1234", true),
    "http://127.0.0.1:1234",
  );
});
test("Actual server registration singleflight and explicit trial, never implicit claim", async () => {
  const c = new OfficialClient({ base, store: memory(), development: true });
  await c.initialize();
  const [a, b] = await Promise.all([c.register(), c.register()]);
  assert.equal(a, b);
  assert.equal(c.account.balance_questions, 0);
  await c.refresh();
  assert.equal(c.account.free_trial.status, "eligible");
  await c.claimTrial();
  assert.equal(c.account.balance_questions, 400);
  assert.equal(c.account.free_trial.status, "active");
});
test("Actual server solve, multi-image ordering, full receipt, one debit, duplicate ID cannot debit again", async () => {
  responseKind = "ready";
  const c = await client();
  const run = await c.freeze([...images, ...images], settings);
  assert.equal(run.screenQuery, true);
  assert.equal(run.body.images_base64.at(-1), run.body.image_base64);
  const before = providerCalls;
  let shown = "";
  const result = await c.stream(run, { onDelta: (x) => (shown += x) });
  assert.equal(result.raw, shown);
  assert.equal(compose(result.raw).finalAnswer, "B");
  assert.equal(result.receipt.questions_charged, 1);
  assert.equal(c.account.balance_questions, 399);
  await assert.rejects(() => c.stream(run));
  assert.equal(providerCalls, before + 1);
  await c.refresh();
  assert.equal(c.account.balance_questions, 399);
});
for (const kind of ["review", "retake", "empty", "error"])
  test(`Actual server ${kind} preserves charging invariant`, async () => {
    responseKind = kind;
    const c = await client(),
      run = await c.freeze(images, settings);
    if (["error", "empty"].includes(kind))
      await assert.rejects(
        () => c.stream(run),
        kind === "empty" ? { code: "multiple_targets" } : undefined,
      );
    else {
      const result = await c.stream(run);
      assert.equal(result.receipt.questions_charged, kind === "review" ? 1 : 0);
      const parsed = compose(result.raw);
      if (kind === "retake") assert.equal(parsed.state, "retake");
      if (kind === "empty")
        assert.equal(parsed.noResultReason, "multiple_targets");
    }
    await c.refresh();
    assert.equal(c.account.balance_questions, kind === "review" ? 399 : 400);
  });
test("Cancellation fences callbacks and starts no settlement query or replay", async () => {
  responseKind = "slow";
  const c = await client(),
    run = await c.freeze(images, settings),
    abort = new AbortController();
  let statusCalls = 0;
  c.status = async () => {
    statusCalls++;
  };
  const promise = c.stream(run, { signal: abort.signal });
  setTimeout(() => abort.abort(), 80);
  await assert.rejects(() => promise);
  assert.equal(statusCalls, 0);
});
test("Truncated stream retains valid balance receipt but cannot become successful; no POST replay", async () => {
  let posts = 0,
    status = 0;
  const token = "dev_0123456789";
  const c = new OfficialClient({
    base,
    store: memory(),
    development: true,
    fetchImpl: async (_url, options) => {
      if (options.method === "POST") {
        posts++;
        return new Response(
          "data: " +
            JSON.stringify({ type: "delta", text: "FINAL: B" }) +
            "\n\ndata: " +
            JSON.stringify({
              type: "usage",
              input_tokens: 1,
              output_tokens: 1,
              questions_charged: 1,
              balance_questions: 399,
              capture_id: "abc",
              balance_version: "9",
            }) +
            "\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      status++;
      return new Response("{}", {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    },
  });
  c.token = token;
  const run = {
    id: "abc",
    body: {},
    owner: c.owner(),
    base,
    token,
    createdAt: Date.now(),
    screenQuery: false,
  };
  await assert.rejects(() => c.stream(run));
  assert.equal(posts, 1);
  assert.equal(status, 1);
  assert.equal(c.account.balance_questions, 399);
});
test("401 retains original recovery credential; restoration is validated before replacement", async () => {
  responseKind = "ready";
  const c = await client(),
    token = c.token;
  await assert.rejects(() => c.restore("dev_notarealcredential"));
  assert.equal(c.token, token);
  const owner = c.owner();
  assert.equal(
    c.apply({ balance_questions: 999, balance_version: "999" }, owner + "old"),
    false,
  );
});
test("Malformed responses cannot install new credentials or forge a charge", async () => {
  const store = memory();
  const c = new OfficialClient({
    base,
    store,
    development: true,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          device_token: "dev_1234567890",
          balance_questions: -1,
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(() => c.register());
  assert.equal(c.token, null);
  assert.equal(await store.get("device:" + base), null);
  assert.ok(await store.get("attempt:" + base));
});

test("Actual recovery and explanation retain the paid parent binding and do not charge twice", async () => {
  responseKind = "ready";
  const c = await client(),
    run = await c.freeze(images, settings);
  const solved = await c.stream(run);
  assert.equal(solved.receipt.explanation_available, true);
  await c.status(run);
  assert.equal(run.status.can_recover, true);
  const recovered = await c.stream(run, { operation: "recover" });
  assert.equal(recovered.receipt.questions_charged, 0);
  assert.equal(recovered.receipt.settlement_status, "not_required");
  assert.notEqual(run.answerID, run.id);
  const explained = await c.stream(run, {
    operation: "explain",
    finalAnswer: "B",
  });
  assert.match(explained.raw, /supplied question/);
  assert.equal(explained.receipt.questions_charged, 0);
  await c.refresh();
  assert.equal(c.account.balance_questions, 399);
  await assert.rejects(() =>
    c.stream(run, { operation: "explain", finalAnswer: "B" }),
  );
});
test("Actual unclaimed account receives 402 without an implicit claim or provider call", async () => {
  const c = new OfficialClient({ base, store: memory(), development: true });
  await c.initialize();
  const run = await c.freeze(images, settings),
    before = providerCalls;
  await assert.rejects(() => c.stream(run), { status: 402 });
  assert.equal(providerCalls, before);
  assert.equal(c.account.balance_questions, 0);
});
