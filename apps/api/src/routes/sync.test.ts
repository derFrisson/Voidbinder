import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeckDetailSchema,
  ErrorResponseSchema,
  SYNC_DELETION_RETENTION_DAYS,
  SyncPullResponseSchema,
  SyncPushResponseSchema,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@voidbinder/shared/api';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { MailMessage } from '../auth/mail';
import {
  appMeta,
  binders,
  cards,
  collectionEntries,
  deckEntries,
  decks,
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
import {
  SYNC_CLOCK_ALLOWANCE_MS,
  SYNC_DELETIONS_HORIZON_KEY,
  sweepSyncDeletions,
} from '../platform/cloudflare/drizzle-sync-store';
import { databaseUrl, freshDatabase, migrationConfig, testApp, testDeps } from '../test-helpers';

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
      deletions: [],
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
    expect(page.deletions).toEqual([]);
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
      deletions: [],
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
      deletions: [],
    });
    const [row] = await db.select().from(binders).where(eq(binders.id, b.id));
    expect(row?.name).toBe('Server wins');
  });

  it('never moves updated_at back, so a REST write behind a fast device clock still conflicts', async () => {
    // Device A's clock runs 3 minutes fast (within the allowance): its row keeps the future time.
    const ahead = new Date(Date.now() + 3 * 60_000).toISOString();
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

  it('cuts a stamp far ahead of the server clock to now plus the allowance', async () => {
    const year = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
    const b = binder({ updatedAt: year });
    const created = await push(ash, [{ table: 'binders', rows: [b] }]);
    const ceiling = Date.now() + SYNC_CLOCK_ALLOWANCE_MS;
    const stamped = created.body.applied[0]?.updatedAt ?? '';
    expect(Date.parse(stamped)).toBeLessThanOrEqual(ceiling);
    const [row] = await db.select().from(binders).where(eq(binders.id, b.id));
    expect(row?.updatedAt.toISOString()).toBe(stamped);

    const del = { ...b, updatedAt: year, deletedAt: year, baseUpdatedAt: stamped };
    expect((await push(ash, [{ table: 'binders', rows: [del] }])).status).toBe(200);
    const [gone] = await db.select().from(syncDeletions).where(eq(syncDeletions.id, b.id));
    expect(gone?.deletedAt.getTime()).toBeLessThanOrEqual(Date.now() + SYNC_CLOCK_ALLOWANCE_MS);
  });

  it('lets a newer delete win, a newer edit bring the row back, and keeps a deck’s list on conflict', async () => {
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
    // The row is gone; only the log keeps its id and the delete's time.
    expect(await db.select().from(collectionEntries).where(eq(collectionEntries.id, e.id))).toEqual(
      [],
    );
    const log = () => db.select().from(syncDeletions).where(eq(syncDeletions.id, e.id));
    expect((await log())[0]).toMatchObject({
      table: 'collection_entries',
      deletedAt: new Date(at(20)),
    });

    // An edit at :15 from a device that missed the delete loses: answered as a deletion.
    const lost = { ...edited, quantity: 7, updatedAt: at(15) };
    const conflict = await push(ash, [{ table: 'collection_entries', rows: [lost] }]);
    expect(conflict.body).toEqual({
      applied: [],
      conflicts: [],
      deletions: [{ table: 'collection_entries', id: e.id }],
    });
    // One at :25 brings it back (an insert) and clears the log entry.
    const back = { ...edited, quantity: 9, updatedAt: at(25) };
    expect((await push(ash, [{ table: 'collection_entries', rows: [back] }])).body.applied).toEqual(
      [{ table: 'collection_entries', id: e.id, updatedAt: at(25) }],
    );
    const [alive] = await db.select().from(collectionEntries).where(eq(collectionEntries.id, e.id));
    expect(alive).toMatchObject({ quantity: 9 });
    expect(await log()).toEqual([]);

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

  it('weighs an edit against a logged delete by time alone, whatever the base', async () => {
    // A fast device clock (within the allowance) stamps the row 4 minutes ahead.
    const now = Date.now();
    const ahead = new Date(now + 4 * 60_000).toISOString();
    const b = binder({ updatedAt: ahead });
    await push(ash, [{ table: 'binders', rows: [b] }]);
    // A REST delete at now(): logged before the row's last edit.
    expect((await ash(`/collection/binders/${b.id}`, { method: 'DELETE' })).status).toBe(204);
    // A device that pulled the row (base: the fast stamp) and edited it before the delete loses.
    const edit = { ...b, name: 'Offline', updatedAt: new Date(now - 60_000).toISOString() };
    const res = await push(ash, [{ table: 'binders', rows: [{ ...edit, baseUpdatedAt: ahead }] }]);
    expect(res.body).toEqual({
      applied: [],
      conflicts: [],
      deletions: [{ table: 'binders', id: b.id }],
    });
    expect(await db.select().from(binders).where(eq(binders.id, b.id))).toEqual([]);
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
    expect(await db.select().from(binders).where(eq(binders.id, b.id))).toEqual([]);
    // Only the binder is logged; its entry moved and stays.
    expect(
      (
        await db
          .select()
          .from(syncDeletions)
          .where(inArray(syncDeletions.id, [b.id, e.id]))
      ).map((r) => r.id),
    ).toEqual([b.id]);
    // An offline device files a new entry into the deleted binder: it lands in no binder.
    const late = entry(adeline.printId, { binderId: b.id });
    expect((await push(ash, [{ table: 'collection_entries', rows: [late] }])).status).toBe(200);
    const [row] = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.id, late.id));
    expect(row?.binderId).toBeNull();
  });

  it('keeps a move out of a binder deleted in the same push', async () => {
    const adeline = await print('mid', '1');
    const [b, c] = [binder(), binder()];
    const x = entry(adeline.printId, { binderId: b.id });
    await push(ash, [
      { table: 'binders', rows: [b, c] },
      { table: 'collection_entries', rows: [x] },
    ]);
    // Offline: the cards move from B to C, then B is deleted; both go up in one push.
    const res = await push(ash, [
      {
        table: 'binders',
        rows: [{ ...b, deletedAt: at(2), updatedAt: at(2), baseUpdatedAt: at(0) }],
      },
      {
        table: 'collection_entries',
        rows: [{ ...x, binderId: c.id, updatedAt: at(1), baseUpdatedAt: at(0) }],
      },
    ]);
    expect(res.body.conflicts).toEqual([]);
    expect(res.body.applied).toContainEqual({
      table: 'collection_entries',
      id: x.id,
      updatedAt: at(1),
    });
    const [row] = await db.select().from(collectionEntries).where(eq(collectionEntries.id, x.id));
    expect(row?.binderId).toBe(c.id);
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
    expect(await pull(ash, cursor)).toEqual({ changes: [], deletions: [], cursor, more: false });
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

  it('names the pushed row that runs into a unique rule', async () => {
    const gary = as(await signUp());
    const plains = await print('mid', '268');
    const taken = binder();
    const w = wish(plains.printId);
    await push(gary, [
      { table: 'binders', rows: [taken] },
      { table: 'wishlist_entries', rows: [w] },
    ]);
    const message = async (changes: unknown[]) => {
      const res = await gary('/sync/push', { body: { changes } });
      expect(res.status).toBe(409);
      return ((await res.json()) as { error: { message: string } }).error.message;
    };

    const twin = binder({ name: taken.name });
    expect(await message([{ table: 'binders', rows: [binder(), twin, binder()] }])).toBe(
      `binders ${twin.id}: a binder of that name exists already`,
    );
    const again = wish(plains.printId);
    expect(await message([{ table: 'wishlist_entries', rows: [again] }])).toBe(
      `wishlist_entries ${again.id}: a wish for that print, language and finish exists already`,
    );
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

  it('tells other devices of every delete, REST and pushed, and takes a repeated delete as applied', async () => {
    const adeline = await print('mid', '1');
    const [b, e, w, d] = [binder(), entry(adeline.printId), wish(adeline.printId), deck()];
    await push(ash, [
      { table: 'binders', rows: [b] },
      { table: 'collection_entries', rows: [e] },
      { table: 'wishlist_entries', rows: [w] },
      { table: 'decks', rows: [d] },
    ]);
    const start = (await pull(ash)).cursor;

    expect((await ash(`/collection/wishlist/${w.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await ash(`/decks/${d.id}`, { method: 'DELETE' })).status).toBe(204);
    const del = { ...e, deletedAt: at(3), updatedAt: at(3), baseUpdatedAt: at(0) };
    const first = await push(ash, [{ table: 'collection_entries', rows: [del] }]);
    expect(first.body.applied).toEqual([
      { table: 'collection_entries', id: e.id, updatedAt: at(3) },
    ]);
    // A retry, or another device that deleted it too: applied, nothing written.
    const seq = await lastSeq();
    const again = await push(ash, [
      { table: 'collection_entries', rows: [{ ...del, deletedAt: at(4), updatedAt: at(4) }] },
    ]);
    expect(again.body).toEqual(first.body);
    expect(await lastSeq()).toBe(seq);
    // A delete of a row the server never had is applied and not logged.
    const never = entry(adeline.printId, { deletedAt: at(5), updatedAt: at(5) });
    expect(
      (await push(ash, [{ table: 'collection_entries', rows: [never] }])).body.applied,
    ).toHaveLength(1);
    expect(await db.select().from(syncDeletions).where(eq(syncDeletions.id, never.id))).toEqual([]);
    await ash(`/collection/binders/${b.id}`, { method: 'DELETE' });

    // The deletions come in the order they happened, without content, within the page budget.
    const page = await pull(ash, start);
    expect(page.changes).toEqual([]);
    expect(page.deletions).toEqual([
      { table: 'wishlist_entries', id: w.id },
      { table: 'decks', id: d.id },
      { table: 'collection_entries', id: e.id },
      { table: 'binders', id: b.id },
    ]);
    const firstTwo = await pull(ash, start, 2);
    expect(firstTwo.deletions).toHaveLength(2);
    expect(firstTwo.more).toBe(true);
    expect((await pull(ash, firstTwo.cursor)).deletions).toEqual(page.deletions.slice(2));
  });

  it('frees a deleted binder’s name at once, in the same push too', async () => {
    const b = binder();
    await push(ash, [{ table: 'binders', rows: [b] }]);
    const twin = binder({ name: b.name });
    const res = await push(ash, [
      {
        table: 'binders',
        rows: [{ ...b, deletedAt: at(1), updatedAt: at(1), baseUpdatedAt: at(0) }, twin],
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.applied.map((a) => a.id)).toEqual([b.id, twin.id]);
  });

  it('caps a push at 500 rows', async () => {
    const rows = Array.from({ length: 501 }, () => binder());
    expect((await push(ash, [{ table: 'binders', rows }])).status).toBe(400);
    expect((await push(ash, [{ table: 'binders', rows: rows.slice(0, 500) }])).status).toBe(200);
  });

  // Last in this describe: the horizon it raises is global (app_meta), and it removes it after.
  it('sweeps log entries older than 30 days and asks a device behind them to pull everything again', async () => {
    const brock = as(await signUp());
    const [b1, b2, b3] = [binder(), binder(), binder()];
    await push(brock, [{ table: 'binders', rows: [b1, b2, b3] }]);
    const behind = (await pull(brock)).cursor;
    for (const b of [b1, b2, b3])
      expect((await brock(`/collection/binders/${b.id}`, { method: 'DELETE' })).status).toBe(204);
    const day = 86_400_000;
    const age = async (id: string, days: number) =>
      db
        .update(syncDeletions)
        .set({ loggedAt: new Date(Date.now() - days * day) })
        .where(eq(syncDeletions.id, id));
    await age(b1.id, SYNC_DELETION_RETENTION_DAYS + 1);
    await age(b2.id, SYNC_DELETION_RETENTION_DAYS - 1);
    const left = async () =>
      (
        await db
          .select({ id: syncDeletions.id })
          .from(syncDeletions)
          .where(inArray(syncDeletions.id, [b1.id, b2.id, b3.id]))
      ).map((r) => r.id);
    try {
      expect(await sweepSyncDeletions(db)).toBe(1);
      expect(new Set(await left())).toEqual(new Set([b2.id, b3.id]));
      // Two days on, b2 is older than 30 days too (the injectable now).
      expect(await sweepSyncDeletions(db, new Date(Date.now() + 2 * day))).toBe(1);
      expect(await left()).toEqual([b3.id]);

      // The cursor from before the deletes may have missed b1 and b2: pull everything again.
      const res = await brock(`/sync/pull?since=${behind}`);
      expect(res.status).toBe(409);
      expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe('resync_required');
      // A full pull pages past the horizon, and its last cursor is clear of it.
      let cursor = 0;
      const deletions: unknown[] = [];
      for (let more = true; more;) {
        const page = await pull(brock, cursor, 1);
        deletions.push(...page.deletions);
        ({ cursor, more } = page);
      }
      expect(deletions).toEqual([{ table: 'binders', id: b3.id }]);
      expect(await pull(brock, cursor)).toMatchObject({ deletions: [], more: false });
    } finally {
      await db.delete(appMeta).where(eq(appMeta.key, SYNC_DELETIONS_HORIZON_KEY));
    }
  });
});

// Migration 0009 on a database that still holds deleted rows (tombstones of VB-31/VB-34).
describe.skipIf(!databaseUrl)('migration 0009 (Postgres)', () => {
  it('removes deleted rows into the deletion log and makes the unique rules plain', async () => {
    // The migrations up to 0008 only.
    const dir = mkdtempSync(join(tmpdir(), 'voidbinder-0008-'));
    cpSync(migrationConfig.migrationsFolder, dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx <= 8);
    writeFileSync(journalPath, JSON.stringify(journal));
    const { db, drop } = await freshDatabase(dir);
    try {
      const id = () => randomUUID();
      const [set, card, print, b1, b2, e1, e2, w1, w2, d1, d2] = Array.from({ length: 11 }, id);
      const old = '2026-09-01T10:00:00.000Z';
      for (const statement of [
        sql`insert into "user" (id, name, email) values ('u1', 'Ash', 'ash@example.test')`,
        sql`insert into sets (id, game_id, code, name) values (${set}, 'mtg', 'tst', 'Test')`,
        sql`insert into cards (id, game_id, name, oracle_key) values (${card}, 'mtg', 'Card', 'card')`,
        sql`insert into prints (id, card_id, set_id, number) values (${print}, ${card}, ${set}, '1')`,
        sql`insert into binders (id, user_id, name, deleted_at)
          values (${b1}, 'u1', 'Trades', ${old}), (${b2}, 'u1', 'Trades', null)`,
        sql`insert into collection_entries
          (id, user_id, print_id, binder_id, quantity, language, condition, finish, deleted_at)
          values (${e1}, 'u1', ${print}, ${b1}, 1, 'en', 'NM', 'nonfoil', null),
                 (${e2}, 'u1', ${print}, null, 1, 'en', 'NM', 'nonfoil', ${old})`,
        sql`insert into wishlist_entries (id, user_id, print_id, quantity, deleted_at)
          values (${w1}, 'u1', ${print}, 1, ${old}), (${w2}, 'u1', ${print}, 1, null)`,
        sql`insert into decks (id, user_id, game_id, name, format, deleted_at)
          values (${d1}, 'u1', 'mtg', 'Old', 'modern', ${old}),
                 (${d2}, 'u1', 'mtg', 'Live', 'modern', null)`,
        sql`insert into deck_entries (deck_id, card_id, zone, quantity)
          values (${d1}, ${card}, 'main', 4)`,
      ])
        await db.execute(statement);

      await migrate(db, migrationConfig);

      const ids = async (table: string) =>
        (await db.execute<{ id: string }>(sql.raw(`select id from ${table}`))).rows.map(
          (r) => r.id,
        );
      expect(await ids('binders')).toEqual([b2]);
      expect(await ids('collection_entries')).toEqual([e1]);
      expect(await ids('wishlist_entries')).toEqual([w2]);
      expect(await ids('decks')).toEqual([d2]);
      expect(await db.select().from(deckEntries)).toEqual([]);
      const [moved] = await db.select().from(collectionEntries);
      expect(moved?.binderId).toBeNull();
      const log = await db
        .select({ table: syncDeletions.table, id: syncDeletions.id, at: syncDeletions.deletedAt })
        .from(syncDeletions);
      expect(new Set(log.map((l) => `${l.table} ${l.id} ${l.at.toISOString()}`))).toEqual(
        new Set([
          `binders ${b1} ${old}`,
          `collection_entries ${e2} ${old}`,
          `wishlist_entries ${w1} ${old}`,
          `decks ${d1} ${old}`,
        ]),
      );
      // The unique rules now hold for every row.
      await expect(
        db.execute(sql`insert into binders (user_id, name) values ('u1', 'Trades')`),
      ).rejects.toMatchObject({ cause: { constraint: 'binders_user_id_name_key' } });
    } finally {
      await drop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
