// Generated from shared/protocol/official-stream.mjs.
// Shared SSE event semantics. Byte framing and asynchronous delivery remain platform adapters.
import { validAccount, validSettlement } from "./settlement.mjs";
export class ProtocolError extends Error {
  constructor(message = "Incomplete or invalid answer stream") {
    super(message);
    this.code = "invalid_stream";
  }
}
const streamUint = (n) => Number.isSafeInteger(n) && n >= 0;
function sameStreamCaptureID(value, expected) {
  if (typeof value !== "string" || typeof expected !== "string") return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return value === expected || (uuid.test(value) && uuid.test(expected) && value.toLowerCase() === expected.toLowerCase());
}
// Native struct copies receive independent engines, including already accepted events.
export function createOfficialStream(id, screenQuery, operation, snapshot = null) {
  const stream = new OfficialStream(id, screenQuery, operation);
  return snapshot === null ? stream : Object.assign(stream, JSON.parse(snapshot));
}
export function snapshotOfficialStream(stream) { return JSON.stringify(stream); }
export class OfficialStream {
  receipt = null;
  error = null;
  content = "";
  contentBytes = 0;
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
      const bytes = unescape(encodeURIComponent(v.text)).length;
      if (this.contentBytes + bytes > 65536) throw new ProtocolError();
      this.contentBytes += bytes;
      this.content += v.text;
    } else if (v.type === "error") {
      if (this.receipt || this.error) throw new ProtocolError();
      const error = v.error ?? v;
      if ((v.message != null && typeof v.message !== "string") ||
          (v.code != null && typeof v.code !== "string")) throw new ProtocolError();
      if (typeof error.message !== "string" || !error.message ||
          (error.code != null && typeof error.code !== "string"))
        throw new ProtocolError();
      this.error = error;
    } else if (v.type === "usage") {
      if (
        this.receipt ||
        !validAccount(!this.screenQuery && v.balance_version === null ? { ...v, balance_version: undefined } : v) ||
        !["solve", "explain", "recover"].includes(this.operation) ||
        (v.explanation_available != null && typeof v.explanation_available !== "boolean") ||
        !streamUint(v.input_tokens) ||
        !streamUint(v.output_tokens) ||
        ![0, 1].includes(v.questions_charged) ||
        (v.capture_id != null && !sameStreamCaptureID(v.capture_id, this.id)) ||
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
      if (this.screenQuery && (!sameStreamCaptureID(v.capture_id, this.id) || !validSettlement({ ...v, capture_id: this.id }, this.id)))
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
  finishOutcome() {
    if (!this.done || !this.receipt) throw new ProtocolError();
    return { hasContent: Boolean(this.content.trim()), serviceError: this.error };
  }
  finish() {
    this.finishOutcome();
    if (this.error)
      throw Object.assign(new Error(this.error.message), {
        code: this.error.code,
      });
    return this.receipt;
  }
}
