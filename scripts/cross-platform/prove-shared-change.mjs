// A real change (4s -> 5s) is generated, executed by BOTH intake implementations and compiled
// into the Mac test product in an isolated source copy. The shipping source stays at 4 seconds.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = path.join(root, "output", "shared-change-proof"),
  copy = path.join(out, "source");
fs.mkdirSync(copy, { recursive: true });
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
  fs.cpSync(path.join(root, name), target, { recursive: true });
}
const productFile = path.join(copy, "shared/product.json"),
  p = JSON.parse(fs.readFileSync(productFile));
const original = p.capture.submitDelay;
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
const checks = [];
function run(name, cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: copy,
    env: { ...process.env, NSPI_QA_EPHEMERAL: "1" },
    encoding: "utf8",
  });
  fs.writeFileSync(
    path.join(out, name + ".log"),
    (r.stdout ?? "") + (r.stderr ?? ""),
  );
  checks.push({ name, exit_code: r.status });
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
if (process.platform !== "darwin")
  throw new Error("The dual-platform proof requires a macOS Swift toolchain");
run("mac-real-intake", "swift", [
  "test",
  "-Xswiftc",
  "-warnings-as-errors",
  "--filter",
  "SharedProductTests|SharedUIProofTests",
]);
fs.writeFileSync(
  path.join(out, "result.json"),
  JSON.stringify(
    {
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
