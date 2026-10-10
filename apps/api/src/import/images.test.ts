import { eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRuns, printLocalizations, prints } from '../db/schema';
import { databaseUrl, freshDatabase } from '../test-helpers';
import {
  extension,
  hasSm,
  imageKey,
  IMAGE_CACHE_CONTROL,
  mirrorImages,
  MirrorBusy,
  mirrorJobs,
  pendingRows,
  writeKeys,
  planJobs,
  SourceRateLimited,
  sourceId,
  sourceUrl,
  TokenBucket,
  type Clock,
  type ImageJob,
  type MirrorDeps,
} from './images';
import { runScryfallImport } from './scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from './scryfall/test-fixtures';
import type { Db } from './scryfall/write';

const ID = '0b5b6e3c-5c2e-4f3a-9d8c-1a2b3c4d5e6f';

describe('imageKey', () => {
  it.each([
    ['mtg', ID, 'en', 'orig', 'jpg', `images/mtg/${ID}/en/orig.jpg`],
    ['mtg', ID, 'de', 'sm', 'webp', `images/mtg/${ID}/de/sm.webp`],
    ['pokemon', 'swsh3-136', 'de', 'orig', 'webp', 'images/pokemon/swsh3-136/de/orig.webp'],
    ['pokemon', 'swsh3-136', 'en', 'sm', 'webp', 'images/pokemon/swsh3-136/en/sm.webp'],
    ['yugioh', '46986414', 'en', 'orig', 'jpg', 'images/yugioh/46986414/en/orig.jpg'],
    ['onepiece', 'OP01-001', 'ja', 'orig', 'png', 'images/onepiece/OP01-001/ja/orig.png'],
  ] as const)('%s %s %s %s', (game, id, lang, size, ext, key) => {
    expect(imageKey(game, id, lang, size, ext)).toBe(key);
  });

  it('tells an sm key from an orig key', () => {
    expect(hasSm(`images/mtg/${ID}/en/sm.webp`)).toBe(true);
    expect(hasSm(`images/mtg/${ID}/en/orig.jpg`)).toBe(false);
    expect(hasSm(`images/mtg/${ID}/en/sm-lowres.webp`)).toBe(true);
    expect(hasSm(`images/mtg/${ID}/en/orig-lowres.jpg`)).toBe(false);
  });
});

describe('sourceUrl', () => {
  const scryfall = {
    scryfall: 'abc',
    scryfall_images: {
      normal: 'https://cards.scryfall.io/normal/front/a/b/ab.jpg?1',
      large: 'https://cards.scryfall.io/large/front/a/b/ab.jpg?1',
      png: 'https://cards.scryfall.io/png/front/a/b/ab.png?1',
      highres_image: true,
      image_status: 'highres_scan',
    },
  };
  const highres = { highres_image: true };

  it('takes Scryfall large, then normal, then png', () => {
    expect(sourceUrl('mtg', scryfall)).toBe('https://cards.scryfall.io/large/front/a/b/ab.jpg?1');
    const { normal, png } = scryfall.scryfall_images;
    expect(sourceUrl('mtg', { scryfall_images: { normal, png, ...highres } })).toBe(normal);
    expect(sourceUrl('mtg', { scryfall_images: { png, ...highres } })).toBe(png);
    expect(sourceUrl('mtg', { scryfall: 'abc' })).toBeNull();
  });

  const status = (image_status: string) => ({
    ...scryfall,
    scryfall_images: { ...scryfall.scryfall_images, highres_image: false, image_status },
  });

  it('waits for a Scryfall high-res scan unless low-res is allowed (prints)', () => {
    const large = scryfall.scryfall_images.large;
    expect(sourceUrl('mtg', status('lowres'))).toBeNull();
    expect(sourceUrl('mtg', status('lowres'), { lowres: true })).toBe(large);
    expect(sourceUrl('mtg', status('placeholder'), { lowres: true })).toBeNull();
    expect(sourceUrl('mtg', status('missing'), { lowres: true })).toBeNull();
    expect(sourceUrl('mtg', scryfall, { lowres: true })).toBe(large);
    const unknown = { ...scryfall.scryfall_images, highres_image: undefined };
    expect(sourceUrl('mtg', { scryfall_images: unknown })).toBeNull();
  });

  it("skips Scryfall's missing-image placeholder and non-https URLs", () => {
    expect(
      sourceUrl('mtg', {
        scryfall_images: { large: 'https://errors.scryfall.com/soon.jpg', ...highres },
      }),
    ).toBeNull();
    expect(
      sourceUrl('mtg', { scryfall_images: { large: 'http://x.test/a.jpg', ...highres } }),
    ).toBeNull();
  });

  it('takes YGOPRODeck image_url', () => {
    const ids = {
      ygoprodeck: 46986414,
      set_code: 'LOB-EN005',
      image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg',
      image_url_small: 'https://images.ygoprodeck.com/images/cards_small/46986414.jpg',
    };
    expect(sourceUrl('yugioh', ids)).toBe(ids.image_url);
  });

  it('takes TCGdex high', () => {
    const base = 'https://assets.tcgdex.net/de/swsh/swsh3/136';
    const ids = { tcgdex_images: { high: `${base}/high.webp`, low: `${base}/low.webp` } };
    expect(sourceUrl('pokemon', ids)).toBe(`${base}/high.webp`);
    expect(sourceUrl('pokemon', { tcgdex: 'swsh3-136' })).toBeNull();
    expect(sourceUrl('onepiece', ids)).toBeNull();
  });

  it('reads the extension from the path only', () => {
    expect(extension('https://cards.scryfall.io/large/a.jpg?1562')).toBe('jpg');
    expect(extension('https://x.test/a.JPEG')).toBe('jpg');
    expect(extension('https://x.test/a.webp')).toBe('webp');
    expect(extension('https://x.test/a.gif')).toBeNull();
    expect(extension('https://x.test/a')).toBeNull();
  });
});

describe('sourceId', () => {
  it("names the objects after the source's stable id", () => {
    const large = `https://cards.scryfall.io/large/front/0/b/${ID}.jpg?1`;
    expect(sourceId('mtg', { scryfall: ID }, large)).toBe(ID);
    expect(sourceId('mtg', {}, large)).toBeNull();
    const ygo = 'https://images.ygoprodeck.com/images/cards/46986414.jpg';
    expect(sourceId('yugioh', { ygoprodeck: 1, set_code: 'LOB-EN005' }, ygo)).toBe('46986414');
    const tcgdex = 'https://assets.tcgdex.net/de/swsh/swsh3/136/high.webp';
    expect(sourceId('pokemon', { tcgdex: 'swsh3-136' }, tcgdex)).toBe('swsh3-136');
    expect(sourceId('pokemon', {}, tcgdex)).toBe('swsh3-136');
    expect(sourceId('mtg', { scryfall: '../x' }, large)).toBeNull();
  });
});

/** Time moves only when someone sleeps (or never, with `advance` false). */
function fakeClock(advance = true): Clock & { slept: number[] } {
  let now = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      if (advance) now += ms;
    },
  };
}

describe('TokenBucket', () => {
  it('spaces requests at the rate after the first', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(20, 1, clock);
    for (let i = 0; i < 5; i++) await bucket.take();
    expect(clock.slept).toEqual([50, 50, 50, 50]);
    expect(clock.now()).toBe(200);
  });

  it('lets a full bucket burst, then refills with time', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(10, 3, clock);
    for (let i = 0; i < 3; i++) await bucket.take();
    expect(clock.slept).toEqual([]);
    await bucket.take();
    expect(clock.slept).toEqual([100]);
    await clock.sleep(1000);
    for (let i = 0; i < 3; i++) await bucket.take();
    expect(clock.slept).toEqual([100, 1000]);
  });

  it('queues concurrent callers instead of letting them through together', async () => {
    const clock = fakeClock(false);
    const bucket = new TokenBucket(8, 1, clock);
    // Reserved in the same instant: each waits one interval longer than the one before.
    await Promise.all([bucket.take(), bucket.take(), bucket.take()]);
    expect(clock.slept).toEqual([125, 250]);
  });
});

/** A promise to resolve from outside. */
function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<undefined>((r) => (resolve = () => r(undefined)));
  return { promise, resolve };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const SM = new Uint8Array([1, 2, 3]);

/** Mirror deps on a memory store; `resize` (the VPS script) unless `orig` only (the Worker). */
function fakeDeps(opts: { status?: number; resize?: boolean; fetch?: MirrorDeps['fetch'] } = {}) {
  const store = new MemoryBlobStore();
  const fetched: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const deps: MirrorDeps = {
    fetch: async (url, init) => {
      fetched.push(url);
      if (opts.fetch) return opts.fetch(url, init);
      const status = opts.status ?? 200;
      return new Response(status === 200 ? JPEG : null, {
        status,
        headers: { 'content-type': 'image/jpeg' },
      });
    },
    store: {
      put: (key, body, o) => store.put(key, body, o),
      head: (key) => store.head(key),
      read: async (key) => store.objects.get(key)?.bytes ?? null,
    },
    ...(opts.resize !== false && { resize: async () => SM }),
    log: (_level, fields) => logs.push(fields),
    clock: fakeClock(),
  };
  return { deps, store, fetched, logs };
}

const job = (n: number, stored = false): ImageJob => ({
  game: 'mtg',
  url: `https://cards.scryfall.io/large/${n}.jpg`,
  keys: { orig: `images/mtg/${n}/en/orig.jpg`, sm: `images/mtg/${n}/en/sm.webp` },
  contentType: 'image/jpeg',
  stored,
  targets: [{ table: 'prints', printId: String(n), lang: 'en' }],
});

const run = async (deps: MirrorDeps, jobs: ImageJob[], concurrency = 1, verify = false) => {
  const done: [string, string][] = [];
  const stats = await mirrorJobs(deps, jobs, { concurrency, verify }, async (j, key) => {
    done.push([j.url, key]);
  });
  return { stats, done };
};

describe('mirrorJobs', () => {
  it('stores orig and sm with immutable cache headers and answers the sm key', async () => {
    const { deps, store } = fakeDeps();
    const { stats, done } = await run(deps, [job(1)], 2);
    expect(stats).toMatchObject({ images: 1, uploaded: 1, reused: 0, failed: 0 });
    expect(done).toEqual([[job(1).url, 'images/mtg/1/en/sm.webp']]);
    expect(store.objects.get('images/mtg/1/en/orig.jpg')?.bytes).toEqual(JPEG);
    expect(store.objects.get('images/mtg/1/en/sm.webp')?.info.contentType).toBe('image/webp');
    expect(store.objects.get('images/mtg/1/en/orig.jpg')?.info.contentType).toBe('image/jpeg');
    // MemoryBlobStore drops cacheControl; the constant is what both transports pass.
    expect(IMAGE_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });

  it('without resize (the Worker) stores orig only and answers the orig key', async () => {
    const { deps, store } = fakeDeps({ resize: false });
    const { done } = await run(deps, [job(1)]);
    expect(done).toEqual([[job(1).url, 'images/mtg/1/en/orig.jpg']]);
    expect([...store.objects.keys()]).toEqual(['images/mtg/1/en/orig.jpg']);
  });

  it('adds sm to a stored orig from the bucket, without the source', async () => {
    const { deps, store, fetched } = fakeDeps();
    await store.put('images/mtg/1/en/orig.jpg', JPEG, { contentType: 'image/jpeg' });
    const { done } = await run(deps, [job(1, true)]);
    expect(fetched).toEqual([]);
    expect(done).toEqual([[job(1).url, 'images/mtg/1/en/sm.webp']]);
    expect(store.objects.get('images/mtg/1/en/sm.webp')?.bytes).toEqual(SM);
  });

  it('resumes: with verify, images already in the bucket are not downloaded again', async () => {
    const { deps, store, fetched } = fakeDeps();
    const opts = { contentType: 'image/jpeg' };
    await store.put('images/mtg/1/en/orig.jpg', JPEG, opts);
    await store.put('images/mtg/1/en/sm.webp', JPEG, opts);
    // Only half of image 2 made it before an earlier run stopped.
    await store.put('images/mtg/2/en/orig.jpg', JPEG, opts);
    const { stats, done } = await run(deps, [job(1), job(2)], 1, true);
    expect(stats).toMatchObject({ reused: 1, uploaded: 1 });
    expect(fetched).toEqual(['https://cards.scryfall.io/large/2.jpg']);
    expect(done).toHaveLength(2);
  });

  it('counts a failed download and leaves its rows without a key', async () => {
    const { deps } = fakeDeps({ status: 404 });
    const { stats, done } = await run(deps, [job(1)]);
    expect(stats).toMatchObject({ failed: 1, uploaded: 0 });
    expect(done).toEqual([]);
  });

  it('stops the run on a 429', async () => {
    const { deps, fetched } = fakeDeps({ status: 429 });
    await expect(run(deps, [job(1), job(2)])).rejects.toBeInstanceOf(SourceRateLimited);
    expect(fetched).toHaveLength(1);
  });

  it('lets the other workers finish their image before a 429 is thrown', async () => {
    const slow = deferred();
    const { deps } = fakeDeps({
      fetch: async (url) => {
        if (url.endsWith('/1.jpg')) {
          await slow.promise;
          return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
        }
        setTimeout(slow.resolve, 10);
        return new Response(null, { status: 429 });
      },
    });
    const done: string[] = [];
    await expect(
      mirrorJobs(deps, [job(1), job(2), job(3)], { concurrency: 2, verify: false }, async (j) => {
        done.push(j.url);
      }),
    ).rejects.toBeInstanceOf(SourceRateLimited);
    // Image 1 was in flight when image 2 answered 429: its key still reaches `done`; 3 never starts.
    expect(done).toEqual([job(1).url]);
  });

  it('logs progress every 500 images with a counter that only goes up', async () => {
    const { deps, logs } = fakeDeps();
    const jobs = Array.from({ length: 1001 }, (_, n) => job(n));
    await run(deps, jobs, 8);
    const progress = logs.filter((l) => l.message === 'image mirror progress').map((l) => l.done);
    expect(progress).toEqual([500, 1000, 1001]);
  });

  it('downloads a URL shared by several rows once, named after its source id', () => {
    const url = 'https://images.ygoprodeck.com/images/cards/1.jpg';
    const row = { table: 'prints' as const, lang: 'en', game: 'yugioh', key: null };
    const { jobs, noSource } = planJobs([
      { ...row, printId: 'a', ids: { image_url: url } },
      { ...row, printId: 'b', ids: { image_url: url } },
      { ...row, printId: 'c', ids: {} },
    ]);
    expect(noSource).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.keys).toEqual({
      orig: 'images/yugioh/1/en/orig.jpg',
      sm: 'images/yugioh/1/en/sm.webp',
    });
    expect(jobs[0]?.stored).toBe(false);
    expect(jobs[0]?.targets.map((t) => t.printId)).toEqual(['a', 'b']);
  });

  it('names a low-res print scan -lowres and leaves a low-res localization alone', () => {
    const ids = {
      scryfall: ID,
      scryfall_images: {
        large: `https://cards.scryfall.io/large/front/0/b/${ID}.jpg?1`,
        highres_image: false,
        image_status: 'lowres',
      },
    };
    const { jobs, noSource } = planJobs([
      { table: 'prints', printId: 'a', lang: 'en', game: 'mtg', ids, key: null },
      { table: 'print_localizations', printId: 'a', lang: 'de', game: 'mtg', ids, key: null },
    ]);
    expect(noSource).toBe(1);
    expect(jobs.map((j) => j.keys)).toEqual([
      { orig: `images/mtg/${ID}/en/orig-lowres.jpg`, sm: `images/mtg/${ID}/en/sm-lowres.webp` },
    ]);
  });
});

// The daily delta and the VPS catch-up against the Scryfall fixtures in a fresh database.
describe.skipIf(!databaseUrl)('image mirror (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  /** The bucket after the delta, for the sm catch-up. */
  let bucket: MemoryBlobStore;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'local', date: '2026-10-09', languages: ['en', 'de'] },
    );
    // The prints of `neo` came from an earlier run: the backlog's oldest end.
    await db.execute(sql`update prints set created_at = now() - interval '2 years'
      where set_id = (select id from sets where code = 'neo')`);
  });
  afterAll(() => drop());

  const neoPrintIds = async () =>
    new Set(
      (
        await db.execute<{ id: string }>(
          sql`select p.id from prints p join sets s on s.id = p.set_id where s.code = 'neo'`,
        )
      ).rows.map((r) => r.id),
    );

  it('drains the backlog from the oldest prints, capped by limit', async () => {
    const neo = await neoPrintIds();
    const rows = await pendingRows(db, { game: 'mtg', limit: neo.size });
    expect(rows).toHaveLength(neo.size);
    expect(rows.every((r) => neo.has(r.printId))).toBe(true);
    expect((await pendingRows(db, { game: 'mtg' })).length).toBeGreaterThan(rows.length);
    expect(await pendingRows(db, { game: 'yugioh' })).toEqual([]);
  });

  it('refuses a second mirror while one runs on the same database', async () => {
    const gate = deferred();
    const running = deferred();
    const { deps } = fakeDeps({
      resize: false,
      fetch: async () => {
        running.resolve();
        await gate.promise;
        return new Response(null, { status: 404 });
      },
    });
    const first = mirrorImages(deps, db, { game: 'mtg' }, { concurrency: 1, verify: false });
    await running.promise;
    await expect(
      mirrorImages(fakeDeps().deps, db, { game: 'mtg' }, { concurrency: 1, verify: false }),
    ).rejects.toBeInstanceOf(MirrorBusy);
    gate.resolve();
    expect((await first).failed).toBeGreaterThan(0);
    await db.delete(importRuns).where(eq(importRuns.kind, 'images'));
  });

  it('delta: stores orig, writes the orig keys, records the run, is idempotent', async () => {
    const { deps, store, fetched } = fakeDeps({ resize: false });
    bucket = store;
    const opts = { concurrency: 3, verify: false };
    const stats = await mirrorImages(deps, db, { game: 'mtg' }, opts);
    expect(stats.failed).toBe(0);
    expect(stats.uploaded).toBe(stats.images);
    // A print and its English localization share one download; the low-res German scans wait.
    expect(stats.images).toBeLessThan(stats.rows);
    // Rows without a high-res scan are filtered in the query, never read.
    expect(stats.noSource).toBe(0);
    expect(fetched).toHaveLength(stats.images);
    expect(store.objects.size).toBe(stats.images);

    const keyed = await db
      .select({ key: prints.imageKey, ids: prints.externalIds })
      .from(prints)
      .where(isNotNull(prints.imageKey));
    expect(keyed.length).toBeGreaterThan(0);
    for (const p of keyed) {
      // Named after the Scryfall id, not the database row.
      expect(p.key).toBe(
        `images/mtg/${String((p.ids as { scryfall: string }).scryfall)}/en/orig.jpg`,
      );
      expect(store.objects.has(p.key ?? '')).toBe(true);
    }
    // The German localizations are low-res scans: no key, so the API serves Scryfall's URL.
    const german = await db
      .select({ key: printLocalizations.imageKey })
      .from(printLocalizations)
      .where(eq(printLocalizations.lang, 'de'));
    expect(german.length).toBeGreaterThan(0);
    expect(german.every((l) => l.key === null)).toBe(true);

    const [run] = await db.select().from(importRuns).where(eq(importRuns.kind, 'images'));
    expect(run).toMatchObject({ source: 'images', status: 'ok' });
    expect(run?.stats).toMatchObject({ uploaded: stats.uploaded, rows: stats.rows });

    const again = await mirrorImages(deps, db, { game: 'mtg' }, opts);
    expect(again).toMatchObject({ images: 0, uploaded: 0 });
  });

  it('sm catch-up: adds sm from the bucket and moves the keys to it', async () => {
    const { deps, store, fetched } = fakeDeps();
    for (const [k, o] of bucket.objects) store.objects.set(k, o);
    const before = await db.select({ key: prints.imageKey }).from(prints);
    const stats = await mirrorImages(
      deps,
      db,
      { game: 'mtg', sm: true },
      {
        concurrency: 2,
        verify: false,
      },
    );
    expect(fetched).toEqual([]);
    expect(stats.uploaded).toBe(stats.images);
    const after = await db.select({ key: prints.imageKey }).from(prints);
    const keyed = after.filter((p) => p.key !== null);
    expect(keyed).toHaveLength(before.filter((p) => p.key !== null).length);
    expect(keyed.every((p) => hasSm(p.key ?? ''))).toBe(true);
    expect(await pendingRows(db, { game: 'mtg', sm: true })).toEqual([]);
  });

  it('dry run reads and plans only', async () => {
    const { deps, fetched } = fakeDeps();
    const before = await db.select().from(importRuns);
    const stats = await mirrorImages(
      deps,
      db,
      { game: 'mtg', limit: 5, sm: true },
      { concurrency: 1, verify: false, dryRun: true },
    );
    expect(stats.rows).toBeLessThanOrEqual(5);
    expect(fetched).toEqual([]);
    expect(await db.select().from(importRuns)).toHaveLength(before.length);
  });
});

describe.skipIf(!databaseUrl)('image mirror backlog (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  it('reads past rows without a source image, so they never block the cap', async () => {
    // 2000 old low-res prints ahead of 10 newer high-res ones.
    await db.execute(sql`
      with s as (insert into sets (game_id, code, name) values ('mtg', 'tst', 'Test') returning id),
        c as (insert into cards (game_id, name, oracle_key) values ('mtg', 'Card', 'o') returning id)
      insert into prints (card_id, set_id, number, external_ids, created_at)
      select c.id, s.id, n::text, jsonb_build_object(
          'scryfall', 'card-' || n,
          'scryfall_images', jsonb_build_object(
            'highres_image', n > 2000, 'large', 'https://cards.scryfall.io/large/' || n || '.jpg')),
        now() - interval '1 day' + n * interval '1 second'
      from s, c, generate_series(1, 2010) n`);
    const { deps, fetched } = fakeDeps({ resize: false });
    const stats = await mirrorImages(
      deps,
      db,
      { game: 'mtg', limit: 10 },
      { concurrency: 2, verify: false },
    );
    expect(stats).toMatchObject({ rows: 10, uploaded: 10, noSource: 0 });
    expect(fetched.sort()).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `https://cards.scryfall.io/large/${2001 + i}.jpg`,
      ).sort(),
    );
  });
});

// Scryfall `lowres` scans: mirrored for prints under -lowres names, upgraded once the scan arrives.
describe.skipIf(!databaseUrl)('image mirror low-res scans (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    // p1 low-res (with a low-res German localization), p2 placeholder, p3 a high-res sm key.
    await db.execute(sql`
      with s as (insert into sets (game_id, code, name) values ('mtg', 'tst', 'Test') returning id),
        c as (insert into cards (game_id, name, oracle_key) values ('mtg', 'Card', 'o') returning id),
        p as (insert into prints (card_id, set_id, number, external_ids, image_key)
          select c.id, s.id, n::text, jsonb_build_object(
              'scryfall', 'card-' || n,
              'scryfall_images', jsonb_build_object(
                'highres_image', n = 3,
                'image_status', (array['lowres', 'placeholder', 'highres_scan'])[n],
                'large', 'https://cards.scryfall.io/large/' || n || '.jpg?1')),
            case when n = 3 then 'images/mtg/card-3/en/sm.webp' end
          from s, c, generate_series(1, 3) n
          returning id, number, external_ids)
      insert into print_localizations (print_id, lang, name, external_ids)
      select id, 'de', 'Karte', external_ids from p where number = '1'`);
  });
  afterAll(() => drop());

  const key = async (number: string) =>
    (
      await db.execute<{ image_key: string | null }>(
        sql`select image_key from prints where number = ${number}`,
      )
    ).rows[0]?.image_key;
  const opts = { concurrency: 1, verify: false };

  it('mirrors a low-res print under -lowres names; the sm catch-up reads it from the bucket', async () => {
    const pending = await pendingRows(db, { game: 'mtg', sm: true });
    // Only p1's print: never the placeholder, the localization or the high-res sm key.
    expect(pending.map((r) => [r.table, r.lang, r.key])).toEqual([['prints', 'en', null]]);

    // The Worker delta stores orig only.
    const worker = fakeDeps({ resize: false });
    await mirrorImages(worker.deps, db, { game: 'mtg' }, opts);
    expect(await key('1')).toBe('images/mtg/card-1/en/orig-lowres.jpg');

    const vps = fakeDeps();
    for (const [k, o] of worker.store.objects) vps.store.objects.set(k, o);
    await mirrorImages(vps.deps, db, { game: 'mtg', sm: true }, opts);
    expect(vps.fetched).toEqual([]);
    expect(await key('1')).toBe('images/mtg/card-1/en/sm-lowres.webp');
    expect(vps.store.objects.has('images/mtg/card-1/en/sm-lowres.webp')).toBe(true);
    expect(await pendingRows(db, { game: 'mtg', sm: true })).toEqual([]);
    expect(await key('2')).toBeNull();
  });

  it('replaces the low-res key once Scryfall has the high-res scan', async () => {
    await db.execute(sql`update prints set external_ids = jsonb_set(external_ids, '{scryfall_images}',
      external_ids -> 'scryfall_images' || '{"highres_image": true, "image_status": "highres_scan",
        "large": "https://cards.scryfall.io/large/1.jpg?2"}') where number = '1'`);
    const pending = await pendingRows(db, { game: 'mtg' });
    expect(pending.map((r) => r.table)).toEqual(['prints']);
    const { deps, fetched, store } = fakeDeps();
    await mirrorImages(deps, db, { game: 'mtg', sm: true }, opts);
    expect(fetched).toEqual(['https://cards.scryfall.io/large/1.jpg?2']);
    expect(store.objects.has('images/mtg/card-1/en/orig.jpg')).toBe(true);
    expect(await key('1')).toBe('images/mtg/card-1/en/sm.webp');
    expect(await pendingRows(db, { game: 'mtg', sm: true })).toEqual([]);
    // The localization still has no key: it waits for its own high-res scan.
    const [de] = await db.select({ key: printLocalizations.imageKey }).from(printLocalizations);
    expect(de?.key).toBeNull();
  });

  it('skips a keyed row whose scan went back to low-res, so it never fills a capped run', async () => {
    await db.execute(sql`update print_localizations
      set image_key = 'images/mtg/card-1/de/orig.jpg'`);
    expect(await pendingRows(db, { game: 'mtg', sm: true })).toEqual([]);
  });

  it('skips a print with a high-res key whose scan went back to low-res', async () => {
    await db.execute(sql`update prints set image_key = 'images/mtg/card-2/en/orig.jpg',
      external_ids = jsonb_set(external_ids, '{scryfall_images,image_status}', '"lowres"')
      where number = '2'`);
    expect(await pendingRows(db, { game: 'mtg', sm: true })).toEqual([]);
  });

  it('never replaces a high-res key with a low-res one', async () => {
    const [p3] = (await db.execute<{ id: string }>(sql`select id from prints where number = '3'`))
      .rows;
    const write = (k: string) =>
      writeKeys(db, [{ table: 'prints', printId: p3?.id ?? '', lang: 'en', key: k }]);
    await write('images/mtg/card-3/en/sm-lowres.webp');
    await write('images/mtg/card-3/en/orig-lowres.jpg');
    await write('images/mtg/card-3/en/orig.jpg');
    expect(await key('3')).toBe('images/mtg/card-3/en/sm.webp');
    await db.execute(sql`update prints set image_key = 'images/mtg/card-3/en/orig.jpg'
      where number = '3'`);
    await write('images/mtg/card-3/en/sm-lowres.webp');
    expect(await key('3')).toBe('images/mtg/card-3/en/orig.jpg');
  });
});
