import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { sourceIdentity, verifySourceIdentity, sha256, bundleIdentity } from "./provenance.mjs";
// Electron Mac is an unsigned local review bundle, not the native Mac release.
export function packagingTarget(args, { platform = process.platform, arch = process.arch, env = process.env } = {}) {
  const allowed = new Set(['--win', '--mac', '--local-test']);
  if (args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length
      || (args.includes('--win') && args.includes('--mac')))
    throw new Error('Usage: package.mjs [--win|--mac] [--local-test (Windows only)]');
  const mac = args.includes('--mac');
  if (mac && (platform !== 'darwin' || arch !== 'arm64'))
    throw new Error('Electron Mac review packaging requires an Apple Silicon Mac');
  if (!mac && !['darwin', 'win32'].includes(platform))
    throw new Error('Windows packaging requires a Mac or Windows host');
  if (mac && (args.includes('--local-test') || env.NSPI_WINDOWS_UPDATE_URL || env.NSPI_WINDOWS_PUBLISHER
      || env.CSC_LINK || env.CSC_NAME || env.CSC_KEY_PASSWORD || env.APPLE_ID || env.APPLE_API_KEY))
    throw new Error('Electron Mac review packaging must not use Windows diagnostics, release or signing settings');
  if (args.includes('--local-test') && (env.NSPI_WINDOWS_UPDATE_URL || env.NSPI_WINDOWS_PUBLISHER || env.CSC_LINK))
    throw new Error('Local test packaging must not use release/signing settings');
  return { mac, localTest: args.includes('--local-test'),
    platform: mac ? 'darwin' : 'win32', arch: mac ? 'arm64' : 'x64',
    builderArgs: mac ? ['--mac', '--arm64', '--dir', '--publish', 'never']
      : ['--win', ...(platform === 'win32' ? ['nsis', 'zip'] : ['zip']), '--x64', '--publish', 'never'] };
}

export async function main() {
const target = packagingTarget(process.argv.slice(2));
const root = fileURLToPath(new URL("../../", import.meta.url)),
  desktop = path.join(root, "desktop");
const generated = spawnSync(
  process.execPath,
  [path.join(root, "scripts/cross-platform/generate.mjs"), "--check"],
  { stdio: "inherit" },
);
if (generated.status !== 0) process.exit(generated.status ?? 1);
// NSIS's macOS helper is Intel-only. Produce the usable Windows ZIP on Apple Silicon;
// the same source produces ZIP + NSIS on Windows CI (no Rosetta dependency).

const version = Object.fromEntries(
  fs
    .readFileSync(path.join(root, "VERSION.env"), "utf8")
    .trim()
    .split("\n")
    .map((x) => x.split("=")),
);
const parts = version.APP_VERSION.split(".");
const config = JSON.parse(
  fs.readFileSync(path.join(desktop, "package.json"), "utf8"),
).build;
const source = sourceIdentity(root);
const candidateID = `${source.commit.slice(0, 12)}-${source.sourceSHA256.slice(0, 12)}-${randomUUID()}`;
const candidateDir = path.join(desktop, "dist", "candidates", candidateID);
const provenance = {
  schemaVersion: 1, candidateID, source,
  target: { platform: target.platform, arch: target.arch },
  builtAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  ci: process.env.GITHUB_ACTIONS === "true" ? {
    repository: process.env.GITHUB_REPOSITORY,
    runID: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
  } : null,
};
if (process.env.NSPI_ELECTRON_DIST) {
  const distribution = path.resolve(process.env.NSPI_ELECTRON_DIST);
  const electronVersion = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8")).devDependencies.electron;
  if (target.mac) {
    if (fs.readFileSync(path.join(distribution, 'version'), 'utf8').trim() !== electronVersion
        || !fs.existsSync(path.join(distribution, 'Electron.app/Contents/MacOS/Electron')))
      throw new Error('Local Electron distribution must match the pinned Mac runtime');
    provenance.electronDistribution = { version: electronVersion, bundle: bundleIdentity(path.join(distribution, 'Electron.app')) };
  } else {
    if (path.basename(distribution) !== `electron-v${electronVersion}-win32-x64.zip`)
      throw new Error("Local Electron distribution must match the pinned Windows x64 version");
    provenance.electronDistribution = { file: path.basename(distribution), sha256: sha256(fs.readFileSync(distribution)) };
  }
  config.electronDist = distribution;
}
config.directories.output = candidateDir;
config.extraMetadata = {
  buildProvenance: provenance,
  version: `${parts[0]}.${parts[1]}.${version.BUILD_NUMBER}`,
};
config.buildVersion = version.BUILD_NUMBER;
if(target.localTest){
  if(process.env.NSPI_WINDOWS_UPDATE_URL||process.env.NSPI_WINDOWS_PUBLISHER||process.env.CSC_LINK)throw new Error("Local test packaging must not use release/signing settings");
  config.extraMetadata.localTestReport=true;
  config.win.signAndEditExecutable=false;
}
if (target.mac) {
  config.mac.identity = null;
  config.mac.notarize = false;
  config.npmRebuild = false; // Runtime JS dependencies have no native rebuild step.
}
const extra = [];
if (process.env.NSPI_WINDOWS_UPDATE_URL || process.env.NSPI_WINDOWS_PUBLISHER) {
  const url = new URL(process.env.NSPI_WINDOWS_UPDATE_URL ?? "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !process.env.NSPI_WINDOWS_PUBLISHER ||
    !process.env.CSC_LINK
  )
    throw new Error(
      "Signed release requires HTTPS update URL, certificate publisher and CSC_LINK",
    );

  config.forceCodeSigning = true;
  config.win.publisherName = process.env.NSPI_WINDOWS_PUBLISHER;
  config.win.verifyUpdateCodeSignature = true;
  config.publish = { provider: "generic", url: url.href };
}
fs.mkdirSync(candidateDir, { recursive: true });
const file = path.join(candidateDir, "release-config.json");
fs.writeFileSync(file, JSON.stringify(config, null, 2));
extra.push("--config", file);

const result = spawnSync(
  process.execPath,
  [
    path.join(desktop, "node_modules/electron-builder/out/cli/cli.js"),
    ...target.builderArgs,
    ...extra,
  ],
  { cwd: desktop, stdio: "inherit", env: target.mac ? { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } : process.env },
);
if (result.status !== 0) process.exit(result.status ?? 1);
verifySourceIdentity(source, root);
const verified = spawnSync(process.execPath, [
  path.join(root, "scripts/cross-platform/verify-package.mjs"), candidateDir, ...(target.mac ? ["--mac"] : []),
], { stdio: "inherit" });
process.exit(verified.status ?? 1);

}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
