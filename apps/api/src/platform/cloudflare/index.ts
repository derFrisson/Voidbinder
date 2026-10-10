import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AppDeps, Platform } from '../../app';
import type { MirrorDeps } from '../../import/images';
import type { ImportDeps } from '../../import/scryfall/pipeline';
import type { ImportDeps as TcgdexDeps } from '../../import/tcgdex/pipeline';
import { TcgdexClient } from '../../import/tcgdex/source';
import { log } from '../../middleware/log';
import { DrizzleCardStore } from './drizzle-card-store';
import { bindingMailSender } from './mail-sender';
import { R2BlobStore } from './r2-blob-store';
import { WorkflowJobQueue } from './workflow-job-queue';

/**
 * The only place that touches Cloudflare bindings (ADR 0001). Called once per request: each pool
 * lives for that request only (Hyperdrive pools at the edge) and connects on its first query, so
 * requests that never query open no connection.
 *
 * Two pools (ADR 0004): `pool` reads fresh through `HYPERDRIVE` and serves everything;
 * `cachedPool` reads through `HYPERDRIVE_CACHED` (up to 300 s + swr stale) and goes to the
 * catalog reads only (and the price reads of VB-30). Without that binding (self-hosting) it is
 * the same pool.
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

/**
 * The public `CATALOG` bucket (img.voidbinder.de) holds card images only; anything else (raw
 * source dumps, whose republication breaks the sources' terms) goes to the private `RAW` bucket.
 */
const catalogImages = (env: Env) => new R2BlobStore(env.CATALOG, 'images/');

export function createPlatform(env: Env): Platform {
  const pool = openPool(env.HYPERDRIVE.connectionString);
  const cachedPool = env.HYPERDRIVE_CACHED
    ? openPool(env.HYPERDRIVE_CACHED.connectionString)
    : pool;
  // An unused pool opens no connection.
  const db = drizzle(pool);
  return {
    cardStore: new DrizzleCardStore(db, {
      catalogDb: drizzle(cachedPool),
      imageBaseUrl: env.IMAGE_BASE_URL,
    }),
    blobStore: catalogImages(env),
    jobQueue: new WorkflowJobQueue({
      'scryfall-import': env.SCRYFALL_IMPORT,
      'tcgdex-import': env.TCGDEX_IMPORT,
      'ygoprodeck-import': env.YGOPRODECK_IMPORT,
      'tcgcsv-import': env.TCGCSV_IMPORT,
    }),
    db,
    close: async () => {
      await Promise.all(cachedPool === pool ? [pool.end()] : [pool.end(), cachedPool.end()]);
    },
  };
}

/** The app's dependencies from the Worker's vars, secrets and bindings. */
export function appDeps(env: Env): AppDeps {
  return {
    appUrl: env.APP_URL,
    // Comma-separated; blanks around the commas and empty entries are ignored.
    extraOrigins: (env.CORS_EXTRA_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    version: env.VERSION,
    auth: {
      secret: env.BETTER_AUTH_SECRET,
      apiUrl: env.API_URL,
      // Always the binding: `wrangler dev` simulates it locally, and a mail that cannot be sent
      // is logged as an error, never with its link.
      mail: bindingMailSender(env.EMAIL),
    },
    adminToken: env.ADMIN_TOKEN,
    openPlatform: () => createPlatform(env),
  };
}

/** A fresh (uncached) connection for one Workflow step, closed when `fn` settles. */
export async function withDatabase<T>(
  env: Env,
  fn: (db: NodePgDatabase) => Promise<T>,
): Promise<T> {
  const pool = openPool(env.HYPERDRIVE.connectionString);
  try {
    return await fn(drizzle(pool));
  } finally {
    await pool.end();
  }
}

/** What the import Workflows work with: `fetch`, the private `RAW` bucket, a pool per step. */
export function scryfallImportDeps(env: Env): ImportDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    raw: new R2BlobStore(env.RAW),
    withDb: (fn) => withDatabase(env, fn),
  };
}

/** What the YGOPRODeck import Workflow works with: the same as the Scryfall one. */
export const ygoprodeckImportDeps = scryfallImportDeps;

/** What the TCGCSV price Workflow works with: the same as the Scryfall one. */
export const tcgcsvImportDeps = scryfallImportDeps;

/** Starts a TCGCSV price import instance; an `id` makes it unique (the cron's one per day). */
export async function startTcgcsvImport(env: Env, id?: string): Promise<void> {
  const instance = await env.TCGCSV_IMPORT.create(id ? { id } : {});
  log('info', { message: 'workflow started', job: 'tcgcsv-import', instanceId: instance.id });
}

/** Starts a YGOPRODeck import instance; an `id` makes it unique (the cron's one per day). */
export async function startYgoprodeckImport(env: Env, id?: string): Promise<void> {
  const instance = await env.YGOPRODECK_IMPORT.create(id ? { id } : {});
  log('info', { message: 'workflow started', job: 'ygoprodeck-import', instanceId: instance.id });
}

/** Starts a Scryfall import instance; an `id` makes it unique (the cron's one per day). */
export async function startScryfallImport(env: Env, id?: string): Promise<void> {
  const instance = await env.SCRYFALL_IMPORT.create(id ? { id } : {});
  log('info', { message: 'workflow started', job: 'scryfall-import', instanceId: instance.id });
}

/** What the TCGdex import Workflow works with: paced `fetch`, the `CATALOG` bucket, a pool per step. */
export function tcgdexImportDeps(env: Env): TcgdexDeps {
  return {
    client: new TcgdexClient((input, init) => fetch(input, init)),
    blobs: new R2BlobStore(env.RAW),
    withDb: (fn) => withDatabase(env, fn),
  };
}

/** Starts a TCGdex import instance; an `id` makes it unique (the cron's one per day). */
export async function startTcgdexImport(env: Env, id?: string): Promise<void> {
  const instance = await env.TCGDEX_IMPORT.create({ ...(id && { id }), params: {} });
  log('info', { message: 'workflow started', job: 'tcgdex-import', instanceId: instance.id });
}

/**
 * The cron's TCGdex start: skipped (and logged) while a TCGdex run is still going, which a full
 * run or a slow day can make last past the next cron. Same check as POST /admin/import/tcgdex.
 */
export async function startTcgdexCron(
  env: Env,
  id: string,
  platform: Pick<Platform, 'cardStore' | 'close'> = createPlatform(env),
): Promise<void> {
  try {
    if (await platform.cardStore.importRunning('tcgdex')) {
      log('info', { message: 'import still running, cron start skipped', job: 'tcgdex-import' });
      return;
    }
  } finally {
    await platform.close();
  }
  await startTcgdexImport(env, id);
}

/** The image mirror's daily delta (VB-57): `orig` only, into `CATALOG`; the VPS adds `sm`. */
export function imageMirrorDeps(env: Env): MirrorDeps {
  return { fetch: (input, init) => fetch(input, init), store: catalogImages(env), log };
}
