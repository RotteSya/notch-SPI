import { validAccount, validSettlement } from "../generated/settlement.mjs";
export { validAccount, validSettlement };
import { OfficialStream, ProtocolError } from "../generated/official-stream.mjs";
export { OfficialStream, ProtocolError };
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
