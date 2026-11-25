import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function postgresBin(): string | null {
  const roots = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'];
  const found = roots.find(root => existsSync(join(root, 'postgres')));
  if (found) return found;
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir && existsSync(join(dir, 'postgres')) && existsSync(join(dir, 'initdb'))) return dir;
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface EphemeralPostgres {
  url: string;
  /** Stop a server this helper started and delete its data directory. A caller-supplied URL is left alone. */
  close(): Promise<void>;
}

/**
 * Use TEST_POSTGRES_URL when it names a database containing "test".
 * Otherwise start a temporary server when a local postgres binary is available.
 * Returns null when neither is available so callers can skip the Postgres group.
 */
export async function openEphemeralPostgres(): Promise<EphemeralPostgres | null> {
  const configured = process.env.TEST_POSTGRES_URL;
  if (configured) {
    const parsed = new URL(configured);
    if (!/test/i.test(parsed.pathname)) throw new Error('TEST_POSTGRES_URL must name a database containing test');
    return { url: configured, close: async () => {} };
  }
  const bin = postgresBin();
  if (!bin) return null;
  const user = process.env.USER || 'notchspi';
  const dir = await mkdtemp(join(tmpdir(), 'notchspi-qb-pg-'));
  const port = await freePort();
  const stop = async () => {
    await exec(join(bin, 'pg_ctl'), ['-D', dir, '-m', 'immediate', 'stop']).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  };
  try {
    await exec(join(bin, 'initdb'), [
      '-D', dir, '-U', user, '--auth-host=trust', '--auth-local=trust', '--locale=C', '--encoding=UTF8', '--no-instructions',
    ]);
    await exec('/bin/sh', ['-c', `printf '%s\n' "listen_addresses = '127.0.0.1'" "port = ${port}" "unix_socket_directories = '${dir}'" >> '${dir}/postgresql.conf'`]);
    // On macOS a non-C inherited locale can make the postmaster refuse to start ("became multithreaded during startup").
    await exec(join(bin, 'pg_ctl'), ['-D', dir, '-l', join(dir, 'server.log'), '-w', '-t', '60', 'start'], { env: { ...process.env, LC_ALL: 'C' } });
    await exec(join(bin, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', user, 'notchspi_question_bank_test']);
    return { url: `postgres://${encodeURIComponent(user)}@127.0.0.1:${port}/notchspi_question_bank_test?sslmode=disable`, close: stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
