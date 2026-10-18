import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { checkClientTree, scanClientSources } from './client-route-scan.ts';

// Config is read at import. Keep this process off production storage and vendors.
process.env.NODE_ENV = 'test';
process.env.REQUIRE_DURABLE_STORAGE = '0';
process.env.OFFICIAL_PROVIDER = 'mock';
process.env.OBJECTIVE_PROVIDER = 'mock';
process.env.DB_PATH = ':memory:';
process.env.PAYMENT_PROVIDER = 'stub';
process.env.LOG_LEVEL = 'silent';
for (const name of [
  'POSTGRES_URL', 'DATABASE_URL', 'VERCEL', 'VERCEL_PROJECT_PRODUCTION_URL',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY', 'XAI_API_KEY',
]) delete process.env[name];

const repo = path.resolve(import.meta.dirname, '../..');
const { buildApp } = await import('../src/index.ts');

type Live = { method: string; path: string };
const collected: Live[] = [];
const app = await buildApp({
  onRoute(route) {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const normalized = route.url.startsWith('/') ? route.url : `/${route.url}`;
      collected.push({ method: method.toUpperCase(), path: normalized });
    }
  },
});
after(async () => { await app.close(); });

function inventory(markdown: string): Map<string, string> {
  const start = markdown.indexOf('<!-- route-inventory: start -->');
  const end = markdown.indexOf('<!-- route-inventory: end -->');
  assert.ok(start >= 0 && end > start, 'docs/official-api.md is missing the route inventory');
  const rows = new Map<string, string>();
  for (const line of markdown.slice(start, end).split('\n')) {
    const match = line.match(/^\|\s*(public|client|internal|admin|compat)\s*\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*(\/\S*?)\s*\|$/);
    const audience = match?.[1];
    const method = match?.[2];
    const route = match?.[3];
    if (!audience || !method || !route) continue;
    const key = `${method} ${route}`;
    assert.equal(rows.has(key), false, `duplicate inventory row ${key}`);
    rows.set(key, audience);
  }
  assert.ok(rows.size > 0, 'route inventory table is empty');
  return rows;
}

function headingKeys(markdown: string): string[] {
  const keys: string[] = [];
  for (const line of markdown.split('\n')) {
    if (!/^#{1,6}\s/.test(line)) continue;
    const re = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^ \t#]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line))) {
      const method = match[1];
      const rawPath = match[2];
      if (!method || !rawPath) continue;
      let routePath = rawPath.replace(/\\/g, '');
      const query = routePath.indexOf('?');
      if (query !== -1) routePath = routePath.slice(0, query);
      routePath = routePath.replace(/[.,);]+$/, '');
      keys.push(`${method} ${routePath}`);
    }
  }
  return keys;
}

function liveKeys(): Set<string> {
  const gets = new Set(collected.filter((route) => route.method === 'GET').map((route) => route.path));
  const keys = new Set<string>();
  for (const route of collected) {
    if (route.method === 'HEAD' && gets.has(route.path)) continue;
    keys.add(`${route.method} ${route.path}`);
  }
  return keys;
}

test('registered routes match the official API inventory', () => {
  const markdown = fs.readFileSync(path.join(repo, 'docs/official-api.md'), 'utf8');
  const rows = inventory(markdown);
  const live = liveKeys();
  const documented = new Set(rows.keys());
  const missing = [...live].filter((key) => !documented.has(key)).sort();
  const extra = [...documented].filter((key) => !live.has(key)).sort();
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
  for (const key of headingKeys(markdown)) {
    assert.equal(rows.has(key), true, `heading ${key} is not in the route inventory`);
  }
});

function clientTree(root: string) {
  return {
    cloud: path.join(root, 'Sources/NotchSPI/Cloud'),
    update: path.join(root, 'Sources/NotchSPI/Update/UpdateChecker.swift'),
  };
}

function assertRouteFailure(errors: string[], file: string, contract: string) {
  assert.ok(
    errors.some((line) => line.includes(file) && line.includes(contract)),
    errors.join('\n') || 'checker returned no error',
  );
}

test('Cloud and update callers stay inside the inventory', () => {
  const markdown = fs.readFileSync(path.join(repo, 'docs/official-api.md'), 'utf8');
  const rows = inventory(markdown);
  const tree = clientTree(repo);
  assert.deepEqual(checkClientTree(tree.cloud, tree.update, rows), []);
  const scanned = scanClientSources([
    ...fs.readdirSync(tree.cloud).filter((name) => name.endsWith('.swift')).map((name) => ({
      file: path.join(tree.cloud, name),
      source: fs.readFileSync(path.join(tree.cloud, name), 'utf8'),
    })),
    { file: tree.update, source: fs.readFileSync(tree.update, 'utf8') },
  ]);
  const keys = new Set(scanned.calls.map((call) => `${call.method} ${call.path}`));
  for (const key of [
    'POST /v1/device-source',
    'GET /v1/captures/:id/status',
    'POST /v1/captures/:id/explanation',
    'POST /v1/captures/:id/recovery',
    'GET /v1/purchase-sessions/:purchaseId',
  ]) assert.equal(keys.has(key), true, key);
  assert.deepEqual([...keys].sort(), [
    'GET /healthz',
    'GET /update',
    'GET /v1/account',
    'GET /v1/captures/:id/status',
    'GET /v1/client-config',
    'GET /v1/device-observation',
    'GET /v1/plus',
    'GET /v1/purchase-sessions/:purchaseId',
    'POST /v1/captures',
    'POST /v1/captures/:id/explanation',
    'POST /v1/captures/:id/recovery',
    'POST /v1/device-observation',
    'POST /v1/device-source',
    'POST /v1/devices',
    'POST /v1/events/batch',
    'POST /v1/free-trial/claim',
    'POST /v1/plus/cancel',
    'POST /v1/plus/checkout',
    'POST /v1/plus/portal',
    'POST /v1/purchase-sessions',
  ]);
});

test('client route failures come from the checker on a source copy', () => {
  const markdown = fs.readFileSync(path.join(repo, 'docs/official-api.md'), 'utf8');
  const rows = inventory(markdown);
  const cases: Array<{ name: string; file: string; from: string; to: string; expectFile: string; expectContract: string }> = [
    {
      name: 'device source method',
      file: 'Sources/NotchSPI/Cloud/DeviceSourceSelection.swift',
      from: 'value.httpMethod = "POST"',
      to: 'value.httpMethod = "DELETE"',
      expectFile: 'DeviceSourceSelection.swift',
      expectContract: 'DELETE /v1/device-source',
    },
    {
      name: 'missing static path',
      file: 'Sources/NotchSPI/Cloud/DeviceSourceSelection.swift',
      from: 'path: "v1/device-source"',
      to: 'path: "v1/device-source-missing"',
      expectFile: 'DeviceSourceSelection.swift',
      expectContract: 'POST /v1/device-source-missing',
    },
    {
      name: 'capture status method',
      file: 'Sources/NotchSPI/Cloud/OfficialAPI.swift',
      from: 'let path = "v1/captures/" + id.uuidString.lowercased() + "/status"\n        var request = URLRequest(url: endpointURL(base: base ?? baseURL, path: path))\n        request.timeoutInterval = 10',
      to: 'let path = "v1/captures/" + id.uuidString.lowercased() + "/status"\n        var request = URLRequest(url: endpointURL(base: base ?? baseURL, path: path))\n        request.httpMethod = "DELETE"\n        request.timeoutInterval = 10',
      expectFile: 'OfficialAPI.swift',
      expectContract: 'DELETE /v1/captures/:id/status',
    },
    {
      name: 'explanation path',
      file: 'Sources/NotchSPI/Cloud/OfficialAPI.swift',
      from: '? "explanation" : "recovery"',
      to: '? "explain" : "recovery"',
      expectFile: 'OfficialAPI.swift',
      expectContract: 'POST /v1/captures/*/explain',
    },
    {
      name: 'recovery method',
      file: 'Sources/NotchSPI/Cloud/OfficialAPI.swift',
      from: 'request.url = endpointURL(base: base, path: path)',
      to: 'request.httpMethod = "DELETE"\n                request.url = endpointURL(base: base, path: path)',
      expectFile: 'OfficialAPI.swift',
      expectContract: 'DELETE /v1/captures/:id/recovery',
    },
  ];
  for (const item of cases) {
    const copy = fs.mkdtempSync(path.join(tmpdir(), 'nspi-routes-'));
    fs.cpSync(path.join(repo, 'Sources/NotchSPI/Cloud'), path.join(copy, 'Sources/NotchSPI/Cloud'), { recursive: true });
    fs.mkdirSync(path.join(copy, 'Sources/NotchSPI/Update'), { recursive: true });
    fs.copyFileSync(
      path.join(repo, 'Sources/NotchSPI/Update/UpdateChecker.swift'),
      path.join(copy, 'Sources/NotchSPI/Update/UpdateChecker.swift'),
    );
    const target = path.join(copy, item.file);
    const source = fs.readFileSync(target, 'utf8');
    assert.equal(source.includes(item.from), true, `${item.name} injection site missing`);
    fs.writeFileSync(target, source.replace(item.from, item.to));
    const tree = clientTree(copy);
    assertRouteFailure(checkClientTree(tree.cloud, tree.update, rows), item.expectFile, item.expectContract);
    fs.rmSync(copy, { recursive: true, force: true });
  }

  const copy = fs.mkdtempSync(path.join(tmpdir(), 'nspi-routes-'));
  fs.cpSync(path.join(repo, 'Sources/NotchSPI/Cloud'), path.join(copy, 'Sources/NotchSPI/Cloud'), { recursive: true });
  fs.mkdirSync(path.join(copy, 'Sources/NotchSPI/Update'), { recursive: true });
  fs.copyFileSync(
    path.join(repo, 'Sources/NotchSPI/Update/UpdateChecker.swift'),
    path.join(copy, 'Sources/NotchSPI/Update/UpdateChecker.swift'),
  );
  const device = path.join(copy, 'Sources/NotchSPI/Cloud/DeviceSourceSelection.swift');
  fs.writeFileSync(device, fs.readFileSync(device, 'utf8').replace(
    'value.httpMethod = "POST"',
    'value.httpMethod = group.rawValue',
  ));
  const tree = clientTree(copy);
  const errors = checkClientTree(tree.cloud, tree.update, rows);
  assert.ok(
    errors.some((line) => line.includes('DeviceSourceSelection.swift') && line.includes('could not be parsed')),
    errors.join('\n'),
  );
  assert.equal(errors.some((line) => line === 'DeviceSourceSelection.swift POST /v1/device-source'), false);
  fs.rmSync(copy, { recursive: true, force: true });
});

function contractKeys(root: string): string[] {
  const tree = clientTree(root);
  const scanned = scanClientSources([
    ...fs.readdirSync(tree.cloud).filter((name) => name.endsWith('.swift')).map((name) => ({
      file: path.join(tree.cloud, name),
      source: fs.readFileSync(path.join(tree.cloud, name), 'utf8'),
    })),
    { file: tree.update, source: fs.readFileSync(tree.update, 'utf8') },
  ]);
  return scanned.calls.map((call) => `${call.file} ${call.method} ${call.path}`).sort();
}

function copyClient(root: string): string {
  const copy = fs.mkdtempSync(path.join(tmpdir(), 'nspi-routes-'));
  fs.cpSync(path.join(root, 'Sources/NotchSPI/Cloud'), path.join(copy, 'Sources/NotchSPI/Cloud'), { recursive: true });
  fs.mkdirSync(path.join(copy, 'Sources/NotchSPI/Update'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'Sources/NotchSPI/Update/UpdateChecker.swift'),
    path.join(copy, 'Sources/NotchSPI/Update/UpdateChecker.swift'),
  );
  return copy;
}

const registerOriginal = `        var req = URLRequest(url: endpointURL(base: baseURL, path: "v1/devices"))
        req.httpMethod = "POST"`;
const registerReturn = `        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        return req`;

function writeRegisterInsertion(insertion: string): string {
  const copy = copyClient(repo);
  const target = path.join(copy, 'Sources/NotchSPI/Cloud/OfficialAPI.swift');
  const source = fs.readFileSync(target, 'utf8');
  assert.equal(source.includes(registerReturn), true, 'makeRegisterRequest return site missing');
  const next = source.replace(
    registerReturn,
    `        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)\n${insertion}\n        return req`,
  );
  assert.notEqual(next, source);
  fs.writeFileSync(target, next);
  assert.equal(fs.readFileSync(target, 'utf8').includes(insertion), true, 'conditional injection missing');
  return copy;
}

function assertRegisterFailure(errors: string[], detail: string) {
  assert.ok(
    errors.some((line) => line.includes('OfficialAPI.swift')
      && line.includes('makeRegisterRequest')
      && line.includes('req.httpMethod')
      && line.includes(detail)),
    errors.join('\n') || 'checker returned no error',
  );
}

test('an explicit URLRequest type keeps the same client contracts', () => {
  const markdown = fs.readFileSync(path.join(repo, 'docs/official-api.md'), 'utf8');
  const rows = inventory(markdown);
  const baseline = contractKeys(repo);
  assert.equal(baseline.includes('OfficialAPI.swift POST /v1/devices'), true);
  const forms = [
    `        var req: URLRequest = URLRequest(
            url: endpointURL(base: baseURL, path: "v1/devices")
        )
        req.httpMethod = "POST"`,
    `        var req: URLRequest =
            URLRequest(url: endpointURL(base: baseURL, path: "v1/devices"))
        req.httpMethod = "POST"`,
  ];
  for (const form of forms) {
    const copy = copyClient(repo);
    const target = path.join(copy, 'Sources/NotchSPI/Cloud/OfficialAPI.swift');
    const source = fs.readFileSync(target, 'utf8');
    assert.equal(source.includes(registerOriginal), true);
    fs.writeFileSync(target, source.replace(registerOriginal, form));
    const tree = clientTree(copy);
    assert.deepEqual(checkClientTree(tree.cloud, tree.update, rows), []);
    assert.deepEqual(contractKeys(copy), baseline);
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('an explicit URLRequest type changed to DELETE is reported', () => {
  const markdown = fs.readFileSync(path.join(repo, 'docs/official-api.md'), 'utf8');
  const rows = inventory(markdown);
  const copy = copyClient(repo);
  const target = path.join(copy, 'Sources/NotchSPI/Cloud/OfficialAPI.swift');
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(
    registerOriginal,
    `        var req: URLRequest = URLRequest(
            url: endpointURL(base: baseURL, path: "v1/devices")
        )
        req.httpMethod = "DELETE"`,
  ));
  const tree = clientTree(copy);
  const errors = checkClientTree(tree.cloud, tree.update, rows);
  assertRouteFailure(errors, 'OfficialAPI.swift', 'DELETE /v1/devices');
  assert.equal(contractKeys(copy).includes('OfficialAPI.swift POST /v1/devices'), false);
  fs.rmSync(copy, { recursive: true, force: true });
});

test('an inline URLRequest send that cannot be bound is an error', () => {
  const markdown = fs.readFileSync(path.join(repo, 'docs/official-api.md'), 'utf8');
  const rows = inventory(markdown);
  const copy = copyClient(repo);
  const target = path.join(copy, 'Sources/NotchSPI/Cloud/OfficialAPI.swift');
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(
    'req.httpMethod = "POST"\n        req.setValue("application/json", forHTTPHeaderField: "Content-Type")\n        req.timeoutInterval = 30\n        var payload = ["platform": "macos", "app_version": appVersion]',
    'req.httpMethod = "POST"\n        _ = URLSession.shared.data(for: URLRequest(url: endpointURL(base: baseURL, path: "v1/devices")))\n        var payload = ["platform": "macos", "app_version": appVersion]',
  ));
  const tree = clientTree(copy);
  const errors = checkClientTree(tree.cloud, tree.update, rows);
  assert.ok(
    errors.some((line) => line.includes('OfficialAPI.swift') && line.includes('makeRegisterRequest') && line.includes('could not be parsed')),
    errors.join('\n'),
  );
  fs.rmSync(copy, { recursive: true, force: true });
});

function conditionalRows() {
  return inventory(fs.readFileSync(path.join(repo, 'docs/official-api.md'), 'utf8'));
}

test('a single-line conditional httpMethod assignment is reported', () => {
  const copy = writeRegisterInsertion('        if true { req.httpMethod = "DELETE" }');
  try {
    const errors = checkClientTree(clientTree(copy).cloud, clientTree(copy).update, conditionalRows());
    assertRegisterFailure(errors, 'DELETE /v1/devices');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('a multi-line conditional httpMethod assignment is reported', () => {
  const copy = writeRegisterInsertion(`        if true {
            req.httpMethod = "DELETE"
        }`);
  try {
    const errors = checkClientTree(clientTree(copy).cloud, clientTree(copy).update, conditionalRows());
    assertRegisterFailure(errors, 'DELETE /v1/devices');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('an if else httpMethod assignment keeps every branch', () => {
  const copy = writeRegisterInsertion(`        if ready {
            req.httpMethod = "DELETE"
        } else {
            req.httpMethod = "POST"
        }`);
  try {
    const errors = checkClientTree(clientTree(copy).cloud, clientTree(copy).update, conditionalRows());
    assertRegisterFailure(errors, 'DELETE /v1/devices');
    assertRegisterFailure(errors, 'POST /v1/devices');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('a nested conditional httpMethod assignment is reported', () => {
  const copy = writeRegisterInsertion(`        if outer {
            if inner {
                req.httpMethod = "DELETE"
            }
        }`);
  try {
    const errors = checkClientTree(clientTree(copy).cloud, clientTree(copy).update, conditionalRows());
    assertRegisterFailure(errors, 'DELETE /v1/devices');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('an unparsed conditional httpMethod expression is reported', () => {
  const copy = writeRegisterInsertion(`        if ready {
            req.httpMethod = group.rawValue
        }`);
  try {
    const errors = checkClientTree(clientTree(copy).cloud, clientTree(copy).update, conditionalRows());
    assertRegisterFailure(errors, 'conditional assignment could not be parsed');
    assert.equal(errors.some((line) => line === 'OfficialAPI.swift POST /v1/devices'), false);
    assert.equal(errors.some((line) => line === 'OfficialAPI.swift DELETE /v1/devices'), false);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('comments and strings do not create httpMethod contracts', () => {
  const insertion = [
    '        // if true { req.httpMethod = "DELETE" }',
    '        /* req.httpMethod = "DELETE" */',
    '        let note = "if true { req.httpMethod = \\"DELETE\\" }"',
  ].join('\n');
  const baseline = contractKeys(repo);
  const copy = writeRegisterInsertion(insertion);
  try {
    const tree = clientTree(copy);
    assert.deepEqual(checkClientTree(tree.cloud, tree.update, conditionalRows()), []);
    assert.deepEqual(contractKeys(copy), baseline);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('a conditional assignment of a listed POST method is still reported', () => {
  const baseline = contractKeys(repo);
  const copy = writeRegisterInsertion('        if ready { req.httpMethod = "POST" }');
  try {
    const tree = clientTree(copy);
    const errors = checkClientTree(tree.cloud, tree.update, conditionalRows());
    assertRegisterFailure(errors, 'conditional assignment includes POST /v1/devices');
    assert.deepEqual(contractKeys(copy), baseline);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
