import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pricesDaily } from '../../db/schema';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { runScryfallImport } from '../scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { days, hasDay, loadMappings, mapPrices, readDay, writeDay } from './backfill';
import { runTcgcsvImport } from './pipeline';
import { fakeTcgcsv } from './test-fixtures';

describe('days', () => {
  it('lists every day of the range, both ends included, across a month end', () => {
    expect(days('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(days('2024-03-01', '2024-02-28')).toEqual([]);
  });
});

describe('mapPrices', () => {
  const price = (productId: number, subTypeName: string, marketPrice: number | null = 1.5) => ({
    productId,
    subTypeName,
    lowPrice: 1,
    midPrice: null,
    highPrice: 2,
    marketPrice,
  });
  const mappings = new Map([
    ['1|normal', 'print-a'],
    ['1|foil', 'print-a-foil'],
    ['2|etched', 'print-b'],
  ]);

  it('maps by product and finish, an etched product whatever its printing', () => {
    const r = mapPrices(
      [price(1, 'Normal'), price(1, 'Foil', null), price(2, 'Foil'), price(3, 'Normal')],
      mappings,
    );
    expect(r).toEqual({
      rows: [
        {
          printId: 'print-a',
          finish: 'normal',
          source: 'tcgplayer',
          currency: 'USD',
          market: 150,
          low: 100,
          high: 200,
        },
        {
          printId: 'print-b',
          finish: 'etched',
          source: 'tcgplayer',
          currency: 'USD',
          market: 150,
          low: 100,
          high: 200,
        },
      ],
      unmapped: 1,
      noMarket: 1,
    });
  });
});

describe.skipIf(!databaseUrl)('price backfill (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let dir: string;
  const DAY = '2025-01-01';
  const LIVE = '2026-10-09';

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    const blobs = new MemoryBlobStore();
    const deps = { raw: blobs, withDb: <T>(fn: (db: Db) => Promise<T>) => fn(db) };
    await runScryfallImport({ ...deps, fetch: fakeScryfall() }, (_n, fn) => fn(), {
      env: 'dev',
      date: LIVE,
      languages: ['en'],
    });
    // The daily import makes the mappings (and LIVE's prices_daily rows) the backfill reads.
    await runTcgcsvImport({ ...deps, fetch: fakeTcgcsv() }, (_n, fn) => fn(), {
      env: 'dev',
      date: LIVE,
      delayMs: 0,
    });
    // The archive's layout, `<day>/<category>/<group>/prices`, from the live-shaped fixtures.
    dir = mkdtempSync(join(tmpdir(), 'backfill-test-'));
    const fixtures = new URL('../../../test/fixtures/tcgcsv/', import.meta.url).pathname;
    for (const category of ['1', '2', '3'])
      for (const group of readdirSync(join(fixtures, category)).filter((f) => /^\d+$/.test(f)))
        cpSync(
          join(fixtures, category, group, 'prices.json'),
          join(dir, DAY, category, group, 'prices'),
        );
  });
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await drop();
  });

  const rowsOf = (day: string) =>
    db
      .select({
        printId: pricesDaily.printId,
        finish: pricesDaily.finish,
        market: pricesDaily.centsMarket,
      })
      .from(pricesDaily)
      .where(
        and(
          eq(pricesDaily.source, 'tcgplayer'),
          eq(pricesDaily.observedAt, new Date(`${day}T00:00:00Z`)),
        ),
      )
      .orderBy(pricesDaily.printId, pricesDaily.finish);
  const count = async () =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(pricesDaily))[0]?.n;

  it('writes the rows the daily import writes for the same prices, once', async () => {
    const perGame = await readDay(dir, DAY, await loadMappings(db), ['mtg', 'yugioh', 'pokemon']);
    expect(perGame.mtg).toMatchObject({ groups: 2, unmapped: 2, noMarket: 1 });
    expect(perGame.mtg?.rows).toHaveLength(4);
    const rows = Object.values(perGame).flatMap((g) => g.rows);

    expect(await hasDay(db, DAY)).toBe(false);
    expect(await writeDay(db, DAY, rows)).toBe(4);
    expect(await hasDay(db, DAY)).toBe(true);
    expect(await rowsOf(DAY)).toEqual(await rowsOf(LIVE));

    // A rerun inserts nothing new, and a day the daily import wrote keeps its rows.
    const before = await count();
    expect(await writeDay(db, DAY, rows)).toBe(0);
    expect(await writeDay(db, LIVE, rows)).toBe(0);
    expect(await count()).toBe(before);
  });
});
