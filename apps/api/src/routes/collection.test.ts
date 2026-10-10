import { randomUUID } from 'node:crypto';
import {
  BinderSchema,
  BindersResponseSchema,
  CollectionEntrySchema,
  CollectionSummarySchema,
  CreateEntriesResponseSchema,
  CreateWishesResponseSchema,
  EntriesResponseSchema,
  OwnedResponseSchema,
  WishlistResponseSchema,
} from '@voidbinder/shared/api';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { MailMessage } from '../auth/mail';
import { binders, collectionEntries, prints, sets, wishlistEntries } from '../db/schema';
import { runScryfallImport } from '../import/scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../import/scryfall/test-fixtures';
import type { Db } from '../import/scryfall/write';
import { DrizzleCardStore } from '../platform/cloudflare/drizzle-card-store';
import { DrizzleCollectionStore } from '../platform/cloudflare/drizzle-collection-store';
import { databaseUrl, freshDatabase, testDeps } from '../test-helpers';
import { csvLine } from './collection';

describe('csvLine', () => {
  it('quotes fields with commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvLine(['Fire // Ice', 'mh2', 1])).toBe('Fire // Ice,mh2,1\r\n');
    expect(csvLine(['Borrowing 100,000 Arrows', 'He said "hi"', 'a\nb'])).toBe(
      '"Borrowing 100,000 Arrows","He said ""hi""","a\nb"\r\n',
    );
  });
});

// The collection routes against Postgres, with the Scryfall fixtures and their prices as catalog
// and two real users (sign-up, verification, bearer token).
describe.skipIf(!databaseUrl)('collection routes (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const mails: MailMessage[] = [];
  const deps = testDeps(mails);
  const app = createApp({
    ...deps,
    openPlatform: () => ({
      cardStore: new DrizzleCardStore(db),
      collectionStore: new DrizzleCollectionStore(db),
      blobStore: {} as never,
      jobQueue: {} as never,
      db,
      close: async () => undefined,
    }),
  });

  let printId: (code: string, number: string) => Promise<string>;
  let ash: ReturnType<typeof as>;
  let misty: ReturnType<typeof as>;

  /** Requests as one signed-in user (bearer token). */
  function as(token: string) {
    return (path: string, init: { method?: string; body?: unknown } = {}) => {
      const headers = new Headers({ Authorization: `Bearer ${token}` });
      if (init.body !== undefined) headers.set('Content-Type', 'application/json');
      return app.request(`/collection${path}`, {
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
          'cf-connecting-ip': `10.0.0.${Math.floor(Math.random() * 250)}`,
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
    printId = async (code, number) => {
      const [row] = await db
        .select({ id: prints.id })
        .from(prints)
        .innerJoin(sets, eq(sets.id, prints.setId))
        .where(and(eq(sets.code, code), eq(prints.number, number)));
      if (!row) throw new Error(`print ${code} ${number} missing`);
      return row.id;
    };
    ash = as(await signUp());
    misty = as(await signUp());
  });
  afterAll(() => drop());

  const json = async (res: Response | Promise<Response>) => (await res).json() as Promise<unknown>;

  it('needs a session', async () => {
    const res = await app.request('/collection/entries');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('creates, renames, orders and tombstones binders; names are unique among live ones', async () => {
    const a = BinderSchema.parse(await json(ash('/binders', { body: { name: 'Foils' } })));
    const clientId = randomUUID();
    const b = BinderSchema.parse(
      await json(ash('/binders', { body: { id: clientId, name: 'Bulk', game: 'mtg' } })),
    );
    expect(b).toMatchObject({ id: clientId, game: 'mtg', position: a.position + 1 });
    expect((await ash('/binders', { body: { name: 'Foils' } })).status).toBe(409);

    const renamed = await ash(`/binders/${a.id}`, { method: 'PATCH', body: { name: 'Shiny' } });
    expect(BinderSchema.parse(await renamed.json()).name).toBe('Shiny');

    const ordered = BindersResponseSchema.parse(
      await json(ash('/binders/order', { method: 'PUT', body: { ids: [b.id, a.id] } })),
    );
    expect(ordered.binders.map((x) => [x.id, x.position])).toEqual([
      [b.id, 0],
      [a.id, 1],
    ]);

    // Deleting leaves a tombstone; the name is free again and the binder's entries move out.
    const adeline = await printId('mid', '1');
    const [entry] = CreateEntriesResponseSchema.parse(
      await json(ash('/entries', { body: { printId: adeline, binderId: b.id } })),
    ).entries;
    expect((await ash(`/binders/${b.id}`, { method: 'DELETE' })).status).toBe(204);
    const [row] = await db.select().from(binders).where(eq(binders.id, b.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    const [moved] = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.id, entry?.id ?? ''));
    expect(moved?.binderId).toBeNull();
    const list = BindersResponseSchema.parse(await json(ash('/binders')));
    expect(list.binders.map((x) => x.id)).not.toContain(b.id);
    expect((await ash('/binders', { body: { name: 'Bulk' } })).status).toBe(201);
    expect((await ash(`/binders/${b.id}`, { method: 'DELETE' })).status).toBe(404);
    await ash(`/entries/${entry?.id}`, { method: 'DELETE' });
  });

  it('adds entries idempotently on the client id, with the price of their finish and condition', async () => {
    const adeline = await printId('mid', '1');
    const id = randomUUID();
    const body = { id, printId: adeline, quantity: 2, finish: 'foil', condition: 'EX' };
    const first = await ash('/entries', { body });
    expect(first.status).toBe(201);
    const again = await ash('/entries', { body: [body] });
    expect(again.status).toBe(201);
    const [entry] = CreateEntriesResponseSchema.parse(await again.json()).entries;
    expect(entry).toMatchObject({
      id,
      quantity: 2,
      language: 'en',
      condition: 'EX',
      finish: 'foil',
      print: { id: adeline, game: 'mtg', setCode: 'mid', number: '1' },
      // Ash's currency is EUR: Cardmarket's foil price, times EX's factor (0.85).
      price: {
        source: 'cardmarket',
        finish: 'foil',
        currency: 'EUR',
        marketCents: 523,
        factor: 0.85,
        unitCents: 445,
        observedAt: '2026-10-09T03:00:00.000Z',
      },
    });
    const rows = await db.select().from(collectionEntries).where(eq(collectionEntries.id, id));
    expect(rows).toHaveLength(1);

    expect((await ash('/entries', { body: { printId: randomUUID() } })).status).toBe(404);
    expect((await ash('/entries', { body: { printId: adeline, quantity: 0 } })).status).toBe(400);
    expect((await ash('/entries', { body: { printId: adeline, condition: 'XX' } })).status).toBe(
      400,
    );
    await ash(`/entries/${id}`, { method: 'DELETE' });
  });

  it('lists with filters and pages, edits and tombstones entries', async () => {
    const [adeline, gavony, neo] = await Promise.all([
      printId('mid', '1'),
      printId('mid', '20'),
      printId('neo', '1'),
    ]);
    const binder = BinderSchema.parse(await json(ash('/binders', { body: { name: 'Deck' } })));
    const { entries } = CreateEntriesResponseSchema.parse(
      await json(
        ash('/entries', {
          body: [
            { printId: adeline, language: 'de', binderId: binder.id },
            { printId: gavony, condition: 'PO' },
            { printId: neo, quantity: 3 },
          ],
        }),
      ),
    );
    const list = async (query = '') =>
      EntriesResponseSchema.parse(await json(ash(`/entries${query}`)));
    const all = await list();
    expect(all.total).toBe(3);
    expect(all.pageSize).toBe(50);
    // Newest first; created together, so by id.
    expect(new Set(all.entries.map((e) => e.id))).toEqual(new Set(entries.map((e) => e.id)));
    expect((await list(`?binder=${binder.id}`)).entries.map((e) => e.printId)).toEqual([adeline]);
    expect((await list('?binder=none')).total).toBe(2);
    expect((await list('?set=NEO')).entries.map((e) => e.printId)).toEqual([neo]);
    expect((await list('?condition=PO')).entries.map((e) => e.printId)).toEqual([gavony]);
    expect((await list('?lang=de')).entries.map((e) => e.printId)).toEqual([adeline]);
    expect((await list('?game=pokemon')).total).toBe(0);
    const adelineName = all.entries.find((e) => e.printId === adeline)?.print.name ?? '';
    expect((await list(`?q=${encodeURIComponent(adelineName.slice(0, 5))}`)).total).toBe(1);
    expect((await list('?q=1')).total).toBeGreaterThanOrEqual(2);
    expect((await list('?page=2')).entries).toEqual([]);
    expect((await ash('/entries?binder=nope')).status).toBe(400);

    const neoEntry = entries.find((e) => e.printId === neo);
    const patched = await ash(`/entries/${neoEntry?.id}`, {
      method: 'PATCH',
      body: { quantity: 1, binderId: binder.id, purchasePriceCents: 250, purchaseCurrency: 'EUR' },
    });
    expect(patched.status).toBe(200);
    expect(CollectionEntrySchema.parse(await patched.json())).toMatchObject({
      quantity: 1,
      binderId: binder.id,
      purchasePriceCents: 250,
    });
    expect(
      (await ash(`/entries/${neoEntry?.id}`, { method: 'PATCH', body: { quantity: 0 } })).status,
    ).toBe(400);

    expect((await ash(`/entries/${neoEntry?.id}`, { method: 'DELETE' })).status).toBe(204);
    const [tomb] = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.id, neoEntry?.id ?? ''));
    expect(tomb?.deletedAt).toBeInstanceOf(Date);
    expect((await list()).total).toBe(2);
    expect((await ash(`/entries/${neoEntry?.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await ash(`/entries/${neoEntry?.id}`, { method: 'PATCH', body: { quantity: 2 } })).status,
    ).toBe(404);
    for (const e of entries) await ash(`/entries/${e.id}`, { method: 'DELETE' });
    await ash(`/binders/${binder.id}`, { method: 'DELETE' });
  });

  it('answers 404 for another user’s rows and never shows them', async () => {
    const adeline = await printId('mid', '1');
    const binder = BinderSchema.parse(await json(ash('/binders', { body: { name: 'Mine' } })));
    const [entry] = CreateEntriesResponseSchema.parse(
      await json(ash('/entries', { body: { printId: adeline } })),
    ).entries;
    const [wish] = CreateWishesResponseSchema.parse(
      await json(ash('/wishlist', { body: { printId: adeline } })),
    ).entries;

    expect(
      (await misty(`/entries/${entry?.id}`, { method: 'PATCH', body: { quantity: 5 } })).status,
    ).toBe(404);
    expect((await misty(`/entries/${entry?.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await misty(`/wishlist/${wish?.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await misty(`/binders/${binder.id}`, { method: 'PATCH', body: { name: 'x' } })).status,
    ).toBe(404);
    expect((await misty(`/binders/${binder.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await misty('/binders/order', { method: 'PUT', body: { ids: [binder.id] } })).status,
    ).toBe(404);
    expect(
      (await misty('/entries', { body: { printId: adeline, binderId: binder.id } })).status,
    ).toBe(404);
    // Re-posting Ash's id writes nothing for Misty and changes nothing for Ash.
    const stolen = await misty('/entries', { body: { id: entry?.id, printId: adeline } });
    expect(CreateEntriesResponseSchema.parse(await stolen.json()).entries).toEqual([]);
    expect(EntriesResponseSchema.parse(await json(misty('/entries'))).total).toBe(0);
    expect(BindersResponseSchema.parse(await json(misty('/binders'))).binders).toEqual([]);
    expect(OwnedResponseSchema.parse(await json(misty(`/owned?printIds=${adeline}`)))).toEqual({
      owned: {},
      byFinish: {},
      wished: {},
    });
    const [still] = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.id, entry?.id ?? ''));
    expect(still).toMatchObject({ quantity: 1, deletedAt: null });

    await ash(`/entries/${entry?.id}`, { method: 'DELETE' });
    await ash(`/wishlist/${wish?.id}`, { method: 'DELETE' });
    await ash(`/binders/${binder.id}`, { method: 'DELETE' });
  });

  it('keeps one live wish per print, language and finish, with the current price', async () => {
    const adeline = await printId('mid', '1');
    const wish = { printId: adeline, maxPriceCents: 300, currency: 'EUR', finish: 'normal' };
    const created = await ash('/wishlist', { body: wish });
    expect(created.status).toBe(201);
    const [first] = CreateWishesResponseSchema.parse(await created.json()).entries;
    expect(first?.price).toMatchObject({ source: 'cardmarket', unitCents: 334 });
    expect((await ash('/wishlist', { body: wish })).status).toBe(409);
    // "Any language" is its own wish next to a German one.
    expect((await ash('/wishlist', { body: { ...wish, language: 'de' } })).status).toBe(201);

    const patched = await ash(`/wishlist/${first?.id}`, {
      method: 'PATCH',
      body: { maxPriceCents: 400, minCondition: 'EX' },
    });
    expect(await patched.json()).toMatchObject({
      maxPriceCents: 400,
      minCondition: 'EX',
      price: { unitCents: 284 },
    });
    const list = WishlistResponseSchema.parse(await json(ash('/wishlist')));
    expect(list.total).toBe(2);

    expect((await ash(`/wishlist/${first?.id}`, { method: 'DELETE' })).status).toBe(204);
    const [tomb] = await db
      .select()
      .from(wishlistEntries)
      .where(eq(wishlistEntries.id, first?.id ?? ''));
    expect(tomb?.deletedAt).toBeInstanceOf(Date);
    // The tombstone does not block the same wish again.
    expect((await ash('/wishlist', { body: wish })).status).toBe(201);
    for (const w of WishlistResponseSchema.parse(await json(ash('/wishlist'))).entries)
      await ash(`/wishlist/${w.id}`, { method: 'DELETE' });
  });

  it('sums the value per source, game and binder, and counts the wish list', async () => {
    const [adeline, champion] = await Promise.all([printId('mid', '1'), printId('mid', '385')]);
    const binder = BinderSchema.parse(await json(ash('/binders', { body: { name: 'Value' } })));
    const { entries } = CreateEntriesResponseSchema.parse(
      await json(
        ash('/entries', {
          body: [
            { printId: adeline, quantity: 2, binderId: binder.id },
            { printId: adeline, quantity: 1, condition: 'GD' },
            { printId: champion, quantity: 1, finish: 'foil' },
          ],
        }),
      ),
    );
    const wishes = CreateWishesResponseSchema.parse(
      await json(
        ash('/wishlist', {
          body: [
            { printId: adeline, maxPriceCents: 400, currency: 'EUR' },
            { printId: champion, maxPriceCents: 10, currency: 'EUR' },
          ],
        }),
      ),
    ).entries;

    const summary = CollectionSummarySchema.parse(await json(ash('/summary')));
    // 2 × 334 + 1 × round(334 × 0.7) + 1 × 76 (foil-only, priced by its finish).
    expect(summary.collection).toMatchObject({
      cards: 4,
      entries: 3,
      unpriced: 0,
      estimate: true,
      totals: [
        {
          source: 'cardmarket',
          currency: 'EUR',
          cents: 668 + 234 + 76,
          observedAt: '2026-10-09T03:00:00.000Z',
        },
      ],
    });
    expect(summary.collection.games.map((g) => [g.game, g.cards])).toEqual([['mtg', 4]]);
    const inBinder = summary.collection.binders.find((b) => b.binderId === binder.id);
    expect(inBinder).toMatchObject({ cards: 2, totals: [{ cents: 668 }] });
    expect(summary.wishlist).toMatchObject({ cards: 2, inBudget: 1 });

    const usd = CollectionSummarySchema.parse(await json(ash('/summary?currency=USD')));
    expect(usd.collection.totals[0]).toMatchObject({
      source: 'tcgplayer_scryfall',
      currency: 'USD',
    });

    const owned = OwnedResponseSchema.parse(
      await json(ash(`/owned?printIds=${adeline},${champion},${randomUUID()}`)),
    );
    expect(owned).toEqual({
      owned: { [adeline]: 3, [champion]: 1 },
      byFinish: { [adeline]: { normal: 3 }, [champion]: { foil: 1 } },
      wished: { [adeline]: 1, [champion]: 1 },
    });
    // The set page asks for a whole set.
    const set = OwnedResponseSchema.parse(await json(ash('/owned?game=mtg&set=MID')));
    expect(set.owned).toEqual({ [adeline]: 3, [champion]: 1 });
    expect(OwnedResponseSchema.parse(await json(ash('/owned?game=mtg&set=neo'))).owned).toEqual({});
    expect((await ash('/owned?printIds=nope')).status).toBe(400);
    expect((await ash('/owned')).status).toBe(400);

    for (const e of entries) await ash(`/entries/${e.id}`, { method: 'DELETE' });
    for (const w of wishes) await ash(`/wishlist/${w.id}`, { method: 'DELETE' });
    await ash(`/binders/${binder.id}`, { method: 'DELETE' });
  });

  it('exports the live entries as Cardmarket-style CSV', async () => {
    const [adeline, gavony] = await Promise.all([printId('mid', '1'), printId('mid', '20')]);
    const { entries } = CreateEntriesResponseSchema.parse(
      await json(
        ash('/entries', {
          body: [
            { printId: adeline, quantity: 2, language: 'de', condition: 'EX', finish: 'foil' },
            { printId: gavony },
          ],
        }),
      ),
    );
    await ash(`/entries/${entries[1]?.id}`, { method: 'DELETE' });
    const res = await ash('/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Name,Set Code,Number,Language,Condition,Finish,Quantity');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^.+,mid,1,de,EX,foil,2$/);
    const empty = await (await misty('/export.csv')).text();
    expect(empty.trimEnd().split('\r\n')).toHaveLength(1);
    await ash(`/entries/${entries[0]?.id}`, { method: 'DELETE' });
  });
});
