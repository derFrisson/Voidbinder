import {
  CardResponseSchema,
  PriceHistoryResponseSchema,
  PrintPricesResponseSchema,
  SearchResponseSchema,
  SetPageResponseSchema,
} from '@voidbinder/shared/api';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cards,
  conditionMultipliers,
  priceMappings,
  pricesCurrent,
  pricesDaily,
  prints,
  sets,
} from '../db/schema';
import { writeScryfallPrices } from '../import/prices/scryfall';
import { upsertMappings, writePrices } from '../import/prices/write';
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
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=60, s-maxage=600, stale-while-revalidate=60',
    );
    expect(res.headers.get('Cache-Tag')).toBe('catalog,prices');
    expect(res.headers.get('ETag')).toMatch(/^"v\d+-[0-9a-f]{32}"$/);
    const body = PrintPricesResponseSchema.parse(await res.json());
    expect(body.prices).toHaveLength(4);
    expect(body.prices[0]).toEqual({
      source: 'cardmarket',
      sourceLabel: 'Cardmarket (via Scryfall)',
      finish: 'foil',
      lang: 'en',
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
      lang: 'en',
      currency: 'EUR',
      cents: 334,
      observedAt: '2026-10-09T03:00:00.000Z',
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
    // VB-115: Cardmarket's foil and normal share one product, one link.
    expect(body.links).toEqual([
      {
        portal: 'cardnexus',
        url: 'https://cardnexus.com/en/search?q=Adeline%2C%20Resplendent%20Cathar%20MID',
      },
      {
        portal: 'cardmarket',
        url: 'https://www.cardmarket.com/en/Magic/Products?idProduct=574937',
      },
      {
        portal: 'ebay',
        url: 'https://www.ebay.com/sch/i.html?_nkw=Adeline%2C%20Resplendent%20Cathar%20MID',
      },
    ]);

    const usd = PrintPricesResponseSchema.parse(
      await (
        await app.request(`/catalog/prints/${adeline}/prices?currency=USD&finish=foil`)
      ).json(),
    );
    expect(usd.display).toEqual({
      source: 'tcgplayer_scryfall',
      finish: 'foil',
      lang: 'en',
      currency: 'USD',
      cents: 433,
      observedAt: '2026-10-09T03:00:00.000Z',
    });

    expect((await app.request(`/catalog/prints/${crypto.randomUUID()}/prices`)).status).toBe(404);
    expect((await app.request('/catalog/prints/nope/prices')).status).toBe(400);
    expect((await app.request(`/catalog/prints/${adeline}/prices?currency=GBP`)).status).toBe(400);
  });

  it('links one TCGplayer product of a print (VB-115)', async () => {
    const id = await printId('mid', '1');
    const mapping = (externalId: string, finish: string) => ({
      printId: id,
      source: 'tcgplayer',
      externalId,
      finish,
      confidence: 70,
      method: 'number_match',
    });
    await db.insert(priceMappings).values([mapping('247338', 'normal'), mapping('247339', 'foil')]);
    const body = PrintPricesResponseSchema.parse(
      await (await app.request(`/catalog/prints/${id}/prices`)).json(),
    );
    expect(body.links.filter((l) => l.portal === 'tcgplayer')).toEqual([
      { portal: 'tcgplayer', url: 'https://www.tcgplayer.com/product/247338' },
    ]);
    await db
      .delete(priceMappings)
      .where(and(eq(priceMappings.printId, id), eq(priceMappings.source, 'tcgplayer')));
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
      lang: 'en',
      currency: 'EUR',
      cents: 334,
      observedAt: '2026-10-09T03:00:00.000Z',
    });
    const usd = await page('?currency=USD');
    expect(usd.prints[0]?.marketPrice).toMatchObject({ source: 'tcgplayer_scryfall', cents: 402 });
    // A foil-only print is priced by its only finish.
    const champion = (await page('?page=1&sort=number')).prints.find((p) => p.number === '385');
    expect(champion?.marketPrice).toMatchObject({ finish: 'foil', cents: 76 });
  });

  it('sorts a set page by market price, unpriced prints last', async () => {
    const page = SetPageResponseSchema.parse(
      await (await app.request('/catalog/sets/mtg/mid?sort=price')).json(),
    );
    const cents = page.prints.map((p) => p.marketPrice?.cents ?? null);
    const priced = cents.filter((c): c is number => c !== null);
    expect(priced.length).toBeGreaterThan(1);
    expect(priced).toEqual([...priced].sort((a, b) => b - a));
    // Nothing priced follows an unpriced print.
    expect(cents.slice(priced.length).every((c) => c === null)).toBe(true);
    expect(cents[0]).toBe(Math.max(...priced));

    // A print with only a USD price sorts after every print priced in EUR, whatever its cents.
    const adeline = await printId('mid', '1');
    const eurRows = await db
      .delete(pricesCurrent)
      .where(and(eq(pricesCurrent.printId, adeline), eq(pricesCurrent.currency, 'EUR')))
      .returning();
    const again = SetPageResponseSchema.parse(
      await (await app.request('/catalog/sets/mtg/mid?sort=price')).json(),
    );
    const currencies = again.prints.map((p) => p.marketPrice?.currency ?? null);
    const lastEur = currencies.lastIndexOf('EUR');
    const firstUsd = currencies.indexOf('USD');
    expect(firstUsd).toBeGreaterThan(lastEur);
    expect(again.prints[firstUsd]?.id).toBe(adeline);
    await db.insert(pricesCurrent).values(eurRows);
  });

  it('adds the same market price to the search hits', async () => {
    const hits = async (query: string) =>
      SearchResponseSchema.parse(await (await app.request(`/catalog/search?${query}`)).json())
        .prints;
    const [eur] = await hits('q=adeline');
    expect(eur?.marketPrice).toEqual({
      source: 'cardmarket',
      finish: 'normal',
      lang: 'en',
      currency: 'EUR',
      cents: 334,
      observedAt: '2026-10-09T03:00:00.000Z',
    });
    const [usd] = await hits('q=adeline&currency=USD');
    expect(usd?.marketPrice).toMatchObject({ source: 'tcgplayer_scryfall', cents: 402 });
    expect((await hits('q=champion'))[0]?.marketPrice).toMatchObject({ finish: 'foil', cents: 76 });
  });

  it('gives every print of a card its market price, in the asked currency', async () => {
    const adeline = await printId('mid', '1');
    const [row] = await db
      .select({ cardId: prints.cardId })
      .from(prints)
      .where(eq(prints.id, adeline));
    const read = async (query = '') =>
      CardResponseSchema.parse(
        await (await app.request(`/catalog/cards/${row?.cardId}${query}`)).json(),
      ).prints;
    expect((await read())[0]?.marketPrice).toEqual({
      source: 'cardmarket',
      finish: 'normal',
      lang: 'en',
      currency: 'EUR',
      cents: 334,
      observedAt: '2026-10-09T03:00:00.000Z',
    });
    expect((await read('?currency=USD'))[0]?.marketPrice).toMatchObject({
      source: 'tcgplayer_scryfall',
      cents: 402,
    });
    expect((await app.request(`/catalog/cards/${row?.cardId}?currency=GBP`)).status).toBe(400);
  });

  // Yu-Gi-Oh!: TCGplayer prices per edition (`first_edition`), the print says `normal` (MP25 EN301).
  it('prices a print by a finish it does not list: set page, search, card page, prices', async () => {
    const [card] = await db
      .insert(cards)
      .values({ gameId: 'yugioh', name: 'Geistgrinder Golem', oracleKey: 'ygo-geistgrinder' })
      .returning({ id: cards.id });
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'yugioh', code: 'mp25', name: '2025 Mega Pack' })
      .returning({ id: sets.id });
    const [print] = await db
      .insert(prints)
      .values({
        cardId: card?.id ?? '',
        setId: set?.id ?? '',
        number: 'EN301',
        finishes: ['normal'],
      })
      .returning({ id: prints.id });
    const id = print?.id ?? '';
    await db.insert(pricesCurrent).values({
      printId: id,
      finish: 'first_edition',
      source: 'tcgplayer',
      currency: 'USD',
      centsMarket: 23,
      observedAt: new Date('2026-10-09T20:05:19.000Z'),
    });
    const price = {
      source: 'tcgplayer',
      finish: 'first_edition',
      lang: 'en',
      currency: 'USD',
      cents: 23,
      observedAt: '2026-10-09T20:05:19.000Z',
    };
    const page = SetPageResponseSchema.parse(
      await (await app.request('/catalog/sets/yugioh/mp25')).json(),
    );
    expect(page.prints[0]?.marketPrice).toEqual(price);
    const hits = SearchResponseSchema.parse(
      await (await app.request('/catalog/search?q=geistgrinder')).json(),
    );
    expect(hits.prints[0]?.marketPrice).toEqual(price);
    const card2 = CardResponseSchema.parse(
      await (await app.request(`/catalog/cards/${card?.id}`)).json(),
    );
    expect(card2.prints[0]?.marketPrice).toEqual(price);
    const prices = PrintPricesResponseSchema.parse(
      await (await app.request(`/catalog/prints/${id}/prices`)).json(),
    );
    expect(prices.display).toEqual(price);

    // A listed finish wins over one the print does not list, whatever the source.
    await db.insert(pricesCurrent).values({
      printId: id,
      finish: 'normal',
      source: 'tcgplayer_scryfall',
      currency: 'USD',
      centsMarket: 99,
      observedAt: new Date('2026-10-09T03:00:00.000Z'),
    });
    const again = SetPageResponseSchema.parse(
      await (await app.request('/catalog/sets/yugioh/mp25')).json(),
    );
    expect(again.prints[0]?.marketPrice).toMatchObject({ finish: 'normal', cents: 99 });
  });

  // One finish rule: the set page's SQL `finishRank` and core's pickDisplayPrice must agree.
  it('picks the same finish on the set page and the prices route', async () => {
    const shapes = [
      {
        code: 'rank1',
        finishes: ['holo'],
        rows: [
          { finish: 'normal', source: 'cardmarket', currency: 'EUR' },
          { finish: 'holo', source: 'tcgplayer', currency: 'USD' },
        ],
        finish: 'holo',
      },
      {
        code: 'rank2',
        finishes: ['normal'],
        rows: [
          { finish: 'reverse', source: 'cardmarket', currency: 'EUR' },
          { finish: 'first_edition', source: 'tcgplayer', currency: 'USD' },
        ],
        finish: 'first_edition',
      },
      {
        // An empty finishes array counts as ['normal'] in SQL and in core.
        code: 'rank3',
        finishes: [],
        rows: [
          { finish: 'holo', source: 'cardmarket', currency: 'EUR' },
          { finish: 'normal', source: 'tcgplayer', currency: 'USD' },
        ],
        finish: 'normal',
      },
    ];
    for (const shape of shapes) {
      const [card] = await db
        .insert(cards)
        .values({ gameId: 'yugioh', name: shape.code, oracleKey: `ygo-${shape.code}` })
        .returning({ id: cards.id });
      const [set] = await db
        .insert(sets)
        .values({ gameId: 'yugioh', code: shape.code, name: shape.code })
        .returning({ id: sets.id });
      const [print] = await db
        .insert(prints)
        .values({
          cardId: card?.id ?? '',
          setId: set?.id ?? '',
          number: '1',
          finishes: shape.finishes,
        })
        .returning({ id: prints.id });
      await db.insert(pricesCurrent).values(
        shape.rows.map((r) => ({
          printId: print?.id ?? '',
          ...r,
          centsMarket: 100,
          observedAt: new Date('2026-10-09T03:00:00.000Z'),
        })),
      );
      for (const currency of ['EUR', 'USD']) {
        const page = SetPageResponseSchema.parse(
          await (
            await app.request(`/catalog/sets/yugioh/${shape.code}?currency=${currency}`)
          ).json(),
        );
        const prices = PrintPricesResponseSchema.parse(
          await (
            await app.request(`/catalog/prints/${print?.id}/prices?currency=${currency}`)
          ).json(),
        );
        expect(page.prints[0]?.marketPrice?.finish).toBe(shape.finish);
        expect(prices.display?.finish).toBe(shape.finish);
      }
    }
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

  // VB-103: a German copy's price next to the English one, same print and finish.
  it('writes and reads prices per card language: the language shown, else en, else any', async () => {
    const id = await printId('mid', '1');
    const [row] = await db.select({ cardId: prints.cardId }).from(prints).where(eq(prints.id, id));
    const cardId = row?.cardId ?? '';
    const observedAt = '2026-10-09T03:00:00.000Z';
    // A German copy's price (a source that prices several languages of one print).
    const german = { printId: id, source: 'cardmarket', finish: 'normal', lang: 'de' };
    await upsertMappings(db, [
      { ...german, externalId: '999', method: 'scryfall_id', confidence: 100 },
    ]);
    await writePrices(db, [{ ...german, currency: 'EUR', market: 900 }], observedAt);
    const byLang = async (table: typeof pricesCurrent | typeof pricesDaily) =>
      (
        await db
          .select({ lang: table.lang, cents: table.centsMarket })
          .from(table)
          .where(
            and(eq(table.printId, id), eq(table.source, 'cardmarket'), eq(table.finish, 'normal')),
          )
          .orderBy(table.lang)
      ).map((r) => [r.lang, r.cents]);
    expect(await byLang(pricesCurrent)).toEqual([
      ['de', 900],
      ['en', 334],
    ]);
    expect(await byLang(pricesDaily)).toEqual([
      ['de', 900],
      ['en', 334],
    ]);
    const mapping = await db
      .select({ lang: priceMappings.lang, externalId: priceMappings.externalId })
      .from(priceMappings)
      .where(and(eq(priceMappings.printId, id), eq(priceMappings.lang, 'de')));
    expect(mapping).toEqual([{ lang: 'de', externalId: '999' }]);

    const prices = async (query: string) =>
      PrintPricesResponseSchema.parse(
        await (await app.request(`/catalog/prints/${id}/prices${query}`)).json(),
      );
    const de = await prices('?lang=de');
    expect(de.display).toMatchObject({ source: 'cardmarket', lang: 'de', cents: 900 });
    // One price per source and finish: German where there is one, English otherwise.
    expect(de.prices.map((p) => [p.source, p.finish, p.lang, p.market])).toEqual([
      ['cardmarket', 'foil', 'en', 523],
      ['cardmarket', 'normal', 'de', 900],
      ['tcgplayer_scryfall', 'foil', 'en', 433],
      ['tcgplayer_scryfall', 'normal', 'en', 402],
    ]);
    expect(de.conditions[0]).toMatchObject({ condition: 'NM', cents: 900 });
    expect((await prices('')).display).toMatchObject({ lang: 'en', cents: 334 });
    expect((await prices('?lang=fr')).display).toMatchObject({ lang: 'en', cents: 334 });
    // A German price outranks the USD user's source in English.
    expect((await prices('?lang=de&currency=USD')).display).toMatchObject({ lang: 'de' });
    expect((await app.request(`/catalog/prints/${id}/prices?lang=DE!`)).status).toBe(400);

    // History: per day the German point where there is one, English before.
    const today = new Date().toISOString().slice(0, 10);
    const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000);
    const daily = (n: number, lang: string, centsMarket: number) => ({
      observedAt: day(n),
      printId: id,
      finish: 'normal',
      source: 'cardmarket',
      lang,
      currency: 'EUR',
      centsMarket,
    });
    await db
      .insert(pricesDaily)
      .values([daily(20, 'en', 300), daily(19, 'en', 310), daily(19, 'de', 800)])
      .onConflictDoNothing();
    const history = async (lang: string) =>
      PriceHistoryResponseSchema.parse(
        await (await app.request(`/catalog/prints/${id}/prices/history?lang=${lang}`)).json(),
      ).series.find((s) => s.source === 'cardmarket' && s.finish === 'normal')?.points ?? [];
    const iso = (n: number) => day(n).toISOString().slice(0, 10);
    expect((await history('de')).filter((p) => [iso(20), iso(19)].includes(p.date))).toEqual([
      { date: iso(20), cents: 300, lang: 'en' },
      { date: iso(19), cents: 800, lang: 'de' },
    ]);
    expect((await history('en')).find((p) => p.date === iso(19))).toEqual({
      date: iso(19),
      cents: 310,
      lang: 'en',
    });

    // The lateral lookups: card page, search hits and set page take the language shown; a hit is
    // shown in the language that matched (VB-102), here the English name, whatever ?lang=.
    const cardPrice = async (query: string) =>
      CardResponseSchema.parse(
        await (await app.request(`/catalog/cards/${cardId}${query}`)).json(),
      ).prints.find((p) => p.id === id)?.marketPrice;
    expect(await cardPrice('?lang=de')).toMatchObject({ lang: 'de', cents: 900 });
    expect(await cardPrice('')).toMatchObject({ lang: 'en', cents: 334 });
    const hit = async (lang: string) =>
      SearchResponseSchema.parse(
        await (await app.request(`/catalog/search?q=adeline&lang=${lang}`)).json(),
      ).prints.find((p) => p.id === id)?.marketPrice;
    expect(await hit('de')).toMatchObject({ lang: 'en', cents: 334 });
    expect(await hit('en')).toMatchObject({ lang: 'en', cents: 334 });
    const setPrice = async (lang: string) =>
      SetPageResponseSchema.parse(
        await (await app.request(`/catalog/sets/mtg/mid?lang=${lang}`)).json(),
      ).prints.find((p) => p.id === id)?.marketPrice;
    expect(await setPrice('de')).toMatchObject({ lang: 'de', cents: 900 });
    expect(await setPrice('en')).toMatchObject({ lang: 'en', cents: 334 });

    // Neither the language nor English: any other (a Japanese-only price).
    await db
      .update(pricesCurrent)
      .set({ lang: 'ja' })
      .where(and(eq(pricesCurrent.printId, id), eq(pricesCurrent.lang, 'en')));
    expect((await prices('?lang=fr')).display).toMatchObject({ lang: 'de' });
    expect(await cardPrice('?lang=fr')).toMatchObject({ lang: 'de' });

    await db
      .update(pricesCurrent)
      .set({ lang: 'en' })
      .where(and(eq(pricesCurrent.printId, id), eq(pricesCurrent.lang, 'ja')));
    for (const table of [pricesCurrent, pricesDaily, priceMappings])
      await db.delete(table).where(and(eq(table.printId, id), eq(table.lang, 'de')));
  });

  // VB-103 review: a Japanese-only print kept its pre-migration `en` row; Scryfall prices a print
  // in one language, so its next write drops the row in another.
  it("a Scryfall write drops the print's rows in another language", async () => {
    const id = await printId('neo', '293');
    const [row] = await db.select({ cardId: prints.cardId }).from(prints).where(eq(prints.id, id));
    const cm = and(
      eq(pricesCurrent.printId, id),
      eq(pricesCurrent.source, 'cardmarket'),
      eq(pricesCurrent.finish, 'normal'),
    );
    // The state after migration 0013 guessed wrong: the cardmarket row and mapping as `en`.
    await db.update(pricesCurrent).set({ lang: 'en', centsMarket: 111 }).where(cm);
    await db
      .update(priceMappings)
      .set({ lang: 'en' })
      .where(and(eq(priceMappings.printId, id), eq(priceMappings.finish, 'normal')));

    const line = { set: 'neo', collector_number: '293', lang: 'ja', cardmarket_id: 605034 };
    await writeScryfallPrices(
      db,
      [JSON.stringify({ ...line, prices: { eur: '3.50' } })],
      '2026-10-10T03:00:00.000Z',
    );
    expect(
      await db
        .select({ lang: pricesCurrent.lang, cents: pricesCurrent.centsMarket })
        .from(pricesCurrent)
        .where(cm),
    ).toEqual([{ lang: 'ja', cents: 350 }]);
    expect(
      await db
        .select({ lang: priceMappings.lang })
        .from(priceMappings)
        .where(and(eq(priceMappings.printId, id), eq(priceMappings.finish, 'normal'))),
    ).toEqual([{ lang: 'ja' }]);
    const card = CardResponseSchema.parse(
      await (await app.request(`/catalog/cards/${row?.cardId ?? ''}`)).json(),
    );
    expect(card.prints.find((p) => p.id === id)?.marketPrice).toMatchObject({
      lang: 'ja',
      cents: 350,
    });
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
