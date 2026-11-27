// Log-safe summary of an unexpected request failure. Messages, causes' text, request data and
// SQL details are never copied: a message is only compared with exact library constants and
// replaced by a fixed label. Only the constructor name, a code shaped like a Node system code or
// PostgreSQL SQLSTATE, that label and the source frames below the message are kept.
export type FailureSummary = { kind: string; name: string; code?: string; frames: string[] };

// pg / pg-pool constants. Pool connect timeouts include a Neon scale-to-zero wake that outlasts
// connectionTimeoutMillis, which otherwise surfaces only as an anonymous 500.
const KNOWN_MESSAGES = new Map<string, string>([
  ['Connection terminated due to connection timeout', 'db_connect_timeout'],
  ['timeout exceeded when trying to connect', 'db_pool_wait_timeout'],
  ['Query read timeout', 'db_query_timeout'],
  ['Connection terminated unexpectedly', 'db_connection_lost'],
]);
const SQLSTATE_KINDS = new Map<string, string>([['57014', 'db_statement_timeout'], ['55P03', 'db_lock_timeout']]);
const CODE = /^(?:E[A-Z0-9_]{2,40}|ERR_[A-Z0-9_]{1,60}|[0-9A-Z]{5})$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_FRAMES = 6, MAX_FRAME_LENGTH = 240, MAX_CAUSES = 4;

function frames(error: Error): string[] {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  // V8 prefixes the stack with "name: message"; a multi-line message must not be read as frames.
  const header = `${error.name}${error.message ? `: ${error.message}` : ''}`;
  if (!stack.startsWith(header)) return [];
  return stack.slice(header.length).split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('at '))
    .slice(0, MAX_FRAMES)
    .map(line => line.slice(0, MAX_FRAME_LENGTH));
}

export function summarizeFailure(error: unknown): FailureSummary {
  if (!(error instanceof Error)) return { kind: 'non_error', name: 'unknown', frames: [] };
  const summary: FailureSummary = { kind: 'unclassified', name: NAME.test(error.name) ? error.name : 'unknown', frames: frames(error) };
  // Follow wrapped causes so a library wrapper does not hide the database or network code.
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSES && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (summary.code === undefined && typeof code === 'string' && CODE.test(code)) summary.code = code;
    const kind = KNOWN_MESSAGES.get(current.message) ?? (typeof code === 'string' ? SQLSTATE_KINDS.get(code) : undefined);
    if (summary.kind === 'unclassified' && kind) summary.kind = kind;
    current = (current as { cause?: unknown }).cause;
  }
  return summary;
}
