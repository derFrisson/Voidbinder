import type { CardStore, SearchIndex } from '@voidbinder/core';
import {
  SearchResponseSchema,
  SearchSuggestResponseSchema,
  type SearchSuggestion,
  type SearchSuggestResponse,
} from '@voidbinder/shared/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '../import/scryfall/write';
import { DrizzleCardStore, parseCodeQuery } from '../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase, testApp } from '../test-helpers';
import { seedSearchCatalog } from '../test-search-fixtures';

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
    ['mid 123a', 'mid123a', null],
    ['war 97★', 'war97', null],
    ['MID-123★', 'mid123', null],
    ['Pokémon', null, null],
    ['Æther Vial', null, null],
    ['Séance', null, null],
    ['ポケモンGX', null, null],
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
    expect(parseCodeQuery(q)).toMatchObject({ code, number });
  });

  it.each([
    ['swsh1 25', [5]],
    ['sv03.5 12', [4, 5]],
    ['LDS3-EN121', [4]],
    ['blgg-de 024', [4, 6]],
    [' sv1 ', []],
    ['war 97★', [3]],
    ['lds3en121', []],
    ['Black Lotus!', []],
  ])('splits of %j', (q, splits) => {
    expect(parseCodeQuery(q).splits).toEqual(splits);
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
    await seedSearchCatalog(db);
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
    // The split the user typed wins over the newer set the other split names.
    ['swsh1 25', 'swsh1 25'],
    ['swsh12 5', 'swsh12 5'],
    ['sv1 01', 'sv01 001'],
    ['sv10 1', 'sv10 001'],
    ['war 123a', 'war 123a'],
    ['WAR-97★', 'war 97★'],
    ['war 97', 'war 97★'],
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
      lang: 'en',
      number: 'EN121',
      displayNumber: 'EN121',
      displayCode: 'LDS3-EN121',
      cardFormat: 'japanese',
      variant: '',
      rarity: 'common',
      imageUrl: null,
      cardId: expect.any(String),
    });
    expect((await suggest('blgg de024')).map((s) => s.name)).toEqual([
      'Ghostrick Angel of Mischief',
    ]);
    expect(await suggest('blgg de024')).toMatchObject([
      { number: 'EN024', displayNumber: 'DE024', displayCode: 'BLGG-DE024' },
    ]);
  });

  it('shows a typed language code, else the number in ?lang= where a localization has it (VB-97)', async () => {
    const first = async (q: string, extra = '') => (await search(q, extra)).prints[0];
    // The token typed wins over ?lang=, with or without a localization in that language.
    for (const extra of ['', '&lang=en', '&lang=fr'])
      expect(await first('BLGG-DE024', extra), extra).toMatchObject({
        number: 'EN024',
        displayNumber: 'DE024',
        displayCode: 'BLGG-DE024',
        matchedCode: 'BLGG-DE024',
        cardFormat: 'japanese',
      });
    expect(await first('blgg es024')).toMatchObject({
      displayNumber: 'SP024',
      matchedCode: 'BLGG-SP024',
    });
    expect(await first('BLGG-JP024')).toMatchObject({ displayNumber: 'JP024' });
    // A name search shows the number in the language of the name that matched (VB-102).
    const satellite = await first('satellite warrior', '&lang=de');
    expect(satellite).toMatchObject({ displayNumber: 'EN121', displayCode: 'LDS3-EN121' });
    expect(satellite).not.toHaveProperty('matchedCode');
    expect(await first('satellitenkrieger')).toMatchObject({
      displayNumber: 'DE121',
      displayCode: 'LDS3-DE121',
    });
    expect(await first('ghostrick', '&lang=de')).toMatchObject({ displayNumber: 'EN024' });
    expect(await first('satellite warrior')).toMatchObject({ displayNumber: 'EN121' });
    // Pokémon and Magic numbers stay; the code is printed per game.
    expect(await first('sv1 001', '&lang=de')).toMatchObject({
      displayNumber: '001',
      displayCode: '001/198',
      cardFormat: 'standard',
    });
    expect(await first('mid 123', '&lang=de')).toMatchObject({
      displayNumber: '123',
      displayCode: 'MID 123',
      cardFormat: 'standard',
    });
  });

  it.each([
    ['swsh1 25', 'swsh1 25', 'swsh12 5'],
    ['swsh12 5', 'swsh12 5', 'swsh1 25'],
    ['sv1 01', 'sv01 001', 'sv10 001'],
    ['sv10 1', 'sv10 001', 'sv01 001'],
  ])('suggests the split typed in %j first', async (q, first, second) => {
    expect((await suggest(q)).map(label).slice(0, 2)).toEqual([first, second]);
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
      lang: 'en',
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
    expect((await suggest('pineco')).map(label)).toEqual(['sv10 090']);
  });

  it('?names= picks the languages names match in, all of them by default', async () => {
    const first = async (q: string, extra = '') => {
      const [hit] = (await search(q, extra)).prints;
      return hit && `${hit.setCode} ${hit.number} ${hit.name}`;
    };
    // A German-only name is found and shows in German, the language that matched (VB-102).
    for (const extra of ['', '&names=all&lang=en', '&names=de'])
      expect(await first('satellitenkrieger', extra), extra).toBe('lds3 EN121 Satellitenkrieger');
    // An English-only print drops out with German names.
    expect((await search('stardust')).total).toBe(1);
    expect((await search('stardust', '&names=de')).total).toBe(0);

    for (const extra of ['', '&names=all&lang=en', '&names=de'])
      expect(
        (await suggest('satellitenk', extra)).map((s) => s.name),
        extra,
      ).toEqual(['Satellitenkrieger']);
    expect((await suggest('stardust')).map((s) => s.name)).toEqual(['Stardust Dragon']);
    expect(await suggest('stardust', '&names=de')).toEqual([]);
    // The newest print with a name in the language that matched, not the card's newest.
    expect((await suggest('tannza')).map(label)).toEqual(['sv01 001']);
    expect(
      (await suggest('tannza', '&names=de&lang=de')).map((s) => `${label(s)} ${s.name}`),
    ).toEqual(['sv01 001 Tannza']);
  });

  // VB-102: a hit is shown in the language of what matched; ?lang= (the user's) only where
  // nothing names one and between several languages that matched alike. One rule for every game.
  it.each([
    // An English name with a German user: English name, number and set name.
    ['Lev Shaddoll', '&lang=de', 'en BLGG-EN025 Lev Shaddoll'],
    // A German name with an English user: the German name and number.
    ['Lev-Schattenpuppen', '&lang=en', 'de BLGG-DE025 Lev-Schattenpuppen'],
    ['Lev-Schattenpuppen', '&lang=de', 'de BLGG-DE025 Lev-Schattenpuppen'],
    // A code's language token, whatever ?lang= (no German name: the English one).
    ['blgg en024', '&lang=de', 'en BLGG-EN024 Ghostrick Angel of Mischief'],
    ['blgg de024', '&lang=en', 'de BLGG-DE024 Ghostrick Angel of Mischief'],
    ['LDS3-EN121', '&lang=de', 'en LDS3-EN121 Satellite Warrior'],
    // A code without a language, a set code alone: the user's language.
    ['sv1 001', '&lang=de', 'de 001/198 Tannza'],
    ['sv1 001', '&lang=en', 'en 001/198 Pineco'],
    // A bare number: the user's language, the English name where the print has none in it.
    ['001/198', '&lang=fr', 'fr 001/198 Pineco'],
    ['lds3en121', '&lang=fr', 'en LDS3-EN121 Satellite Warrior'],
    ['053/128', '&lang=de', undefined],
    // A name equal in several languages: ?lang= when it matched, else English.
    ['pikachu', '&lang=de', 'de 063/198 Pikachu'],
    ['pikachu', '&lang=fr', 'fr 063/198 Pikachu'],
    ['pikachu', '&lang=ja', 'en 063/198 Pikachu'],
    // ?names= matches one language's names only, so it is that language.
    ['pikachu', '&names=fr&lang=de', 'fr 063/198 Pikachu'],
    // Pokémon: the German name finds the print that has it, its number as stored.
    ['tannza', '&lang=en', 'de 001/198 Tannza'],
    ['pineco', '&lang=de', 'en 090/182 Pineco'],
    // A typo: the language of the closest name, not ?lang= among every similar one.
    ['Satellitenkriger', '&lang=en', 'de LDS3-DE121 Satellitenkrieger'],
    ['lev schadoll', '&lang=de', 'en BLGG-EN025 Lev Shaddoll'],
  ])('%j%s: search and typeahead show %j (VB-102)', async (q, extra, shown) => {
    const label = (h?: { lang: string; displayCode?: string | undefined; name: string }) =>
      h && `${h.lang} ${h.displayCode} ${h.name}`;
    expect(label((await search(q, extra)).prints[0])).toBe(shown);
    expect(label((await suggest(q, extra))[0])).toBe(shown);
  });

  it('a set and a set code alone show in ?lang= (VB-102)', async () => {
    expect((await suggest('legendary du', '&lang=de'))[0]).toMatchObject({
      kind: 'set',
      lang: 'de',
    });
    const set = await suggest('lds3', '&lang=de');
    expect(set.map((s) => s.lang)).toEqual(['de', 'de', 'de', 'de']);
    expect(set.find((s) => s.number === 'EN121')).toMatchObject({
      name: 'Satellitenkrieger',
      displayCode: 'LDS3-DE121',
    });
    const prints = (await search('lds3', '&lang=fr')).prints;
    expect(new Set(prints.map((p) => p.lang))).toEqual(new Set(['fr']));
  });

  it('validates q and is cached like the catalog', async () => {
    for (const query of [
      '',
      'q=a',
      `q=${'x'.repeat(65)}`,
      'q=ab&game=chess',
      'q=ab&lang=x',
      'q=ab&names=german',
    ])
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

// VB-98: the search index answers the typeahead first; Postgres (the card store) when it cannot.
describe('the typeahead through the search index', () => {
  const print = {
    kind: 'print',
    id: '00000000-0000-4000-8000-000000000001',
    name: 'From the index',
    game: 'mtg',
    set: { code: 'mid', name: 'Innistrad: Midnight Hunt' },
    lang: 'en',
  } satisfies SearchSuggestion;
  const pgPrint = { ...print, name: 'From Postgres' };
  const cardStore = {
    catalogVersion: async () => '7',
    suggest: async () => ({ suggestions: [pgPrint] }),
  } as unknown as CardStore;
  const answer = (index: Partial<SearchIndex>) =>
    testApp({ cardStore, searchIndex: index as SearchIndex });

  it('answers the typeahead from the index, tagged with its version', async () => {
    const app = answer({
      suggest: async () => ({ result: { suggestions: [print] }, catalogVersion: '6' }),
    });
    const res = await app.request('/catalog/search/suggest?q=mid');
    expect(res.headers.get('x-search-source')).toBe('d1');
    expect(res.headers.get('ETag')).toMatch(/^"v6-/);
    expect(((await res.json()) as SearchSuggestResponse).suggestions[0]?.name).toBe(
      'From the index',
    );
  });

  it('reads Postgres alone without an index', async () => {
    const res = await testApp({ cardStore }).request('/catalog/search/suggest?q=mid');
    expect(res.headers.get('x-search-source')).toBe('postgres');
  });

  it.each([
    ['an error', async () => Promise.reject(new Error('D1 down'))],
    ['no answer', async () => null],
    ['no hits', async () => ({ result: { suggestions: [] }, catalogVersion: '6' })],
  ])('falls back to Postgres on %s', async (_what, suggest) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await answer({ suggest }).request('/catalog/search/suggest?q=mid');
    warn.mockRestore();
    expect(res.headers.get('x-search-source')).toBe('postgres');
    expect(res.headers.get('ETag')).toMatch(/^"v7-/);
    expect(((await res.json()) as SearchSuggestResponse).suggestions[0]?.name).toBe(
      'From Postgres',
    );
  });
});
