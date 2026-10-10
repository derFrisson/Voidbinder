import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  appMeta,
  cards,
  importRuns,
  priceMappings,
  pricesCurrent,
  pricesDaily,
  prints,
  sets,
} from '../../db/schema';
import { cacheTags } from '../../middleware/catalog-cache';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { runScryfallImport, type ImportDeps } from '../scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { importGroups, runTcgcsvImport, splitReprints } from './pipeline';
import { results, type TcgPrice, type TcgProduct } from './tcgcsv';
import { fakeTcgcsv, tcgcsvFixture, type FakeTcgcsv } from './test-fixtures';
import { setManualMapping } from './override';

describe.skipIf(!databaseUrl)('price pipeline (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const blobs = new MemoryBlobStore();
  const purged: string[][] = [];
  const deps = (fetch = fakeTcgcsv()): ImportDeps => ({
    fetch,
    raw: blobs,
    withDb: (fn) => fn(db),
    purgeCache: async (tags) => void purged.push(tags),
  });
  const run = (fake: FakeTcgcsv = {}, steps: string[] = [], force = false) =>
    runTcgcsvImport(deps(fakeTcgcsv(fake)), (name, fn) => (steps.push(name), fn()), {
      env: 'dev',
      date: '2026-10-09',
      delayMs: 0,
      force,
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
    purged.length = 0;
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { stats } = await run({ requests }, steps);
    const lines = logged.mock.calls.map(([line]) => JSON.parse(String(line)) as object);
    logged.mockRestore();

    expect(stats).toEqual({
      lastUpdated: '2026-10-09T20:05:19.000Z',
      raw: 'raw/dev/tcgcsv/2026-10-09',
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
      // VB-116: per game of the `tcgplayer` source (counts in coverage.test.ts).
      freshness: [
        expect.objectContaining({ game: 'mtg', source: 'tcgplayer', priced: 3 }),
        expect.objectContaining({ game: 'yugioh', source: 'tcgplayer', priced: 0, share: null }),
        expect.objectContaining({ game: 'pokemon', source: 'tcgplayer', priced: 0, share: null }),
      ],
    });
    expect(steps).toEqual([
      'start run',
      'last updated',
      'groups mtg',
      'prices mtg 000',
      'coverage mtg',
      'groups yugioh',
      'coverage yugioh',
      'groups pokemon',
      'coverage pokemon',
      'freshness',
      'finish run',
      'purge cache',
    ]);
    expect(purged).toEqual([['prices']]);
    // VB-111: one line with the coverage counts per game.
    expect(lines).toContainEqual(
      expect.objectContaining({
        message: 'price coverage',
        game: 'mtg',
        setsWithGroup: 2,
        unmatchedGroups: 1,
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        message: 'price coverage',
        game: 'pokemon',
        sets: 0,
        unmatchedGroups: 3,
      }),
    );
    // The purge reaches every page that shows a price, not only the price routes.
    for (const path of ['/catalog/sets/pokemon/sv1', '/catalog/cards/0a1b', '/catalog/search'])
      expect(cacheTags(path).split(',')).toEqual(expect.arrayContaining(purged[0] ?? ['none']));
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
    purged.length = 0;
    const { stats } = await run({ requests });
    expect(stats).toMatchObject({ skipped: expect.any(String) });
    expect(requests).toEqual(['https://tcgcsv.com/last-updated.txt']);
    // Nothing new: the cached catalog reads stay valid, at the edge too.
    expect(await version()).toBe(before);
    expect(purged).toEqual([]);
  });

  it('imports the same build again when forced: a group a new rule matches is mapped (VB-111)', async () => {
    const answer = (results: object[]) => JSON.stringify({ success: true, errors: [], results });
    // Between the runs the catalog gains the set `trc` (as a new matching rule would match the
    // group): the first run left Commander: Star Trek (24770, `TRC`) unmatched.
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'mtg', code: 'trc', name: 'Commander: Star Trek' })
      .returning({ id: sets.id });
    const [card] = await db
      .insert(cards)
      .values({ gameId: 'mtg', oracleKey: 'trc-kirk', name: 'Captain Kirk' })
      .returning({ id: cards.id });
    const [kirk] = await db
      .insert(prints)
      .values({
        setId: set?.id ?? '',
        cardId: card?.id ?? '',
        number: '1',
        finishes: ['nonfoil'],
        externalIds: { tcgplayer: '700001' },
      })
      .returning({ id: prints.id });
    const before = await version();
    const requests: string[] = [];
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { stats } = await run(
      {
        requests,
        files: {
          '1/24770/products': answer([
            {
              productId: 700001,
              name: 'Captain Kirk',
              extendedData: [{ name: 'Number', value: '1' }],
            },
          ]),
          '1/24770/prices': answer([
            { productId: 700001, marketPrice: 3.5, subTypeName: 'Normal' },
          ]),
        },
      },
      [],
      true,
    );
    logged.mockRestore();
    expect(stats).toMatchObject({ games: { mtg: { matchedGroups: 3, mapped: 5 } } });
    expect(requests).toContain('https://tcgcsv.com/tcgplayer/1/24770/products');
    expect(await current(kirk?.id ?? '')).toMatchObject([{ finish: 'normal', market: 350 }]);
    expect(await version()).toBe(before + 1);
  });

  it('never fails the run on the coverage: it WARNs and goes on (VB-111)', async () => {
    const before = await version();
    const unread = vi.spyOn(blobs, 'get').mockRejectedValue(new Error('RAW unreachable'));
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    const steps: string[] = [];
    const { stats } = await run({}, steps, true);
    const warnings = warned.mock.calls.map(([line]) => JSON.parse(String(line)) as object);
    for (const spy of [unread, warned, quiet]) spy.mockRestore();
    expect(stats).toMatchObject({ games: { mtg: { matchedGroups: 3 } } });
    expect(steps).toContain('finish run');
    expect(await version()).toBe(before + 1);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        message: 'price coverage failed',
        game: 'mtg',
        error: 'Error: RAW unreachable',
      }),
    );
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
    purged.length = 0;
    const scryfall = () =>
      runScryfallImport(
        { ...deps(fakeScryfall()), raw: blobs },
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
      'prices: freshness',
      'prices: finish run',
      'purge cache',
      'clean up chunks',
    ]);
    // One purge for the catalog run and the price run.
    expect(purged).toEqual([['catalog', 'prices']]);
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
    // The catalog is imported; the price run is marked failed, the edge cache is still purged
    // (the catalog changed) and the chunks are still cleaned up.
    expect(result.stats).toBeTruthy();
    expect(result.prices).toBeUndefined();
    expect(steps.slice(-4)).toEqual([
      'prices 00000',
      'prices: fail run',
      'purge cache',
      'clean up chunks',
    ]);
  });

  // VB-116: a build counts as imported only after a run that pulled all of it ended `ok`.
  const pulled = (requests: string[]) => requests.some((r) => r.endsWith('/products'));
  const failing =
    (failName: string, steps: string[] = []) =>
    <T>(name: string, fn: () => Promise<T>) => {
      steps.push(name);
      return name === failName ? Promise.reject(new Error('HTTP 429')) : fn();
    };
  const plain = (lastUpdated: string, step = failing(''), files: Record<string, string> = {}) =>
    runTcgcsvImport(deps(fakeTcgcsv({ lastUpdated, files })), step, {
      env: 'dev',
      date: '2026-10-10',
      delayMs: 0,
    });
  // 25 groups per set code (no files: a group without products), so each set is one
  // `prices mtg` step.
  const groupIds = (set: number) => Array.from({ length: 25 }, (_, i) => 100_000 + set * 100 + i);
  const groupsOf = (codes: string[]) => ({
    '1/groups': JSON.stringify({
      success: true,
      errors: [],
      results: codes.flatMap((abbreviation, set) =>
        groupIds(set).map((groupId) => ({ groupId, name: `Group ${groupId}`, abbreviation })),
      ),
    }),
  });

  it('lists a group step that still fails, goes on, and pulls the build again next time', async () => {
    const build = '2026-10-10T20:05:19+0000';
    const steps: string[] = [];
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Magic's two fixture sets: two steps.
    const { runId, stats } = await plain(
      build,
      failing('prices mtg 001', steps),
      groupsOf(['MID', 'NEO']),
    );
    const warnings = warned.mock.calls.map(([line]) => JSON.parse(String(line)) as object);
    warned.mockRestore();
    // The other groups, games and the finish still run; the run is `ok` and names the groups.
    expect(steps.slice(steps.indexOf('prices mtg 001'))).toEqual([
      'prices mtg 001',
      'coverage mtg',
      'groups yugioh',
      'coverage yugioh',
      'groups pokemon',
      'coverage pokemon',
      'freshness',
      'finish run',
      'purge cache',
    ]);
    expect(stats).toMatchObject({
      failedGroups: [{ game: 'mtg', groupIds: groupIds(1), error: 'Error: HTTP 429' }],
      games: { mtg: { matchedGroups: 50 } },
    });
    expect(warnings).toContainEqual(
      expect.objectContaining({ message: 'price groups failed', runId, game: 'mtg' }),
    );
    const [row] = await db.select().from(importRuns).where(eq(importRuns.id, runId));
    expect(row?.status).toBe('ok');

    // The late run pulls the same build again; after that full run, the build is imported.
    const again: string[] = [];
    const second = await runTcgcsvImport(
      deps(fakeTcgcsv({ lastUpdated: build, requests: again })),
      failing(''),
      {
        env: 'dev',
        date: '2026-10-10',
        delayMs: 0,
      },
    );
    expect(pulled(again)).toBe(true);
    expect(second.stats).not.toHaveProperty('failedGroups');
    const third: string[] = [];
    const skipped = await runTcgcsvImport(
      deps(fakeTcgcsv({ lastUpdated: build, requests: third })),
      failing(''),
      {
        env: 'dev',
        date: '2026-10-10',
        delayMs: 0,
      },
    );
    quiet.mockRestore();
    expect(pulled(third)).toBe(false);
    expect(skipped.stats).toMatchObject({
      skipped: expect.any(String),
      freshness: expect.any(Array),
    });
  });

  it('fails the run when the group steps fail systemically', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const latest = async () =>
      (await db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(1))[0];
    // Two more Magic sets: four steps.
    await db.insert(sets).values([
      { gameId: 'mtg', code: 'zza', name: 'Test Set A' },
      { gameId: 'mtg', code: 'zzb', name: 'Test Set B' },
    ]);
    const fourSteps = groupsOf(['MID', 'NEO', 'ZZA', 'ZZB']);
    const every =
      (steps: string[]) =>
      <T>(name: string, fn: () => Promise<T>) =>
        failing(name.startsWith('prices ') ? name : '', steps)(name, fn);

    // Three failed steps in a row: the fourth is never tried.
    const steps: string[] = [];
    await expect(plain('2026-10-10T21:05:19+0000', every(steps), fourSteps)).rejects.toThrow(
      'price groups failed: mtg, 3 step(s) in a row',
    );
    expect(steps.filter((s) => s.startsWith('prices '))).toEqual([
      'prices mtg 000',
      'prices mtg 001',
      'prices mtg 002',
    ]);
    expect(steps.slice(-1)).toEqual(['fail run']);
    expect(await latest()).toMatchObject({ status: 'failed' });

    // Every step of a game failed (here its only one).
    await expect(plain('2026-10-10T21:15:19+0000', every([]))).rejects.toThrow(
      'price groups failed: mtg, 1 step(s) in a row',
    );
    expect(await latest()).toMatchObject({ status: 'failed' });

    // Two failures apart are isolated: the run is `ok` and lists both.
    const apart = await plain(
      '2026-10-10T21:25:19+0000',
      (name, fn) =>
        failing(name === 'prices mtg 000' || name === 'prices mtg 002' ? name : '')(name, fn),
      fourSteps,
    );
    expect(apart.stats).toMatchObject({
      failedGroups: [
        { game: 'mtg', groupIds: groupIds(0) },
        { game: 'mtg', groupIds: groupIds(2) },
      ],
    });
    expect(await latest()).toMatchObject({ status: 'ok' });
    quiet.mockRestore();
    warned.mockRestore();
  });

  it('pulls a build again after a failed run or one that never finished', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    const build = '2026-10-11T20:05:19+0000';
    await expect(plain(build, failing('groups yugioh'))).rejects.toThrow('HTTP 429');
    expect(
      (await db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(1))[0]?.status,
    ).toBe('failed');
    // A run of the next build that died mid-way stays `running`.
    const dead = '2026-10-12T20:05:19+0000';
    await db.insert(importRuns).values({
      source: 'tcgcsv',
      kind: 'prices',
      status: 'running',
      stats: { lastUpdated: new Date(Date.parse('2026-10-12T20:05:19Z')).toISOString() },
    });
    for (const b of [build, dead]) {
      const requests: string[] = [];
      await runTcgcsvImport(deps(fakeTcgcsv({ lastUpdated: b, requests })), failing(''), {
        env: 'dev',
        date: '2026-10-11',
        delayMs: 0,
      });
      expect(pulled(requests)).toBe(true);
    }
    quiet.mockRestore();
  });
});

describe.skipIf(!databaseUrl)('Yu-Gi-Oh! regional prints (Postgres, VB-110)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const ids: Record<string, string> = {};
  // TCGplayer lists Blue-Eyes once, as LOB-EN001; the catalog has the NA, EU and EN prints.
  const products = (extra: object[] = []) =>
    JSON.stringify({
      success: true,
      errors: [],
      results: [
        {
          productId: 21800,
          name: 'Blue-Eyes White Dragon',
          extendedData: [
            { name: 'Number', value: 'LOB-EN001' },
            { name: 'Rarity', value: 'Ultra Rare' },
          ],
        },
        ...extra,
      ],
    });
  const run = (files: Record<string, string>, force = false) =>
    runTcgcsvImport(
      { fetch: fakeTcgcsv({ files }), raw: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-10', delayMs: 0, games: ['yugioh'], force },
    );
  const mappings = async () =>
    (
      await db
        .select({
          printId: priceMappings.printId,
          externalId: priceMappings.externalId,
          method: priceMappings.method,
          confidence: priceMappings.confidence,
        })
        .from(priceMappings)
        .where(eq(priceMappings.finish, 'first_edition'))
    )
      .map((m) => [
        Object.keys(ids).find((k) => ids[k] === m.printId),
        m.externalId,
        m.method,
        m.confidence,
      ])
      .sort();
  const market = async (key: string) =>
    (
      await db
        .select({ finish: pricesCurrent.finish, market: pricesCurrent.centsMarket })
        .from(pricesCurrent)
        .where(eq(pricesCurrent.printId, ids[key] ?? ''))
        .orderBy(pricesCurrent.finish)
    ).map((p) => [p.finish, p.market]);

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'yugioh', code: 'lob', name: 'Legend of Blue Eyes White Dragon' })
      .returning({ id: sets.id });
    const [card] = await db
      .insert(cards)
      .values({ gameId: 'yugioh', oracleKey: '89631139', name: 'Blue-Eyes White Dragon' })
      .returning({ id: cards.id });
    for (const [key, number] of [
      ['na', '001'],
      ['eu', 'E001'],
      ['en', 'EN001'],
    ] as const) {
      const [p] = await db
        .insert(prints)
        .values({
          setId: set?.id ?? '',
          cardId: card?.id ?? '',
          number,
          variant: 'ultra-rare',
          finishes: ['normal'],
        })
        .returning({ id: prints.id });
      ids[key] = p?.id ?? '';
    }
  });
  afterAll(() => drop());

  it('prices all three prints with the EN product, the regional ones less confidently', async () => {
    await run({ '2/330/products': products() });
    expect(await mappings()).toEqual([
      ['en', '21800', 'number_match', 70],
      ['eu', '21800', 'region_match', 60],
      ['na', '21800', 'region_match', 60],
    ]);
    for (const key of ['na', 'eu', 'en'])
      expect(await market(key)).toEqual([
        ['first_edition', 90000],
        ['normal', 8000],
      ]);
  });

  it('re-maps a build already imported with `force`; an exact regional product wins', async () => {
    const european = {
      productId: 21801,
      name: 'Blue-Eyes White Dragon',
      extendedData: [
        { name: 'Number', value: 'LOB-E001' },
        { name: 'Rarity', value: 'Ultra Rare' },
      ],
    };
    const files = {
      '2/330/products': products([european]),
      '2/330/prices': JSON.stringify({
        success: true,
        errors: [],
        results: [
          { productId: 21800, marketPrice: 900, subTypeName: '1st Edition' },
          { productId: 21801, marketPrice: 500, subTypeName: '1st Edition' },
        ],
      }),
    };
    // The same build: skipped, nothing re-mapped.
    expect((await run(files)).stats).toMatchObject({ skipped: expect.any(String) });
    expect((await mappings()).find((m) => m[0] === 'eu')).toEqual([
      'eu',
      '21800',
      'region_match',
      60,
    ]);

    await run(files, true);
    expect(await mappings()).toEqual([
      ['en', '21800', 'number_match', 70],
      ['eu', '21801', 'number_match', 70],
      ['na', '21800', 'region_match', 60],
    ]);
    expect((await market('eu'))[0]).toEqual(['first_edition', 50000]);
    expect((await market('na'))[0]).toEqual(['first_edition', 90000]);
  });

  it('matches the groups of one set together: LOB, LOB-EN and its reprint (VB-111)', async () => {
    const answer = (results: object[]) => JSON.stringify({ success: true, errors: [], results });
    const group = (groupId: number, name: string, abbreviation: string) => ({
      groupId,
      name,
      abbreviation,
    });
    const product = (productId: number, number: string) => ({
      productId,
      name: 'Blue-Eyes White Dragon',
      extendedData: [
        { name: 'Number', value: number },
        { name: 'Rarity', value: 'Ultra Rare' },
      ],
    });
    const price = (productId: number, marketPrice: number) => ({
      productId,
      marketPrice,
      subTypeName: '1st Edition',
    });
    await db.delete(priceMappings);
    // TCGplayer (2026-10-10): `LOB` holds the North American prints (LOB-001), `LOB-EN` the EN
    // ones and the 25th Anniversary Edition their reprints, which the catalog folds into the set.
    await run(
      {
        '2/groups': answer([
          group(330, 'The Legend of Blue Eyes White Dragon', 'LOB'),
          group(22881, 'Legend of Blue Eyes White Dragon (Worldwide English)', 'LOB-EN'),
          group(23050, 'Legend of Blue Eyes White Dragon (25th Anniversary Edition)', 'LOB-EN'),
        ]),
        '2/330/products': answer([product(21792, 'LOB-001')]),
        '2/330/prices': answer([price(21792, 1000)]),
        '2/22881/products': answer([product(21800, 'LOB-EN001')]),
        '2/22881/prices': answer([price(21800, 900)]),
        '2/23050/products': answer([product(486045, 'LOB-EN001')]),
        '2/23050/prices': answer([price(486045, 20)]),
      },
      true,
    );
    // The NA print keeps its own product: the EN product's regional claim (60) loses to it, and
    // the reprint leaves the EN print to the older group instead of a tie.
    expect(await mappings()).toEqual([
      ['en', '21800', 'number_match', 70],
      ['eu', '21800', 'region_match', 60],
      ['na', '21792', 'number_match', 70],
    ]);
    expect((await market('na'))[0]).toEqual(['first_edition', 100000]);
    expect((await market('en'))[0]).toEqual(['first_edition', 90000]);
    expect((await market('eu'))[0]).toEqual(['first_edition', 90000]);
  });
});

describe('splitReprints (VB-113)', () => {
  const own = (groupId: number) =>
    results<TcgProduct>(tcgcsvFixture(`2/${groupId}/products.json`), 'products').map((product) => ({
      groupId,
      product,
    }));
  const prices = (groupId: number) =>
    results<TcgPrice>(tcgcsvFixture(`2/${groupId}/prices.json`), 'prices');

  it('keeps the oldest group of a card with a market price, else the oldest', () => {
    const { products, reprints } = splitReprints(
      [...own(255), ...own(22882), ...own(23052)],
      [...prices(255), ...prices(22882), ...prices(23052)],
    );
    // MRD-EN010 Kojikocy and MRD-EN081 Tainted Wisdom: no market price in the Worldwide English
    // group, so the 25th Anniversary Edition's product prices the EN print.
    expect(products.map((p) => p.productId)).toEqual([
      22062, 173924, 22131, 21835, 21762, 22477, 476262, 476271, 476288, 486249, 486358,
    ]);
    expect(reprints.map((p) => p.productId)).toEqual([476268, 476659, 486247, 486250, 486257]);
  });

  it('keeps a print’s current product while it has a price, else falls forward', () => {
    // Harpie Lady MRD-EN008 is mapped to the 25th Anniversary product and both have a price;
    // Kojikocy MRD-EN010 to the Worldwide English one, which has none.
    const { products } = splitReprints(
      [...own(22882), ...own(23052)],
      [...prices(22882), ...prices(23052)],
      new Set([486247, 476268]),
    );
    expect(products.map((p) => p.productId)).toEqual([476271, 476288, 486247, 486249, 486358]);
  });
});

describe.skipIf(!databaseUrl)('Yu-Gi-Oh! MRD price mapping (Postgres, VB-113)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const ids: Record<string, string> = {};
  const answer = (results: object[]) => JSON.stringify({ success: true, errors: [], results });
  const groups = JSON.parse(tcgcsvFixture('2/groups-vb113.json')) as {
    results: { groupId: number }[];
  };
  const fixture = (groupId: number, file: string) => tcgcsvFixture(`2/${groupId}/${file}.json`);
  const run = (files: Record<string, string>) =>
    runTcgcsvImport(
      { fetch: fakeTcgcsv({ files }), raw: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-10', delayMs: 0, games: ['yugioh'], force: true },
    );
  // The catalog's MRD prints of five cards (YGOPRODeck, local import of 2026-10-10).
  const catalog: [string, string, [string, string][]][] = [
    [
      '76812113',
      'Harpie Lady',
      [
        ['008', 'common'],
        ['E008', 'common'],
        ['EN008', 'common'],
      ],
    ],
    [
      '1184620',
      'Kojikocy',
      [
        ['010', 'common'],
        ['E010', 'common'],
        ['EN010', 'common'],
      ],
    ],
    [
      '40240595',
      'Cocoon of Evolution',
      [
        ['011', 'super-short-print'],
        ['E011', 'super-short-print'],
        ['EN011', 'common'],
        ['EN011', 'short-print'],
        ['EN011', 'super-short-print'],
      ],
    ],
    [
      '11901678',
      'Black Skull Dragon',
      [
        ['018', 'ultra-rare'],
        ['E018', 'ultra-rare'],
        ['EN018', 'ultra-rare'],
      ],
    ],
    [
      '28725004',
      'Tainted Wisdom',
      [
        ['081', 'common'],
        ['E081', 'common'],
        ['EN081', 'common'],
      ],
    ],
  ];

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'yugioh', code: 'mrd', name: 'Metal Raiders' })
      .returning({ id: sets.id });
    for (const [oracleKey, name, numbers] of catalog) {
      const [card] = await db
        .insert(cards)
        .values({ gameId: 'yugioh', oracleKey, name })
        .returning({ id: cards.id });
      for (const [number, variant] of numbers) {
        const [p] = await db
          .insert(prints)
          .values({
            setId: set?.id ?? '',
            cardId: card?.id ?? '',
            number,
            variant,
            finishes: ['normal'],
          })
          .returning({ id: prints.id });
        ids[`${number} ${variant}`] = p?.id ?? '';
      }
    }
  });
  afterAll(() => drop());

  it('prices every MRD print of the recorded groups', async () => {
    const files: Record<string, string> = {
      '2/groups': answer(groups.results.filter((g) => [255, 22882, 23052].includes(g.groupId))),
    };
    for (const g of [255, 22882, 23052])
      for (const file of ['products', 'prices']) files[`2/${g}/${file}`] = fixture(g, file);
    await run(files);

    const mapped = (
      await db
        .select({
          printId: priceMappings.printId,
          externalId: priceMappings.externalId,
          method: priceMappings.method,
          confidence: priceMappings.confidence,
        })
        .from(priceMappings)
        .where(eq(priceMappings.finish, 'normal'))
    )
      .map((m) => [
        Object.keys(ids).find((k) => ids[k] === m.printId),
        Number(m.externalId),
        m.method,
        m.confidence,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(mapped).toEqual([
      // Artwork variants: the original artwork, less confidently.
      ['008 common', 22062, 'number_match', 65],
      ['010 common', 22131, 'number_match', 70],
      // One print by number: no rarity to compare.
      ['011 super-short-print', 21835, 'number_match', 70],
      ['018 ultra-rare', 21762, 'number_match', 70],
      ['081 common', 22477, 'number_match', 70],
      ['E008 common', 476262, 'region_match', 60],
      // The Worldwide English product has no market price: the 25th Anniversary one prices it.
      ['E010 common', 486249, 'region_match', 60],
      // A super short print is TCGplayer's Common.
      ['E011 super-short-print', 476271, 'region_match', 60],
      // `B. Skull Dragon` on TCGplayer: the EN print's product.
      ['E018 ultra-rare', 476288, 'region_match', 60],
      ['E081 common', 486358, 'region_match', 60],
      ['EN008 common', 476262, 'number_match', 70],
      ['EN010 common', 486249, 'number_match', 70],
      ['EN011 common', 476271, 'number_match', 70],
      ['EN011 short-print', 476271, 'number_match', 70],
      ['EN011 super-short-print', 476271, 'number_match', 70],
      ['EN018 ultra-rare', 476288, 'number_match', 70],
      ['EN081 common', 486358, 'number_match', 70],
    ]);
    const priced = await db
      .select({ printId: pricesCurrent.printId })
      .from(pricesCurrent)
      .where(eq(pricesCurrent.source, 'tcgplayer'));
    expect(new Set(priced.map((p) => p.printId)).size).toBe(Object.keys(ids).length);
    const [kojikocy] = await db
      .select({ market: pricesCurrent.centsMarket })
      .from(pricesCurrent)
      .where(
        and(
          eq(pricesCurrent.printId, ids['EN010 common'] ?? ''),
          eq(pricesCurrent.finish, 'normal'),
        ),
      );
    expect(kojikocy?.market).toBe(20);
  });

  it('prices a set without a group through the group that lists its numbers', async () => {
    // LC03's group lists LC03-EN001 and the mega pack's LCYW-EN001; LCYW has no group.
    const [lc03, lcyw] = await db
      .insert(sets)
      .values([
        { gameId: 'yugioh', code: 'lc03', name: "Legendary Collection 3: Yugi's World" },
        { gameId: 'yugioh', code: 'lcyw', name: "Legendary Collection 3: Yugi's World Mega Pack" },
      ])
      .returning({ id: sets.id });
    const [card] = await db
      .insert(cards)
      .values({ gameId: 'yugioh', oracleKey: '46986414', name: 'Dark Magician' })
      .returning({ id: cards.id });
    const [print] = await db
      .insert(prints)
      .values({
        setId: lcyw?.id ?? '',
        cardId: card?.id ?? '',
        number: 'EN001',
        variant: 'ultra-rare',
        finishes: ['normal'],
      })
      .returning({ id: prints.id });
    const files = {
      '2/584/products': answer([
        {
          productId: 1,
          name: 'Dark Magician',
          extendedData: [
            { name: 'Number', value: 'LCYW-EN001' },
            { name: 'Rarity', value: 'Ultra Rare' },
          ],
        },
      ]),
      '2/584/prices': answer([{ productId: 1, marketPrice: 2, subTypeName: '1st Edition' }]),
    };
    const deps = {
      fetch: fakeTcgcsv({ files }),
      raw: new MemoryBlobStore(),
      withDb: <T>(fn: (db: Db) => Promise<T>) => fn(db),
    };
    const opts = { raw: 'raw/dev/tcgcsv/x', delayMs: 0, observedAt: '2026-10-10T20:05:19.000Z' };
    const mapping = async () =>
      (
        await db
          .select()
          .from(priceMappings)
          .where(eq(priceMappings.printId, print?.id ?? ''))
      ).map((m) => m.externalId);
    // LCYW with a group of its own: that group prices it, not LC03's.
    await importGroups(deps, 'yugioh', [{ groupId: 584, setId: lc03?.id ?? '' }], {
      ...opts,
      grouped: new Set([lc03?.id ?? '', lcyw?.id ?? '']),
    });
    expect(await mapping()).toEqual([]);
    await importGroups(deps, 'yugioh', [{ groupId: 584, setId: lc03?.id ?? '' }], opts);
    expect(await mapping()).toEqual(['1']);
  });
});
