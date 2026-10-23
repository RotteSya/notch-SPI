import { test } from "node:test";
import assert from "node:assert/strict";
import { directAPI, localCLI } from "../core/providers.mjs";
const event = (x) =>
  "data: " + (typeof x === "string" ? x : JSON.stringify(x)) + "\n\n";
for (const protocol of ["openai", "anthropic"])
  test(`${protocol}: real request construction and complete stream, no network credential needed`, async () => {
    let body,
      headers,
      shown = "";
    const raw =
      protocol === "openai"
        ? event({ choices: [{ delta: { content: "FINAL: C" } }] }) +
          event({ choices: [{ finish_reason: "stop" }] }) +
          event("[DONE]")
        : event({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "FINAL: C" },
          }) +
          event({ type: "message_delta", delta: { stop_reason: "end_turn" } }) +
          event({ type: "message_stop" });
    const result = await directAPI({
      images: [{ base64: "one" }, { base64: "two" }],
      settings: {
        protocol,
        endpoint: "https://provider.invalid/v1/messages",
        model: "fixture",
        language: "zh",
      },
      mode: "tutor",
      key: "test-only",
      signal: new AbortController().signal,
      onDelta: (x) => (shown += x),
      fetchImpl: async (url, o) => {
        body = JSON.parse(o.body);
        headers = o.headers;
        return new Response(raw, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    assert.equal(shown, "FINAL: C");
    assert.equal(result.raw, shown);
    assert.equal(body.stream, true);
    const content = body.messages.at(-1).content;
    assert.equal(content.length, 3);
    assert.match(JSON.stringify(content), /Analyze the 2/);
    assert.match(JSON.stringify(content), /two/);
    assert.equal(
      protocol === "anthropic" ? headers["x-api-key"] : headers.Authorization,
      protocol === "anthropic" ? "test-only" : "Bearer test-only",
    );
  });
test("Custom API truncation and token cutoff cannot become complete answers", async () => {
  for (const ending of [
    "",
    event({ choices: [{ finish_reason: "length" }] }) + event("[DONE]"),
  ]) {
    await assert.rejects(() =>
      directAPI({
        images: [{ base64: "one" }],
        settings: {
          protocol: "openai",
          endpoint: "https://provider.invalid",
          model: "fixture",
        },
        key: "test",
        signal: new AbortController().signal,
        onDelta: () => {},
        fetchImpl: async () =>
          new Response(
            event({ choices: [{ delta: { content: "FINAL: C" } }] }) + ending,
            { headers: { "content-type": "text/event-stream" } },
          ),
      }),
    );
  }
});
test("CLI refuses shell scripts and relative executable paths before writing images", async () => {
  for (const cliPath of ["codex", "C:/tools/codex.cmd"])
    await assert.rejects(() =>
      localCLI({
        images: [],
        settings: { cliPath },
        signal: new AbortController().signal,
        onDelta: () => {},
      }),
    );
});
