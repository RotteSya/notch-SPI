import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { screen } from "electron";
const execute = promisify(execFile);
export async function windowBounds(id) {
  const match = /^window:(\d+):/.exec(id);
  if (!match) return null;
  try {
    const script =
      process.platform === "win32"
        ? (
            await fs.readFile(
              new URL("window-bounds.ps1", import.meta.url),
              "utf8",
            )
          ).replace("param([long]$WindowId)", "$WindowId = " + match[1])
        : "";
    const result =
      process.platform === "win32"
        ? await execute(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-EncodedCommand",
              Buffer.from(script, "utf16le").toString("base64"),
            ],
            { windowsHide: true, timeout: 4000, maxBuffer: 8192 },
          )
        : process.platform === "darwin"
          ? await execute(
              "/usr/bin/swift",
              [
                fileURLToPath(new URL("window-bounds.swift", import.meta.url)),
                match[1],
              ],
              { timeout: 8000, maxBuffer: 8192 },
            )
          : null;
    if (!result) return null;
    const [x, y, width, height] = JSON.parse(result.stdout.trim());
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0
    )
      return null;
    const rect = { x, y, width, height };
    return process.platform === "win32"
      ? screen.screenToDipRect(null, rect)
      : rect;
  } catch {
    return null;
  } // An unavailable origin deliberately uses the Mac reduced-motion arrival.
}
