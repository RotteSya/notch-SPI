import fs from 'node:fs';
import path from 'node:path';

export type ClientCall = { file: string; method: string; path: string };
type Method = string | { empty: string; present: string } | { any: string[] };
type State = { method: Method; paths: string[] | null; bad: string | null; parametric: boolean; conditional: boolean };
type Sig = { file: string; name: string; method: Method; paths: string[] | null };
type LocalFile = { file: string; source: string };

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD';

function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next;
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

function balanced(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i] ?? '';
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTop(source: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? '';
    if (quote) {
      current += ch;
      if (ch === '\\') { current += source[i + 1] ?? ''; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (depth === 0 && source.startsWith(separator, i)) {
      parts.push(current);
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// Newlines and semicolons split statements. Braces stay in that stream so the
// walker can tell `if`/`else`/`guard`/`switch`/`while`/`for` blocks from `do` and closures.
function statements(body: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  let paren = 0;
  let bracket = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? '';
    if (quote) {
      current += ch;
      if (ch === '\\') { current += body[i + 1] ?? ''; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; current += ch; continue; }
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    if ((ch === '\n' || ch === ';') && paren === 0 && bracket === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return stitchDeclarations(out);
}

function stitchDeclarations(parts: string[]): string[] {
  const stitched: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const current = parts[index] ?? '';
    const next = parts[index + 1];
    const continued = /^(?:var|let)\s+[A-Za-z_]\w*(?:\s*:\s*[A-Za-z_][\w.]*(?:\?)?)?\s*=$/.test(current);
    if (next && continued && /^URLRequest\b/.test(next)) {
      stitched.push(`${current} ${next}`);
      index += 1;
      continue;
    }
    stitched.push(current);
  }
  return stitched;
}

type Fn = { name: string; signature: string; body: string };

function functionsIn(source: string): Fn[] {
  const found: Fn[] = [];
  const re = /\bfunc\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1];
    if (!name) continue;
    const open = match.index + match[0].length - 1;
    const close = balanced(source, open, '(', ')');
    if (close < 0) continue;
    const brace = source.indexOf('{', close);
    if (brace < 0) continue;
    const end = balanced(source, brace, '{', '}');
    if (end < 0) continue;
    found.push({
      name,
      signature: source.slice(match.index, close + 1),
      body: source.slice(brace + 1, end),
    });
    re.lastIndex = end + 1;
  }
  return found;
}

function parameterNames(signature: string, kind: 'URLRequest' | 'URL'): Set<string> {
  const names = new Set<string>();
  const open = signature.indexOf('(');
  const close = balanced(signature, open, '(', ')');
  if (open < 0 || close < 0) return names;
  for (const part of splitTop(signature.slice(open + 1, close), ',')) {
    const parsed = part.trim().match(/^(?:(\w+)\s+)?(\w+)\s*:\s*([\s\S]+)$/);
    const internal = parsed?.[2];
    const type = parsed?.[3] ?? '';
    if (!internal) continue;
    const request = /\bURLRequest\b/.test(type);
    const url = /\bURL\b/.test(type) && !request;
    if ((kind === 'URLRequest' && request) || (kind === 'URL' && url)) names.add(internal);
  }
  return names;
}

function canon(raw: string): string {
  let route = raw.startsWith('/') ? raw : `/${raw}`;
  route = route.replace(/\/{2,}/g, '/');
  if (route.length > 1 && route.endsWith('/')) route = route.slice(0, -1);
  const known: Record<string, string> = {
    '/v1/captures/*/status': '/v1/captures/:id/status',
    '/v1/captures/*/explanation': '/v1/captures/:id/explanation',
    '/v1/captures/*/recovery': '/v1/captures/:id/recovery',
    '/v1/purchase-sessions/*': '/v1/purchase-sessions/:purchaseId',
  };
  return known[route] ?? route;
}

function resolveExpr(expr: string, env: Map<string, string[]>): string[] | null {
  const text = expr.trim().replace(/,\s*$/, '');
  if (!text) return null;
  const literal = text.match(/^"([^"]*)"$/);
  if (literal?.[1] !== undefined) return [literal[1]];
  let quote: string | null = null;
  let depth = 0;
  let question = -1;
  let colon = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '?' && depth === 0 && question < 0) question = i;
    else if (ch === ':' && depth === 0 && question >= 0 && colon < 0) colon = i;
  }
  if (question >= 0 && colon > question) {
    const left = resolveExpr(text.slice(question + 1, colon), env);
    const right = resolveExpr(text.slice(colon + 1), env);
    if (!left || !right) return null;
    return [...left, ...right];
  }
  const parts = splitTop(text, '+').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const resolved = parts.map((part) => resolveExpr(part, env) ?? ['*']);
    let rows = [''];
    for (const choices of resolved) {
      const next: string[] = [];
      for (const row of rows) for (const choice of choices) next.push(row + choice);
      rows = next;
    }
    return rows;
  }
  if (/^[A-Za-z_]\w*$/.test(text) && env.has(text)) return env.get(text) ?? null;
  return null;
}

function endpointPaths(text: string, env: Map<string, string[]>): string[] | null {
  const marker = 'endpointURL(';
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const open = start + marker.length - 1;
  const close = balanced(text, open, '(', ')');
  if (close < 0) return null;
  const inner = text.slice(open + 1, close);
  const key = splitTop(inner, ',').map((part) => part.trim()).find((part) => part.startsWith('path:'));
  if (!key) return null;
  const resolved = resolveExpr(key.slice('path:'.length), env);
  if (!resolved) return null;
  return resolved.map(canon);
}

function routeLiterals(expr: string): string[] | null {
  const found = [...expr.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '').filter((value) => (
    value.startsWith('/v1/') || value.startsWith('v1/') || value === 'healthz' || value === 'update' || value === 'dl' || value === 'topup'
  ));
  if (found.length === 0) return null;
  return found.map(canon);
}

function fileBindings(source: string): Map<string, string[]> {
  const env = new Map<string, string[]>();
  const re = /var\s+(\w+)\s*:\s*URL\s*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    const paths = endpointPaths(body, env) ?? routeLiterals(body);
    if (paths) env.set(name, paths);
  }
  return env;
}

function parseMethod(rhs: string): Method | null {
  const text = rhs.trim().replace(/;\s*$/, '');
  const literal = text.match(new RegExp(`^"(${METHODS})"$`));
  if (literal?.[1]) return literal[1];
  const conditional = text.match(new RegExp(`^\\w+\\s*==\\s*nil\\s*\\?\\s*"(${METHODS})"\\s*:\\s*"(${METHODS})"$`));
  if (conditional?.[1] && conditional[2]) return { empty: conditional[1], present: conditional[2] };
  return null;
}

const CONDITIONAL_KEYWORDS = new Set(['if', 'else', 'guard', 'switch', 'while', 'for']);
const PLAIN_KEYWORDS = new Set(['do', 'catch', 'defer']);
type Control = { blocks: Array<'cond' | 'plain'>; pending: 'cond' | 'plain' | null; directive: number };
type MethodAssignment = { name: string; rhs: string; conditional: boolean };

function methodNames(method: Method): string[] {
  if (typeof method === 'string') return [method];
  if ('any' in method) return method.any;
  return [method.empty, method.present];
}

function mergeMethod(current: Method, extra: Method): Method {
  const names = [...new Set([...methodNames(current), ...methodNames(extra)])];
  const [only] = names;
  if (names.length === 1 && only) return only;
  return { any: names };
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function readUntilTerminator(statement: string, start: number): { end: number; text: string } {
  let k = start;
  let paren = 0;
  let bracket = 0;
  let rhsQuote: string | null = null;
  while (k < statement.length) {
    const c = statement[k] ?? '';
    if (rhsQuote) {
      if (c === '\\') { k += 2; continue; }
      if (c === rhsQuote) rhsQuote = null;
      k += 1;
      continue;
    }
    if (c === '"' || c === '\'') { rhsQuote = c; k += 1; continue; }
    if (c === '(') paren += 1;
    else if (c === ')') paren -= 1;
    else if (c === '[') bracket += 1;
    else if (c === ']') bracket -= 1;
    else if ((c === ';' || c === '\n' || c === '}') && paren === 0 && bracket === 0) break;
    k += 1;
  }
  return { end: k, text: statement.slice(start, k).trim() };
}

// A conditional keyword marks the next `{`. Assignments inside that block keep
// every parsed method. An unparsed right-hand side fails the request.
function absorbStatement(statement: string, control: Control): MethodAssignment[] {
  const found: MethodAssignment[] = [];
  let quote: string | null = null;
  let i = 0;
  while (i < statement.length) {
    const ch = statement[i] ?? '';
    const next = statement[i + 1] ?? '';
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; i += 1; continue; }
    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < statement.length && !(statement[i] === '*' && statement[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '.' && statement.startsWith('httpMethod', i + 1)) {
      let k = i + 1 + 'httpMethod'.length;
      while (statement[k] === ' ' || statement[k] === '\t') k += 1;
      if (statement[k] === '=') {
        k += 1;
        const rhs = readUntilTerminator(statement, k);
        found.push({
          name: '',
          rhs: rhs.text,
          conditional: control.blocks.includes('cond') || control.directive > 0,
        });
        i = rhs.end;
        continue;
      }
    }
    if (ch === '{') {
      control.blocks.push(control.pending ?? 'plain');
      control.pending = null;
      i += 1;
      continue;
    }
    if (ch === '}') {
      control.blocks.pop();
      control.pending = null;
      i += 1;
      continue;
    }
    if (isWordChar(ch) && (i === 0 || !isWordChar(statement[i - 1] ?? ''))) {
      let j = i + 1;
      while (j < statement.length && isWordChar(statement[j] ?? '')) j += 1;
      const word = statement.slice(i, j);
      if (statement[i - 1] === '#') {
        if (word === 'if') control.directive += 1;
        else if (word === 'endif') control.directive = Math.max(0, control.directive - 1);
        i = j;
        continue;
      }
      if (CONDITIONAL_KEYWORDS.has(word) || PLAIN_KEYWORDS.has(word)) {
        control.pending = CONDITIONAL_KEYWORDS.has(word) ? 'cond' : 'plain';
        i = j;
        continue;
      }
      if (statement.startsWith('.httpMethod', j)) {
        let k = j + '.httpMethod'.length;
        while (statement[k] === ' ' || statement[k] === '\t') k += 1;
        if (statement[k] === '=') {
          k += 1;
          const rhs = readUntilTerminator(statement, k);
          found.push({
            name: word,
            rhs: rhs.text,
            conditional: control.blocks.includes('cond') || control.directive > 0,
          });
          i = rhs.end;
          continue;
        }
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return found;
}

function lookup(sigs: Sig[], file: string, name: string): Sig | null {
  const sameFile = sigs.find((sig) => sig.name === name && sig.file === file);
  if (sameFile) return sameFile;
  const matches = sigs.filter((sig) => sig.name === name);
  return matches.length === 1 ? matches[0] ?? null : null;
}

function rememberBinding(statement: string, env: Map<string, string[]>) {
  const url = statement.match(/\b(?:let|var)\s+(\w+)(?:\s*:\s*URL)?\s*=\s*URL\(string:\s*([\s\S]*?)\)/);
  if (url?.[1]) {
    const paths = routeLiterals(url[2] ?? '');
    if (paths) env.set(url[1], paths);
    return;
  }
  const assigned = statement.match(/\b(?:let|var)\s+(\w+)\s*=\s*([\s\S]+)$/);
  if (!assigned?.[1] || assigned[2] === undefined) return;
  if (statement.includes('URLRequest') || statement.includes('URL(string:')) return;
  const resolved = resolveExpr(assigned[2], env);
  if (resolved) env.set(assigned[1], resolved.map(canon));
}

function requestPaths(statement: string, env: Map<string, string[]>, urlParams: Set<string>): { paths: string[] | null; parametric: boolean } {
  const marker = 'URLRequest(';
  const start = statement.indexOf(marker);
  if (start < 0) return { paths: null, parametric: false };
  const open = start + marker.length - 1;
  const close = balanced(statement, open, '(', ')');
  if (close < 0) return { paths: null, parametric: false };
  const inner = statement.slice(open + 1, close);
  const urlPart = splitTop(inner, ',').map((part) => part.trim()).find((part) => part.startsWith('url:'));
  if (!urlPart) return { paths: null, parametric: false };
  const expr = urlPart.slice('url:'.length).trim();
  if (expr.includes('endpointURL(')) return { paths: endpointPaths(expr, env), parametric: false };
  if (/^[A-Za-z_]\w*$/.test(expr)) {
    if (urlParams.has(expr) && !env.has(expr)) return { paths: null, parametric: true };
    return { paths: env.get(expr) ?? null, parametric: false };
  }
  return { paths: routeLiterals(expr), parametric: false };
}

function analyze(file: string, fn: Fn, fileEnv: Map<string, string[]>, sigs: Sig[], emit: boolean): { calls: ClientCall[]; errors: string[]; sig: Sig | null } {
  const calls: ClientCall[] = [];
  const errors: string[] = [];
  const env = new Map(fileEnv);
  const requests = new Map<string, State>();
  const requestParams = parameterNames(fn.signature, 'URLRequest');
  const urlParams = parameterNames(fn.signature, 'URL');
  const base = path.basename(file);

  const fail = (message: string) => {
    const line = `${base}: ${fn.name}: ${message}`;
    if (!errors.includes(line)) errors.push(line);
  };

  const emitState = (name: string) => {
    if (requestParams.has(name)) return;
    const state = requests.get(name);
    if (!state) {
      fail(`${name} is sent but its URLRequest was not parsed`);
      return;
    }
    if (state.parametric) return;
    if (state.bad) {
      fail(state.bad);
      return;
    }
    if (!state.paths || state.paths.length === 0) {
      fail(`${name} request path could not be parsed`);
      return;
    }
    for (const route of state.paths) {
      for (const method of methodNames(state.method)) {
        calls.push({ file: base, method, path: route });
        if (state.conditional) fail(`${name}.httpMethod conditional assignment includes ${method} ${route}`);
      }
    }
  };

  const applyMethod = (assignment: MethodAssignment) => {
    if (!assignment.name) {
      fail(assignment.conditional
        ? 'httpMethod conditional assignment could not be parsed'
        : 'httpMethod assignment could not be parsed');
      return;
    }
    const state = requests.get(assignment.name);
    if (!state) {
      fail(`${assignment.name}.httpMethod is not attached to a parsed URLRequest`);
      return;
    }
    const parsed = parseMethod(assignment.rhs);
    if (assignment.conditional) {
      if (!parsed) {
        state.bad = `${assignment.name}.httpMethod conditional assignment could not be parsed`;
        state.conditional = true;
        return;
      }
      if (state.bad) return;
      state.method = mergeMethod(state.method, parsed);
      state.conditional = true;
      return;
    }
    if (parsed) {
      state.method = parsed;
      state.conditional = false;
    } else state.bad = `${assignment.name}.httpMethod could not be parsed`;
  };

  const control: Control = { blocks: [], pending: null, directive: 0 };
  for (const statement of statements(fn.body)) {
    rememberBinding(statement, env);
    for (const assignment of absorbStatement(statement, control)) applyMethod(assignment);
    const urlSet = statement.match(/^(\w+)\.url\s*=\s*([\s\S]+)$/);
    if (urlSet?.[1] && urlSet[2] !== undefined) {
      const paths = urlSet[2].includes('endpointURL(') ? endpointPaths(urlSet[2], env) : resolveExpr(urlSet[2], env)?.map(canon) ?? null;
      const state = requests.get(urlSet[1]);
      if (!state) {
        fail(`${urlSet[1]}.url is not attached to a parsed URLRequest`);
        continue;
      }
      if (paths) state.paths = paths;
      else state.bad = `${urlSet[1]} request path could not be parsed`;
      continue;
    }
    if (statement.includes('URLRequest(')) {
      const assigned = statement.match(/^(?:(?:var|let)\s+)?([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_][\w.]*(?:\?)?)?\s*=\s*URLRequest\b/);
      if (!assigned?.[1]) {
        fail('URLRequest construction could not be parsed');
        continue;
      }
      const resolved = requestPaths(statement, env, urlParams);
      requests.set(assigned[1], {
        method: 'GET',
        paths: resolved.paths,
        parametric: resolved.parametric,
        bad: resolved.parametric || resolved.paths ? null : `${assigned[1]} request path could not be parsed`,
        conditional: false,
      });
      continue;
    }
    const factory = statement.match(/^(?:(?:var|let)\s+)?(\w+)\s*=\s*(?:Self\.)?(\w+)\s*\(/);
    if (factory?.[1] && factory[2]) {
      const sig = lookup(sigs, file, factory[2]);
      if (sig) {
        requests.set(factory[1], {
          method: sig.method,
          paths: sig.paths,
          bad: null,
          parametric: sig.paths === null,
          conditional: false,
        });
        continue;
      }
    }
    const callRe = /\brequest\(url:\s*(\w+)/g;
    let call: RegExpExecArray | null;
    while ((call = callRe.exec(statement))) {
      const target = call[1];
      const sig = lookup(sigs, file, 'request');
      if (!target || !sig || sig.paths !== null || typeof sig.method === 'string') continue;
      const paths = env.get(target);
      if (!paths) {
        fail(`request(url: ${target}) could not be parsed`);
        continue;
      }
      if (!('present' in sig.method)) {
        fail(`request(url: ${target}).httpMethod conditional assignment could not be parsed`);
        continue;
      }
      const open = statement.indexOf('request(url:', call.index);
      const close = balanced(statement, statement.indexOf('(', open), '(', ')');
      const inner = close > open ? statement.slice(open, close) : statement.slice(open);
      const hasBody = /\bbody\s*:/.test(inner) && !/\bbody\s*:\s*nil\b/.test(inner);
      const method = hasBody ? sig.method.present : sig.method.empty;
      for (const route of paths) calls.push({ file: base, method, path: route });
    }
    for (const name of usedNames(statement)) emitState(name);
  }

  let sig: Sig | null = null;
  const returned = fn.body.match(/\breturn\s+(\w+)/);
  const returnedName = returned?.[1];
  if (returnedName && requests.has(returnedName)) {
    const state = requests.get(returnedName);
    if (state && !state.bad) sig = { file, name: fn.name, method: state.method, paths: state.parametric ? null : state.paths };
  }
  if (emit) {
    for (const name of requests.keys()) {
      if (new RegExp(`\\breturn\\s+${name}\\b`).test(fn.body)) emitState(name);
    }
  }
  return { calls, errors, sig };
}

function usedNames(statement: string): string[] {
  const names: string[] = [];
  const patterns = [
    /\bdata\(for:\s*([A-Za-z_]\w*)\b(?!\s*\()/g,
    /\bbytes\(for:\s*([A-Za-z_]\w*)\b(?!\s*\()/g,
    /\bdataTask\(with:\s*([A-Za-z_]\w*)\b(?!\s*\()/g,
    /\breadAccountHTTP\(\s*([A-Za-z_]\w*)\b(?!\s*\()/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(statement))) if (match[1]) names.push(match[1]);
  }
  return names;
}

export function scanClientSources(files: LocalFile[]): { calls: ClientCall[]; errors: string[] } {
  const prepared = files.map((entry) => ({
    file: entry.file,
    source: stripComments(entry.source),
    fns: functionsIn(stripComments(entry.source)),
    env: fileBindings(stripComments(entry.source)),
  }));
  const sigs: Sig[] = [];
  for (const entry of prepared) {
    for (const fn of entry.fns) {
      const result = analyze(entry.file, fn, entry.env, sigs, false);
      if (result.sig) sigs.push(result.sig);
    }
  }
  const calls: ClientCall[] = [];
  const errors: string[] = [];
  for (const entry of prepared) {
    for (const fn of entry.fns) {
      const result = analyze(entry.file, fn, entry.env, sigs, true);
      calls.push(...result.calls);
      errors.push(...result.errors);
    }
  }
  const seen = new Set<string>();
  const unique = calls.filter((call) => {
    const key = `${call.file} ${call.method} ${call.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { calls: unique, errors };
}

export function loadClientSources(cloudDir: string, updateFile: string): LocalFile[] {
  const files = fs.readdirSync(cloudDir)
    .filter((name) => name.endsWith('.swift'))
    .sort()
    .map((name) => ({ file: path.join(cloudDir, name), source: fs.readFileSync(path.join(cloudDir, name), 'utf8') }));
  files.push({ file: updateFile, source: fs.readFileSync(updateFile, 'utf8') });
  return files;
}

export function checkClientTree(cloudDir: string, updateFile: string, inventory: Map<string, string>): string[] {
  const scanned = scanClientSources(loadClientSources(cloudDir, updateFile));
  const errors = [...scanned.errors];
  if (scanned.calls.length < 10) errors.push(`expected the Cloud callers to reference the API, found ${scanned.calls.length}`);
  for (const call of scanned.calls) {
    if (!inventory.has(`${call.method} ${call.path}`)) errors.push(`${call.file} ${call.method} ${call.path}`);
  }
  return errors;
}
