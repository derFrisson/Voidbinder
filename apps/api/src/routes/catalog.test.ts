import {
  CardResponseSchema,
  GamesResponseSchema,
  PrintResponseSchema,
  SearchResponseSchema,
  SetPageResponseSchema,
  SetsResponseSchema,
} from '@voidbinder/shared/api';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, cards, printLocalizations, prints, sets } from '../db/schema';
import { runScryfallImport } from '../import/scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../import/scryfall/test-fixtures';
import type { Db } from '../import/scryfall/write';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleCardStore } from '../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase, testApp } from '../test-helpers';

// The read API against the Scryfall fixtures imported into a fresh database.
describe.skipIf(!databaseUrl)('GET /catalog (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  let app: ReturnType<typeof testApp>;
  let store: DrizzleCardStore;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'local', date: '2026-10-09', languages: ['en', 'de'] },
    );
    store = new DrizzleCardStore(db, { imageBaseUrl: 'https://img.test' });
    app = testApp({ cardStore: store });
  });
  afterAll(() => drop());

  const get = async (path: string) => {
    const res = await app.request(`/catalog${path}`);
    return { res, body: res.status === 200 ? ((await res.json()) as unknown) : undefined };
  };
  const cardId = async (name: string) =>
    (await db.select({ id: cards.id }).from(cards).where(eq(cards.name, name)))[0]?.id ?? '';

  it('lists the games with their set counts and card formats (migration 0012)', async () => {
    const { body } = await get('/games');
    expect(GamesResponseSchema.parse(body).games).toEqual([
      { id: 'mtg', name: 'Magic: The Gathering', setCount: 2, cardFormat: 'standard' },
      { id: 'pokemon', name: 'Pokémon', setCount: 0, cardFormat: 'standard' },
      { id: 'yugioh', name: 'Yu-Gi-Oh!', setCount: 0, cardFormat: 'japanese' },
      { id: 'onepiece', name: 'One Piece Card Game', setCount: 0, cardFormat: 'standard' },
    ]);
  });

  it('lists the sets of a game, newest first, with the name in ?lang=', async () => {
    const en = SetsResponseSchema.parse((await get('/games/mtg/sets')).body);
    expect(en.sets.map((s) => [s.code, s.localizedName])).toEqual([
      ['neo', 'Kamigawa: Neon Dynasty'],
      ['mid', 'Innistrad: Midnight Hunt'],
    ]);
    expect(en.sets[1]).toMatchObject({
      releasedOn: '2021-09-24',
      cardCount: 392,
      kind: 'expansion',
    });
    // Magic sets have English names only.
    const de = SetsResponseSchema.parse((await get('/games/mtg/sets?lang=de')).body);
    expect(de.sets.every((s) => s.localizedName === null)).toBe(true);
    expect((await get('/games/chess/sets')).res.status).toBe(400);
  });

  it('pages, filters and sorts the prints of a set', async () => {
    const page = SetPageResponseSchema.parse((await get('/sets/mtg/mid')).body);
    expect(page.set).toMatchObject({ game: 'mtg', code: 'mid', name: 'Innistrad: Midnight Hunt' });
    expect(page).toMatchObject({ page: 1, pageSize: 60, total: 22 });
    expect(page.prints.map((p) => p.number).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(page.prints.at(-1)?.number).toBe('385');
    expect(page.prints[0]?.imageUrl).toMatch(/^https:\/\/cards\.scryfall\.io\/normal\//);

    const de = SetPageResponseSchema.parse((await get('/sets/mtg/mid?lang=de')).body);
    expect(de.prints[0]?.name).toBe('Adeline, strahlende Katharerin');
    expect(de.prints[2]?.name).toBe('Beloved Beggar // Generous Soul');

    const mythic = SetPageResponseSchema.parse((await get('/sets/mtg/mid?rarity=mythic')).body);
    expect(mythic.prints.map((p) => p.rarity)).toEqual(['mythic']);
    const normal = SetPageResponseSchema.parse((await get('/sets/mtg/mid?finish=normal')).body);
    expect(normal.total).toBe(21);
    const byName = SetPageResponseSchema.parse((await get('/sets/mtg/mid?sort=name')).body);
    expect(byName.prints[0]?.name).toBe('Adeline, Resplendent Cathar');
    expect(byName.prints[1]?.name).toBe('Ambitious Farmhand // Seasoned Cathar');

    // The facets describe the whole set, whatever the filters.
    expect(mythic.facets).toEqual(page.facets);
    expect(page.facets).toEqual({
      rarities: [
        { rarity: 'common', count: 8 },
        { rarity: 'uncommon', count: 8 },
        { rarity: 'rare', count: 5 },
        { rarity: 'mythic', count: 1 },
      ],
      // `normal` first although `foil` has more prints.
      finishes: [
        { finish: 'normal', count: 21 },
        { finish: 'foil', count: 22 },
      ],
      languages: ['de', 'en'],
    });

    const beyond = SetPageResponseSchema.parse((await get('/sets/mtg/mid?page=2')).body);
    expect(beyond).toMatchObject({ page: 2, total: 22, prints: [] });
    const query = { lang: 'en', sort: 'number', currency: 'EUR', page: 2 } as const;
    const second = await store.getSetPage('mtg', 'mid', query, 5);
    expect(second?.prints.map((p) => p.number)).toEqual(['6', '7', '8', '9', '10']);

    expect((await get('/sets/mtg/xyz')).res.status).toBe(404);
    expect((await get('/sets/mtg/mid?sort=popularity')).res.status).toBe(400);
  });

  it('breaks rarity ties by name, so the chips keep their order', async () => {
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'mtg', code: 'tie', name: 'Tie' })
      .returning({ id: sets.id });
    // Two rarities the Magic ranking does not know, one print each: only the name tells them apart.
    for (const [number, rarity] of [
      ['1', 'Zeta'],
      ['2', 'Alpha'],
    ] as const) {
      const [card] = await db
        .insert(cards)
        .values({ gameId: 'mtg', name: `Tie ${number}`, oracleKey: `tie-${number}` })
        .returning({ id: cards.id });
      await db.insert(prints).values({
        cardId: card?.id ?? '',
        setId: set?.id ?? '',
        number,
        rarity,
        finishes: ['normal'],
      });
    }
    for (let i = 0; i < 3; i++) {
      const page = await store.getSetPage(
        'mtg',
        'tie',
        { lang: 'en', sort: 'number', currency: 'EUR', page: 1 },
        60,
      );
      expect(page?.facets.rarities.map((r) => r.rarity)).toEqual(['Alpha', 'Zeta']);
    }
  });

  it('returns a card with its prints, localizations, images and legalities', async () => {
    const id = await cardId('Adeline, Resplendent Cathar');
    const { card, prints: list } = CardResponseSchema.parse((await get(`/cards/${id}`)).body);
    expect(card).toMatchObject({ game: 'mtg', typeLine: 'Legendary Creature — Human Knight' });
    expect(card.legalities.commander).toBe('legal');
    expect(list).toHaveLength(1);
    expect(list[0]?.set).toEqual({ game: 'mtg', code: 'mid', name: 'Innistrad: Midnight Hunt' });
    expect(list[0]?.localizations.map((l) => l.lang)).toEqual(['de', 'en']);
    expect(list[0]?.externalIds).toMatchObject({
      scryfall: expect.any(String),
      tcgplayer: expect.any(Number),
    });
    expect(list[0]?.externalIds).not.toHaveProperty('scryfall_images');
    // Artist and the game's copyright line for the card page (VB-57).
    expect(list[0]?.artist).toEqual(expect.any(String));
    expect(CardResponseSchema.parse((await get(`/cards/${id}`)).body).copyright).toBe(
      '©Wizards of the Coast LLC',
    );

    // Once VB-57 stored the image in R2, the URL points there.
    await db
      .update(prints)
      .set({ imageKey: 'mtg/mid/1.jpg' })
      .where(eq(prints.id, list[0]?.id ?? ''));
    const after = CardResponseSchema.parse((await get(`/cards/${id}`)).body);
    expect(after.prints[0]?.imageUrl).toBe('https://img.test/mtg/mid/1.jpg');
    // The set page: the English R2 image for en and, until a German one is mirrored, for de too
    // (the app renders only our image host), then the German R2 image once it exists.
    const imageOf = async (query: string) =>
      SetPageResponseSchema.parse((await get(`/sets/mtg/mid${query}`)).body).prints[0]?.imageUrl;
    expect(await imageOf('')).toBe('https://img.test/mtg/mid/1.jpg');
    expect(await imageOf('?lang=de')).toBe('https://img.test/mtg/mid/1.jpg');
    await db
      .update(printLocalizations)
      .set({ imageKey: 'mtg/mid/1.de.jpg' })
      .where(
        and(eq(printLocalizations.printId, list[0]?.id ?? ''), eq(printLocalizations.lang, 'de')),
      );
    expect(await imageOf('?lang=de')).toBe('https://img.test/mtg/mid/1.de.jpg');

    const plains = CardResponseSchema.parse((await get(`/cards/${await cardId('Plains')}`)).body);
    expect(plains.prints.map((p) => p.set.code)).toEqual(['neo', 'mid']);

    expect((await get('/cards/00000000-0000-4000-8000-000000000000')).res.status).toBe(404);
    expect((await get('/cards/not-a-uuid')).res.status).toBe(400);
  });

  it('returns one print with its card', async () => {
    const [p] = await db.select({ id: prints.id }).from(prints).where(eq(prints.number, '385'));
    // Source image URLs of every importer are served as imageUrl only.
    await db
      .update(prints)
      .set({
        externalIds: sql`${prints.externalIds} || '{"image_url":"x","image_url_small":"x","tcgdex_images":"x","tcgdex_marketplace":"x"}'::jsonb`,
      })
      .where(eq(prints.id, p?.id ?? ''));
    const body = PrintResponseSchema.parse((await get(`/prints/${p?.id}`)).body);
    expect(body.print).toMatchObject({ number: '385', variant: '', finishes: ['foil'] });
    for (const key of ['image_url', 'image_url_small', 'tcgdex_images', 'tcgdex_marketplace'])
      expect(body.print.externalIds).not.toHaveProperty(key);
    expect(body.card.name).toBe('Champion of the Perished');
    expect(body.copyright).toBe('©Wizards of the Coast LLC');
  });

  it('shows numbers in the language shown and the card format (VB-97)', async () => {
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'yugioh', code: 'blgg', name: 'Battles of Legend', cardCount: 100 })
      .returning({ id: sets.id });
    const [card] = await db
      .insert(cards)
      .values({ gameId: 'yugioh', name: 'Ghostrick Angel', oracleKey: 'ygo-ghostrick-angel' })
      .returning({ id: cards.id });
    const [print] = await db
      .insert(prints)
      .values({ cardId: card?.id ?? '', setId: set?.id ?? '', number: 'EN024' })
      .returning({ id: prints.id });
    await db.insert(printLocalizations).values([
      { printId: print?.id ?? '', lang: 'en', name: 'Ghostrick Angel' },
      { printId: print?.id ?? '', lang: 'de', name: 'Geistertrick-Engel' },
    ]);

    // The card page: the print as stored, each localization in its own language.
    const { prints: list } = CardResponseSchema.parse((await get(`/cards/${card?.id}`)).body);
    expect(list[0]).toMatchObject({
      number: 'EN024',
      displayNumber: 'EN024',
      displayCode: 'BLGG-EN024',
      cardFormat: 'japanese',
    });
    expect(list[0]?.localizations.map((l) => [l.lang, l.displayNumber, l.displayCode])).toEqual([
      ['de', 'DE024', 'BLGG-DE024'],
      ['en', 'EN024', 'BLGG-EN024'],
    ]);
    // The set page: German where a German localization exists, English otherwise.
    const shown = async (query: string) =>
      SetPageResponseSchema.parse((await get(`/sets/yugioh/blgg${query}`)).body).prints[0];
    expect(await shown('?lang=de')).toMatchObject({
      displayNumber: 'DE024',
      displayCode: 'BLGG-DE024',
      cardFormat: 'japanese',
    });
    expect(await shown('?lang=fr')).toMatchObject({ displayNumber: 'EN024' });
    // Magic keeps its number in every language.
    const adeline = CardResponseSchema.parse(
      (await get(`/cards/${await cardId('Adeline, Resplendent Cathar')}`)).body,
    ).prints[0];
    expect(adeline).toMatchObject({ displayCode: 'MID 1', cardFormat: 'standard' });
    expect(adeline?.localizations.map((l) => l.displayNumber)).toEqual(['1', '1']);
    const mid = SetPageResponseSchema.parse((await get('/sets/mtg/mid?lang=de')).body).prints[0];
    expect(mid).toMatchObject({ number: '1', displayNumber: '1', displayCode: 'MID 1' });
  });

  describe('GET /catalog/search', () => {
    const search = async (query: string) =>
      SearchResponseSchema.parse((await get(`/search?${query}`)).body);
    const names = async (query: string) => (await search(query)).prints.map((p) => p.name);

    it('finds prints by name, the last word as a prefix, with set and game', async () => {
      const page = await search('q=adeline');
      expect(page).toMatchObject({ page: 1, pageSize: 30, total: 1 });
      expect(page.prints[0]).toMatchObject({
        name: 'Adeline, Resplendent Cathar',
        number: '1',
        game: 'mtg',
        setCode: 'mid',
        setName: 'Innistrad: Midnight Hunt',
        finishes: ['normal', 'foil'],
      });
      expect(await names('q=adel')).toEqual(['Adeline, Resplendent Cathar']);
      expect(await names('q=resplendent cath')).toEqual(['Adeline, Resplendent Cathar']);
      // websearch syntax: an exact phrase and a negated word are not prefixes.
      expect(await names('q="adel"')).toEqual([]);
      expect(await names('q=cathar -commando')).not.toContain('Cathar Commando');
    });

    it('matches the localized names and shows them in ?lang=, English otherwise', async () => {
      expect(await names('q=strahlende')).toEqual(['Adeline, Resplendent Cathar']);
      expect(await names('q=strahlende&lang=de')).toEqual(['Adeline, strahlende Katharerin']);
      // Without a German name the English one shows.
      expect(await names('q=commando&lang=de')).toEqual(['Cathar Commando']);
    });

    it('ranks by ts_rank with matches in the name first', async () => {
      // A match in the name ranks above one in the text only: Ambitious Farmhand's text
      // mentions a Plains card.
      expect(await names('q=plains')).toEqual([
        'Plains',
        'Plains',
        'Ambitious Farmhand // Seasoned Cathar',
      ]);
      const cathars = await names('q=cathar');
      const named = cathars.filter((n) => /cathar/i.test(n));
      expect(cathars.slice(0, named.length)).toEqual(named);
      expect(named.length).toBeGreaterThan(4);
    });

    it('filters exactly by game, set, rarity and finish', async () => {
      expect((await search('q=plains&set=neo')).prints.map((p) => p.setCode)).toEqual(['neo']);
      expect((await search('q=plains&set=NEO')).total).toBe(1);
      expect((await search('q=plains&game=pokemon')).total).toBe(0);
      expect((await search('q=plains&game=mtg')).total).toBe(3);
      expect((await names('q=cathar&rarity=rare')).sort()).toEqual([
        'Adeline, Resplendent Cathar',
        'Brutal Cathar // Moonrage Brute',
      ]);
      expect(await names('q=champion&finish=normal')).toEqual([]);
      expect(await names('q=champion&finish=foil')).toEqual(['Champion of the Perished']);
    });

    it('pages by the given size', async () => {
      const second = await store.search(
        { q: 'cathar', lang: 'en', names: 'all', currency: 'EUR', page: 2 },
        3,
      );
      const first = await store.search(
        { q: 'cathar', lang: 'en', names: 'all', currency: 'EUR', page: 1 },
        3,
      );
      expect(first.prints).toHaveLength(3);
      expect(second.page).toBe(2);
      expect(second.total).toBe(first.total);
      expect(second.prints.map((p) => p.id)).not.toContain(first.prints[0]?.id);
      expect(await search('q=cathar&page=9')).toMatchObject({ page: 9, prints: [] });
    });

    it('validates q and the filters', async () => {
      for (const query of ['', 'q=a', `q=${'x'.repeat(81)}`, 'q=ab&game=chess', 'q=ab&page=0'])
        expect((await get(`/search?${query}`)).res.status, query).toBe(400);
      expect((await get('/search?q=%20%20ab%20')).res.status).toBe(200);
    });

    it('is cached like the catalog', async () => {
      const res = await app.request('/catalog/search?q=adeline');
      expect(res.headers.get('Cache-Control')).toBe(
        'public, max-age=60, s-maxage=600, stale-while-revalidate=60',
      );
      expect(res.headers.get('Cache-Tag')).toBe('catalog,prices');
      expect(res.headers.get('ETag')).toMatch(/^"v\d+-[0-9a-f]{32}"$/);
    });

    it('uses the GIN indexes, no sequential scan, with ~200 cards', async () => {
      const [set] = await db.select({ id: sets.id }).from(sets).where(eq(sets.code, 'mid'));
      const many = Array.from({ length: 200 }, (_, i) => ({
        gameId: 'mtg',
        name: `Synthetic Wanderer ${i}`,
        oracleKey: `synthetic-${i}`,
        typeLine: 'Creature',
        text: `Filler text number ${i}.`,
      }));
      // The store's own queries, run as EXPLAIN. At this size a sequential scan (or a full scan
      // of a primary key) is cheaper and the planner rightly takes it, so both are switched off:
      // when the query has an index path the plan uses it, when it has none (an OR across both
      // tables, a wrapped column) the plan still shows the Seq Scan. The synthetic rows live in a
      // transaction that is rolled back, so later tests see the fixture only.
      const plans: Record<string, unknown[]> = {};
      const rollback = new Error('rollback');
      await db
        .transaction(async (tx) => {
          const inserted = await tx.insert(cards).values(many).returning({ id: cards.id });
          const synthetic = await tx
            .insert(prints)
            .values(
              inserted.map((c, i) => ({ cardId: c.id, setId: set?.id ?? '', number: `s${i}` })),
            )
            .returning({ id: prints.id });
          await tx.insert(printLocalizations).values(
            synthetic.flatMap((p, i) => [
              { printId: p.id, lang: 'en', name: `Synthetic Wanderer ${i}` },
              { printId: p.id, lang: 'de', name: `Synthetischer Wanderer ${i}` },
            ]),
          );
          await tx.execute(sql`analyze cards, prints, print_localizations`);
          await tx.execute(sql`set local enable_seqscan = off`);
          await tx.execute(sql`set local enable_indexscan = off`);
          let into: unknown[] = [];
          const explaining = new Proxy(tx as unknown as NodePgDatabase, {
            get: (target, key) =>
              key === 'execute'
                ? async (query: ReturnType<typeof sql>) => {
                    const r = await target.execute(sql`explain (format json) ${query}`);
                    into.push(r.rows[0]?.['QUERY PLAN']);
                    return { rows: [] };
                  }
                : Reflect.get(target, key),
          });
          const explained = new DrizzleCardStore(db, { catalogDb: explaining });
          for (const names of ['all', 'de']) {
            const query = { q: 'adeline', lang: 'de', names, game: 'mtg' as const };
            into = plans[`search ${names}`] = [];
            await explained.search({ ...query, currency: 'EUR', page: 1 }, 30);
            into = plans[`suggest ${names}`] = [];
            await explained.suggest(query, 8);
          }
          throw rollback;
        })
        .catch((e: unknown) => {
          if (e !== rollback) throw e;
        });
      /** The relations each plan reads by Seq Scan and the indexes it reads. */
      const reads = (plan: unknown) => {
        const scans: string[] = [];
        const indexes: string[] = [];
        const walk = (node: unknown): void => {
          if (Array.isArray(node)) return node.forEach(walk);
          if (!node || typeof node !== 'object') return;
          const n = node as Record<string, unknown>;
          if (n['Node Type'] === 'Seq Scan') scans.push(String(n['Relation Name']));
          if (typeof n['Index Name'] === 'string') indexes.push(n['Index Name']);
          Object.values(n).forEach(walk);
        };
        walk(plan);
        return { scans, indexes };
      };
      expect(Object.values(plans).map((p) => p.length)).toEqual([2, 1, 2, 1]);
      for (const [name, plan] of Object.entries(plans)) {
        const { scans } = reads(plan);
        expect(scans, name).not.toContain('cards');
        expect(scans, name).not.toContain('print_localizations');
      }
      // The name matches in localizations use their GIN indexes with a language as well (the
      // typeahead may read the cards of a game by cards_game_id_idx).
      expect(reads(plans['search all']).indexes).toEqual(
        expect.arrayContaining(['cards_search_idx', 'print_localizations_search_idx']),
      );
      expect(reads(plans['search de']).indexes).toContain('print_localizations_search_idx');
      expect(reads(plans['search de']).indexes).not.toContain('cards_search_idx');
      expect(reads(plans['suggest all']).indexes).toContain('print_localizations_name_trgm_idx');
      expect(reads(plans['suggest de']).indexes).toContain('print_localizations_name_trgm_idx');
      expect(reads(plans['suggest de']).indexes).not.toContain('cards_name_trgm_idx');
    });
  });

  it('answers with cache headers, an ETag per catalog_version and 304 on a match', async () => {
    const first = await app.request('/catalog/sets/mtg/mid', {
      headers: { Origin: 'https://app.example.test' },
    });
    // The edge keys on Vary: an entry filled without Origin (curl, SSR) has no ACAO for the app.
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    expect(first.headers.get('Vary')).toMatch(/\bOrigin\b/);
    expect(first.headers.get('Cache-Control')).toBe(
      'public, max-age=60, s-maxage=600, stale-while-revalidate=60',
    );
    // Workers Caching reads its own header (s-maxage would switch off stale-while-revalidate).
    expect(first.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'public, max-age=600, stale-while-revalidate=600',
    );
    expect(first.headers.get('Cache-Tag')).toBe('catalog,prices');
    const etag = first.headers.get('ETag') ?? '';
    expect(etag).toMatch(/^"v\d+-[0-9a-f]{32}"$/);

    const again = await app.request('/catalog/sets/mtg/mid', {
      headers: { 'If-None-Match': `W/${etag}` },
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('ETag')).toBe(etag);

    await db
      .update(appMeta)
      .set({ value: sql`(${appMeta.value}::int + 1)::text` })
      .where(eq(appMeta.key, 'catalog_version'));
    const bumped = await app.request('/catalog/sets/mtg/mid', {
      headers: { 'If-None-Match': etag },
    });
    expect(bumped.status).toBe(200);
    expect(bumped.headers.get('ETag')).not.toBe(etag);

    const missing = await app.request('/catalog/sets/mtg/xyz');
    expect(missing.headers.get('Cache-Control')).toBe('no-store');
    expect(missing.headers.get('Cache-Tag')).toBeNull();
  });

  it('keeps an unvalidated ?game= out of the Cache-Tag header', async () => {
    // A newline in a header value throws after the handler ran; the tags come from the path only.
    const res = await app.request(`/catalog/cards/${await cardId('Plains')}?game=x%0Ay`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Tag')).toBe('catalog,prices');
  });
});
