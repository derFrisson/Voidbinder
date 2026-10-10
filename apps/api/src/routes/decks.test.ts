import { randomUUID } from 'node:crypto';
import { DeckDetailSchema, DecksResponseSchema } from '@voidbinder/shared/api';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { MailMessage } from '../auth/mail';
import {
  cards,
  deckEntries,
  decks,
  printLocalizations,
  prints,
  sets,
  syncDeletions,
} from '../db/schema';
import { runScryfallImport } from '../import/scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../import/scryfall/test-fixtures';
import type { Db } from '../import/scryfall/write';
import { DrizzleCardStore } from '../platform/cloudflare/drizzle-card-store';
import { DrizzleCollectionStore } from '../platform/cloudflare/drizzle-collection-store';
import { DrizzleDeckStore } from '../platform/cloudflare/drizzle-deck-store';
import { databaseUrl, freshDatabase, testApp, testDeps } from '../test-helpers';

it('needs a session', async () => {
  const res = await testApp().request('/decks');
  expect(res.status).toBe(401);
});

// The deck routes against Postgres, with the Scryfall fixtures (Magic, Cardmarket prices) as
// catalog and two real users (sign-up, verification, bearer token), as in collection.test.ts.
describe.skipIf(!databaseUrl)('deck routes (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const mails: MailMessage[] = [];
  const deps = testDeps(mails);
  const app = createApp({
    ...deps,
    openPlatform: () => ({
      cardStore: new DrizzleCardStore(db),
      collectionStore: new DrizzleCollectionStore(db),
      deckStore: new DrizzleDeckStore(db),
      blobStore: {} as never,
      jobQueue: {} as never,
      db,
      close: async () => undefined,
    }),
  });

  let print: (code: string, number: string) => Promise<{ printId: string; cardId: string }>;
  let ash: ReturnType<typeof as>;
  let misty: ReturnType<typeof as>;

  /** Requests as one signed-in user (bearer token). */
  function as(token: string) {
    return (path: string, init: { method?: string; body?: unknown } = {}) => {
      const headers = new Headers({ Authorization: `Bearer ${token}` });
      if (init.body !== undefined) headers.set('Content-Type', 'application/json');
      return app.request(path, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers,
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      });
    };
  }

  async function signUp(): Promise<string> {
    const email = `${randomUUID()}@example.test`;
    const password = 'correct horse battery';
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: deps.appUrl,
          'cf-connecting-ip': `10.0.1.${Math.floor(Math.random() * 250)}`,
        },
        body: JSON.stringify(body),
      });
    await post('/auth/sign-up/email', { name: 'Ash', email, password });
    const mail = mails.findLast((m) => m.to === email);
    const token = /verify\?token=([^\s"&]+)/.exec(mail?.text ?? '')?.[1] ?? '';
    await app.request(`/auth/verify-email?token=${token}`);
    const res = await post('/auth/sign-in/email', { email, password });
    expect(res.status).toBe(200);
    return res.headers.get('set-auth-token') ?? '';
  }

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_n, fn) => fn(),
      {
        env: 'local',
        date: '2026-10-09',
        languages: ['en'],
        pricesObservedAt: '2026-10-09T03:00:00.000Z',
      },
    );
    print = async (code, number) => {
      const [row] = await db
        .select({ printId: prints.id, cardId: prints.cardId })
        .from(prints)
        .innerJoin(sets, eq(sets.id, prints.setId))
        .where(and(eq(sets.code, code), eq(prints.number, number)));
      if (!row) throw new Error(`print ${code} ${number} missing`);
      return row;
    };
    ash = as(await signUp());
    misty = as(await signUp());
  });
  afterAll(() => drop());

  const detail = async (res: Response | Promise<Response>) =>
    DeckDetailSchema.parse(await (await res).json());
  const newDeck = (body: object) => detail(ash('/decks', { body }));

  it('creates decks idempotently on the client id, with the game’s first format by default', async () => {
    const id = randomUUID();
    const first = await ash('/decks', { body: { id, game: 'mtg', name: 'Weiß' } });
    expect(first.status).toBe(201);
    const deck = await detail(first);
    expect(deck).toMatchObject({ id, game: 'mtg', name: 'Weiß', format: 'standard', entries: [] });
    expect(deck.analysis).toMatchObject({
      valid: false,
      problems: [{ code: 'too_few', params: { zone: 'main', count: 0, min: 60 } }],
      rules: { copies: 4 },
      missing: [],
      collectionCards: 0,
    });
    expect((await ash('/decks', { body: { id, game: 'mtg', name: 'Again' } })).status).toBe(201);
    expect((await db.select().from(decks).where(eq(decks.id, id)))[0]?.name).toBe('Weiß');
    // Another user's id is taken; nothing is written for them.
    expect((await misty('/decks', { body: { id, game: 'mtg', name: 'Mine' } })).status).toBe(409);
  });

  it('refuses a format the game has not got', async () => {
    expect(
      (await ash('/decks', { body: { game: 'yugioh', name: 'x', format: 'modern' } })).status,
    ).toBe(400);
    expect((await ash('/decks', { body: { game: 'onepiece', name: 'x' } })).status).toBe(400);
    const deck = await newDeck({ game: 'yugioh', name: 'Nebel' });
    expect(deck.format).toBe('advanced');
    expect(
      (await ash(`/decks/${deck.id}`, { method: 'PATCH', body: { format: 'modern' } })).status,
    ).toBe(400);
  });

  it('replaces the entries, validates them and runs the rules on the collection and prices', async () => {
    const deck = await newDeck({ game: 'mtg', name: 'Adeline', format: 'modern' });
    const [adeline, plainsMid, plainsNeo, champion] = await Promise.all([
      print('mid', '1'),
      print('mid', '268'),
      print('neo', '293'),
      print('mid', '385'),
    ]);
    const put = (entries: unknown[]) =>
      ash(`/decks/${deck.id}/entries`, { method: 'PUT', body: { entries } });

    // Ash owns one Adeline and three Plains (of the expensive print: any print counts).
    await ash('/collection/entries', {
      body: [{ printId: adeline.printId }, { printId: plainsNeo.printId, quantity: 3 }],
    });

    const res = await put([
      { cardId: adeline.cardId, zone: 'main', quantity: 5 },
      { cardId: plainsMid.cardId, printId: plainsNeo.printId, zone: 'main', quantity: 20 },
      { cardId: champion.cardId, zone: 'side', quantity: 1 },
    ]);
    expect(res.status).toBe(200);
    const d = await detail(res);
    expect(d.analysis.counts).toEqual({ main: 25, side: 1 });
    expect(d.analysis.problems.map((p) => p.code)).toEqual(['too_few', 'too_many_copies']);
    expect(d.analysis.collectionCards).toBe(4);

    const adelineEntry = d.entries.find((e) => e.cardId === adeline.cardId);
    expect(adelineEntry).toMatchObject({
      name: 'Adeline, Resplendent Cathar',
      group: 'creature',
      owned: 1,
      price: { source: 'cardmarket', currency: 'EUR', unitCents: 334 },
    });
    // The preferred print is shown with its own price.
    expect(d.entries.find((e) => e.cardId === plainsMid.cardId)).toMatchObject({
      printId: plainsNeo.printId,
      print: { id: plainsNeo.printId, setCode: 'neo', number: '293' },
      owned: 3,
      price: { unitCents: 294 },
    });

    // Missing copies are priced at the cheapest print (Plains of MID, 0,26 €), in the deck's order.
    expect(d.analysis.missing).toEqual([
      expect.objectContaining({ cardId: adeline.cardId, needed: 5, owned: 1, unitPriceCents: 334 }),
      expect.objectContaining({ cardId: champion.cardId, needed: 1, owned: 0, unitPriceCents: 76 }),
      expect.objectContaining({
        cardId: plainsMid.cardId,
        printId: plainsMid.printId,
        setCode: 'mid',
        number: '268',
        needed: 20,
        owned: 3,
        unitPriceCents: 26,
        currency: 'EUR',
        source: 'cardmarket',
        observedAt: '2026-10-09T03:00:00.000Z',
      }),
    ]);
    expect(d.analysis.missingValue).toEqual({
      cards: 22,
      entries: 3,
      totals: [
        {
          source: 'cardmarket',
          currency: 'EUR',
          cents: 4 * 334 + 76 + 17 * 26,
          observedAt: '2026-10-09T03:00:00.000Z',
        },
      ],
      unpriced: 0,
    });

    // The list carries the verdict and the value.
    const list = DecksResponseSchema.parse(await (await ash('/decks')).json());
    expect(list.decks.find((x) => x.id === deck.id)).toMatchObject({
      valid: false,
      problems: 2,
      cards: 25,
      missing: 22,
      value: { totals: [{ cents: 5 * 334 + 20 * 294 + 76 }] },
    });

    // Validation: a zone the game has not got, a card twice in a zone, an unknown card, a print
    // of another card, a card of another game.
    const bad = async (entries: unknown[]) => (await put(entries)).status;
    expect(await bad([{ cardId: adeline.cardId, zone: 'extra', quantity: 1 }])).toBe(400);
    expect(
      await bad([
        { cardId: adeline.cardId, zone: 'main', quantity: 1 },
        { cardId: adeline.cardId, zone: 'main', quantity: 2 },
      ]),
    ).toBe(400);
    expect(await bad([{ cardId: adeline.cardId, zone: 'main', quantity: 0 }])).toBe(400);
    expect(await bad([{ cardId: randomUUID(), zone: 'main', quantity: 1 }])).toBe(404);
    expect(
      await bad([
        { cardId: adeline.cardId, printId: plainsMid.printId, zone: 'main', quantity: 1 },
      ]),
    ).toBe(404);
    const ygo = await newDeck({ game: 'yugioh', name: 'Wrong game' });
    expect(
      (
        await ash(`/decks/${ygo.id}/entries`, {
          method: 'PUT',
          body: { entries: [{ cardId: adeline.cardId, zone: 'main', quantity: 1 }] },
        })
      ).status,
    ).toBe(404);
    // A refused list leaves the stored one alone.
    expect((await detail(ash(`/decks/${deck.id}`))).entries).toHaveLength(3);

    // An empty list clears the deck.
    expect((await detail(put([]))).entries).toEqual([]);
  });

  it('reads Pokémon legality per name and gives a missing card without a price a print', async () => {
    // Nest Ball of an old set (rotated out) and its legal reprint: TCGdex has a card for each.
    const [oldSet, newSet] = await db
      .insert(sets)
      .values([
        { gameId: 'pokemon', code: 'pk-old', name: 'Old' },
        { gameId: 'pokemon', code: 'pk-new', name: 'New' },
      ])
      .returning();
    const nestBall = (oracleKey: string, standard: string) => ({
      gameId: 'pokemon',
      name: 'Nest Ball',
      oracleKey,
      typeLine: 'Trainer - Item',
      attributes: { category: 'Trainer' },
      legalities: { standard, expanded: 'legal' },
    });
    const [oldCard, newCard] = await db
      .insert(cards)
      .values([nestBall('old-nest-ball', 'not_legal'), nestBall('new-nest-ball', 'legal')])
      .returning();
    if (!oldSet || !newSet || !oldCard || !newCard) throw new Error('insert failed');
    const [oldPrint] = await db
      .insert(prints)
      .values([
        { cardId: oldCard.id, setId: oldSet.id, number: '1' },
        { cardId: newCard.id, setId: newSet.id, number: '1' },
      ])
      .returning();

    const deck = await newDeck({ game: 'pokemon', name: 'Nest', format: 'standard' });
    const d = await detail(
      ash(`/decks/${deck.id}/entries`, {
        method: 'PUT',
        body: { entries: [{ cardId: oldCard.id, zone: 'main', quantity: 4 }] },
      }),
    );
    // No `not_legal`: the reprint is legal in Standard.
    expect(d.analysis.problems.map((p) => p.code)).toEqual(['wrong_size', 'no_basic_pokemon']);

    // A Pokémon that only shares the name (other attacks) does not borrow the legality.
    const pika = (oracleKey: string, text: string, standard: string) => ({
      gameId: 'pokemon',
      name: 'Pikachu',
      oracleKey,
      text,
      typeLine: 'Pokémon - Basic',
      attributes: { category: 'Pokémon', stage: 'Basic' },
      legalities: { standard, expanded: 'legal' },
    });
    const [oldPika, newPika] = await db
      .insert(cards)
      .values([
        pika('old-pika', 'Thunder Jolt 30', 'not_legal'),
        pika('new-pika', 'Gnaw 10', 'legal'),
      ])
      .returning();
    if (!oldPika || !newPika) throw new Error('insert failed');
    await db.insert(prints).values([
      { cardId: oldPika.id, setId: oldSet.id, number: '2' },
      { cardId: newPika.id, setId: newSet.id, number: '2' },
    ]);
    const d2 = await detail(
      ash(`/decks/${deck.id}/entries`, {
        method: 'PUT',
        body: { entries: [{ cardId: oldPika.id, zone: 'main', quantity: 4 }] },
      }),
    );
    expect(d2.analysis.problems.map((p) => p.code)).toContain('not_legal');
    expect(d.entries[0]).toMatchObject({ limit: 4 });
    // No print has a price: the wish still gets one (the card's own).
    expect(d.analysis.missing).toEqual([
      expect.objectContaining({
        cardId: oldCard.id,
        englishName: 'Nest Ball',
        printId: oldPrint?.id,
        setCode: 'pk-old',
        needed: 4,
        unitPriceCents: null,
      }),
    ]);
  });

  it('checks a commander deck’s colour identity', async () => {
    const deck = await newDeck({ game: 'mtg', name: 'Cmdr', format: 'commander' });
    const [adeline, champion] = await Promise.all([print('mid', '1'), print('mid', '385')]);
    const d = await detail(
      ash(`/decks/${deck.id}/entries`, {
        method: 'PUT',
        body: {
          entries: [
            { cardId: adeline.cardId, zone: 'commander', quantity: 1 },
            { cardId: champion.cardId, zone: 'main', quantity: 1 },
          ],
        },
      }),
    );
    expect(d.analysis.problems.map((p) => p.code)).toEqual(['wrong_size', 'colour_identity']);
  });

  it('answers 404 for another user’s deck and deletes a deck with its list, logging the deck only', async () => {
    const deck = await newDeck({ game: 'pokemon', name: 'Pika' });
    expect(deck.format).toBe('standard');
    expect((await misty(`/decks/${deck.id}`)).status).toBe(404);
    expect(
      (await misty(`/decks/${deck.id}`, { method: 'PATCH', body: { name: 'Mine' } })).status,
    ).toBe(404);
    expect(
      (await misty(`/decks/${deck.id}/entries`, { method: 'PUT', body: { entries: [] } })).status,
    ).toBe(404);
    expect((await misty(`/decks/${deck.id}`, { method: 'DELETE' })).status).toBe(404);
    const theirs = DecksResponseSchema.parse(await (await misty('/decks')).json());
    expect(theirs.decks.map((d) => d.id)).not.toContain(deck.id);

    const renamed = await detail(
      ash(`/decks/${deck.id}`, { method: 'PATCH', body: { name: 'Pikachu', description: 'ex' } }),
    );
    expect(renamed).toMatchObject({ name: 'Pikachu', description: 'ex' });
    expect(Date.parse(renamed.updatedAt)).toBeGreaterThanOrEqual(Date.parse(deck.updatedAt));

    expect((await ash(`/decks/${deck.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.select().from(decks).where(eq(decks.id, deck.id))).toEqual([]);
    expect((await ash(`/decks/${deck.id}`)).status).toBe(404);
    expect((await ash(`/decks/${deck.id}`, { method: 'DELETE' })).status).toBe(404);
    const mine = DecksResponseSchema.parse(await (await ash('/decks')).json());
    expect(mine.decks.map((d) => d.id)).not.toContain(deck.id);
    expect((await ash('/decks/not-a-uuid')).status).toBe(400);

    // A deck with a list: the list goes with it, only the deck is logged.
    const adeline = await print('mid', '1');
    const full = await newDeck({ game: 'mtg', name: 'Gone' });
    await ash(`/decks/${full.id}/entries`, {
      method: 'PUT',
      body: { entries: [{ cardId: adeline.cardId, zone: 'main', quantity: 4 }] },
    });
    expect(await db.select().from(deckEntries).where(eq(deckEntries.deckId, full.id))).toHaveLength(
      1,
    );
    expect((await ash(`/decks/${full.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.select().from(deckEntries).where(eq(deckEntries.deckId, full.id))).toEqual([]);
    expect(
      await db
        .select({ table: syncDeletions.table, id: syncDeletions.id })
        .from(syncDeletions)
        .where(eq(syncDeletions.id, full.id)),
    ).toEqual([{ table: 'decks', id: full.id }]);
    // Written again under its id (a retried POST): the log entry goes.
    await newDeck({ id: full.id, game: 'mtg', name: 'Back' });
    expect(await db.select().from(syncDeletions).where(eq(syncDeletions.id, full.id))).toEqual([]);
  });

  it('shows the prints’ numbers in the user’s language (VB-97)', async () => {
    // Ash reads in German (the profile default); EN024 has a German localization, EN025 not.
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'yugioh', code: 'blgg', name: 'Battles of Legend', cardCount: 100 })
      .returning();
    const [angel, ghost] = await db
      .insert(cards)
      .values([
        { gameId: 'yugioh', name: 'Ghostrick Angel', oracleKey: 'ygo-angel' },
        { gameId: 'yugioh', name: 'Ghostrick Ghoul', oracleKey: 'ygo-ghoul' },
      ])
      .returning();
    if (!set || !angel || !ghost) throw new Error('insert failed');
    const [angelPrint] = await db
      .insert(prints)
      .values([
        { cardId: angel.id, setId: set.id, number: 'EN024' },
        { cardId: ghost.id, setId: set.id, number: 'EN025' },
      ])
      .returning();
    await db
      .insert(printLocalizations)
      .values({ printId: angelPrint?.id ?? '', lang: 'de', name: 'Geistertrick-Engel' });
    const deck = await newDeck({ game: 'yugioh', name: 'Geister' });
    const d = await detail(
      ash(`/decks/${deck.id}/entries`, {
        method: 'PUT',
        body: {
          entries: [
            { cardId: angel.id, zone: 'main', quantity: 1 },
            { cardId: ghost.id, zone: 'main', quantity: 1 },
          ],
        },
      }),
    );
    expect(d.entries.map((e) => [e.print?.displayNumber, e.print?.displayCode])).toEqual([
      ['DE024', 'BLGG-DE024'],
      ['EN025', 'BLGG-EN025'],
    ]);
    expect(d.entries.every((e) => e.print?.cardFormat === 'japanese')).toBe(true);
    expect(d.analysis.missing.map((m) => m.displayNumber)).toEqual(['DE024', 'EN025']);
  });
});
