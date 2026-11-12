import { terminateTree } from "./platform-actions.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { capturePrompt, taskText, contextTask } from "./product.mjs";
import { SSEFramer, readJSON } from "./stream.mjs";
import { apiEndpoint } from "./api-providers.mjs";
export async function directAPI({
  fetchImpl = fetch,
  images,
  settings,
  key,
  mode,
  signal,
  onDelta,
  sessionContext = "",
  prompt: suppliedPrompt,
}) {
  signal.throwIfAborted();
  if (!key) throw new Error("Configure your provider API key first");
  const endpoint = apiEndpoint(settings.endpoint),
    anthropic = settings.protocol === "anthropic";
  const prompt = suppliedPrompt ?? capturePrompt({
    language: settings.language,
    objective: mode === "tutor",
    mode,
    persona: settings.persona,
    sessionContext,
  });
  if (!suppliedPrompt && images.length > 1 && mode !== "personality") prompt.task = contextTask;
  const text = taskText(prompt.task, images.length);
  const body = anthropic
    ? {
        model: settings.model,
        max_tokens: 8192,
        stream: true,
        system: prompt.system,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((x) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: x.base64,
                },
              })),
              { type: "text", text },
            ],
          },
        ],
      }
    : {
        model: settings.model,
        stream: true,
        messages: [
          { role: "system", content: prompt.system },
          {
            role: "user",
            content: [
              { type: "text", text },
              ...images.map((x) => ({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${x.base64}` },
              })),
            ],
          },
        ],
      };
  if (!anthropic && new URL(endpoint).hostname === "api.deepseek.com")
    Object.assign(body, {
      thinking: { type: "enabled" },
      reasoning_effort: settings.reasoning,
    });
  const response = await fetchImpl(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    headers: {
      "Content-Type": "application/json",
      ...(anthropic
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const v = await readJSON(response);
    throw new Error(v.error?.message ?? `HTTP ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw new Error("Expected event stream");
  const framer = new SSEFramer();
  let raw = "",
    terminal = false,
    reason = null;
  const reader = response.body.getReader();
  try {
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const payload of framer.feed(value)) {
        if (payload === "[DONE]") {
          if (anthropic) throw new Error("Invalid stream");
          terminal = true;
          break outer;
        }
        const v = JSON.parse(payload);
        if (v.error) throw new Error(v.error.message);
        let delta = anthropic
          ? v.type === "content_block_delta" && v.delta?.type === "text_delta"
            ? v.delta.text
            : ""
          : (v.choices?.[0]?.delta?.content ?? "");
        const next = anthropic
          ? v.delta?.stop_reason
          : v.choices?.[0]?.finish_reason;
        if (next) {
          if (reason && reason !== next)
            throw new Error("Inconsistent stop reason");
          reason = next;
        }
        if (delta) {
          raw += delta;
          if (Buffer.byteLength(raw) > 65536)
            throw new Error("Answer too large");
          onDelta(delta);
        }
        if (anthropic && v.type === "message_stop") {
          terminal = true;
          break outer;
        }
      }
    }
  } finally {
    await reader.cancel();
  }
  framer.finish();
  signal.throwIfAborted();
  if (
    !terminal ||
    !(anthropic ? ["end_turn", "stop_sequence"] : ["stop"]).includes(reason)
  )
    throw new Error("Answer was not completely delivered");
  return { raw };
}
export async function localCLI({
  images,
  settings,
  mode,
  signal,
  onDelta,
  sessionContext = "",
  prompt: suppliedPrompt,
  spawnImpl = spawn,
  terminateImpl = terminateTree,
  timeoutMs = 120000,
}) {
  signal.throwIfAborted();
  if (
    !path.isAbsolute(settings.cliPath) ||
    /\.(cmd|bat)$/i.test(settings.cliPath)
  )
    throw new Error(
      "Select the native codex.exe or claude.exe executable (not a command shell script)",
    );
  const directory = await mkdtemp(path.join(os.tmpdir(), "notchspi-"));
  try {
    const paths = [];
    for (const [i, image] of images.entries()) {
      const p = path.join(directory, `${i}.jpg`);
      await writeFile(p, Buffer.from(image.base64, "base64"), { mode: 0o600 });
      paths.push(p);
    }
    signal.throwIfAborted();
    const prompt = suppliedPrompt ?? capturePrompt({
      language: settings.language,
      objective: mode === "tutor",
      mode,
      persona: settings.persona,
      sessionContext,
    });
    if (!suppliedPrompt && images.length > 1 && mode !== "personality") prompt.task = contextTask;
    const isClaude = settings.cliKind === "claude";
    const args = isClaude
      ? [
          "-p",
          prompt.system +
            "\n\nThe screenshots are saved at these paths, in order:\n" +
            paths.join("\n") +
            "\nOpen and read those image files in order, then " +
            prompt.task,
          "--allowedTools",
          "Read",
          "--disallowedTools",
          "Edit,Write,Bash,WebFetch,WebSearch",
          "--permission-mode",
          "dontAsk",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
        ]
      : [
          "exec",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          prompt.system + "\n\n" + taskText(prompt.task, images.length),
          ...paths.flatMap((p) => ["-i", p]),
        ];
    return await new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const child = spawnImpl(settings.cliPath, args, {
        cwd: directory,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      let raw = "",
        buffer = "",
        stderr = "";
      let overflow = false, resultText = '';
      const stop = () => terminateImpl(child);
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      const timeout = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
      let timedOut = false;

      child.stderr.on("data", (x) => {
        stderr = (stderr + x).slice(-600);
      });
      child.stdout.setEncoding("utf8");
      const append = text => {
        if (signal.aborted || overflow) return;
        if (Buffer.byteLength(raw + text) > 65536) { overflow = true; stop(); return; }
        raw += text; onDelta(text);
      };
      const claudeLine = line => {
        try {
          const v = JSON.parse(line);
          if (v.type === 'stream_event' && v.event?.delta?.type === 'text_delta') append(v.event.delta.text);
          else if (v.type === 'result' && !v.is_error && typeof v.result === 'string') resultText = v.result;
        } catch {}
      };
      child.stdout.on("data", (chunk) => {
        if (signal.aborted) return;
        if (!isClaude) {
          append(chunk);
          return;
        }
        buffer += chunk;
        if (buffer.length > 524288) {
          overflow = true;
          stop();
          return;
        }
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          claudeLine(line);
        }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", stop);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", stop);
        if (isClaude && buffer.trim()) claudeLine(buffer);
        if (!raw && resultText) append(resultText);
        if (signal.aborted) reject(signal.reason);
        else if (code !== 0 || timedOut || overflow)
          reject(new Error(stderr || "CLI failed or timed out"));
        else resolve({ raw });
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
