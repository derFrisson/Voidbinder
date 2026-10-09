import {
  CardResponseSchema,
  GamesResponseSchema,
  PrintResponseSchema,
  SetPageResponseSchema,
  SetsResponseSchema,
} from '@voidbinder/shared/api';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, cards, printLocalizations, prints } from '../db/schema';
import { runScryfallImport } from '../import/scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../import/scryfall/test-fixtures';
import type { Db } from '../import/scryfall/write';
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

  it('lists the games with their set counts', async () => {
    const { body } = await get('/games');
    expect(GamesResponseSchema.parse(body).games).toEqual([
      { id: 'mtg', name: 'Magic: The Gathering', setCount: 2 },
      { id: 'pokemon', name: 'Pokémon', setCount: 0 },
      { id: 'yugioh', name: 'Yu-Gi-Oh!', setCount: 0 },
      { id: 'onepiece', name: 'One Piece Card Game', setCount: 0 },
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

    const beyond = SetPageResponseSchema.parse((await get('/sets/mtg/mid?page=2')).body);
    expect(beyond).toMatchObject({ page: 2, total: 22, prints: [] });
    const query = { lang: 'en', sort: 'number', page: 2 } as const;
    const second = await store.getSetPage('mtg', 'mid', query, 5);
    expect(second?.prints.map((p) => p.number)).toEqual(['6', '7', '8', '9', '10']);

    expect((await get('/sets/mtg/xyz')).res.status).toBe(404);
    expect((await get('/sets/mtg/mid?sort=price')).res.status).toBe(400);
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
    // The set page: the English R2 image for en, the German source image over it for de, and
    // the German R2 image once it exists.
    const imageOf = async (query: string) =>
      SetPageResponseSchema.parse((await get(`/sets/mtg/mid${query}`)).body).prints[0]?.imageUrl;
    expect(await imageOf('')).toBe('https://img.test/mtg/mid/1.jpg');
    expect(await imageOf('?lang=de')).toMatch(/\/10630111-537c-468e-b270-562ee7bdfb29\.jpg/);
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

  it('answers with cache headers, an ETag per catalog_version and 304 on a match', async () => {
    const first = await app.request('/catalog/sets/mtg/mid');
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=600');
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
  });
});
