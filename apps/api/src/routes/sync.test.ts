import { randomUUID } from 'node:crypto';
import {
  DeckDetailSchema,
  SyncPullResponseSchema,
  SyncPushResponseSchema,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@voidbinder/shared/api';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { MailMessage } from '../auth/mail';
import { binders, cards, collectionEntries, deckEntries, decks, prints, sets } from '../db/schema';
import { runScryfallImport } from '../import/scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../import/scryfall/test-fixtures';
import type { Db } from '../import/scryfall/write';
import { DrizzleCardStore } from '../platform/cloudflare/drizzle-card-store';
import { DrizzleCollectionStore } from '../platform/cloudflare/drizzle-collection-store';
import { DrizzleDeckStore } from '../platform/cloudflare/drizzle-deck-store';
import { databaseUrl, freshDatabase, testApp, testDeps } from '../test-helpers';

it('needs a session', async () => {
  expect((await testApp().request('/sync/pull')).status).toBe(401);
  expect((await testApp().request('/sync/push', { method: 'POST' })).status).toBe(401);
});

// The sync routes against Postgres, with the Scryfall fixtures as catalog and two real users, as
// in decks.test.ts.
describe.skipIf(!databaseUrl)('sync routes (Postgres)', () => {
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
          'cf-connecting-ip': `10.0.2.${Math.floor(Math.random() * 250)}`,
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

  // Device edit times, all before the REST writes' now().
  const at = (minute: number) => `2026-01-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
  const stamp = <T extends object>(o: T) => ({
    id: randomUUID(),
    updatedAt: at(0),
    deletedAt: null,
    baseUpdatedAt: null,
    ...o,
  });
  const binder = (o: object = {}) =>
    stamp({ name: `Binder ${randomUUID()}`, game: null, position: 0, colour: null, ...o });
  const entry = (printId: string, o: object = {}) =>
    stamp({
      printId,
      binderId: null,
      quantity: 1,
      language: 'en',
      condition: 'NM',
      finish: 'nonfoil',
      purchasePriceCents: null,
      purchaseCurrency: null,
      note: null,
      ...o,
    });
  const wish = (printId: string, o: object = {}) =>
    stamp({
      printId,
      quantity: 1,
      language: null,
      finish: null,
      minCondition: null,
      maxPriceCents: null,
      currency: null,
      note: null,
      ...o,
    });
  const deck = (o: object = {}) =>
    stamp({ game: 'mtg', name: 'Sync', format: 'modern', description: null, ...o });

  type User = typeof ash;
  /** `body` is parsed on a 200 only; the tests read it on a 200 only. */
  const push = async (user: User, changes: unknown[]) => {
    const res = await user('/sync/push', { body: { changes } });
    const body = await res.json();
    return {
      status: res.status,
      body: (res.status === 200 ? SyncPushResponseSchema.parse(body) : body) as SyncPushResponse,
    };
  };
  const pull = async (user: User, since = 0, limit?: number): Promise<SyncPullResponse> => {
    const res = await user(`/sync/pull?since=${since}${limit ? `&limit=${limit}` : ''}`);
    expect(res.status).toBe(200);
    return SyncPullResponseSchema.parse(await res.json());
  };
  const rowsOf = (page: SyncPullResponse, table: string) =>
    (page.changes.find((c) => c.table === table)?.rows ?? []) as { id?: string }[];
  const lastSeq = async () =>
    Number((await db.execute(sql`select last_value from sync_seq`)).rows[0]?.last_value);

  it('pushes new rows of every table, pulls them back and ignores a second identical push', async () => {
    const start = (await pull(ash)).cursor;
    const [adeline, plains] = await Promise.all([print('mid', '1'), print('mid', '268')]);
    const b = binder({ name: 'Weiß' });
    const e = entry(adeline.printId, { binderId: b.id, quantity: 2 });
    const w = wish(plains.printId);
    const d = deck();
    // Out of order on purpose: the server applies binders before entries, decks before lists.
    const changes = [
      {
        table: 'deck_entries',
        rows: [{ deckId: d.id, cardId: adeline.cardId, printId: null, zone: 'main', quantity: 4 }],
      },
      { table: 'collection_entries', rows: [e] },
      { table: 'decks', rows: [d] },
      { table: 'wishlist_entries', rows: [w] },
      { table: 'binders', rows: [b] },
    ];
    const first = await push(ash, changes);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      applied: [
        { table: 'binders', id: b.id, updatedAt: at(0) },
        { table: 'collection_entries', id: e.id, updatedAt: at(0) },
        { table: 'wishlist_entries', id: w.id, updatedAt: at(0) },
        { table: 'decks', id: d.id, updatedAt: at(0) },
      ],
      conflicts: [],
    });

    const page = await pull(ash, start);
    expect(page.more).toBe(false);
    expect(page.cursor).toBeGreaterThan(start);
    const binderRow = { ...b, baseUpdatedAt: undefined };
    expect(rowsOf(page, 'binders')).toEqual([binderRow]); // toEqual skips the undefined key
    expect(rowsOf(page, 'collection_entries')).toMatchObject([
      { id: e.id, binderId: b.id, quantity: 2 },
    ]);
    expect(rowsOf(page, 'wishlist_entries')).toMatchObject([{ id: w.id }]);
    expect(rowsOf(page, 'decks')).toMatchObject([{ id: d.id, format: 'modern' }]);
    expect(rowsOf(page, 'deck_entries')).toEqual([
      { deckId: d.id, cardId: adeline.cardId, printId: null, zone: 'main', quantity: 4 },
    ]);
    // The REST routes read what sync wrote.
    expect(DeckDetailSchema.parse(await (await ash(`/decks/${d.id}`)).json()).entries).toHaveLength(
      1,
    );

    // Idempotent: the same batch again writes nothing (no sync_seq taken) and conflicts with nothing.
    const seq = await lastSeq();
    const again = await push(ash, changes);
    expect(again.body).toEqual(first.body);
    expect(await lastSeq()).toBe(seq);
    expect((await pull(ash, page.cursor)).changes).toEqual([]);
  });

  it('applies an edit made on the latest row and stamps REST writes too', async () => {
    const b = binder();
    await push(ash, [{ table: 'binders', rows: [b] }]);
    const cursor = (await pull(ash)).cursor;

    // Edited on a device that saw the row: applied.
    const edit = { ...b, name: 'Renamed', updatedAt: at(5), baseUpdatedAt: b.updatedAt };
    const res = await push(ash, [{ table: 'binders', rows: [edit] }]);
    expect(res.body).toEqual({
      applied: [{ table: 'binders', id: b.id, updatedAt: at(5) }],
      conflicts: [],
    });

    // A REST write advances sync_seq as well (the trigger path).
    const rest = await ash(`/collection/binders`, { body: { name: `REST ${randomUUID()}` } });
    const created = (await rest.json()) as { id: string };
    const page = await pull(ash, cursor);
    expect(rowsOf(page, 'binders').map((r) => r.id)).toEqual([b.id, created.id]);
    expect(rowsOf(page, 'binders')[0]).toMatchObject({ name: 'Renamed', updatedAt: at(5) });
  });

  it('keeps the server row and returns it when it changed after the device’s base', async () => {
    const b = binder();
    await push(ash, [{ table: 'binders', rows: [b] }]);
    // Another device renames it through REST (updated_at = now(), after the device's base).
    const patched = await ash(`/collection/binders/${b.id}`, {
      method: 'PATCH',
      body: { name: 'Server wins' },
    });
    const server = (await patched.json()) as { updatedAt: string };

    const stale = { ...b, name: 'Device', updatedAt: at(30), baseUpdatedAt: b.updatedAt };
    const res = await push(ash, [{ table: 'binders', rows: [stale] }]);
    const stored = { ...b, baseUpdatedAt: undefined };
    expect(res.body).toEqual({
      applied: [],
      conflicts: [
        {
          table: 'binders',
          rows: [{ ...stored, name: 'Server wins', updatedAt: server.updatedAt }],
        },
      ],
    });
    const [row] = await db.select().from(binders).where(eq(binders.id, b.id));
    expect(row?.name).toBe('Server wins');
  });

  it('never moves updated_at back, so a REST write behind a fast device clock still conflicts', async () => {
    // Device A's clock runs 10 minutes fast: its row is stored with a future updatedAt.
    const ahead = new Date(Date.now() + 10 * 60_000).toISOString();
    const b = binder({ updatedAt: ahead });
    await push(ash, [{ table: 'binders', rows: [b] }]);
    // A REST edit at the real time (now(), before A's stamp) still lands after it.
    const patched = await ash(`/collection/binders/${b.id}`, {
      method: 'PATCH',
      body: { name: 'Web edit' },
    });
    const web = (await patched.json()) as { updatedAt: string };
    expect(Date.parse(web.updatedAt)).toBe(Date.parse(ahead) + 1);

    // A edits again from its old base: it never saw the web edit, so it conflicts.
    const later = new Date(Date.parse(ahead) + 60_000).toISOString();
    const edit = { ...b, name: 'Device A', updatedAt: later, baseUpdatedAt: ahead };
    const res = await push(ash, [{ table: 'binders', rows: [edit] }]);
    expect(res.body.applied).toEqual([]);
    expect(res.body.conflicts).toMatchObject([
      { table: 'binders', rows: [{ id: b.id, name: 'Web edit', updatedAt: web.updatedAt }] },
    ]);
  });

  it('lets a newer delete win, a newer edit resurrect, and keeps a deck’s list on conflict', async () => {
    const adeline = await print('mid', '1');
    const e = entry(adeline.printId);
    await push(ash, [{ table: 'collection_entries', rows: [e] }]);
    // Edited elsewhere at :10.
    const edited = { ...e, quantity: 3, updatedAt: at(10), baseUpdatedAt: e.updatedAt };
    await push(ash, [{ table: 'collection_entries', rows: [edited] }]);

    // A delete at :05 from a device that never saw the edit: older, so the edit stays.
    const older = { ...e, deletedAt: at(5), updatedAt: at(5) };
    expect(
      (await push(ash, [{ table: 'collection_entries', rows: [older] }])).body.conflicts,
    ).toHaveLength(1);
    // A delete at :20: newer, it wins although the base is stale.
    const newer = { ...e, deletedAt: at(20), updatedAt: at(20) };
    expect(
      (await push(ash, [{ table: 'collection_entries', rows: [newer] }])).body.applied,
    ).toHaveLength(1);
    const [gone] = await db.select().from(collectionEntries).where(eq(collectionEntries.id, e.id));
    expect(gone?.deletedAt?.toISOString()).toBe(at(20));

    // An edit at :15 from a device that missed the delete loses; one at :25 resurrects the row.
    const lost = { ...edited, quantity: 7, updatedAt: at(15) };
    const conflict = await push(ash, [{ table: 'collection_entries', rows: [lost] }]);
    expect(conflict.body.conflicts[0]?.rows[0]).toMatchObject({ id: e.id, deletedAt: at(20) });
    const back = { ...edited, quantity: 9, updatedAt: at(25) };
    expect(
      (await push(ash, [{ table: 'collection_entries', rows: [back] }])).body.applied,
    ).toHaveLength(1);
    const [alive] = await db.select().from(collectionEntries).where(eq(collectionEntries.id, e.id));
    expect(alive).toMatchObject({ deletedAt: null, quantity: 9 });

    // A deck changed elsewhere: the conflict carries its stored list.
    const d = deck();
    const line = { deckId: d.id, cardId: adeline.cardId, printId: null, zone: 'main', quantity: 2 };
    await push(ash, [
      { table: 'decks', rows: [d] },
      { table: 'deck_entries', rows: [line] },
    ]);
    await ash(`/decks/${d.id}`, { method: 'PATCH', body: { name: 'Elsewhere' } });
    const res = await push(ash, [
      {
        table: 'decks',
        rows: [{ ...d, name: 'Mine', updatedAt: at(40), baseUpdatedAt: d.updatedAt }],
      },
      { table: 'deck_entries', rows: [] },
    ]);
    expect(res.body.conflicts).toMatchObject([
      { table: 'decks', rows: [{ id: d.id, name: 'Elsewhere' }] },
      { table: 'deck_entries', rows: [line] },
    ]);
    expect(await db.select().from(deckEntries).where(eq(deckEntries.deckId, d.id))).toHaveLength(1);
  });

  it('moves entries out of a deleted binder', async () => {
    const adeline = await print('mid', '1');
    const b = binder();
    const e = entry(adeline.printId, { binderId: b.id });
    await push(ash, [
      { table: 'binders', rows: [b] },
      { table: 'collection_entries', rows: [e] },
    ]);
    await push(ash, [
      {
        table: 'binders',
        rows: [{ ...b, deletedAt: at(1), updatedAt: at(1), baseUpdatedAt: at(0) }],
      },
    ]);
    const [moved] = await db.select().from(collectionEntries).where(eq(collectionEntries.id, e.id));
    expect(moved?.binderId).toBeNull();
    // An offline device files a new entry into the deleted binder: it lands in no binder.
    const late = entry(adeline.printId, { binderId: b.id });
    expect((await push(ash, [{ table: 'collection_entries', rows: [late] }])).status).toBe(200);
    const [row] = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.id, late.id));
    expect(row?.binderId).toBeNull();
  });

  it('pages a pull by the cursor, which only grows', async () => {
    const start = (await pull(ash)).cursor;
    const adeline = await print('mid', '1');
    const ids = Array.from({ length: 7 }, () => randomUUID());
    await push(ash, [
      {
        table: 'collection_entries',
        rows: ids.slice(0, 4).map((id) => entry(adeline.printId, { id })),
      },
      { table: 'binders', rows: ids.slice(4).map((id) => binder({ id })) },
    ]);
    const seen: string[] = [];
    let cursor = start;
    for (let i = 0; i < 3; i++) {
      const page = await pull(ash, cursor, 3);
      expect(page.cursor).toBeGreaterThan(cursor);
      cursor = page.cursor;
      for (const c of page.changes) for (const r of c.rows) seen.push((r as { id: string }).id);
      expect(page.more).toBe(i < 2);
    }
    expect(seen.sort()).toEqual([...ids].sort());
    expect(await pull(ash, cursor)).toEqual({ changes: [], cursor, more: false });
  });

  it('waits for a write in flight, so a lower sync_seq never commits behind the cursor', async () => {
    const b = binder();
    await push(ash, [{ table: 'binders', rows: [b] }]);
    const [owner] = await db
      .select({ userId: binders.userId })
      .from(binders)
      .where(eq(binders.id, b.id));
    const cursor = (await pull(ash)).cursor;

    // A write takes its sync_seq and stays open; a later one commits with a higher number.
    const slow = await (db as unknown as { $client: Pool }).$client.connect();
    const inFlight = randomUUID();
    await slow.query('begin');
    await slow.query(`insert into binders (id, user_id, name) values ($1, $2, 'In flight')`, [
      inFlight,
      owner?.userId,
    ]);
    const later = binder();
    await push(ash, [{ table: 'binders', rows: [later] }]);

    let done = false;
    const pulling = pull(ash, cursor).finally(() => (done = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false);
    await slow.query('commit');
    slow.release();
    expect(rowsOf(await pulling, 'binders').map((r) => r.id)).toEqual([inFlight, later.id]);
  });

  it('answers a retry running alongside its original like the original', async () => {
    const adeline = await print('mid', '1');
    const changes = [
      { table: 'binders', rows: Array.from({ length: 50 }, () => binder()) },
      {
        table: 'collection_entries',
        rows: Array.from({ length: 50 }, () => entry(adeline.printId)),
      },
    ];
    const [a, b] = await Promise.all([push(ash, changes), push(ash, changes)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect(a.body.applied).toHaveLength(100);
  });

  it('isolates users: no foreign rows pulled, a foreign id is a 404 and writes nothing', async () => {
    const b = binder();
    await push(ash, [{ table: 'binders', rows: [b] }]);
    const mine = await pull(misty);
    expect(mine.changes).toEqual([]);

    const fresh = binder();
    const res = await push(misty, [
      {
        table: 'binders',
        rows: [fresh, { ...b, name: 'Stolen', updatedAt: at(50), baseUpdatedAt: at(0) }],
      },
    ]);
    expect(res.status).toBe(404);
    expect(await db.select().from(binders).where(eq(binders.id, fresh.id))).toEqual([]);
    const [row] = await db.select().from(binders).where(eq(binders.id, b.id));
    expect(row?.name).toBe(b.name);
    // Filing an entry into another user's binder is a 404 too.
    const adeline = await print('mid', '1');
    const into = entry(adeline.printId, { binderId: b.id });
    expect((await push(misty, [{ table: 'collection_entries', rows: [into] }])).status).toBe(404);
  });

  it('validates deck lists as a whole and writes nothing on a refused one', async () => {
    const adeline = await print('mid', '1');
    const d = deck();
    const line = (o: object) => ({
      deckId: d.id,
      cardId: adeline.cardId,
      printId: null,
      zone: 'main',
      quantity: 1,
      ...o,
    });
    const tryPush = (rows: unknown[], deckRow: object = d) =>
      push(ash, [
        { table: 'decks', rows: [deckRow] },
        { table: 'deck_entries', rows },
      ]);
    expect((await tryPush([line({ zone: 'extra' })])).status).toBe(400);
    expect((await tryPush([line({ cardId: randomUUID() })])).status).toBe(404);
    expect((await tryPush([line({}), line({})])).status).toBe(400);
    expect((await tryPush([line({})], { ...d, format: 'advanced' })).status).toBe(400);
    expect(await db.select().from(decks).where(eq(decks.id, d.id))).toEqual([]);
    // Entries without their deck's row.
    expect((await push(ash, [{ table: 'deck_entries', rows: [line({})] }])).status).toBe(400);
  });

  it('caps deck entries at 500 per deck and 5000 per push', async () => {
    const lines = (deckId: string, n: number) =>
      Array.from({ length: n }, () => ({
        deckId,
        cardId: randomUUID(),
        printId: null,
        zone: 'main',
        quantity: 1,
      }));
    const decksOf = (n: number) => Array.from({ length: n }, () => deck());
    const messages = async (res: Response) =>
      ((await res.json()) as { error: { issues?: { message: string }[] } }).error.issues?.map(
        (i) => i.message,
      );
    const body = (ds: { id: string }[], per: number) => ({
      changes: [
        { table: 'decks', rows: ds },
        { table: 'deck_entries', rows: ds.flatMap((d) => lines(d.id, per)) },
      ],
    });

    const one = await ash('/sync/push', { body: body(decksOf(1), 501) });
    expect(one.status).toBe(400);
    expect(await messages(one)).toEqual(['At most 500 entries per deck']);
    const many = await ash('/sync/push', { body: body(decksOf(11), 500) });
    expect(many.status).toBe(400);
    expect(await messages(many)).toEqual(['At most 5000 deck entries per push']);
    // 10 full decks pass validation (and then fail on the made-up cards).
    expect((await ash('/sync/push', { body: body(decksOf(10), 500) })).status).toBe(404);
  });

  it('ends a pull page early once the decks’ lists pass 5000 entries', async () => {
    const brock = as(await signUp());
    const allCards = await db.select({ id: cards.id }).from(cards).where(eq(cards.gameId, 'mtg'));
    const zones = ['main', 'extra', 'side', 'commander'];
    const lines = allCards.flatMap((c) => zones.map((zone) => ({ cardId: c.id, zone })));
    const perDeck = Math.min(lines.length, 500);
    const count = Math.ceil(5000 / perDeck) + 2;
    const ds = Array.from({ length: count }, () => deck());
    await push(brock, [{ table: 'decks', rows: ds }]);
    // Straight into the table: the lists only need to be long, not legal.
    for (const d of ds)
      await db
        .insert(deckEntries)
        .values(
          lines.slice(0, perDeck).map((l) => ({ ...l, deckId: d.id, printId: null, quantity: 1 })),
        );

    const seen: string[] = [];
    let cursor = 0;
    let more = true;
    while (more) {
      const page = await pull(brock, cursor);
      const rows = rowsOf(page, 'decks').length;
      expect(rows).toBeGreaterThan(0);
      expect(rows + rowsOf(page, 'deck_entries').length).toBeLessThanOrEqual(5000);
      seen.push(...rowsOf(page, 'decks').map((r) => r.id ?? ''));
      ({ cursor, more } = page);
    }
    expect(seen.length).toBeGreaterThan(Math.floor(5000 / (perDeck + 1)));
    expect(new Set(seen)).toEqual(new Set(ds.map((d) => d.id)));
  });

  it('caps a push at 500 rows', async () => {
    const rows = Array.from({ length: 501 }, () => binder());
    expect((await push(ash, [{ table: 'binders', rows }])).status).toBe(400);
    expect((await push(ash, [{ table: 'binders', rows: rows.slice(0, 500) }])).status).toBe(200);
  });
});
