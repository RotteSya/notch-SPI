import { validAccount, validSettlement } from "../generated/settlement.mjs";
export { validAccount, validSettlement };
export class ProtocolError extends Error {
  constructor(message = "Incomplete or invalid answer stream") {
    super(message);
    this.code = "invalid_stream";
  }
}
const uint = (n) => Number.isSafeInteger(n) && n >= 0;
// Byte framing handles split UTF-8, CR/LF, BOM, comments and multi-line SSE data.
export class SSEFramer {
  decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  line = [];
  lines = [];
  bytes = 0;
  eventBytes = 0;
  skipLF = false;
  firstLine = true;
  *feed(chunk) {
    // Yield each complete event before examining later bytes in this chunk.
    // A malformed suffix must not erase a validated settlement or a prior DONE.
    for (const byte of chunk) {
      if (++this.bytes > 4 * 1024 * 1024)
        throw new ProtocolError("Stream too large");
      if (this.skipLF) {
        this.skipLF = false;
        if (byte === 10) continue;
      }
      if (byte === 13 || byte === 10) {
        this.skipLF = byte === 13;
        let line = this.decoder.decode(Uint8Array.from(this.line));
        this.line = [];
        if (this.firstLine) {
          this.firstLine = false;
          if (line.startsWith("\uFEFF")) line = line.slice(1);
        }
        if (!line) {
          const payload = this.lines.length ? this.lines.join("\n") : null;
          this.lines = [];
          this.eventBytes = 0;
          if (payload !== null) yield payload;
        } else if (line === "data" || line.startsWith("data:")) {
          const data = line.slice(5).replace(/^ /, "");
          this.eventBytes += new TextEncoder().encode(data).length + 1;
          if (this.eventBytes > 512 * 1024) throw new ProtocolError();
          this.lines.push(data);
        }
      } else {
        if (this.line.length >= 512 * 1024) throw new ProtocolError();
        this.line.push(byte);
      }
    }
  }
  finish() {
    this.decoder.decode(Uint8Array.from(this.line));
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
    if (!v || typeof v !== "object") throw new ProtocolError();
    if (v.type === "delta") {
      if (this.receipt || this.error || typeof v.text !== "string")
        throw new ProtocolError();
      this.content += v.text;
      if (new TextEncoder().encode(this.content).length > 65536)
        throw new ProtocolError();
    } else if (v.type === "error") {
      if (this.receipt || this.error) throw new ProtocolError();
      const error = v.error ?? v;
      if (typeof error.message !== "string" || !error.message ||
          (error.code != null && typeof error.code !== "string"))
        throw new ProtocolError();
      this.error = error;
    } else if (v.type === "usage") {
      if (
        this.receipt ||
        !validAccount(v) ||
        (v.explanation_available != null && typeof v.explanation_available !== "boolean") ||
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
