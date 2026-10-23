import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { QuestionHistory } from "../platform/history.mjs";
import { personality } from "../core/answer.mjs";
import { PersonaSession } from "../core/sessions.mjs";
test("History roundtrip stores image bytes separately, prunes age/count/size and removes orphan images", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nspi-history-test-"));
  try {
    const h = new QuestionHistory(dir, {
      limit: 2,
      byteLimit: 12,
      lifetime: 10000,
    });
    const row = (time = Date.now()) => ({
      id: randomUUID(),
      time,
      answer: "B",
      images: [
        {
          id: randomUUID(),
          base64: Buffer.from("image").toString("base64"),
          thumbnail: "data:image/jpeg;base64,eA==",
        },
      ],
    });
    const a = row(),
      b = row(),
      c = row(),
      old = row(Date.now() - 20000);
    assert.equal(h.save([a, b, c, old]).length, 2);
    assert.equal(h.list()[0].images[0].base64, undefined);
    assert.equal(h.load(a.id).images[0].base64, a.images[0].base64);
    assert.equal(h.load("../../outside"), null);
    h.save([]);
    assert.equal(
      fs.readdirSync(h.directory).filter((x) => x !== "index.json").length,
      0,
    );
    const small = new QuestionHistory(dir, { byteLimit: 1 });
    assert.equal(small.save([a]).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Persona normalizes decorated full-width ordinals, validates matching context, and withholds machine lines", () => {
  const item = { ordinal: "Q０１", summary: "工作偏好", choice: "很符合" };
  const raw =
    "**（１） 很符合**\nNSPI_CONTEXT_V1: " +
    JSON.stringify({ last: item, referenceable: [item] });
  const result = personality(raw);
  assert.equal(result.visible, "（１） 很符合");
  assert.equal(result.context.last.summary, "工作偏好");
  assert.equal(result.usable, true);
  assert.equal(
    personality(raw.replace('"choice":"很符合"', '"choice":"不符合"')).context,
    null,
  );
  assert.equal(
    personality('NSPI_ERROR_V1: {"code":"unreadable"}').usable,
    false,
  );
  assert.equal(
    personality("1. 很符合\n**NSPI_CONT", true).visible,
    "1. 很符合",
  );
  assert.equal(personality("1. 很符合").usable, true); // Mac shows valid choices even when continuity metadata is missing.
});
test("Persona session context is bounded in UTF-8 bytes and failed previous turn never reuses older immediate answer", () => {
  const session = new PersonaSession();
  const item = { ordinal: "1", summary: "题".repeat(240), choice: "很符合" };
  for (let i = 0; i < 8; i++) {
    session.begin("same", i);
    session.finish({ last: item, referenceable: Array(8).fill(item) });
  }
  assert.ok(Buffer.byteLength(session.contextBlock()) <= 8192);
  session.finish(null);
  assert.match(session.begin("same", 9), /"status":"unavailable"/);
  assert.match(session.begin("changed", 10), /"status":"none"/);
});
