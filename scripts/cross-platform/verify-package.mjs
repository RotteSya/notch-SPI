// Inspect the actual packaged ASAR, not just the source directory.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { verifySourceIdentity, verifyArchivedFile, bundleIdentity } from "./provenance.mjs";
export function verifyExecutable(bytes, mac) {
  if (mac) {
    assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, 'Expected a 64-bit Mach-O');
    assert.equal(bytes.readUInt32LE(4), 0x0100000c, 'Expected an arm64 Mach-O');
  } else {
    assert.equal(bytes.readUInt16LE(0), 0x5a4d);
    const pe = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.readUInt32LE(pe), 0x4550);
    assert.equal(bytes.readUInt16LE(pe + 4), 0x8664);
  }
}

export async function main() {
const args = process.argv.slice(2);
assert.ok(args.length >= 1 && args.length <= 2 && !args[0].startsWith('--')
  && (args.length === 1 || args[1] === '--mac'), 'Usage: verify-package.mjs <candidate-directory> [--mac]');
const mac = args[1] === '--mac';
const root = fileURLToPath(new URL("../../", import.meta.url)),
  desktop = path.join(root, "desktop");
const asar = createRequire(path.join(desktop, "package.json"))(
  "@electron/asar",
);
const candidateDir = path.resolve(process.argv[2] ?? path.join(desktop, "dist"));
const bundle = path.join(candidateDir, 'mac-arm64/NotchSPI Desktop.app');
const archive = mac ? path.join(bundle, 'Contents/Resources/app.asar')
  : path.join(candidateDir, "win-unpacked/resources/app.asar");
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
    asar.extractFile(archive, path.normalize(file)),
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
const executable = mac ? path.join(bundle, 'Contents/MacOS/NotchSPI Desktop')
  : path.join(candidateDir, 'win-unpacked/NotchSPI Desktop.exe');
const exe = fs.readFileSync(executable);
verifyExecutable(exe, mac);
const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.ok(pkg.buildProvenance?.source, 'Missing build provenance; rebuild the candidate');
assert.deepEqual(pkg.buildProvenance.target, { platform: mac ? 'darwin' : 'win32', arch: mac ? 'arm64' : 'x64' }, 'Wrong candidate target');
verifySourceIdentity(pkg.buildProvenance.source, root);
const version = Object.fromEntries(fs.readFileSync(path.join(root, 'VERSION.env'), 'utf8').trim().split('\n').map(line => line.split('=')));
const [major, minor] = version.APP_VERSION.split('.');
assert.equal(pkg.version, `${major}.${minor}.${version.BUILD_NUMBER}`, 'Packaged version must match VERSION.env');
assert.equal(path.basename(candidateDir), pkg.buildProvenance.candidateID, 'Candidate directory identity mismatch');
let artifact;
if (mac) {
  artifact = { bundle: path.relative(root, bundle), bundleIdentity: bundleIdentity(bundle), zipPayloadMatches: null };
} else {
  const zip = path.join(candidateDir, `NotchSPI-${pkg.version}-Windows-x64.zip`), bytes = fs.readFileSync(zip);
  const unzipper = createRequire(path.join(desktop, 'package.json'))('unzipper');
  const zipContents = await unzipper.Open.file(zip);
  await verifyArchivedFile(zipContents.files, 'resources/app.asar', fs.readFileSync(archive));
  await verifyArchivedFile(zipContents.files, 'NotchSPI Desktop.exe', exe);
  artifact = { zip: path.relative(root, zip), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), zipPayloadMatches: true };
}
const result = {
  schemaVersion: 2,
  provenance: pkg.buildProvenance,
  verifierHost: { platform: process.platform, arch: process.arch },
  ...artifact,
  acceptance: { windowsHardware: "not-verified", installation: "not-verified", signedUpdate: "not-verified" },
  version: pkg.version,
  platform: mac ? "Electron macOS arm64 (local review)" : "Windows x64",
  executedOnWindows: false,
  diagnosticsMode: pkg.localTestReport === true ? "local-only-test-report" : "standard",
  packagedSourcesMatch: true,
  sourceFilesCompared: owned.length,
  runtimeDependenciesPresent: true,
  fixtureExcluded: true,
  verifiedAt: new Date().toISOString(),
};
const indexDir = path.join(root, mac ? "output/electron-mac-delivery" : "output/windows-delivery");
fs.mkdirSync(indexDir, { recursive: true });
fs.writeFileSync(
  path.join(indexDir, "manifest.json"),
  JSON.stringify(result, null, 2) + "\n",
);
fs.writeFileSync(path.join(candidateDir, "delivery-manifest.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
