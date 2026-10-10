import { and, eq, inArray, notExists } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cards, priceMappings, pricesCurrent, prints, sets } from '../../db/schema';
import { databaseUrl, freshDatabase, testApp } from '../../test-helpers';
import { runScryfallImport } from '../scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import {
  coverageCounts,
  lastCoverage,
  priceCoverage,
  priceFreshness,
  runFreshness,
} from './coverage';
import { runTcgcsvImport } from './pipeline';
import { results, type TcgGroup } from './tcgcsv';
import { fakeTcgcsv, tcgcsvFixture } from './test-fixtures';

describe.skipIf(!databaseUrl)('price coverage (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const blobs = new MemoryBlobStore();
  const groups = results<TcgGroup>(tcgcsvFixture('1/groups.json'), 'groups');
  // The fixture build: last-updated.txt.
  const hoursAfterBuild = (h: number) =>
    new Date(Date.parse('2026-10-09T20:05:19Z') + h * 3_600_000);

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: blobs, withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', languages: ['en'] },
    );
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runTcgcsvImport(
      { fetch: fakeTcgcsv(), raw: blobs, withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', delayMs: 0, games: ['mtg'] },
    );
    quiet.mockRestore();
  });
  afterAll(() => drop());

  it('counts the priced prints per set, the unmatched groups and the unpriced sets', async () => {
    // A Midnight Hunt print TCGCSV does not price has Scryfall's Cardmarket and TCGplayer prices
    // (VB-114: a print counts as priced by any source).
    const [scryfallOnly] = await db
      .select({ id: prints.id })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(
        and(
          eq(sets.code, 'mid'),
          notExists(db.select().from(pricesCurrent).where(eq(pricesCurrent.printId, prints.id))),
        ),
      )
      .limit(1);
    const row = {
      printId: scryfallOnly?.id ?? '',
      finish: 'normal',
      lang: 'en',
      centsMarket: 100,
      observedAt: new Date('2026-10-09T00:00:00Z'),
    };
    await db.insert(pricesCurrent).values([
      { ...row, source: 'cardmarket', currency: 'EUR' },
      { ...row, source: 'tcgplayer_scryfall', currency: 'USD' },
    ]);
    const c = await priceCoverage(db, 'mtg', groups, { now: hoursAfterBuild(1) });
    const coverage = (prints: number, tcgplayer: number, cardmarket: number) => ({
      prints,
      priced: tcgplayer + cardmarket,
      sources: { tcgplayer, cardmarket, tcgplayer_scryfall: cardmarket },
      unpriced: prints - tcgplayer - cardmarket,
      groupMatched: true,
      rules: ['scryfall-id'],
      stale: 0,
    });
    expect(c.sets.filter((s) => s.groupMatched)).toEqual([
      { code: 'mid', name: 'Innistrad: Midnight Hunt', groups: [2864], ...coverage(22, 2, 1) },
      { code: 'neo', name: 'Kamigawa: Neon Dynasty', groups: [2965], ...coverage(6, 1, 0) },
    ]);
    expect(c.unmatchedGroups).toEqual([
      { groupId: 24770, name: 'Commander: Star Trek', abbreviation: 'TRC' },
    ]);
    expect(c.unpricedSets).toEqual([]);
    expect(c.totals).toEqual(coverageCounts(c));
    expect(c.totals).toMatchObject({
      setsWithGroup: 2,
      setsPriced: 2,
      priced: 4,
      sources: { tcgplayer: 3, cardmarket: 1, tcgplayer_scryfall: 1 },
      unpriced: c.totals.prints - 4,
    });

    // Neo loses its TCGplayer price: a set with a group and no price.
    const neo = db
      .select({ id: prints.id })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(eq(sets.code, 'neo'));
    await db
      .delete(pricesCurrent)
      .where(and(inArray(pricesCurrent.printId, neo), eq(pricesCurrent.source, 'tcgplayer')));
    expect((await priceCoverage(db, 'mtg', groups)).unpricedSets).toEqual([
      { code: 'neo', name: 'Kamigawa: Neon Dynasty', prints: 6 },
    ]);

    // A run (forced: the same build) whose Neo group lists no price WARNs once for the set.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runTcgcsvImport(
      {
        fetch: fakeTcgcsv({
          files: { '1/2965/prices': JSON.stringify({ success: true, errors: [], results: [] }) },
        }),
        raw: blobs,
        withDb: (fn) => fn(db),
      },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', delayMs: 0, games: ['mtg'], force: true },
    );
    const warnings = warned.mock.calls.map(([line]) => JSON.parse(String(line)) as object);
    warned.mockRestore();
    quiet.mockRestore();
    expect(warnings).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'set has a TCGplayer group and no price',
        game: 'mtg',
        code: 'neo',
        name: 'Kamigawa: Neon Dynasty',
        prints: 6,
      }),
    ]);
  });

  it('answers GET /admin/prices/coverage from the last run’s group list', async () => {
    const get = (query: string, raw = blobs, auth = 'Bearer t') =>
      testApp({
        adminToken: 't',
        priceCoverage: (game) => lastCoverage(db, raw, game),
      }).request(`/admin/prices/coverage${query}`, { headers: { Authorization: auth } });
    const res = await get('?game=mtg');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      game: 'mtg',
      totals: { setsWithGroup: 2, sources: { tcgplayer: 2, cardmarket: 1 } },
      unmatchedGroups: [{ groupId: 24770 }],
      unpricedSets: [{ code: 'neo' }],
    });
    // The run imported Magic only: no Pokémon group list.
    expect((await get('?game=pokemon')).status).toBe(404);
    expect((await get('?game=mtg', new MemoryBlobStore())).status).toBe(404);
    expect((await get('?game=lorcana')).status).toBe(400);
    expect((await get('?game=mtg', blobs, 'Bearer wrong')).status).toBe(401);
  });
});

describe.skipIf(!databaseUrl)('price freshness (Postgres, VB-116)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const now = new Date('2026-10-10T21:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'yugioh', code: 'lob', name: 'Legend of Blue Eyes White Dragon' })
      .returning({ id: sets.id });
    const [card] = await db
      .insert(cards)
      .values({ gameId: 'yugioh', oracleKey: 'lob-dragon', name: 'Blue-Eyes White Dragon' })
      .returning({ id: cards.id });
    const ids = await db
      .insert(prints)
      .values(
        ['1', '2', '3', '4', '5'].map((number) => ({
          setId: set?.id ?? '',
          cardId: card?.id ?? '',
          number,
          finishes: ['nonfoil'],
        })),
      )
      .returning({ id: prints.id, number: prints.number });
    const id = (n: string) => ids.find((p) => p.number === n)?.id ?? '';
    const mapping = (n: string) => ({
      printId: id(n),
      source: 'tcgplayer',
      externalId: `p${n}`,
      finish: 'normal',
      method: 'number_match',
      confidence: 90,
    });
    const price = (n: string, finish: string, at: Date) => ({
      printId: id(n),
      finish,
      source: 'tcgplayer',
      currency: 'USD',
      centsMarket: 100,
      observedAt: at,
    });
    // 1 fresh (its old 1st Edition price does not make it stale), 2 stale, 3 neither (30 h, a
    // price without a mapping: a lost mapping still counts), 4 mapped without a market price
    // yet, 5 unmapped.
    await db.insert(priceMappings).values(['1', '2', '4'].map(mapping));
    await db
      .insert(pricesCurrent)
      .values([
        price('1', 'normal', hoursAgo(2)),
        price('1', 'first_edition', hoursAgo(72)),
        price('2', 'normal', hoursAgo(40)),
        price('3', 'normal', hoursAgo(30)),
      ]);
  });
  afterAll(() => drop());

  it('counts fresh, stale and unmapped prints per game and source', async () => {
    expect(await priceFreshness(db, 'tcgplayer', now)).toEqual([
      {
        game: 'mtg',
        source: 'tcgplayer',
        prints: 0,
        mapped: 0,
        unmapped: 0,
        priced: 0,
        fresh: 0,
        stale: 0,
        share: null,
      },
      {
        game: 'yugioh',
        source: 'tcgplayer',
        prints: 5,
        mapped: 4,
        unmapped: 1,
        priced: 3,
        fresh: 1,
        stale: 1,
        share: 0.3333,
      },
      {
        game: 'pokemon',
        source: 'tcgplayer',
        prints: 0,
        mapped: 0,
        unmapped: 0,
        priced: 0,
        fresh: 0,
        stale: 0,
        share: null,
      },
    ]);
    // Another source has no row of these prints; 37 h later all three priced ones are stale.
    expect(await priceFreshness(db, 'cardmarket', now)).toEqual([
      expect.objectContaining({ game: 'mtg', prints: 0, mapped: 0 }),
    ]);
    const later = await priceFreshness(db, 'tcgplayer', new Date(now.getTime() + 37 * 3_600_000));
    expect(later[1]).toMatchObject({ priced: 3, fresh: 0, stale: 3, share: 0 });
  });

  it('logs one line per run and keeps the counts', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    const freshness = await runFreshness(db, { source: 'tcgcsv', runId: 'r1' }, ['tcgplayer'], now);
    const lines = logged.mock.calls.map(([line]) => JSON.parse(String(line)) as object);
    logged.mockRestore();
    expect(lines).toEqual([
      expect.objectContaining({
        message: 'price freshness',
        source: 'tcgcsv',
        runId: 'r1',
        freshness,
      }),
    ]);
    expect(freshness?.[1]).toMatchObject({ game: 'yugioh', stale: 1 });
  });

  it('shows the stale prints per set and the failed groups on the coverage', async () => {
    const c = await priceCoverage(db, 'yugioh', [], { now, failedGroups: [23] });
    expect(c.sets).toEqual([
      expect.objectContaining({ code: 'lob', prints: 5, priced: 3, stale: 1 }),
    ]);
    expect(c.freshness).toEqual([expect.objectContaining({ source: 'tcgplayer', stale: 1 })]);
    expect(c.failedGroups).toEqual([23]);
  });
});
