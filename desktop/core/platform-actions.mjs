import { spawn } from "node:child_process";
import path from "node:path";
export function billingDestination(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "notchspi:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["plus", "account"].includes(u.hostname) &&
      (u.pathname === "" || u.pathname === "/")
      ? "account"
      : null;
  } catch {
    return null;
  }
}
// Only the direct child PID created by this invocation is accepted; no shell expansion.
export function terminateTree(
  child,
  {
    platform = process.platform,
    spawnImpl = spawn,
    killImpl = process.kill.bind(process),
  } = {},
) {
  if (
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 0 ||
    child.exitCode != null
  )
    return;
  if (platform === "win32") {
    const killer = spawnImpl(
      path.win32.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, shell: false, stdio: "ignore" },
    );
    killer.once("error", () => child.kill());
    killer.once("close", (code) => {
      if (code !== 0 && child.exitCode == null) child.kill();
    });
  } else {
    try {
      killImpl(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  }
}
