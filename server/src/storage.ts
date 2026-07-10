import type { Store } from './db.ts';
import type { Config } from './config.ts';

// Storage selection, most-durable first. Implementations are imported DYNAMICALLY so a
// platform missing node:sqlite (or with a read-only filesystem) never even loads the module
// it can't use:
//
//   1. POSTGRES_URL / DATABASE_URL set  → PostgresStore   (production)
//   2. serverless platform (VERCEL=1)   → MemoryStore     (ephemeral — visible in /healthz)
//   3. otherwise                        → SqliteStore     (local dev / self-hosted VPS)

export type StoreKind = 'postgres' | 'sqlite' | 'memory';

export async function makeStore(config: Config): Promise<{ store: Store; kind: StoreKind }> {
  if (config.postgresUrl) {
    const { PostgresStore } = await import('./db-postgres.ts');
    return { store: new PostgresStore(config.postgresUrl), kind: 'postgres' };
  }
  if (config.isServerless) {
    const { MemoryStore } = await import('./db-memory.ts');
    return { store: new MemoryStore(), kind: 'memory' };
  }
  const { SqliteStore } = await import('./db-sqlite.ts');
  return { store: new SqliteStore(config.dbPath), kind: 'sqlite' };
}
