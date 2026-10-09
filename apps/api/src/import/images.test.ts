import { eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRuns, printLocalizations, prints } from '../db/schema';
import { databaseUrl, freshDatabase } from '../test-helpers';
import {
  extension,
  imageKey,
  IMAGE_CACHE_CONTROL,
  mirrorImages,
  mirrorJobs,
  pendingRows,
  planJobs,
  SourceRateLimited,
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
    ['mtg', 'en', 'orig', 'jpg', `images/mtg/${ID}/en/orig.jpg`],
    ['mtg', 'de', 'sm', 'webp', `images/mtg/${ID}/de/sm.webp`],
    ['pokemon', 'de', 'orig', 'webp', `images/pokemon/${ID}/de/orig.webp`],
    ['pokemon', 'en', 'sm', 'webp', `images/pokemon/${ID}/en/sm.webp`],
    ['yugioh', 'en', 'orig', 'jpg', `images/yugioh/${ID}/en/orig.jpg`],
    ['onepiece', 'ja', 'orig', 'png', `images/onepiece/${ID}/ja/orig.png`],
  ] as const)('%s %s %s', (game, lang, size, ext, key) => {
    expect(imageKey(game, ID, lang, size, ext)).toBe(key);
  });
});

describe('sourceUrl', () => {
  const scryfall = {
    scryfall: 'abc',
    scryfall_images: {
      normal: 'https://cards.scryfall.io/normal/front/a/b/ab.jpg?1',
      large: 'https://cards.scryfall.io/large/front/a/b/ab.jpg?1',
      png: 'https://cards.scryfall.io/png/front/a/b/ab.png?1',
    },
  };

  it('takes Scryfall large, then normal, then png', () => {
    expect(sourceUrl('mtg', scryfall)).toBe('https://cards.scryfall.io/large/front/a/b/ab.jpg?1');
    const { normal, png } = scryfall.scryfall_images;
    expect(sourceUrl('mtg', { scryfall_images: { normal, png } })).toBe(normal);
    expect(sourceUrl('mtg', { scryfall_images: { png } })).toBe(png);
    expect(sourceUrl('mtg', { scryfall: 'abc' })).toBeNull();
  });

  it("skips Scryfall's missing-image placeholder and non-https URLs", () => {
    expect(
      sourceUrl('mtg', { scryfall_images: { large: 'https://errors.scryfall.com/soon.jpg' } }),
    ).toBeNull();
    expect(sourceUrl('mtg', { scryfall_images: { large: 'http://x.test/a.jpg' } })).toBeNull();
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

  it('takes TCGdex image_url, or the image base with /high.webp', () => {
    const base = 'https://assets.tcgdex.net/de/swsh/swsh3/136';
    expect(sourceUrl('pokemon', { tcgdex: 'swsh3-136', image: base })).toBe(`${base}/high.webp`);
    expect(sourceUrl('pokemon', { image_url: `${base}/high.png`, image: base })).toBe(
      `${base}/high.png`,
    );
    expect(sourceUrl('onepiece', { image_url: `${base}/high.png` })).toBeNull();
  });

  it('reads the extension from the path only', () => {
    expect(extension('https://cards.scryfall.io/large/a.jpg?1562')).toBe('jpg');
    expect(extension('https://x.test/a.JPEG')).toBe('jpg');
    expect(extension('https://x.test/a.webp')).toBe('webp');
    expect(extension('https://x.test/a.gif')).toBeNull();
    expect(extension('https://x.test/a')).toBeNull();
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

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function fakeDeps(store = new MemoryBlobStore(), status = 200) {
  const fetched: string[] = [];
  const deps: MirrorDeps = {
    fetch: async (url) => {
      fetched.push(url);
      return new Response(status === 200 ? JPEG : null, {
        status,
        headers: { 'content-type': 'image/jpeg' },
      });
    },
    store,
    resize: async () => new Uint8Array([1, 2, 3]),
    log: () => undefined,
    clock: fakeClock(),
  };
  return { deps, store, fetched };
}

const job = (n: number): ImageJob => ({
  game: 'mtg',
  url: `https://cards.scryfall.io/large/${n}.jpg`,
  keys: { orig: `images/mtg/${n}/en/orig.jpg`, sm: `images/mtg/${n}/en/sm.webp` },
  contentType: 'image/jpeg',
  targets: [{ table: 'prints', printId: String(n), lang: 'en' }],
});

describe('mirrorJobs', () => {
  it('stores orig and sm with immutable cache headers', async () => {
    const { deps, store } = fakeDeps();
    const done: ImageJob[] = [];
    const stats = await mirrorJobs(deps, [job(1)], { concurrency: 2, verify: false }, async (j) => {
      done.push(j);
    });
    expect(stats).toMatchObject({ images: 1, uploaded: 1, reused: 0, failed: 0 });
    expect(done).toHaveLength(1);
    expect(store.objects.get('images/mtg/1/en/orig.jpg')?.bytes).toEqual(JPEG);
    expect(store.objects.get('images/mtg/1/en/sm.webp')?.info.contentType).toBe('image/webp');
    expect(store.objects.get('images/mtg/1/en/orig.jpg')?.info.contentType).toBe('image/jpeg');
    // MemoryBlobStore drops cacheControl; the constant is what both transports pass.
    expect(IMAGE_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });

  it('resumes: with verify, images already in the bucket are not downloaded again', async () => {
    const { deps, store, fetched } = fakeDeps();
    const opts = { contentType: 'image/jpeg' };
    await store.put('images/mtg/1/en/orig.jpg', JPEG, opts);
    await store.put('images/mtg/1/en/sm.webp', JPEG, opts);
    // Only half of image 2 made it before an earlier run stopped.
    await store.put('images/mtg/2/en/orig.jpg', JPEG, opts);
    const done: string[] = [];
    const stats = await mirrorJobs(
      deps,
      [job(1), job(2)],
      { concurrency: 1, verify: true },
      async (j) => {
        done.push(j.url);
      },
    );
    expect(stats).toMatchObject({ reused: 1, uploaded: 1 });
    expect(fetched).toEqual(['https://cards.scryfall.io/large/2.jpg']);
    expect(done).toHaveLength(2);
  });

  it('counts a failed download and leaves its rows without a key', async () => {
    const { deps } = fakeDeps(new MemoryBlobStore(), 404);
    const done: ImageJob[] = [];
    const stats = await mirrorJobs(deps, [job(1)], { concurrency: 1, verify: false }, async (j) => {
      done.push(j);
    });
    expect(stats).toMatchObject({ failed: 1, uploaded: 0 });
    expect(done).toEqual([]);
  });

  it('stops the run on a 429', async () => {
    const { deps, fetched } = fakeDeps(new MemoryBlobStore(), 429);
    await expect(
      mirrorJobs(deps, [job(1), job(2)], { concurrency: 1, verify: false }, async () => undefined),
    ).rejects.toBeInstanceOf(SourceRateLimited);
    expect(fetched).toHaveLength(1);
  });

  it('downloads a URL shared by several rows once', () => {
    const url = 'https://images.ygoprodeck.com/images/cards/1.jpg';
    const { jobs, noSource } = planJobs([
      { table: 'prints', printId: 'a', lang: 'en', game: 'yugioh', ids: { image_url: url } },
      { table: 'prints', printId: 'b', lang: 'en', game: 'yugioh', ids: { image_url: url } },
      { table: 'prints', printId: 'c', lang: 'en', game: 'yugioh', ids: {} },
    ]);
    expect(noSource).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.keys).toEqual({
      orig: 'images/yugioh/a/en/orig.jpg',
      sm: 'images/yugioh/a/en/sm.webp',
    });
    expect(jobs[0]?.targets.map((t) => t.printId)).toEqual(['a', 'b']);
  });
});

// The daily delta against the Scryfall fixtures in a fresh database.
describe.skipIf(!databaseUrl)('image mirror (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let runId: string;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    ({ runId } = await runScryfallImport(
      { fetch: fakeScryfall(), blobs: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'local', date: '2026-10-09', languages: ['en', 'de'] },
    ));
    // Pretend the run started a year ago and the prints of `neo` came from an earlier run.
    await db
      .update(importRuns)
      .set({ startedAt: sql`now() - interval '1 year'` })
      .where(eq(importRuns.id, runId));
    await db.execute(sql`update prints set created_at = now() - interval '2 years'
      where set_id = (select id from sets where code = 'neo')`);
  });
  afterAll(() => drop());

  const newPrintIds = async () =>
    (
      await db.execute<{ id: string }>(
        sql`select p.id from prints p join sets s on s.id = p.set_id where s.code <> 'neo'`,
      )
    ).rows.map((r) => r.id);

  it("picks only the run's new prints and their localizations", async () => {
    const rows = await pendingRows(db, { game: 'mtg', sinceRun: runId });
    const ids = new Set(await newPrintIds());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => ids.has(r.printId))).toBe(true);
    expect(rows.filter((r) => r.table === 'prints')).toHaveLength(ids.size);
    expect(rows.some((r) => r.table === 'print_localizations' && r.lang === 'de')).toBe(true);
    expect((await pendingRows(db, { game: 'mtg' })).length).toBeGreaterThan(rows.length);
    expect(await pendingRows(db, { game: 'yugioh' })).toEqual([]);
  });

  it('mirrors them, writes the keys back, records the run and is idempotent', async () => {
    const { deps, store, fetched } = fakeDeps();
    const stats = await mirrorImages(
      deps,
      db,
      { game: 'mtg', sinceRun: runId },
      { concurrency: 3, verify: false },
    );
    expect(stats.failed).toBe(0);
    expect(stats.uploaded).toBe(stats.images);
    // A print and its English localization share one download.
    expect(stats.images).toBeLessThan(stats.rows);
    expect(fetched).toHaveLength(stats.images);
    expect(store.objects.size).toBe(stats.images * 2);

    const ids = await newPrintIds();
    const keyed = await db
      .select({ id: prints.id, key: prints.imageKey })
      .from(prints)
      .where(isNotNull(prints.imageKey));
    expect(keyed.map((p) => p.id).sort()).toEqual([...ids].sort());
    for (const p of keyed) {
      expect(p.key).toMatch(new RegExp(`^images/mtg/${p.id}/en/orig\\.jpg$`));
      expect(store.objects.has(p.key ?? '')).toBe(true);
    }
    const en = await db
      .select({ key: printLocalizations.imageKey, printKey: prints.imageKey })
      .from(printLocalizations)
      .innerJoin(prints, eq(prints.id, printLocalizations.printId))
      .where(inArray(printLocalizations.printId, ids));
    expect(en.every((l) => l.key !== null)).toBe(true);
    // The old prints keep no key.
    expect(
      await db.select({ id: prints.id }).from(prints).where(isNull(prints.imageKey)),
    ).not.toHaveLength(0);

    const [run] = await db.select().from(importRuns).where(eq(importRuns.kind, 'images'));
    expect(run).toMatchObject({ source: 'images', status: 'ok' });
    expect(run?.stats).toMatchObject({ uploaded: stats.uploaded, rows: stats.rows });

    const again = await mirrorImages(
      deps,
      db,
      { game: 'mtg', sinceRun: runId },
      { concurrency: 3, verify: false },
    );
    expect(again).toMatchObject({ rows: 0, images: 0, uploaded: 0 });
  });

  it('dry run reads and plans only', async () => {
    const { deps, fetched } = fakeDeps();
    const before = await db.select().from(importRuns);
    const stats = await mirrorImages(
      deps,
      db,
      { game: 'mtg', limit: 5 },
      {
        concurrency: 1,
        verify: false,
        dryRun: true,
      },
    );
    expect(stats.rows).toBe(5);
    expect(fetched).toEqual([]);
    expect(await db.select().from(importRuns)).toHaveLength(before.length);
  });
});
