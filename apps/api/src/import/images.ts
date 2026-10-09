import { and, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { importRuns, printLocalizations, prints, sets } from '../db/schema';
import { USER_AGENT, type Fetch } from './scryfall/source';

// The card image mirror (VB-57): copies every print's source image into R2 under
// images/<game>/<printId>/<lang>/{orig.<ext>,sm.webp} and writes the key into `image_key`. The
// bulk load runs as a Node script on the database VPS (scripts/mirror-images.ts, S3 API + sharp);
// the daily delta runs as the last step of each import Workflow (R2 binding + Images binding).
// Only the transport differs: both call `mirrorImages` with their own `MirrorDeps`.

export type ImageSize = 'orig' | 'sm';
/** Width of the `sm` copy; same aspect ratio, never enlarged. */
export const SM_WIDTH = 320;
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Requests per second per source: Scryfall's file hosts have no limit (be polite), YGOPRODeck allows 20, TCGdex asks to be considerate. */
export const SOURCE_RATES: Record<string, number> = { mtg: 20, yugioh: 15, pokemon: 8 };

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function imageKey(
  game: string,
  printId: string,
  lang: string,
  size: ImageSize,
  ext: string,
): string {
  return `images/${game}/${printId}/${lang}/${size}.${ext}`;
}

/** File extension of an image URL's path (`jpg`, `png`, `webp`), null for anything else. */
export function extension(url: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  const norm = ext === 'jpeg' ? 'jpg' : ext;
  return norm && norm in CONTENT_TYPES ? norm : null;
}

/** The `external_ids` keys that hold source image URLs, the only ones the mirror reads. */
export const IMAGE_ID_FIELDS = ['scryfall_images', 'image_url', 'tcgdex_images'] as const;

const https = (v: unknown) => (typeof v === 'string' && v.startsWith('https://') ? v : null);

/**
 * The URL of the image to mirror from a print's or localization's `external_ids`, null when it
 * has none: Scryfall `large` (JPEG, 672 px), then `normal`, then `png`, never its "missing image"
 * placeholder; YGOPRODeck `image_url`; TCGdex `tcgdex_images.high` (`<image>/high.webp`).
 */
export function sourceUrl(game: string, ids: Record<string, unknown>): string | null {
  switch (game) {
    case 'mtg': {
      const uris = (ids.scryfall_images ?? {}) as Record<string, unknown>;
      const url = https(uris.large) ?? https(uris.normal) ?? https(uris.png);
      return url && new URL(url).hostname !== 'errors.scryfall.com' ? url : null;
    }
    case 'yugioh':
      return https(ids.image_url);
    case 'pokemon':
      return https((ids.tcgdex_images as Record<string, unknown> | undefined)?.high);
    default:
      return null;
  }
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Token bucket. `take()` reserves a token synchronously and waits until it is due, so concurrent
 * callers queue up instead of racing. Capacity 1 by default: requests are evenly spaced and no
 * one-second window ever sees more than `rate` of them.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly capacity = 1,
    private readonly clock: Clock = realClock,
  ) {
    this.tokens = capacity;
    this.last = clock.now();
  }

  take(): Promise<void> {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) * this.rate) / 1000);
    this.last = now;
    this.tokens -= 1;
    return this.tokens < 0
      ? this.clock.sleep((-this.tokens * 1000) / this.rate)
      : Promise.resolve();
  }
}

export interface ImageTarget {
  table: 'prints' | 'print_localizations';
  printId: string;
  lang: string;
}

/** One source image: downloaded once, stored under `keys`, written to every target. */
export interface ImageJob {
  game: string;
  url: string;
  keys: Record<ImageSize, string>;
  contentType: string;
  targets: ImageTarget[];
}

export interface PendingRow extends ImageTarget {
  game: string;
  ids: Record<string, unknown>;
}

/**
 * Groups rows by source URL. The first row of a URL names the keys; the rest reuse them (a print
 * and its English localization, a Yu-Gi-Oh! card in several sets share one image).
 */
export function planJobs(rows: PendingRow[]): { jobs: ImageJob[]; noSource: number } {
  const byUrl = new Map<string, ImageJob>();
  let noSource = 0;
  for (const { game, ids, ...target } of rows) {
    const url = sourceUrl(game, ids);
    const ext = url && extension(url);
    if (!url || !ext) {
      noSource++;
      continue;
    }
    let job = byUrl.get(url);
    if (!job) {
      const key = (size: ImageSize, e: string) =>
        imageKey(game, target.printId, target.lang, size, e);
      job = {
        game,
        url,
        keys: { orig: key('orig', ext), sm: key('sm', 'webp') },
        contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
        targets: [],
      };
      byUrl.set(url, job);
    }
    job.targets.push(target);
  }
  return { jobs: [...byUrl.values()], noSource };
}

/** What the mirror needs from its host; `put`/`head` match `BlobStore` and an S3 adapter. */
export interface MirrorDeps {
  fetch: Fetch;
  store: {
    put(
      key: string,
      body: Uint8Array,
      options: { contentType: string; cacheControl: string },
    ): Promise<unknown>;
    head(key: string): Promise<unknown>;
  };
  /** The `sm` copy: SM_WIDTH px wide (never enlarged), WebP. */
  resize(body: Uint8Array): Promise<Uint8Array>;
  log(level: 'info' | 'warn', fields: Record<string, unknown>): void;
  clock?: Clock;
}

export interface MirrorOptions {
  /** Parallel downloads (each still waits for its source's rate limiter). */
  concurrency: number;
  /** HEAD both objects first and skip the download when they exist. */
  verify: boolean;
}

export interface MirrorStats {
  images: number;
  uploaded: number;
  /** Already in the bucket (`verify`). */
  reused: number;
  failed: number;
  bytes: number;
}

export class SourceRateLimited extends Error {}

/**
 * Downloads and stores each job's image, calling `done` once its objects exist. A failed image is
 * logged and counted and its rows keep no key, so the next run retries it; a 429 aborts the run
 * (YGOPRODeck blocks an IP for an hour after one).
 */
export async function mirrorJobs(
  deps: MirrorDeps,
  jobs: ImageJob[],
  opts: MirrorOptions,
  done: (job: ImageJob) => Promise<void>,
): Promise<MirrorStats> {
  const clock = deps.clock ?? realClock;
  const buckets = new Map<string, TokenBucket>();
  const bucket = (game: string) => {
    let b = buckets.get(game);
    if (!b) buckets.set(game, (b = new TokenBucket(SOURCE_RATES[game] ?? 5, 1, clock)));
    return b;
  };
  const stats: MirrorStats = { images: jobs.length, uploaded: 0, reused: 0, failed: 0, bytes: 0 };
  const started = clock.now();
  let next = 0;
  let aborted = false;

  const progress = () => {
    const n = stats.uploaded + stats.reused + stats.failed;
    if (n % 500 === 0 || n === jobs.length)
      deps.log('info', {
        message: 'image mirror progress',
        ...stats,
        done: n,
        perSecond: Math.round((n / Math.max(1, clock.now() - started)) * 10000) / 10,
      });
  };

  const one = async (job: ImageJob) => {
    if (opts.verify) {
      const [orig, sm] = await Promise.all([
        deps.store.head(job.keys.orig),
        deps.store.head(job.keys.sm),
      ]);
      if (orig && sm) {
        stats.reused++;
        return;
      }
    }
    await bucket(job.game).take();
    const res = await deps.fetch(job.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      // An unread body keeps the connection open (Workers allow six).
      await res.body?.cancel();
      if (res.status === 429) throw new SourceRateLimited(`${job.url} answered 429, stopping`);
      throw new Error(`answered ${res.status}`);
    }
    const type = res.headers.get('content-type')?.split(';')[0]?.trim();
    if (type && !type.startsWith('image/')) throw new Error(`content type ${type}`);
    const body = new Uint8Array(await res.arrayBuffer());
    const sm = await deps.resize(body);
    const cacheControl = IMAGE_CACHE_CONTROL;
    await Promise.all([
      deps.store.put(job.keys.orig, body, { contentType: type ?? job.contentType, cacheControl }),
      deps.store.put(job.keys.sm, sm, { contentType: 'image/webp', cacheControl }),
    ]);
    stats.uploaded++;
    stats.bytes += body.byteLength + sm.byteLength;
  };

  const worker = async () => {
    while (!aborted && next < jobs.length) {
      const job = jobs[next++] as ImageJob;
      try {
        try {
          await one(job);
        } catch (err) {
          if (err instanceof SourceRateLimited) throw err;
          stats.failed++;
          deps.log('warn', { message: 'image failed', url: job.url, error: String(err) });
          progress();
          continue;
        }
        await done(job);
      } catch (err) {
        // A 429 or a failed key write stops every worker.
        aborted = true;
        throw err;
      }
      progress();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  return stats;
}

export type Db = NodePgDatabase;

export interface PendingQuery {
  game?: string | undefined;
  /** Rows (a print or a localization) to read at most. */
  limit?: number | undefined;
  /** Only prints created since this import run started (the daily delta). */
  sinceRun?: string | undefined;
}

const imageIds = (column: SQLWrapper) =>
  sql`jsonb_build_object(${sql.join(
    IMAGE_ID_FIELDS.map((f) => sql`${f}::text, ${column} -> ${f}::text`),
    sql`, `,
  )})`;

/**
 * Prints and localizations without `image_key`, oldest print first, the print before its
 * localizations. Only the image fields of `external_ids` are read, which keeps a full run of
 * every Magic print in memory small.
 */
export async function pendingRows(db: Db, q: PendingQuery): Promise<PendingRow[]> {
  const filters: SQL[] = [];
  if (q.game) filters.push(sql`${sets.gameId} = ${q.game}`);
  if (q.sinceRun)
    filters.push(
      sql`${prints.createdAt} >= (select ${importRuns.startedAt} from ${importRuns} where ${importRuns.id} = ${q.sinceRun})`,
    );
  const where = filters.length ? sql` and ${sql.join(filters, sql` and `)}` : sql``;
  const result = await db.execute<{
    print_id: string;
    lang: string;
    t: number;
    game: string;
    ids: Record<string, unknown>;
  }>(sql`
    select print_id, lang, t, game, ids from (
      select ${prints.id} as print_id, 'en' as lang, 0 as t, ${sets.gameId} as game,
        ${imageIds(prints.externalIds)} as ids, ${prints.createdAt} as created_at
      from ${prints} join ${sets} on ${sets.id} = ${prints.setId}
      where ${prints.imageKey} is null${where}
      union all
      select ${printLocalizations.printId}, ${printLocalizations.lang}, 1, ${sets.gameId},
        ${imageIds(printLocalizations.externalIds)}, ${prints.createdAt}
      from ${printLocalizations}
        join ${prints} on ${prints.id} = ${printLocalizations.printId}
        join ${sets} on ${sets.id} = ${prints.setId}
      where ${printLocalizations.imageKey} is null${where}
    ) r
    order by created_at, print_id, t, lang
    ${q.limit ? sql`limit ${q.limit}` : sql``}`);
  return result.rows.map((r) => ({
    table: r.t === 0 ? 'prints' : 'print_localizations',
    printId: r.print_id,
    lang: r.lang,
    game: r.game,
    ids: r.ids,
  }));
}

/** Sets `image_key` on rows that still have none (a concurrent run's key is kept). */
export async function writeKeys(db: Db, rows: (ImageTarget & { key: string })[]) {
  const json = (table: ImageTarget['table']) =>
    JSON.stringify(
      rows
        .filter((r) => r.table === table)
        .map(({ printId, lang, key }) => ({ id: printId, lang, key })),
    );
  await db.execute(sql`
    update ${prints} set image_key = v.key
    from jsonb_to_recordset(${json('prints')}::jsonb) as v(id uuid, lang text, key text)
    where ${prints.id} = v.id and ${prints.imageKey} is null`);
  await db.execute(sql`
    update ${printLocalizations} set image_key = v.key
    from jsonb_to_recordset(${json('print_localizations')}::jsonb) as v(id uuid, lang text, key text)
    where ${printLocalizations.printId} = v.id and ${printLocalizations.lang} = v.lang
      and ${printLocalizations.imageKey} is null`);
}

export interface MirrorRunStats extends MirrorStats {
  rows: number;
  /** Rows without a usable source URL. */
  noSource: number;
}

/** Keys written per database round trip. */
const KEY_BATCH = 500;

/**
 * One mirror run: the pending rows of `query`, grouped by source URL, mirrored, the keys written
 * back in batches. Records an `import_runs` row (source and kind `images`) unless `dryRun`, which
 * only reads and plans. Idempotent: a rerun picks up the rows that still have no key.
 */
export async function mirrorImages(
  deps: MirrorDeps,
  db: Db,
  query: PendingQuery,
  opts: MirrorOptions & { dryRun?: boolean },
): Promise<MirrorRunStats> {
  const rows = await pendingRows(db, query);
  const { jobs, noSource } = planJobs(rows);
  const zero = { images: jobs.length, uploaded: 0, reused: 0, failed: 0, bytes: 0 };
  if (opts.dryRun) {
    deps.log('info', {
      message: 'image mirror dry run',
      rows: rows.length,
      images: jobs.length,
      noSource,
      sample: jobs
        .slice(0, 5)
        .map((j) => ({ url: j.url, keys: j.keys, targets: j.targets.length })),
    });
    return { ...zero, rows: rows.length, noSource };
  }

  const [run] = await db
    .insert(importRuns)
    .values({ source: 'images', kind: 'images', stats: { query } })
    .returning({ id: importRuns.id });
  if (!run) throw new Error('import_runs insert returned no row');

  let pending: (ImageTarget & { key: string })[] = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    if (batch.length) await writeKeys(db, batch);
  };
  try {
    let stats: MirrorStats;
    try {
      stats = await mirrorJobs(deps, jobs, opts, async (job) => {
        pending.push(...job.targets.map((t) => ({ ...t, key: job.keys.orig })));
        if (pending.length >= KEY_BATCH) await flush();
      });
    } finally {
      await flush();
    }
    const result = { ...stats, rows: rows.length, noSource };
    await db
      .update(importRuns)
      .set({ status: 'ok', finishedAt: sql`now()`, stats: { query, ...result } })
      .where(eq(importRuns.id, run.id));
    return result;
  } catch (err) {
    await db
      .update(importRuns)
      .set({ status: 'failed', finishedAt: sql`now()`, error: String(err).slice(0, 4000) })
      .where(and(eq(importRuns.id, run.id), eq(importRuns.status, 'running')));
    throw err;
  }
}
