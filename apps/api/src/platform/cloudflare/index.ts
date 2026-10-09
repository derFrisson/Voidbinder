import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Platform } from '../../app';
import { log } from '../../middleware/log';
import { DrizzleCardStore } from './drizzle-card-store';
import { R2BlobStore } from './r2-blob-store';

/**
 * The only place that touches Cloudflare bindings (ADR 0001). Called once per request: each pool
 * lives for that request only (Hyperdrive pools at the edge) and connects on its first query, so
 * requests that never query open no connection.
 *
 * Two pools (ADR 0004): `pool` reads fresh through `HYPERDRIVE` and serves everything;
 * `cachedPool` reads through `HYPERDRIVE_CACHED` (up to 300 s + swr stale) and goes to the
 * catalog and price stores only, which VB-26 / VB-30 add. Without that binding (self-hosting) it
 * is the same pool.
 */
/**
 * A pool for one request. An idle client's socket error is emitted on the pool and crashes the
 * isolate without a listener; workerd reports "This socket has been closed" on every `end()`,
 * so errors after `end()` are expected and dropped.
 */
function openPool(connectionString: string): Pool {
  // Workers allow 6 concurrent outbound connections per request; two pools share them (3 + 3).
  const pool = new Pool({ connectionString, max: 3 });
  pool.on('error', (err) => {
    if (!pool.ending) log('warn', { message: 'idle database client failed', error: String(err) });
  });
  return pool;
}

export function createPlatform(env: Env): Platform {
  const pool = openPool(env.HYPERDRIVE.connectionString);
  const cachedPool = env.HYPERDRIVE_CACHED
    ? openPool(env.HYPERDRIVE_CACHED.connectionString)
    : pool;
  // ponytail: nothing reads through the cache yet; VB-26 hands `drizzle(cachedPool)` to the
  // catalog store. An unused pool opens no connection.
  const db = drizzle(pool);
  return {
    cardStore: new DrizzleCardStore(db),
    blobStore: new R2BlobStore(env.CATALOG),
    db,
    close: async () => {
      await Promise.all(cachedPool === pool ? [pool.end()] : [pool.end(), cachedPool.end()]);
    },
  };
}
