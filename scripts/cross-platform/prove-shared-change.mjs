// A real change (4s -> 5s) is generated, executed by BOTH intake implementations and compiled
// into the Mac test product in an isolated source copy. The shipping source stays at 4 seconds.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { checkSwiftCheckouts } from "../lib/swift-check.mjs";
import { sha256, sourceIdentity, verifySourceIdentity } from "./provenance.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = path.join(root, "output", "shared-change-proof"),
  copy = path.join(out, "source");
fs.mkdirSync(copy, { recursive: true });
fs.rmSync(path.join(out, "result.json"), { force: true });
const source = sourceIdentity(root);
const productBefore = fs.readFileSync(path.join(root, "shared/product.json"), "utf8");
if (process.platform !== "darwin") throw new Error("This proof requires macOS");
for (const name of [
  "Sources",
  "Tests",
  "Vendor",
  "Package.swift",
  "Package.resolved",
  "VERSION.env",
  "shared",
  "scripts/cross-platform/generate.mjs",
  "server/src/objective-result.ts",
  "desktop/core",
  "desktop/generated",
  "desktop/test/core.test.mjs",
]) {
  const target = path.join(copy, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Replace only this script's copied inputs; retain its existing Swift build cache.
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(root, name), target, { recursive: true });
}
const productFile = path.join(copy, "shared/product.json"),
  p = JSON.parse(fs.readFileSync(productFile));
const original = p.capture.submitDelay;
const originalPersona = structuredClone(p.personalitySession);
p.personalitySession = { maxAgeSeconds: 901, maxRecords: 2, maxContextBytes: 1024 };
for (const key of Object.keys(originalPersona)) assert.notEqual(p.personalitySession[key], originalPersona[key]);
const checkoutErrors = checkSwiftCheckouts(copy);
assert.deepEqual(checkoutErrors, [], "Existing isolated Swift checkouts required; no downloads allowed");
p.capture.submitDelay = original + 1;
fs.writeFileSync(productFile, JSON.stringify(p, null, 2) + "\n");
// Exercise a visible shared reading change as well as a business timing change.
const readingFile = path.join(copy, "shared/ui/reading.mjs");
const readingBefore = fs.readFileSync(readingFile, "utf8");
fs.writeFileSync(
  readingFile,
  readingBefore.replace("bodySize: 15", "bodySize: 16"),
);
fs.writeFileSync(
  path.join(copy, "Tests/NotchSPITests/SharedUIProofTests.swift"),
  `import XCTest
@testable import NotchSPI
final class SharedUIProofTests: XCTestCase {
 func testVisibleSharedReadingChangeReachesNativeReader() {
  let rows = SharedVisual.reading(answer: "B", detail: "Shared UI proof", review: false)
  XCTAssertEqual(rows.last?.size, 16)
  XCTAssertEqual(InformationHierarchy.bodySize, 16)
 }
}
`,
);
fs.writeFileSync(path.join(copy, "Tests/NotchSPITests/SharedPersonaProofTests.swift"), `import XCTest
@testable import NotchSPI
@MainActor
final class SharedPersonaProofTests: XCTestCase {
 let scope = PersonalitySessionScope(personaID: "p", personaName: "N", personaText: "T", captureTargetID: "screen", channelID: "official")
 func payload(large: Bool = false) -> PersonalityContextPayload {
  let item = PersonalityContextItem(ordinal: "1", summary: String(repeating: "x", count: large ? 100 : 1), choice: "A")
  return .init(last: item, referenceable: Array(repeating: item, count: large ? 5 : 1))
 }
 func testChangedTTLReachesRealSession() {
  var time = Date(timeIntervalSince1970: 0)
  let session = PersonalitySession(now: { time })
  let first = session.begin(scope: scope)
  XCTAssertTrue(session.record(payload(), token: first))
  time = Date(timeIntervalSince1970: 900)
  XCTAssertEqual(session.begin(scope: scope).generation, first.generation)
  time = Date(timeIntervalSince1970: 1801)
  XCTAssertNotEqual(session.begin(scope: scope).generation, first.generation)
 }
 func testChangedRecordLimitReachesRealSession() {
  let session = PersonalitySession()
  for _ in 0..<3 { XCTAssertTrue(session.record(payload(), token: session.begin(scope: scope))) }
  XCTAssertEqual(session.recordCount, 2)
 }
 func testChangedByteLimitReachesRealSession() {
  let session = PersonalitySession()
  for _ in 0..<2 { XCTAssertTrue(session.record(payload(large: true), token: session.begin(scope: scope))) }
  XCTAssertEqual(session.recordCount, 1)
 }
}
`);
// Change the actual protocol source, not the generated adapter or test-only constants.
const streamFile = path.join(copy, "shared/protocol/official-stream.mjs");
const streamBefore = fs.readFileSync(streamFile, "utf8");
const streamNeedle = "this.contentBytes + bytes > 65536";
assert.equal(streamBefore.split(streamNeedle).length, 2, "Expected exactly one production content limit");
const streamExperimental = streamBefore.replace(streamNeedle, "this.contentBytes + bytes > 4");
fs.writeFileSync(path.join(copy, "Tests/NotchSPITests/SharedStreamProofTests.swift"), `import XCTest
@testable import NotchSPI
final class SharedStreamProofTests: XCTestCase {
 func append(_ object: [String: Any], to decoder: inout OfficialStreamDecoder) throws {
  let data = try JSONSerialization.data(withJSONObject: object)
  let frame = "data: " + String(decoding: data, as: UTF8.self) + "\\n\\n"
  for byte in frame.utf8 { _ = try decoder.append(byte) }
 }
 func testChangedContentLimitReachesRealDecoder() throws {
  var exact = OfficialStreamDecoder(captureID: UUID(), screenQuery: false)
  try append(["type": "delta", "text": "🔎"], to: &exact)
  try append(["type": "usage", "input_tokens": 1, "output_tokens": 1,
              "questions_charged": 1, "balance_questions": 29], to: &exact)
  for byte in "data: [DONE]\\n\\n".utf8 { _ = try exact.append(byte) }
  XCTAssertTrue(try exact.finish().hasContent)
  var overflow = OfficialStreamDecoder(captureID: UUID(), screenQuery: false)
  try append(["type": "delta", "text": "ab"], to: &overflow)
  XCTAssertThrowsError(try append(["type": "delta", "text": "cde"], to: &overflow))
 }
}
`);
const checks = [];
function run(name, cmd, args) {
  fs.rmSync(path.join(out, name + ".log"), { force: true });
  const r = spawnSync(cmd, args, {
    cwd: copy,
    env: { ...process.env, NSPI_QA_EPHEMERAL: "1" },
    encoding: "utf8",
  });
  fs.writeFileSync(
    path.join(out, name + ".log"),
    (r.stdout ?? "") + (r.stderr ?? ""),
  );
  checks.push({ name, exit_code: r.status,
    logSHA256: sha256(fs.readFileSync(path.join(out, name + ".log"))) });
  if (r.status !== 0) throw new Error(name + " failed; see " + out);
}
run("generate", process.execPath, ["scripts/cross-platform/generate.mjs"]);
run("desktop-real-intake", process.execPath, [
  "--test",
  "desktop/test/core.test.mjs",
]);
run("desktop-shared-ui", process.execPath, [
  "--input-type=module",
  "-e",
  `import assert from 'node:assert/strict';import {readingSections,readingHTML} from './desktop/generated/ui/reading.mjs';assert.equal(readingSections({answer:'B',detail:'Shared UI proof'}).at(-1).size,16);assert.match(readingHTML({answer:'B',detail:'Shared UI proof'}),/font-size:16px/);console.log('Actual desktop reading template uses 16px');`,
]);
run("desktop-persona", process.execPath, ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import {PersonaSession} from './desktop/core/sessions.mjs';
const small = {ordinal:'1', summary:'x', choice:'A'};
const payload = {last:small, referenceable:[small]};
const ttl = new PersonaSession(); ttl.begin('p',0); ttl.finish(payload,0);
assert.match(ttl.begin('p',900000), /"status":"available"/);
assert.match(ttl.begin('p',1801000), /"status":"none"/);
const count = new PersonaSession();
for(let i=0;i<3;i++){count.begin('p',i);count.finish(payload,i);}
assert.equal(count.records.length,2);
const large = {...small, summary:'x'.repeat(100)};
const bytes = new PersonaSession();
for(let i=0;i<2;i++){bytes.begin('p',i);bytes.finish({last:large, referenceable:Array(5).fill(large)},i);}
assert.equal(bytes.records.length,1);
`]);
fs.writeFileSync(streamFile, streamExperimental);
run("generate-stream", process.execPath, ["scripts/cross-platform/generate.mjs"]);
run("desktop-stream", process.execPath, ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import {OfficialStream} from './desktop/core/stream.mjs';
const exact = new OfficialStream('proof', false);
exact.accept(JSON.stringify({type:'delta',text:'🔎'}));
exact.accept(JSON.stringify({type:'usage',input_tokens:1,output_tokens:1,questions_charged:1,balance_questions:29}));
exact.accept('[DONE]');
assert.equal(exact.finish().questions_charged,1);
const overflow = new OfficialStream('proof', false);
overflow.accept(JSON.stringify({type:'delta',text:'ab'}));
assert.throws(()=>overflow.accept(JSON.stringify({type:'delta',text:'cde'})));
console.log('Actual desktop stream accepts 4 UTF-8 bytes and rejects cumulative 5 bytes');
`]);
run("mac-real-intake", "swift", [
  "test",
  "--disable-automatic-resolution",
  "--skip-update",
  "-Xswiftc",
  "-warnings-as-errors",
  "--filter",
  "SharedProductTests|SharedUIProofTests|SharedPersonaProofTests|SharedStreamProofTests",
]);
verifySourceIdentity(source, root);
assert.equal(fs.readFileSync(path.join(root, "shared/product.json"), "utf8"), productBefore);
assert.equal(fs.readFileSync(path.join(root, "shared/ui/reading.mjs"), "utf8"), readingBefore);
fs.writeFileSync(
  path.join(out, "result.json"),
  JSON.stringify(
    {
      source,
      officialStream: { originalContentBytes: 65536, experimentalContentBytes: 4,
        originalSHA256: sha256(streamBefore), experimentalSHA256: sha256(streamExperimental),
        sourceUnchanged: fs.readFileSync(path.join(root, "shared/protocol/official-stream.mjs"), "utf8") === streamBefore },
      personalitySession: { original: originalPersona, experimental: p.personalitySession },
      sharedUI: {
        originalBodySize: 15,
        experimentalBodySize: 16,
        sourceUnchanged:
          fs.readFileSync(path.join(root, "shared/ui/reading.mjs"), "utf8") ===
          readingBefore,
      },
      original,
      experimental: p.capture.submitDelay,
      sourceUnchanged:
        JSON.parse(fs.readFileSync(path.join(root, "shared/product.json")))
          .capture.submitDelay === original,
      checks,
    },
    null,
    2,
  ) + "\n",
);
console.log(out);
