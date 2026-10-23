export class ProtocolError extends Error {
  constructor(message = "Incomplete or invalid answer stream") {
    super(message);
    this.code = "invalid_stream";
  }
}
const uint = (n) => Number.isSafeInteger(n) && n >= 0;
export function validSettlement(v, id) {
  if (
    v.capture_id !== id ||
    !uint(v.balance_questions) ||
    !uint(v.held_questions) ||
    !/^\d{1,40}$/.test(v.balance_version ?? "") ||
    typeof v.usable_result !== "boolean" ||
    typeof v.can_retry !== "boolean" ||
    typeof v.can_recover !== "boolean"
  )
    return false;
  if (v.settlement_status === "settled")
    return (
      v.questions_charged === 1 &&
      v.terminal_state === "usable" &&
      v.usable_result
    );
  if (v.settlement_status === "released")
    return (
      v.questions_charged === 0 &&
      !v.usable_result &&
      ["retake", "no_result", "failed", "canceled"].includes(v.terminal_state)
    );
  return (
    v.settlement_status === "not_required" &&
    v.questions_charged === 0 &&
    ["usable", "failed", "canceled"].includes(v.terminal_state) &&
    v.usable_result === (v.terminal_state === "usable")
  );
}
export function validAccount(v) {
  if (
    !v ||
    !uint(v.balance_questions) ||
    (v.balance_version !== undefined && !/^\d{1,40}$/.test(v.balance_version))
  )
    return false;
  for (const k of [
    "total_questions",
    "total_input_tokens",
    "total_output_tokens",
    "held_questions",
  ])
    if (v[k] !== undefined && !uint(v[k])) return false;
  if (
    v.account_totals &&
    (!v.balance_version ||
      !["questions", "input_tokens", "output_tokens"].every((k) =>
        uint(v.account_totals[k]),
      ))
  )
    return false;
  if (v.free_trial) {
    const t = v.free_trial;
    if (
      !["eligible", "active", "expired", "ineligible"].includes(t.status) ||
      !["daily_limit", "daily_used", "daily_held", "daily_remaining"].every(
        (k) => uint(t[k]),
      )
    )
      return false;
    if (
      t.status === "active" &&
      (t.daily_used + t.daily_held + t.daily_remaining !== t.daily_limit ||
        !["activated_at", "expires_at", "resets_at", "server_time"].every((k) =>
          Number.isFinite(Date.parse(t[k])),
        ))
    )
      return false;
  }
  return true;
}
// Byte framing handles split UTF-8, CR/LF, BOM, comments and multi-line SSE data.
export class SSEFramer {
  decoder = new TextDecoder("utf-8", { fatal: true });
  line = "";
  lines = [];
  bytes = 0;
  eventBytes = 0;
  lineBytes = 0;
  skipLF = false;
  feed(chunk) {
    this.bytes += chunk.byteLength;
    if (this.bytes > 4 * 1024 * 1024)
      throw new ProtocolError("Stream too large");
    const values = [];
    for (const char of this.decoder.decode(chunk, { stream: true })) {
      if (this.skipLF) {
        this.skipLF = false;
        if (char === "\n") continue;
      }
      if (char === "\r" || char === "\n") {
        this.skipLF = char === "\r";
        if (!this.line) {
          if (this.lines.length) values.push(this.lines.join("\n"));
          this.lines = [];
          this.eventBytes = 0;
        } else if (this.line === "data" || this.line.startsWith("data:")) {
          const data = this.line.slice(5).replace(/^ /, "");
          this.eventBytes += new TextEncoder().encode(data).length + 1;
          if (this.eventBytes > 512 * 1024) throw new ProtocolError();
          this.lines.push(data);
        }
        this.line = "";
        this.lineBytes = 0;
      } else {
        this.line += char;
        this.lineBytes += new TextEncoder().encode(char).length;
        if (this.lineBytes > 512 * 1024) throw new ProtocolError();
      }
    }
    return values;
  }
  finish() {
    this.decoder.decode();
  }
}
export class OfficialStream {
  receipt = null;
  error = null;
  content = "";
  done = false;
  constructor(id, screenQuery, operation = "solve") {
    this.id = id;
    this.screenQuery = screenQuery;
    this.operation = operation;
  }
  accept(payload) {
    if (this.done) throw new ProtocolError();
    if (payload === "[DONE]") {
      if (!this.receipt) throw new ProtocolError();
      this.done = true;
      return { type: "done" };
    }
    let v;
    try {
      v = JSON.parse(payload);
    } catch {
      throw new ProtocolError();
    }
    if (v.type === "delta") {
      if (this.receipt || this.error || typeof v.text !== "string")
        throw new ProtocolError();
      this.content += v.text;
      if (new TextEncoder().encode(this.content).length > 65536)
        throw new ProtocolError();
    } else if (v.type === "error") {
      if (this.receipt || this.error) throw new ProtocolError();
      this.error = v.error ?? v;
      if (!this.error.message) throw new ProtocolError();
    } else if (v.type === "usage") {
      if (
        this.receipt ||
        !validAccount(v) ||
        !uint(v.input_tokens) ||
        !uint(v.output_tokens) ||
        ![0, 1].includes(v.questions_charged) ||
        (v.capture_id != null && v.capture_id !== this.id) ||
        (v.operation != null && v.operation !== this.operation) ||
        (this.operation !== "solve" && v.questions_charged !== 0)
      )
        throw new ProtocolError();
      const expected = v.questions_charged
        ? "settled"
        : this.operation === "solve"
          ? "released"
          : "not_required";
      if (v.settlement_status != null && v.settlement_status !== expected)
        throw new ProtocolError();
      if (this.screenQuery && !validSettlement(v, this.id))
        throw new ProtocolError();
      if (
        (v.questions_charged || v.usable_result) &&
        (!this.content.trim() || this.error)
      )
        throw new ProtocolError();
      if (
        v.explanation_available === true &&
        (!this.screenQuery || this.operation === "explain" || !v.usable_result)
      )
        throw new ProtocolError();
      this.receipt = v;
    } else throw new ProtocolError();
    return v;
  }
  finish() {
    if (!this.done || !this.receipt) throw new ProtocolError();
    if (this.error)
      throw Object.assign(new Error(this.error.message), {
        code: this.error.code,
      });
    return this.receipt;
  }
}
export async function readJSON(response, limit = 65536) {
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new ProtocolError("Expected JSON");
  const reader = response.body.getReader();
  let bytes = 0,
    parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new ProtocolError("Response too large");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const v of parts) {
    all.set(v, offset);
    offset += v.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
}
