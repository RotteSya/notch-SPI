import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostgresSSL } from '../src/db-postgres.ts';

const URL = 'postgres://u:p@host/db';

test('default (mode unset) verifies the server certificate', () => {
  assert.deepEqual(resolvePostgresSSL({ connectionString: URL }), { rejectUnauthorized: true });
});

test('an unknown mode falls back to the verified default (never silently insecure)', () => {
  assert.deepEqual(resolvePostgresSSL({ connectionString: URL, mode: 'whatever' }), {
    rejectUnauthorized: true,
  });
});

test('verify-full with a custom CA passes it through and keeps verification on', () => {
  const ca = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
  assert.deepEqual(resolvePostgresSSL({ connectionString: URL, mode: 'verify-full', caCert: ca }), {
    rejectUnauthorized: true,
    ca,
  });
});

test("mode 'require' is the explicit, opt-in unverified escape hatch", () => {
  assert.deepEqual(resolvePostgresSSL({ connectionString: URL, mode: 'require' }), {
    rejectUnauthorized: false,
  });
});

test("mode 'disable' turns TLS off entirely", () => {
  assert.equal(resolvePostgresSSL({ connectionString: URL, mode: 'disable' }), false);
});

test('sslmode=disable in the connection string also turns TLS off (local dev)', () => {
  assert.equal(resolvePostgresSSL({ connectionString: `${URL}?sslmode=disable` }), false);
});

test('a blank/whitespace CA is ignored — verification uses the system trust store', () => {
  assert.deepEqual(resolvePostgresSSL({ connectionString: URL, mode: 'verify-full', caCert: '   ' }), {
    rejectUnauthorized: true,
  });
});
