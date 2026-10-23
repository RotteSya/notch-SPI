import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
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
config.extraMetadata = {
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
fs.mkdirSync(path.join(desktop, "dist"), { recursive: true });
const file = path.join(desktop, "dist", "release-config.json");
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
process.exit(result.status ?? 1);
