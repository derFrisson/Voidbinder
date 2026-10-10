import { and, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { imageSourcesGone, importRuns, printLocalizations, prints, sets } from '../db/schema';
import { USER_AGENT, type Fetch } from './scryfall/source';
import { USER_AGENT as YUGIPEDIA_USER_AGENT } from './yugipedia/source';

// The card image mirror (VB-57): copies every print's source image into R2 under
// images/<game>/<source id>/<lang>/{orig.<ext>,sm.webp} and writes the key into `image_key`. The
// source id is the source's stable id, so dev and prod share the objects. The bulk load and the
// nightly catch-up run as a Node script on the database VPS (scripts/mirror-images.ts, S3 API +
// sharp, `orig` and `sm`); the daily delta runs as the last step of each import Workflow (R2
// binding, `orig` only). Only the transport differs: both call `mirrorImages`.
//
// `image_key` is the `sm` key once that copy exists and the `orig` key until then, so the API
// serves the small copy when there is one without asking R2 (`hasSm`).
//
// A Magic print whose Scryfall image is only `lowres` is mirrored too, under `orig-lowres.<ext>` /
// `sm-lowres.webp`: the objects are immutable for a year, so the later high-res scan needs names of
// its own. Once Scryfall flags the scan (`highres_image`), the row is pending again and its key is
// replaced by the high-res one (`writeKeys` ranks the keys). Localizations wait for a high-res scan.

export type ImageSize = 'orig' | 'sm' | 'orig-lowres' | 'sm-lowres';
/** Width of the `sm` copy; same aspect ratio, never enlarged. */
export const SM_WIDTH = 320;
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Requests per second per source: Scryfall's file hosts have no limit (be polite), YGOPRODeck
 * allows 20, TCGdex asks to be considerate; Yugipedia's scans (VB-106) one a second, as its API;
 * pokemontcg.io's pictures (VB-118, the Pokémon backup) a few a second.
 */
export const SOURCE_RATES: Record<string, number> = {
  mtg: 20,
  yugioh: 15,
  pokemon: 8,
  yugipedia: 1,
  pokemontcg: 4,
};

/**
 * The rate limiter (SOURCE_RATES key) of an image URL: its game's, Yugipedia's for a wiki scan,
 * pokemontcg.io's for its pictures.
 */
const sourceOf = (game: string, url: string) => {
  const host = new URL(url).hostname;
  if (host.endsWith('yugipedia.com')) return 'yugipedia';
  return host === 'images.pokemontcg.io' ? 'pokemontcg' : game;
};

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function imageKey(
  game: string,
  sourceId: string,
  lang: string,
  size: ImageSize,
  ext: string,
): string {
  return `images/${game}/${sourceId}/${lang}/${size}.${ext}`;
}

/** Whether an `image_key` names the `sm` copy (and so the `orig` next to it exists too). */
export const hasSm = (key: string): boolean => /\/sm(-lowres)?\.webp$/.test(key);

/** File extension of an image URL's path (`jpg`, `png`, `webp`), null for anything else. */
export function extension(url: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  const norm = ext === 'jpeg' ? 'jpg' : ext;
  return norm && norm in CONTENT_TYPES ? norm : null;
}

/** The `external_ids` keys the mirror reads: the source image URLs and the source ids. */
export const IMAGE_ID_FIELDS = [
  'scryfall',
  'scryfall_images',
  'image_url',
  'tcgdex',
  'tcgdex_images',
  'pokemontcg_images',
  'artwork',
] as const;

const https = (v: unknown) => (typeof v === 'string' && v.startsWith('https://') ? v : null);

/** A Scryfall image that is a `lowres` scan, not (yet) a high-res one. */
export function lowresScan(game: string, ids: Record<string, unknown>): boolean {
  const uris = (ids.scryfall_images ?? {}) as Record<string, unknown>;
  return game === 'mtg' && uris.highres_image !== true && uris.image_status === 'lowres';
}

/**
 * The URL of the image to mirror from a print's or localization's `external_ids`, null when it
 * has none: Scryfall `large` (JPEG, 672 px), then `normal`, then `png`, for a high-res scan
 * (`highres_image`) and, with `lowres` (prints only), a `lowres` one; a placeholder or missing
 * image stays keyless, so the API keeps Scryfall's URL, and never its "missing image"
 * placeholder; Yu-Gi-Oh!: the print's own Yugipedia scan (`artwork.url`, VB-106), else YGOPRODeck's
 * `image_url` (the card's first artwork); TCGdex `tcgdex_images.high` (`<image>/high.webp`), else
 * pokemontcg.io's `pokemontcg_images.large` (VB-118, a print TCGdex has no picture for).
 */
export function sourceUrl(
  game: string,
  ids: Record<string, unknown>,
  opts: { lowres?: boolean } = {},
): string | null {
  switch (game) {
    case 'mtg': {
      const uris = (ids.scryfall_images ?? {}) as Record<string, unknown>;
      if (uris.highres_image !== true && !(opts.lowres && lowresScan(game, ids))) return null;
      const url = https(uris.large) ?? https(uris.normal) ?? https(uris.png);
      return url && new URL(url).hostname !== 'errors.scryfall.com' ? url : null;
    }
    case 'yugioh':
      return (
        https((ids.artwork as Record<string, unknown> | undefined)?.url) ?? https(ids.image_url)
      );
    case 'pokemon':
      return (
        https((ids.tcgdex_images as Record<string, unknown> | undefined)?.high) ??
        https((ids.pokemontcg_images as Record<string, unknown> | undefined)?.large)
      );
    default:
      return null;
  }
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * The source's stable id that names an image's objects: the Scryfall card id; for YGOPRODeck the
 * image id from `image_url` (`…/cards/<id>.jpg`: one artwork, shared by every set print of it); for
 * a Yugipedia scan its file name (`RedEyesDarkDragoon-RA05-EN-UR-1E-EA`, VB-106);
 * the TCGdex card id (`tcgdex`, else `<set>-<number>` from `…/<set>/<number>/high.webp`), with
 * `-pokemontcg` for a pokemontcg.io picture, so `needsWork` and `writeKeys` let a later TCGdex
 * picture replace it (VB-118).
 */
export function sourceId(game: string, ids: Record<string, unknown>, url: string): string | null {
  const path = new URL(url).pathname.split('/');
  const base =
    game === 'mtg'
      ? ids.scryfall
      : game === 'yugioh'
        ? path.at(-1)?.replace(/\.[^.]*$/, '')
        : game === 'pokemon'
          ? (ids.tcgdex ?? (path.length >= 4 ? `${path.at(-3)}-${path.at(-2)}` : null))
          : null;
  const id =
    typeof base === 'string' && sourceOf(game, url) === 'pokemontcg' ? `${base}-pokemontcg` : base;
  return typeof id === 'string' && SAFE_ID.test(id) ? id : null;
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
  keys: { orig: string; sm: string };
  contentType: string;
  /** A target already has the `orig` key: read it from the bucket instead of the source. */
  stored: boolean;
  targets: ImageTarget[];
}

export interface PendingRow extends ImageTarget {
  game: string;
  ids: Record<string, unknown>;
  /** The row's current `image_key` (an `orig` key when only the `sm` copy is missing). */
  key: string | null;
}

/**
 * Groups rows by source URL. The first row of a URL names the keys; the rest reuse them (a print
 * and its English localization, a Yu-Gi-Oh! card in several sets share one image). A print's
 * low-res scan gets the `-lowres` names and a job of its own.
 */
export function planJobs(rows: PendingRow[]): { jobs: ImageJob[]; noSource: number } {
  const byUrl = new Map<string, ImageJob>();
  let noSource = 0;
  for (const { game, ids, key: current, ...target } of rows) {
    const isPrint = target.table === 'prints';
    const url = sourceUrl(game, ids, { lowres: isPrint });
    const ext = url && extension(url);
    const id = url && sourceId(game, ids, url);
    if (!url || !ext || !id) {
      noSource++;
      continue;
    }
    const lowres = isPrint && lowresScan(game, ids);
    const group = lowres ? `lowres ${url}` : url;
    let job = byUrl.get(group);
    if (!job) {
      const key = (size: ImageSize, e: string) => imageKey(game, id, target.lang, size, e);
      job = {
        game,
        url,
        keys: lowres
          ? { orig: key('orig-lowres', ext), sm: key('sm-lowres', 'webp') }
          : { orig: key('orig', ext), sm: key('sm', 'webp') },
        contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
        stored: false,
        targets: [],
      };
      byUrl.set(group, job);
    }
    if (current === job.keys.orig) job.stored = true;
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
    /** An object's bytes, null when missing (the `sm` catch-up reads `orig` from the bucket). */
    read?(key: string): Promise<Uint8Array | null>;
  };
  /**
   * The `sm` copy: SM_WIDTH px wide (never enlarged), WebP. Only the VPS script has it (sharp);
   * without it only `orig` is stored and the row gets the `orig` key.
   */
  resize?(body: Uint8Array): Promise<Uint8Array>;
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
  /** The source answered 404 or 410: recorded in `image_sources_gone`, skipped from then on. */
  gone: number;
  bytes: number;
}

export class SourceRateLimited extends Error {}

/** The source answered 404 or 410 for the image (VB-89). */
export class SourceGone extends Error {}

/**
 * Downloads and stores each job's image, calling `done` with the key to write once its objects
 * exist. A failed image is logged and counted and its rows keep their key, so the next run
 * retries it; a 404 or 410 counts as `gone` and calls `gone` instead; a 429 aborts the run (YGOPRODeck blocks an IP for an hour after one). On an abort
 * the other workers finish their current image (and its `done`) before the first error is thrown.
 */
export async function mirrorJobs(
  deps: MirrorDeps,
  jobs: ImageJob[],
  opts: MirrorOptions,
  done: (job: ImageJob, key: string) => Promise<void>,
  gone?: (job: ImageJob) => Promise<void>,
): Promise<MirrorStats> {
  const clock = deps.clock ?? realClock;
  const buckets = new Map<string, TokenBucket>();
  const bucket = (game: string) => {
    let b = buckets.get(game);
    if (!b) buckets.set(game, (b = new TokenBucket(SOURCE_RATES[game] ?? 5, 1, clock)));
    return b;
  };
  const stats: MirrorStats = {
    images: jobs.length,
    uploaded: 0,
    reused: 0,
    failed: 0,
    gone: 0,
    bytes: 0,
  };
  const started = clock.now();
  let next = 0;
  let finished = 0;
  let aborted = false;

  const progress = () => {
    const n = ++finished;
    if (n % 500 === 0 || n === jobs.length)
      deps.log('info', {
        message: 'image mirror progress',
        ...stats,
        done: n,
        perSecond: Math.round((n / Math.max(1, clock.now() - started)) * 10000) / 10,
      });
  };

  const download = async (job: ImageJob) => {
    const source = sourceOf(job.game, job.url);
    await bucket(source).take();
    const res = await deps.fetch(job.url, {
      headers: { 'User-Agent': source === 'yugipedia' ? YUGIPEDIA_USER_AGENT : USER_AGENT },
    });
    if (!res.ok) {
      // An unread body keeps the connection open (Workers allow six).
      await res.body?.cancel();
      if (res.status === 429) throw new SourceRateLimited(`${job.url} answered 429, stopping`);
      if (res.status === 404 || res.status === 410) throw new SourceGone(`answered ${res.status}`);
      throw new Error(`answered ${res.status}`);
    }
    const type = res.headers.get('content-type')?.split(';')[0]?.trim();
    if (type && !type.startsWith('image/')) throw new Error(`content type ${type}`);
    const body = new Uint8Array(await res.arrayBuffer());
    await deps.store.put(job.keys.orig, body, {
      contentType: type ?? job.contentType,
      cacheControl: IMAGE_CACHE_CONTROL,
    });
    stats.bytes += body.byteLength;
    return body;
  };

  /** Stores the job's objects and answers the key its rows get. */
  const one = async (job: ImageJob): Promise<string> => {
    const key = deps.resize ? job.keys.sm : job.keys.orig;
    if (opts.verify) {
      const [orig, sm] = await Promise.all([
        deps.store.head(job.keys.orig),
        deps.resize ? deps.store.head(job.keys.sm) : true,
      ]);
      if (orig && sm) {
        stats.reused++;
        return key;
      }
    }
    const stored = job.stored && deps.store.read ? await deps.store.read(job.keys.orig) : null;
    const body = stored ?? (await download(job));
    if (deps.resize) {
      const sm = await deps.resize(body);
      await deps.store.put(job.keys.sm, sm, {
        contentType: 'image/webp',
        cacheControl: IMAGE_CACHE_CONTROL,
      });
      stats.bytes += sm.byteLength;
    }
    stats.uploaded++;
    return key;
  };

  const worker = async () => {
    while (!aborted && next < jobs.length) {
      const job = jobs[next++] as ImageJob;
      try {
        let key: string;
        try {
          key = await one(job);
        } catch (err) {
          if (err instanceof SourceRateLimited) throw err;
          if (err instanceof SourceGone) {
            stats.gone++;
            deps.log('info', { message: 'image source gone', url: job.url, error: err.message });
            await gone?.(job);
          } else {
            stats.failed++;
            deps.log('warn', { message: 'image failed', url: job.url, error: String(err) });
          }
          progress();
          continue;
        }
        await done(job, key);
      } catch (err) {
        // A 429 or a failed key write stops every worker after its current image.
        aborted = true;
        throw err;
      }
      progress();
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: Math.max(1, opts.concurrency) }, worker),
  );
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  return stats;
}

export type Db = NodePgDatabase;

export interface PendingQuery {
  game?: string | undefined;
  /** Rows (a print or a localization) to read at most, the oldest prints first. */
  limit?: number | undefined;
  /** Also the rows that have only the `orig` copy (needs `MirrorDeps.resize`). */
  sm?: boolean | undefined;
  /**
   * Also the rows whose source URL is in `image_sources_gone`. `mirrorImages` sets it on Sundays
   * (UTC), so a file that comes back is found within a week.
   */
  retryGone?: boolean | undefined;
}

const imageIds = (column: SQLWrapper) =>
  sql`jsonb_build_object(${sql.join(
    IMAGE_ID_FIELDS.map((f) => sql`${f}::text, ${column} -> ${f}::text`),
    sql`, `,
  )})`;

/**
 * Rows `sourceUrl` can mirror (the same conditions in SQL, `lowres` for prints only). Filtered
 * before the limit, so rows without a source image never fill a capped run and block the rows
 * behind them; that includes a keyed row whose scan Scryfall has since downgraded (`planJobs`
 * could not plan it) and, unless `retryGone`, a row whose source URL answered 404 (VB-89; a
 * changed URL is work again). A `-lowres` key is work again once the high-res scan is there.
 */
const needsWork = (
  table: ImageTarget['table'],
  ids: SQLWrapper,
  key: SQLWrapper,
  { sm, retryGone }: PendingQuery,
) => {
  const highres = sql`coalesce(${ids} -> 'scryfall_images' ->> 'highres_image', 'false') = 'true'`;
  // A low-res scan never replaces a high-res key (`writeKeys`), so it is work only without one.
  const lowres =
    table === 'prints'
      ? sql` or (${ids} -> 'scryfall_images' ->> 'image_status' = 'lowres'
          and (${key} is null or ${key} like '%-lowres.%'))`
      : sql``;
  const mirrorable = sql`((${sets.gameId} = 'mtg' and (${highres}${lowres}))
    or (${sets.gameId} = 'yugioh' and (${ids} ->> 'image_url' is not null
      or ${ids} -> 'artwork' ->> 'url' is not null))
    or (${sets.gameId} = 'pokemon' and (${ids} -> 'tcgdex_images' ->> 'high' is not null
      or ${ids} -> 'pokemontcg_images' ->> 'large' is not null)))`;
  // A Yugipedia scan (VB-106) the key does not name yet: the row keeps its old key until then.
  // Likewise a TCGdex picture published after the pokemontcg.io one was mirrored (VB-118).
  // The id is the URL's file name, as `sourceId` takes it (`artwork.file` may differ in case).
  const scan = sql`regexp_replace(${ids} -> 'artwork' ->> 'url', '^.*/|[.][^./]*$', '', 'g')`;
  const todo = sql`(${key} is null
    ${sm ? sql`or (${key} not like '%/sm.webp' and ${key} not like '%/sm-lowres.webp')` : sql``}
    or (${key} like '%-lowres.%' and ${highres})
    or (${sets.gameId} = 'yugioh' and position('/' || ${scan} || '/' in ${key}) = 0)
    or (${sets.gameId} = 'pokemon' and ${key} like '%-pokemontcg/%'
      and ${ids} -> 'tcgdex_images' ->> 'high' is not null))`;
  // The URL `sourceUrl` picks, to look up in `image_sources_gone`.
  const url = sql`case ${sets.gameId}
    when 'pokemon' then coalesce(${ids} -> 'tcgdex_images' ->> 'high',
      ${ids} -> 'pokemontcg_images' ->> 'large')
    when 'yugioh' then coalesce(${ids} -> 'artwork' ->> 'url', ${ids} ->> 'image_url')
    else coalesce(${ids} -> 'scryfall_images' ->> 'large', ${ids} -> 'scryfall_images' ->> 'normal',
      ${ids} -> 'scryfall_images' ->> 'png') end`;
  const fresh = retryGone
    ? sql``
    : sql` and not exists (select from ${imageSourcesGone} where ${imageSourcesGone.url} = ${url})`;
  return sql`${todo} and ${mirrorable}${fresh}`;
};

/**
 * Prints and localizations without `image_key` (with `sm`, also those with only the `orig`
 * copy), oldest print first, the print before its localizations: a capped run drains the backlog
 * from the oldest end. Only the image fields of `external_ids` are read, which keeps a full run
 * of every Magic print in memory small.
 */
export async function pendingRows(db: Db, q: PendingQuery): Promise<PendingRow[]> {
  const where = q.game ? sql` and ${sets.gameId} = ${q.game}` : sql``;
  const result = await db.execute<{
    print_id: string;
    lang: string;
    t: number;
    game: string;
    ids: Record<string, unknown>;
    key: string | null;
  }>(sql`
    select print_id, lang, t, game, ids, key from (
      select ${prints.id} as print_id, 'en' as lang, 0 as t, ${sets.gameId} as game,
        ${imageIds(prints.externalIds)} as ids, ${prints.imageKey} as key,
        ${prints.createdAt} as created_at
      from ${prints} join ${sets} on ${sets.id} = ${prints.setId}
      where ${needsWork('prints', prints.externalIds, prints.imageKey, q)}${where}
      union all
      select ${printLocalizations.printId}, ${printLocalizations.lang}, 1, ${sets.gameId},
        ${imageIds(printLocalizations.externalIds)}, ${printLocalizations.imageKey},
        ${prints.createdAt}
      from ${printLocalizations}
        join ${prints} on ${prints.id} = ${printLocalizations.printId}
        join ${sets} on ${sets.id} = ${prints.setId}
      where ${needsWork('print_localizations', printLocalizations.externalIds, printLocalizations.imageKey, q)}${where}
    ) r
    order by created_at, print_id, t, lang
    ${q.limit ? sql`limit ${q.limit}` : sql``}`);
  return result.rows.map((r) => ({
    table: r.t === 0 ? 'prints' : 'print_localizations',
    printId: r.print_id,
    lang: r.lang,
    game: r.game,
    ids: r.ids,
    key: r.key,
  }));
}

/**
 * Sets `image_key` on rows without one, or replaces a key the new one outranks: `sm.webp`, then
 * `orig.<ext>`, then `sm-lowres.webp`, then `orig-lowres.<ext>`. So `sm` replaces `orig` and a
 * high-res scan replaces a low-res one, never the other way round. A key of another source id
 * (a Yu-Gi-Oh! print's new scan) replaces any.
 */
export async function writeKeys(db: Db, rows: (ImageTarget & { key: string })[]) {
  const json = (table: ImageTarget['table']) =>
    JSON.stringify(
      rows
        .filter((r) => r.table === table)
        .map(({ printId, lang, key }) => ({ id: printId, lang, key })),
    );
  const rank = (key: SQLWrapper) => sql`case
    when ${key} like '%/sm.webp' then 4
    when ${key} like '%/sm-lowres.webp' then 2
    when ${key} like '%-lowres.%' then 1
    else 3 end`;
  // Another source id (a Yu-Gi-Oh! print's new Yugipedia scan, VB-106) replaces whatever rank.
  const dir = (key: SQLWrapper) => sql`regexp_replace(${key}, '[^/]*$', '')`;
  const replaceable = (key: SQLWrapper) =>
    sql`(${key} is null or ${rank(sql`v.key`)} > ${rank(key)} or ${dir(sql`v.key`)} <> ${dir(key)})`;
  await db.execute(sql`
    update ${prints} set image_key = v.key
    from jsonb_to_recordset(${json('prints')}::jsonb) as v(id uuid, lang text, key text)
    where ${prints.id} = v.id and ${replaceable(prints.imageKey)}`);
  await db.execute(sql`
    update ${printLocalizations} set image_key = v.key
    from jsonb_to_recordset(${json('print_localizations')}::jsonb) as v(id uuid, lang text, key text)
    where ${printLocalizations.printId} = v.id and ${printLocalizations.lang} = v.lang
      and ${replaceable(printLocalizations.imageKey)}`);
}

export interface MirrorRunStats extends MirrorStats {
  rows: number;
  /** Rows without a usable source URL. */
  noSource: number;
}

/** Keys written per database round trip. */
const KEY_BATCH = 500;

/** Another mirror holds the database's lock. */
export class MirrorBusy extends Error {}

/**
 * One mirror run: the pending rows of `query`, grouped by source URL, mirrored, the keys written
 * back in batches. Records an `import_runs` row (source and kind `images`) unless `dryRun`, which
 * only reads and plans. Idempotent: a rerun picks up the rows that still have no key.
 *
 * One run per database at a time: the run holds `pg_try_advisory_xact_lock(hashtext(
 * 'image-mirror'))` in a transaction of its own and throws `MirrorBusy` when another run has it.
 * Transaction-scoped, because Hyperdrive pools in transaction mode and cannot keep a session lock;
 * a dropped connection releases it.
 */
export async function mirrorImages(
  deps: MirrorDeps,
  db: Db,
  query: PendingQuery,
  opts: MirrorOptions & { dryRun?: boolean },
): Promise<MirrorRunStats> {
  if (query.sm && !deps.resize) throw new Error('the sm catch-up needs MirrorDeps.resize');
  if (opts.dryRun) return mirrorRun(deps, db, query, opts);
  return db.transaction(async (tx) => {
    // The lock's transaction sits idle while the run works on other connections.
    await tx.execute(sql`set local idle_in_transaction_session_timeout = 0`);
    const { rows } = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('image-mirror')) as ok`,
    );
    if (!rows[0]?.ok)
      throw new MirrorBusy(
        'another image mirror is running on this database; wait for it to finish',
      );
    return mirrorRun(deps, db, query, opts);
  });
}

async function mirrorRun(
  deps: MirrorDeps,
  db: Db,
  query: PendingQuery,
  opts: MirrorOptions & { dryRun?: boolean },
): Promise<MirrorRunStats> {
  const retryGone = query.retryGone ?? new Date((deps.clock ?? realClock).now()).getUTCDay() === 0;
  const rows = await pendingRows(db, { ...query, retryGone });
  const { jobs, noSource } = planJobs(rows);
  const zero = { images: jobs.length, uploaded: 0, reused: 0, failed: 0, gone: 0, bytes: 0 };
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
  let urls: string[] = [];
  const flush = async () => {
    const [batch, back] = [pending, urls];
    [pending, urls] = [[], []];
    if (batch.length) await writeKeys(db, batch);
    // A gone URL that answered again (the weekly retry).
    if (back.length) await db.delete(imageSourcesGone).where(inArray(imageSourcesGone.url, back));
  };
  try {
    let stats: MirrorStats;
    try {
      stats = await mirrorJobs(
        deps,
        jobs,
        opts,
        async (job, key) => {
          pending.push(...job.targets.map((t) => ({ ...t, key })));
          urls.push(job.url);
          if (pending.length >= KEY_BATCH) await flush();
        },
        async (job) => {
          const [first] = job.targets;
          await db
            .insert(imageSourcesGone)
            .values({ url: job.url, printId: first?.printId, lang: first?.lang })
            .onConflictDoNothing();
        },
      );
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
