// Inspect the actual packaged ASAR, not just the source directory.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  desktop = path.join(root, "desktop");
const asar = createRequire(path.join(desktop, "package.json"))(
  "@electron/asar",
);
const archive = path.join(desktop, "dist/win-unpacked/resources/app.asar");
const files = asar.listPackage(archive).map((x) => x.replaceAll("\\", "/"));
const owned = ["main.mjs", "preload.cjs", "THIRD_PARTY_NOTICES.md"];
function visit(relative) {
  for (const entry of fs.readdirSync(path.join(desktop, relative), {
    withFileTypes: true,
  })) {
    const file = relative + "/" + entry.name;
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile()) owned.push(file);
  }
}
for (const directory of ["core", "platform", "ui", "generated"])
  visit(directory);
for (const file of owned)
  assert.deepEqual(
    asar.extractFile(archive, file),
    fs.readFileSync(path.join(desktop, file)),
    `Stale packaged file: ${file}`,
  );
for (const name of ["electron-updater", "js-yaml", "katex"])
  assert.ok(
    files.includes(`/node_modules/${name}/package.json`),
    `Missing runtime dependency: ${name}`,
  );
assert.ok(!files.some((x) => x.startsWith("/test/") || x.includes("/.env")));
assert.ok(!files.some((x) => x.includes("/node_modules/electron/")));
const exe = fs.readFileSync(
  path.join(desktop, "dist/win-unpacked/NotchSPI Desktop.exe"),
);
assert.equal(exe.readUInt16LE(0), 0x5a4d);
const pe = exe.readUInt32LE(0x3c);
assert.equal(exe.readUInt32LE(pe), 0x4550);
assert.equal(exe.readUInt16LE(pe + 4), 0x8664);
const pkg = JSON.parse(asar.extractFile(archive, "package.json").toString());
const zip = path.join(
    desktop,
    "dist",
    `NotchSPI-${pkg.version}-Windows-x64.zip`,
  ),
  bytes = fs.readFileSync(zip);
const result = {
  version: pkg.version,
  platform: "Windows x64",
  executedOnWindows: false,
  zip: path.relative(root, zip),
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  packagedSourcesMatch: true,
  sourceFilesCompared: owned.length,
  runtimeDependenciesPresent: true,
  fixtureExcluded: true,
  verifiedAt: new Date().toISOString(),
};
fs.mkdirSync(path.join(root, "output/windows-delivery"), { recursive: true });
fs.writeFileSync(
  path.join(root, "output/windows-delivery/manifest.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
