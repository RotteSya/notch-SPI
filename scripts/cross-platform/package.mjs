import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { sourceIdentity, verifySourceIdentity, sha256 } from "./provenance.mjs";
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
const targets = process.platform === "win32" ? ["nsis", "zip"] : ["zip"];
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
  if (path.basename(distribution) !== `electron-v${electronVersion}-win32-x64.zip`)
    throw new Error("Local Electron distribution must match the pinned Windows x64 version");
  provenance.electronDistribution = { file: path.basename(distribution), sha256: sha256(fs.readFileSync(distribution)) };
  config.electronDist = distribution;
}
config.directories.output = candidateDir;
config.extraMetadata = {
  buildProvenance: provenance,
  version: `${parts[0]}.${parts[1]}.${version.BUILD_NUMBER}`,
};
config.buildVersion = version.BUILD_NUMBER;
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
    "--win",
    ...targets,
    "--x64",
    "--publish",
    "never",
    ...extra,
  ],
  { cwd: desktop, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
verifySourceIdentity(source, root);
const verified = spawnSync(process.execPath, [
  path.join(root, "scripts/cross-platform/verify-package.mjs"), candidateDir,
], { stdio: "inherit" });
process.exit(verified.status ?? 1);
