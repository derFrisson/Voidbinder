import {
  PriceHistoryResponseSchema,
  PrintPricesResponseSchema,
  SetPageResponseSchema,
} from '@voidbinder/shared/api';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conditionMultipliers, pricesDaily, prints, sets } from '../db/schema';
import { runScryfallImport, type ImportDeps } from '../import/scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../import/scryfall/test-fixtures';
import type { Db } from '../import/scryfall/write';
import { DrizzleCardStore } from '../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase, testApp } from '../test-helpers';

// The price read routes and the mapping override against the Scryfall fixtures and their prices.
describe.skipIf(!databaseUrl)('price routes (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let app: ReturnType<typeof testApp>;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    const deps: ImportDeps = {
      fetch: fakeScryfall(),
      raw: new MemoryBlobStore(),
      withDb: (fn) => fn(db),
    };
    const opts = { env: 'local', date: '2026-10-09' };
    await runScryfallImport(deps, (_n, fn) => fn(), {
      ...opts,
      languages: ['en'],
      pricesObservedAt: '2026-10-09T03:00:00.000Z',
    });
    app = testApp({ cardStore: new DrizzleCardStore(db), db, adminToken: 't' });
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

  it('answers current prices, the display price and condition estimates, cached', async () => {
    const adeline = await printId('mid', '1');
    const res = await app.request(`/catalog/prints/${adeline}/prices`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=600');
    expect(res.headers.get('ETag')).toMatch(/^"v\d+-[0-9a-f]{32}"$/);
    const body = PrintPricesResponseSchema.parse(await res.json());
    expect(body.prices).toHaveLength(4);
    expect(body.prices[0]).toEqual({
      source: 'cardmarket',
      sourceLabel: 'Cardmarket (via Scryfall)',
      finish: 'foil',
      currency: 'EUR',
      market: 523,
      low: null,
      mid: null,
      high: null,
      observedAt: '2026-10-09T03:00:00.000Z',
    });
    // EUR (the default) prefers Cardmarket; the conditions are estimates of that price.
    expect(body.display).toEqual({
      source: 'cardmarket',
      finish: 'normal',
      currency: 'EUR',
      cents: 334,
    });
    expect(body.conditions.map((c) => [c.condition, c.cents])).toEqual([
      ['NM', 334],
      ['EX', 284],
      ['GD', 234],
      ['LP', 200],
      ['PL', 150],
      ['PO', 100],
    ]);
    expect(body.conditionsAreEstimates).toBe(true);

    const usd = PrintPricesResponseSchema.parse(
      await (
        await app.request(`/catalog/prints/${adeline}/prices?currency=USD&finish=foil`)
      ).json(),
    );
    expect(usd.display).toEqual({
      source: 'tcgplayer_scryfall',
      finish: 'foil',
      currency: 'USD',
      cents: 433,
    });

    expect((await app.request(`/catalog/prints/${crypto.randomUUID()}/prices`)).status).toBe(404);
    expect((await app.request('/catalog/prints/nope/prices')).status).toBe(400);
    expect((await app.request(`/catalog/prints/${adeline}/prices?currency=GBP`)).status).toBe(400);
  });

  it('answers the history: daily for 180 days, weekly before, at most one point per day', async () => {
    const id = await printId('neo', '1');
    const today = new Date().toISOString().slice(0, 10);
    const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000);
    await db.insert(pricesDaily).values(
      Array.from({ length: 400 }, (_, i) => ({
        observedAt: day(i + 1),
        printId: id,
        finish: 'normal',
        source: 'tcgplayer',
        currency: 'USD',
        centsMarket: 100 + i,
      })),
    );
    const res = await app.request(`/catalog/prints/${id}/prices/history?days=365`);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    const body = PriceHistoryResponseSchema.parse(await res.json());
    const series = body.series.find((s) => s.source === 'tcgplayer');
    const dates = series?.points.map((p) => p.date) ?? [];
    expect(dates.at(-1)).toBe(day(1).toISOString().slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length);
    const cutoff = day(180).toISOString().slice(0, 10);
    expect(dates.filter((d) => d >= cutoff)).toHaveLength(180);
    const weekly = dates.filter((d) => d < cutoff);
    // 185 older days in the window, thinned to the last day of each ISO week.
    expect(weekly.length).toBeGreaterThanOrEqual(26);
    expect(weekly.length).toBeLessThanOrEqual(28);
    for (const d of weekly.slice(0, -1)) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(0);
    // The Scryfall rows of the import are there too, one series per source and finish.
    expect(body.series.map((s) => `${s.source} ${s.finish}`)).toContain('tcgplayer normal');

    const short = PriceHistoryResponseSchema.parse(
      await (await app.request(`/catalog/prints/${id}/prices/history`)).json(),
    );
    expect(short.days).toBe(90);
    expect(short.series.find((s) => s.source === 'tcgplayer')?.points).toHaveLength(90);
    expect((await app.request(`/catalog/prints/${id}/prices/history?days=0`)).status).toBe(400);
  });

  it('adds the market price of the normal finish to every print of a set page', async () => {
    const page = async (query = '') =>
      SetPageResponseSchema.parse(
        await (await app.request(`/catalog/sets/mtg/mid${query}`)).json(),
      );
    const eur = await page();
    expect(eur.prints[0]?.marketPrice).toEqual({
      source: 'cardmarket',
      finish: 'normal',
      currency: 'EUR',
      cents: 334,
    });
    const usd = await page('?currency=USD');
    expect(usd.prints[0]?.marketPrice).toMatchObject({ source: 'tcgplayer_scryfall', cents: 402 });
    // A foil-only print is priced by its only finish.
    const champion = (await page('?page=1&sort=number')).prints.find((p) => p.number === '385');
    expect(champion?.marketPrice).toMatchObject({ finish: 'foil', cents: 76 });
  });

  it('estimates conditions with the default factors when a game has no rows', async () => {
    const adeline = await printId('mid', '1');
    const removed = await db
      .delete(conditionMultipliers)
      .where(eq(conditionMultipliers.gameId, 'mtg'))
      .returning();
    try {
      const body = PrintPricesResponseSchema.parse(
        await (await app.request(`/catalog/prints/${adeline}/prices`)).json(),
      );
      expect(body.conditions.map((c) => [c.condition, c.factor, c.cents])).toEqual([
        ['NM', 1, 334],
        ['EX', 0.85, 284],
        ['GD', 0.7, 234],
        ['LP', 0.6, 200],
        ['PL', 0.45, 150],
        ['PO', 0.3, 100],
      ]);
    } finally {
      await db.insert(conditionMultipliers).values(removed);
    }
  });

  it('PUT /admin/price-mappings sets a manual mapping', async () => {
    const adeline = await printId('mid', '1');
    const gavony = await printId('mid', '20');
    const put = (path: string, body: unknown, token = 't') =>
      app.request(`/admin/price-mappings/${path}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    expect((await put(`${adeline}/tcgplayer/normal`, { externalId: '1' }, 'x')).status).toBe(401);
    const res = await put(`${adeline}/tcgplayer/normal`, { externalId: '248137', note: 'checked' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      printId: adeline,
      source: 'tcgplayer',
      finish: 'normal',
      externalId: '248137',
      confidence: 100,
      method: 'manual',
      overriddenBy: 'admin',
      note: 'checked',
    });
    // Another print cannot take a product an admin mapped.
    expect((await put(`${gavony}/tcgplayer/normal`, { externalId: '248137' })).status).toBe(409);
    expect((await put(`${crypto.randomUUID()}/tcgplayer/normal`, { externalId: '9' })).status).toBe(
      404,
    );
    expect((await put(`${adeline}/ebay/normal`, { externalId: '9' })).status).toBe(400);
    // The Scryfall sources write by print, so a mapping there would change nothing.
    expect((await put(`${adeline}/cardmarket/normal`, { externalId: '9' })).status).toBe(400);
    expect((await put(`${adeline}/tcgplayer/normal`, {})).status).toBe(400);
  });
});
