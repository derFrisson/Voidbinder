import {
  SearchResponseSchema,
  SearchSuggestResponseSchema,
  type SearchSuggestion,
} from '@voidbinder/shared/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cards, printLocalizations, prints, sets } from '../db/schema';
import type { Db } from '../import/scryfall/write';
import { DrizzleCardStore, parseCodeQuery } from '../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase, testApp } from '../test-helpers';

describe('parseCodeQuery', () => {
  it.each([
    ['LDS3-EN121', 'lds3en121', null],
    ['lds3 en121', 'lds3en121', null],
    ['LDS3-121', 'lds3121', null],
    ['lds3en12', 'lds3en12', null],
    ['BLGG-DE024', 'blggde024', null],
    ['blgg de024', 'blggde024', null],
    ['blgg-de 024', 'blggde024', null],
    ['sv1 001', 'sv1001', null],
    ['SV01_001', 'sv01001', null],
    ['sv03.5 12', 'sv03512', null],
    ['mid 123', 'mid123', null],
    ['MID-123', 'mid123', null],
    ['lds3', 'lds3', null],
    ['121', '121', { number: '121', total: null }],
    ['001/128', '001128', { number: '001', total: 128 }],
    [' 001 / 128 ', '001128', { number: '001', total: 128 }],
    ['Satellite Warrior', 'satellitewarrior', null],
    ['Black Lotus!', null, null],
    ['a', null, null],
    ['"exact phrase" -not', null, null],
    ['averyveryverylongname', null, null],
    ['12345', '12345', null],
  ])('%j', (q, code, number) => {
    expect(parseCodeQuery(q)).toEqual({ code, number });
  });
});

// The code lookup, the trigram fallback and the typeahead against a small catalog of the three
// games written straight into a fresh database.
describe.skipIf(!databaseUrl)('search by code and GET /catalog/search/suggest (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let app: ReturnType<typeof testApp>;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    const set = async (
      gameId: string,
      code: string,
      name: string,
      releasedOn: string,
      cardCount: number,
    ) =>
      (
        await db
          .insert(sets)
          .values({ gameId, code, name, releasedOn, cardCount })
          .returning({ id: sets.id })
      )[0]?.id ?? '';
    const print = async (
      setId: string,
      gameId: string,
      name: string,
      number: string,
      de?: string,
    ) => {
      const [card] = await db
        .insert(cards)
        .values({ gameId, name, oracleKey: `${gameId}-${name}` })
        .onConflictDoUpdate({ target: [cards.gameId, cards.oracleKey], set: { name } })
        .returning({ id: cards.id });
      const [p] = await db
        .insert(prints)
        .values({ cardId: card?.id ?? '', setId, number, rarity: 'common' })
        .returning({ id: prints.id });
      await db
        .insert(printLocalizations)
        .values([
          { printId: p?.id ?? '', lang: 'en', name },
          ...(de ? [{ printId: p?.id ?? '', lang: 'de', name: de }] : []),
        ]);
    };
    const lds3 = await set('yugioh', 'lds3', 'Legendary Duelists: Season 3', '2022-07-14', 391);
    await print(lds3, 'yugioh', 'Satellite Warrior', 'EN121', 'Satellitenkrieger');
    await print(lds3, 'yugioh', 'Stardust Dragon', 'EN012');
    for (const n of [120, 122, 123, 124, 125])
      await print(lds3, 'yugioh', `Duelist Filler ${n}`, `EN${n}`);
    const blgg = await set('yugioh', 'blgg', 'Battles of Legend: Chapter 1', '2024-01-11', 100);
    await print(blgg, 'yugioh', 'Ghostrick Angel of Mischief', 'EN024');
    const sv01 = await set('pokemon', 'sv01', 'Scarlet & Violet', '2023-03-31', 198);
    await print(sv01, 'pokemon', 'Pineco', '001');
    await print(sv01, 'pokemon', 'Forretress ex', '005');
    const sv10 = await set('pokemon', 'sv10', 'Destined Rivals', '2025-05-30', 182);
    await print(sv10, 'pokemon', 'Ethan’s Pinsir', '001');
    const base1 = await set('pokemon', 'base1', 'Base', '1999-01-09', 102);
    await print(base1, 'pokemon', 'Alakazam', '1');
    await print(base1, 'pokemon', 'Midas Touch', '50');
    const mid = await set('mtg', 'mid', 'Innistrad: Midnight Hunt', '2021-09-24', 277);
    await print(mid, 'mtg', 'Midnight Reaper', '123');
    await print(mid, 'mtg', 'Adeline, Resplendent Cathar', '1');
    for (let i = 0; i < 10; i++) await print(mid, 'mtg', `Satyr Wayfinder ${i}`, `${200 + i}`);
    app = testApp({ cardStore: new DrizzleCardStore(db) });
  });
  afterAll(() => drop());

  const get = async (path: string) => {
    const res = await app.request(`/catalog${path}`);
    return { res, body: res.status === 200 ? ((await res.json()) as unknown) : undefined };
  };
  const search = async (q: string, extra = '') =>
    SearchResponseSchema.parse((await get(`/search?q=${encodeURIComponent(q)}${extra}`)).body);
  const suggest = async (q: string, extra = '') =>
    SearchSuggestResponseSchema.parse(
      (await get(`/search/suggest?q=${encodeURIComponent(q)}${extra}`)).body,
    ).suggestions;
  const label = (s: SearchSuggestion) =>
    s.kind === 'set' ? `set ${s.set.code}` : `${s.set.code} ${s.number}`;

  it.each([
    ['LDS3-EN121', 'lds3 EN121'],
    ['lds3 en121', 'lds3 EN121'],
    ['LDS3-121', 'lds3 EN121'],
    ['lds3en121', 'lds3 EN121'],
    // German and other language codes find the English print (no DE prints exist).
    ['BLGG-DE024', 'blgg EN024'],
    ['blgg de024', 'blgg EN024'],
    ['blgg-de 024', 'blgg EN024'],
    ['BLGG-SP024', 'blgg EN024'],
    ['blgg es024', 'blgg EN024'],
    ['BLGG-JP024', 'blgg EN024'],
    ['blgg024', 'blgg EN024'],
    ['sv1 001', 'sv01 001'],
    ['SV01-001', 'sv01 001'],
    ['sv1 1', 'sv01 001'],
    ['001/198', 'sv01 001'],
    ['mid 123', 'mid 123'],
    ['MID-123', 'mid 123'],
    ['Satelite', 'lds3 EN121'],
    ['Satelite Warior', 'lds3 EN121'],
    ['Satellitenkriger', 'lds3 EN121'],
  ])('/search finds %j first', async (q, first) => {
    const page = await search(q);
    expect(page.prints.map((p) => `${p.setCode} ${p.number}`)[0]).toBe(first);
    expect(page.total).toBe(page.prints.length);
  });

  it('/search: partial numbers, a bare set code and pure numbers', async () => {
    // EN012 is number 12 itself; the rest start with 12, by name like every equal rank.
    const partial = (await search('lds3en12')).prints.map((p) => p.number);
    expect(partial[0]).toBe('EN012');
    expect(partial.slice(1).sort()).toEqual(['EN120', 'EN121', 'EN122', 'EN123', 'EN124', 'EN125']);
    // A set code alone lists the set's prints.
    expect((await search('lds3')).total).toBe(7);
    // A pure number matches it in every set (and game), `/` the printed set size too.
    expect((await search('001')).prints.map((p) => `${p.setCode} ${p.number}`).sort()).toEqual([
      'base1 1',
      'mid 1',
      'sv01 001',
      'sv10 001',
    ]);
    expect((await search('001', '&game=pokemon')).total).toBe(3);
    expect((await search('001/182')).prints.map((p) => p.name)).toEqual(['Ethan’s Pinsir']);
    expect((await search('LDS3-EN121', '&game=pokemon')).total).toBe(0);
  });

  it('/search: the trigram fallback answers only when nothing else does', async () => {
    // `satyr` matches by name, so the similar `Satellite Warrior` stays out.
    const names = (await search('satyr')).prints.map((p) => p.name);
    expect(names).toHaveLength(10);
    expect(names).not.toContain('Satellite Warrior');
    expect((await search('qqqzzz')).total).toBe(0);
  });

  it('suggests the exact code first, then partial numbers', async () => {
    expect((await suggest('LDS3-EN121')).map(label)).toEqual(['lds3 EN121']);
    const partial = await suggest('lds3en12');
    expect(partial.map(label)).toEqual([
      'lds3 EN012',
      'lds3 EN120',
      'lds3 EN121',
      'lds3 EN122',
      'lds3 EN123',
      'lds3 EN124',
      'lds3 EN125',
    ]);
    expect(partial[2]).toEqual({
      kind: 'print',
      id: expect.any(String),
      name: 'Satellite Warrior',
      game: 'yugioh',
      set: { code: 'lds3', name: 'Legendary Duelists: Season 3' },
      number: 'EN121',
      variant: '',
      rarity: 'common',
      imageUrl: null,
      cardId: expect.any(String),
    });
    expect((await suggest('blgg de024')).map((s) => s.name)).toEqual([
      'Ghostrick Angel of Mischief',
    ]);
  });

  it('suggests a set by code with its first prints, then names starting with q', async () => {
    const mid = await suggest('mid');
    expect(mid.map(label)).toEqual(['set mid', 'mid 1', 'mid 123', 'mid 200', 'base1 50']);
    expect(mid[0]).toEqual({
      kind: 'set',
      id: expect.any(String),
      name: 'Innistrad: Midnight Hunt',
      game: 'mtg',
      set: { code: 'mid', name: 'Innistrad: Midnight Hunt' },
    });
    // Midnight Reaper is one of the set's first prints already; the name match follows.
    expect(mid.at(-1)?.name).toBe('Midas Touch');
    expect((await suggest('sv1')).map(label)[0]).toBe('set sv01');
    expect((await suggest('legendary du')).map(label)).toEqual(['set lds3']);
  });

  it('suggests names in lang, typos last, at most 8, one print per card', async () => {
    expect((await suggest('satel')).map((s) => s.name)).toEqual(['Satellite Warrior']);
    expect((await suggest('satelliten', '&lang=de')).map((s) => s.name)).toEqual([
      'Satellitenkrieger',
    ]);
    expect((await suggest('Satelite')).map((s) => s.name)).toEqual(['Satellite Warrior']);
    const many = await suggest('sat');
    expect(many).toHaveLength(8);
    // Shortest names first, then alphabetical.
    expect(many.map((s) => s.name).slice(0, 3)).toEqual([
      'Satellite Warrior',
      'Satyr Wayfinder 0',
      'Satyr Wayfinder 1',
    ]);
    expect(await suggest('sat', '&game=pokemon')).toEqual([]);
    expect((await suggest('pineco')).map(label)).toEqual(['sv01 001']);
  });

  it('validates q and is cached like the catalog', async () => {
    for (const query of ['', 'q=a', `q=${'x'.repeat(65)}`, 'q=ab&game=chess', 'q=ab&lang=x'])
      expect((await get(`/search/suggest?${query}`)).res.status, query).toBe(400);
    const res = await app.request('/catalog/search/suggest?q=lds3');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=60, s-maxage=600, stale-while-revalidate=60',
    );
    expect(res.headers.get('Cache-Tag')).toBe('catalog');
    expect(res.headers.get('ETag')).toMatch(/^"v\d+-[0-9a-f]{32}"$/);
  });
});
