import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appMeta, priceMappings, pricesCurrent, pricesDaily, prints, sets } from '../../db/schema';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { runScryfallImport, type ImportDeps } from '../scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { importGroups, runTcgcsvImport } from './pipeline';
import { fakeTcgcsv, type FakeTcgcsv } from './test-fixtures';
import { setManualMapping } from './override';

describe.skipIf(!databaseUrl)('price pipeline (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const blobs = new MemoryBlobStore();
  const deps = (fetch = fakeTcgcsv()): ImportDeps => ({
    fetch,
    raw: blobs,
    withDb: (fn) => fn(db),
  });
  const run = (fake: FakeTcgcsv = {}, steps: string[] = []) =>
    runTcgcsvImport(deps(fakeTcgcsv(fake)), (name, fn) => (steps.push(name), fn()), {
      env: 'dev',
      date: '2026-10-09',
      delayMs: 0,
    });

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    // The catalog of the Scryfall fixtures; its raw dump stays in `blobs` for the price step.
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: blobs, withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', languages: ['en'] },
    );
  });
  afterAll(() => drop());

  const printId = async (code: string, number: string) => {
    const [row] = await db
      .select({ id: prints.id })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(and(eq(sets.code, code), eq(prints.number, number)));
    if (!row) throw new Error(`print ${code} ${number} missing`);
    return row.id;
  };
  const current = async (id: string, source = 'tcgplayer') =>
    db
      .select({
        finish: pricesCurrent.finish,
        market: pricesCurrent.centsMarket,
        low: pricesCurrent.centsLow,
        currency: pricesCurrent.currency,
        observedAt: pricesCurrent.observedAt,
      })
      .from(pricesCurrent)
      .where(and(eq(pricesCurrent.printId, id), eq(pricesCurrent.source, source)))
      .orderBy(pricesCurrent.finish);
  const daily = async (id: string, finish = 'normal') =>
    db
      .select({ day: pricesDaily.observedAt, market: pricesDaily.centsMarket })
      .from(pricesDaily)
      .where(
        and(
          eq(pricesDaily.printId, id),
          eq(pricesDaily.finish, finish),
          eq(pricesDaily.source, 'tcgplayer'),
        ),
      )
      .orderBy(pricesDaily.observedAt);
  const version = async () =>
    Number((await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version')))[0]?.value);

  it('skips TimescaleDB without the extension: prices_daily is a plain table', async () => {
    const { rows } = await db.execute<{ timescale: number; kind: string }>(sql`
      select (select count(*)::int from pg_extension where extname = 'timescaledb') as timescale,
             (select relkind::text from pg_class where relname = 'prices_daily') as kind`);
    expect(rows[0]).toEqual({ timescale: 0, kind: 'r' });
  });

  it('maps the Magic products by TCGplayer id and writes their prices', async () => {
    const before = await version();
    const requests: string[] = [];
    const steps: string[] = [];
    const { stats } = await run({ requests }, steps);

    expect(stats).toEqual({
      lastUpdated: '2026-10-09T20:05:19.000Z',
      games: {
        // 3 groups, 2 match a set; 5 card products (the booster box is none), 4 mapped (one of
        // them without a market price), "Mystery Card" unmapped.
        mtg: {
          groups: 3,
          matchedGroups: 2,
          cards: 5,
          mapped: 4,
          unmapped: 1,
          prices: 4,
          noMarket: 1,
        },
        // No Yu-Gi-Oh! or Pokémon sets in this catalog: only their group lists are read.
        yugioh: {
          groups: 3,
          matchedGroups: 0,
          cards: 0,
          mapped: 0,
          unmapped: 0,
          prices: 0,
          noMarket: 0,
        },
        pokemon: {
          groups: 3,
          matchedGroups: 0,
          cards: 0,
          mapped: 0,
          unmapped: 0,
          prices: 0,
          noMarket: 0,
        },
      },
    });
    expect(steps).toEqual([
      'start run',
      'last updated',
      'groups mtg',
      'prices mtg 000',
      'groups yugioh',
      'groups pokemon',
      'finish run',
    ]);
    // last-updated first, then groups, products and prices of the matched groups only.
    expect(requests).toEqual([
      'https://tcgcsv.com/last-updated.txt',
      'https://tcgcsv.com/tcgplayer/1/groups',
      'https://tcgcsv.com/tcgplayer/1/2864/products',
      'https://tcgcsv.com/tcgplayer/1/2864/prices',
      'https://tcgcsv.com/tcgplayer/1/2965/products',
      'https://tcgcsv.com/tcgplayer/1/2965/prices',
      'https://tcgcsv.com/tcgplayer/2/groups',
      'https://tcgcsv.com/tcgplayer/3/groups',
    ]);
    expect([...blobs.objects.keys()].filter((k) => k.includes('tcgcsv'))).toContain(
      'raw/dev/tcgcsv/2026-10-09/1/2864.prices.json.gz',
    );
    expect(await version()).toBe(before + 1);

    const adeline = await printId('mid', '1');
    expect(await current(adeline)).toEqual([
      {
        finish: 'foil',
        market: 433,
        low: 400,
        currency: 'USD',
        observedAt: new Date('2026-10-09T20:05:19Z'),
      },
      {
        finish: 'normal',
        market: 402,
        low: 350,
        currency: 'USD',
        observedAt: new Date('2026-10-09T20:05:19Z'),
      },
    ]);
    const [mapping] = await db
      .select()
      .from(priceMappings)
      .where(and(eq(priceMappings.printId, adeline), eq(priceMappings.finish, 'normal')));
    expect(mapping).toMatchObject({
      source: 'tcgplayer',
      externalId: '248137',
      method: 'scryfall_id',
      confidence: 100,
    });
  });

  it('pulls nothing more when TCGCSV has not been updated since the last run', async () => {
    const before = await version();
    const requests: string[] = [];
    const { stats } = await run({ requests });
    expect(stats).toMatchObject({ skipped: expect.any(String) });
    expect(requests).toEqual(['https://tcgcsv.com/last-updated.txt']);
    // Nothing new: the cached catalog reads stay valid.
    expect(await version()).toBe(before);
  });

  it('keeps one prices_daily row per print, finish, source and day', async () => {
    const adeline = await printId('mid', '1');
    const groups = [
      {
        groupId: 2864,
        setId: (await db.select().from(sets).where(eq(sets.code, 'mid')))[0]?.id ?? '',
      },
    ];
    const opts = (observedAt: string) => ({ raw: 'raw/dev/tcgcsv/x', delayMs: 0, observedAt });
    const count = async () =>
      (await db.select({ n: sql<number>`count(*)::int` }).from(pricesDaily))[0]?.n;

    // The same day again (a retried step): nothing new.
    const rows = await count();
    await importGroups(deps(), 'mtg', groups, opts('2026-10-09T21:00:00.000Z'));
    expect(await count()).toBe(rows);
    expect(await daily(adeline)).toEqual([{ day: new Date('2026-10-09T00:00:00Z'), market: 402 }]);

    // The next day with a new price: a second row, the current price follows.
    const raised = JSON.stringify({
      success: true,
      errors: [],
      results: [
        {
          productId: 248137,
          lowPrice: 4,
          midPrice: 5,
          highPrice: 9,
          marketPrice: 5.5,
          subTypeName: 'Normal',
        },
      ],
    });
    const next = deps(fakeTcgcsv({ files: { '1/2864/prices': raised } }));
    await importGroups(next, 'mtg', groups, opts('2026-10-10T20:04:00.000Z'));
    expect(await daily(adeline)).toEqual([
      { day: new Date('2026-10-09T00:00:00Z'), market: 402 },
      { day: new Date('2026-10-10T00:00:00Z'), market: 550 },
    ]);
    expect((await current(adeline)).find((p) => p.finish === 'normal')?.market).toBe(550);

    // A late re-run of the first day rewrites that day only, never the newer current price.
    await importGroups(deps(), 'mtg', groups, opts('2026-10-09T20:05:19.000Z'));
    expect(await daily(adeline)).toHaveLength(2);
    expect((await current(adeline)).find((p) => p.finish === 'normal')?.market).toBe(550);
  });

  it('keeps a manual mapping: the product’s price goes to the print an admin chose', async () => {
    const adeline = await printId('mid', '1');
    const gavony = await printId('mid', '20');
    await setManualMapping(db, {
      printId: gavony,
      source: 'tcgplayer',
      finish: 'normal',
      externalId: '248137',
      note: 'test',
    });
    const set = (await db.select().from(sets).where(eq(sets.code, 'mid')))[0];
    await importGroups(deps(), 'mtg', [{ groupId: 2864, setId: set?.id ?? '' }], {
      raw: 'raw/dev/tcgcsv/x',
      delayMs: 0,
      observedAt: '2026-10-11T20:00:00.000Z',
    });
    const mappings = await db
      .select({ printId: priceMappings.printId, method: priceMappings.method })
      .from(priceMappings)
      .where(and(eq(priceMappings.externalId, '248137'), eq(priceMappings.finish, 'normal')));
    expect(mappings).toEqual([{ printId: gavony, method: 'manual' }]);
    expect((await current(gavony))[0]).toMatchObject({ finish: 'normal', market: 402 });
    // Adeline's foil is still matched automatically.
    expect((await current(adeline)).map((p) => p.finish)).toContain('foil');
  });

  it('writes Scryfall’s Cardmarket EUR and TCGplayer USD prices per chunk of the dump', async () => {
    const before = await version();
    const steps: string[] = [];
    const scryfall = () =>
      runScryfallImport(
        { fetch: fakeScryfall(), raw: blobs, withDb: (fn) => fn(db) },
        (name, fn) => (steps.push(name), fn()),
        {
          env: 'dev',
          date: '2026-10-09',
          languages: ['en'],
          pricesObservedAt: '2026-10-09T03:00:00.000Z',
        },
      );
    const { prices: stats } = await scryfall();
    // 30 lines; the token and the digital card have no print.
    expect(stats).toMatchObject({ lines: 30, noPrint: 2 });
    // One step per chunk of the cards steps, all before the chunks are deleted.
    const cards = steps.filter((s) => s.startsWith('cards '));
    expect(steps.slice(steps.indexOf('finish run'))).toEqual([
      'finish run',
      'prices: start run',
      ...cards.map((s) => s.replace('cards', 'prices')),
      'prices: finish run',
      'clean up chunks',
    ]);
    // The catalog run and the price run each bump once.
    expect(await version()).toBe(before + 2);
    const adeline = await printId('mid', '1');
    expect(await current(adeline, 'cardmarket')).toMatchObject([
      { finish: 'foil', market: 523, currency: 'EUR', low: null },
      { finish: 'normal', market: 334, currency: 'EUR' },
    ]);
    expect(await current(adeline, 'tcgplayer_scryfall')).toMatchObject([
      { finish: 'foil', market: 433, currency: 'USD' },
      { finish: 'normal', market: 402, currency: 'USD' },
    ]);
    const [cardmarket] = await db
      .select()
      .from(priceMappings)
      .where(and(eq(priceMappings.printId, adeline), eq(priceMappings.source, 'cardmarket')))
      .limit(1);
    expect(cardmarket).toMatchObject({
      externalId: '574937',
      method: 'scryfall_id',
      confidence: 100,
    });

    // Idempotent: the same dump again writes the same rows.
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(pricesDaily);
    await scryfall();
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(pricesDaily)).toEqual(rows);
  });

  it('marks the price run failed on a failed chunk and leaves the catalog run ok', async () => {
    const steps: string[] = [];
    let failed = false;
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runScryfallImport(
      { fetch: fakeScryfall(), raw: blobs, withDb: (fn) => fn(db) },
      (name, fn) => {
        steps.push(name);
        if (name === 'prices 00000' && !failed) {
          failed = true;
          return Promise.reject(new Error('boom'));
        }
        return fn();
      },
      {
        env: 'dev',
        date: '2026-10-09',
        languages: ['en'],
        pricesObservedAt: '2026-10-09T03:00:00.000Z',
      },
    );
    warn.mockRestore();
    // The catalog is imported; the price run is marked failed, the chunks are still cleaned up.
    expect(result.stats).toBeTruthy();
    expect(result.prices).toBeUndefined();
    expect(steps.slice(-3)).toEqual(['prices 00000', 'prices: fail run', 'clean up chunks']);
  });
});
