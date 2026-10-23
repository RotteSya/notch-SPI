// Both clients use the existing Fastify server in an explicitly isolated mock configuration.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  port = 18878,
  base = `http://127.0.0.1:${port}`;
const available = await new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
});
if (!available)
  throw new Error(
    `Port ${port} is occupied; existing processes were left running`,
  );
const env = Object.fromEntries(
  ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR"]
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
Object.assign(env, {
  HOST: "127.0.0.1",
  PORT: String(port),
  PUBLIC_BASE_URL: base,
  DB_PATH: ":memory:",
  OFFICIAL_PROVIDER: "mock",
  PAYMENT_PROVIDER: "stub",
  FREE_TRIAL_ENABLED: "1",
  SCREEN_QUERY_ENABLED: "1",
  ENABLED_SUPPORT_PROFILES: "general",
  OBJECTIVE_RESULT_V1_BPS: "10000",
  OBJECTIVE_RESULT_EXPERIMENT_SALT: "local-desktop-development-only",
  LOG_LEVEL: "warn",
});
const server = spawn(
  process.execPath,
  ["scripts/cross-platform/mock-server.mjs"],
  { cwd: root, env, stdio: "inherit" },
);
let client;
function stop() {
  client?.kill();
  server.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
let healthy = false;
for (let i = 0; i < 80; i++) {
  if (server.exitCode !== null) throw new Error("Mock server exited");
  try {
    const v = await (await fetch(base + "/healthz")).json();
    if (
      v.ok &&
      v.provider === "mock" &&
      ["memory", "sqlite"].includes(v.db) &&
      ["disabled", "stub"].includes(v.payments)
    ) {
      healthy = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
if (!healthy) {
  stop();
  throw new Error("Isolated server did not become ready");
}
console.log(
  `Development only: mock model, in-memory database, stub payments at ${base}`,
);
const electron = (
  await import(
    pathToFileURL(path.join(root, "desktop/node_modules/electron/index.js"))
      .href
  )
).default;
client = spawn(electron, [path.join(root, "desktop"), "--dev-base", base], {
  stdio: "inherit",
  env: { ...process.env, NSPI_DESKTOP_DEVELOPMENT: "1" },
});
client.on("close", (code) => {
  server.kill();
  process.exitCode = code ?? 0;
});
