import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OfficialStream, SSEFramer } from "../core/stream.mjs";

const cases = JSON.parse(fs.readFileSync(new URL(
  "../../Tests/Fixtures/official-stream/cases.json", import.meta.url,
)));
for (const scenario of cases) test(`Shared stream: ${scenario.id}`, () => {
  const bytes = Buffer.from(scenario.bytes, "base64");
  for (const size of [1, 7, bytes.length]) {
    const stream = new OfficialStream(scenario.captureID, scenario.screenQuery ?? true, scenario.operation);
    const framer = new SSEFramer();
    let content = "", receipts = 0, complete = false, serviceError = false;
    try {
      outer: for (let offset = 0; offset < bytes.length; offset += size) {
        for (const payload of framer.feed(bytes.subarray(offset, offset + size))) {
          const event = stream.accept(payload);
          if (event.type === "delta") content += event.text;
          if (event.type === "usage") receipts++;
          if (event.type === "error") serviceError = true;
          if (stream.done) break outer;
        }
      }
      framer.finish();
      try { stream.finish(); complete = true; }
      catch (error) {
        // The JS API throws service errors after validating the completed protocol.
        if (stream.done && stream.receipt && serviceError) complete = true;
        else throw error;
      }
    } catch {}
    assert.deepEqual({ complete, receipts, content, serviceError }, {
      complete: scenario.complete, receipts: scenario.receipts,
      content: scenario.content, serviceError: scenario.serviceError,
    }, `chunk size ${size}`);
  }
});

test("SSE framing retains line, event and stream byte limits", () => {
  const limit = 512 * 1024;
  const line = new SSEFramer();
  assert.deepEqual([...line.feed(Buffer.from(":" + "x".repeat(limit - 1) + "\n"))], []);
  assert.throws(() => [...line.feed(Buffer.from(":" + "x".repeat(limit)))], /invalid answer stream/);
  const event = new SSEFramer();
  const dataLine = Buffer.from("data: " + "x".repeat(limit / 2) + "\n");
  assert.deepEqual([...event.feed(dataLine)], []);
  assert.throws(() => [...event.feed(dataLine)], /invalid answer stream/);
  const total = new SSEFramer();
  const comment = Buffer.from(":" + "x".repeat(limit - 2) + "\n");
  for (let i = 0; i < 8; i++) assert.deepEqual([...total.feed(comment)], []);
  assert.throws(() => [...total.feed(Buffer.from("\n"))], /Stream too large/);
});
