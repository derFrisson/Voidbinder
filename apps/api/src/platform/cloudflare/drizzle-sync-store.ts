import { orderChanges, resolvePush, type SyncResolution } from '@voidbinder/core';
import {
  SYNC_DECK_ENTRIES_TOTAL,
  SYNC_TABLES,
  type DeckGame,
  type SyncChange,
  type SyncDeckEntry,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncTable,
} from '@voidbinder/shared/api';
import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { HTTPException } from 'hono/http-exception';
import { binders, collectionEntries, deckEntries, decks, wishlistEntries } from '../../db/schema';
import { checkDeckEntries } from './drizzle-deck-store';

// The sync protocol (VB-32, ADR 0005) on PostgreSQL, on the cache-disabled pool. `sync_seq` is
// stamped by the trigger of drizzle/0008_sync.sql on every write, REST or sync alike.

type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];
type RowTable = Exclude<SyncTable, 'deck_entries'>;
type Row = Record<string, unknown> & { id: string; updatedAt: string; deletedAt: string | null };
type PushedRow = Row & { baseUpdatedAt: string | null };
type Stored = Record<string, unknown> & {
  id: string;
  userId: string;
  updatedAt: Date;
  deletedAt: Date | null;
  syncSeq: number;
};

const notFound = (what: string) => new HTTPException(404, { message: `${what} not found` });

/** The Postgres error under Drizzle's wrapper (`DrizzleQueryError.cause`). */
function pgError(err: unknown): { code?: string; constraint?: string } {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string } };
  return e.cause?.code ? e.cause : e;
}

/** The unique rules a push can run into (a live binder name, one live wish per print), worded. */
const UNIQUE_RULES: Record<string, string> = {
  binders_user_id_name_live_key: 'a live binder of that name exists already',
  wishlist_entries_user_print_lang_finish_live_key:
    'a live wish for that print, language and finish exists already',
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** How far ahead of the server a device clock may stamp a row; a later stamp is cut to that. */
export const SYNC_CLOCK_ALLOWANCE_MS = 5 * 60_000;
const lockKey = (userId: string, name = 'sync') =>
  sql`hashtextextended(${`voidbinder.${name}:${userId}`}, 0)`;

/** Per table: the Drizzle table, the row as the protocol sends it, the columns a row writes. */
const TABLES = {
  binders: {
    table: binders,
    what: 'Binder',
    toRow: (r: typeof binders.$inferSelect) => ({
      id: r.id,
      name: r.name,
      game: r.gameId,
      position: r.position,
      colour: r.colour,
      updatedAt: r.updatedAt.toISOString(),
      deletedAt: iso(r.deletedAt),
    }),
    values: (r: Row) => ({
      name: r.name as string,
      gameId: r.game as string | null,
      position: r.position as number,
      colour: r.colour as string | null,
    }),
  },
  collection_entries: {
    table: collectionEntries,
    what: 'Entry',
    toRow: (r: typeof collectionEntries.$inferSelect) => ({
      id: r.id,
      printId: r.printId,
      binderId: r.binderId,
      quantity: r.quantity,
      language: r.language,
      condition: r.condition,
      finish: r.finish,
      purchasePriceCents: r.purchasePriceCents,
      purchaseCurrency: r.purchaseCurrency,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
      deletedAt: iso(r.deletedAt),
    }),
    values: (r: Row) => ({
      printId: r.printId as string,
      binderId: r.binderId as string | null,
      quantity: r.quantity as number,
      language: r.language as string,
      condition: r.condition as string,
      finish: r.finish as string,
      purchasePriceCents: r.purchasePriceCents as number | null,
      purchaseCurrency: r.purchaseCurrency as string | null,
      note: r.note as string | null,
    }),
  },
  wishlist_entries: {
    table: wishlistEntries,
    what: 'Wish',
    toRow: (r: typeof wishlistEntries.$inferSelect) => ({
      id: r.id,
      printId: r.printId,
      quantity: r.quantity,
      language: r.language,
      finish: r.finish,
      minCondition: r.minCondition,
      maxPriceCents: r.maxPriceCents,
      currency: r.currency,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
      deletedAt: iso(r.deletedAt),
    }),
    values: (r: Row) => ({
      printId: r.printId as string,
      quantity: r.quantity as number,
      language: r.language as string | null,
      finish: r.finish as string | null,
      minCondition: r.minCondition as string | null,
      maxPriceCents: r.maxPriceCents as number | null,
      currency: r.currency as string | null,
      note: r.note as string | null,
    }),
  },
  decks: {
    table: decks,
    what: 'Deck',
    toRow: (r: typeof decks.$inferSelect) => ({
      id: r.id,
      game: r.gameId,
      name: r.name,
      format: r.format,
      description: r.description,
      updatedAt: r.updatedAt.toISOString(),
      deletedAt: iso(r.deletedAt),
    }),
    values: (r: Row) => ({
      gameId: r.game as string,
      name: r.name as string,
      format: r.format as string,
      description: r.description as string | null,
    }),
  },
} as const;

// ponytail: one shape for the four tables; Drizzle's per-table types do not survive the lookup.
const tableOf = (t: RowTable) =>
  TABLES[t] as unknown as {
    table: typeof binders;
    what: string;
    toRow: (r: Stored) => Row;
    values: (r: Row) => Record<string, unknown>;
  };

const toEntry = (e: typeof deckEntries.$inferSelect): SyncDeckEntry => ({
  deckId: e.deckId,
  cardId: e.cardId,
  printId: e.printId,
  zone: e.zone as SyncDeckEntry['zone'],
  quantity: e.quantity,
});

/** A deck list in a comparable form: order does not matter. */
const listKey = (entries: readonly SyncDeckEntry[]) =>
  JSON.stringify(
    entries
      .map((e) => [e.cardId, e.zone, e.printId ?? null, e.quantity])
      .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)),
  );

async function entriesOf(db: Tx | NodePgDatabase, deckIds: string[]) {
  const byDeck = new Map<string, SyncDeckEntry[]>();
  if (!deckIds.length) return byDeck;
  const rows = await db
    .select()
    .from(deckEntries)
    .where(inArray(deckEntries.deckId, deckIds))
    .orderBy(asc(deckEntries.deckId), asc(deckEntries.zone), asc(deckEntries.cardId));
  for (const r of rows) {
    const list = byDeck.get(r.deckId) ?? [];
    list.push(toEntry(r));
    byDeck.set(r.deckId, list);
  }
  return byDeck;
}

/** Changes grouped per table, in table order, empty tables left out. */
function grouped(rows: Map<SyncTable, unknown[]>): SyncChange[] {
  return SYNC_TABLES.flatMap((table) => {
    const list = rows.get(table);
    return list?.length ? [{ table, rows: list } as SyncChange] : [];
  });
}

/**
 * `POST /sync/push` in one transaction: every row resolved by core's `resolvePush` against the
 * stored one (locked), in table order. A row id of another user, an unknown print, card or binder
 * answers 404 and writes nothing; a refused deck list 400; a taken binder name or wish 409, its
 * message starting with the pushed row (`<table> <id>: …`).
 */
export async function syncPush(
  db: NodePgDatabase,
  userId: string,
  req: SyncPushRequest,
): Promise<SyncPushResponse> {
  const changes = orderChanges(req.changes);
  // sync_stamp() never lowers updated_at, so a device clock far ahead would pin the row in the
  // future for good: its stamps are cut to the server's now() plus the allowance.
  const ceiling = Date.now() + SYNC_CLOCK_ALLOWANCE_MS;
  const clamp = (t: string) => (Date.parse(t) > ceiling ? new Date(ceiling).toISOString() : t);
  for (const c of changes)
    if (c.table !== 'deck_entries')
      for (const r of c.rows as PushedRow[]) {
        r.updatedAt = clamp(r.updatedAt);
        if (r.deletedAt) r.deletedAt = clamp(r.deletedAt);
      }
  const pushedEntries = new Map<string, SyncDeckEntry[]>();
  for (const c of changes)
    if (c.table === 'deck_entries')
      for (const e of c.rows) {
        const list = pushedEntries.get(e.deckId) ?? [];
        list.push({ ...e, printId: e.printId ?? null });
        pushedEntries.set(e.deckId, list);
      }
  const pushedDecks = new Set(
    changes.flatMap((c) => (c.table === 'decks' ? c.rows.map((r) => r.id) : [])),
  );
  if ([...pushedEntries.keys()].some((id) => !pushedDecks.has(id)))
    throw new HTTPException(400, { message: 'Deck entries need their deck row in the same push' });

  // The row being written, to name it in a 409.
  let writing = '';
  try {
    return await db.transaction(async (tx) => {
      // One push per user at a time: a retry running alongside its original waits for it and
      // then finds its rows equal, instead of colliding on their primary keys.
      await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(userId, 'push')})`);
      // The lock the trigger takes, taken before any row lock (a pull waits on it).
      await tx.execute(sql`select pg_advisory_xact_lock_shared(${lockKey(userId)})`);
      const applied: SyncPushResponse['applied'] = [];
      const conflicts = new Map<SyncTable, unknown[]>();
      const conflict = (table: SyncTable, row: unknown) =>
        conflicts.set(table, [...(conflicts.get(table) ?? []), row]);

      for (const change of changes) {
        if (change.table === 'deck_entries') continue;
        const { table, what, toRow, values } = tableOf(change.table);
        const pushed = change.rows as PushedRow[];
        const ids = pushed.map((r) => r.id);
        const stored = new Map(
          (
            (await tx
              .select()
              .from(table)
              .where(inArray(table.id, ids))
              .orderBy(asc(table.id))
              .for('update')) as Stored[]
          ).map((r) => [r.id, r]),
        );
        if ([...stored.values()].some((r) => r.userId !== userId)) throw notFound(what);

        // An entry in a deleted binder lands in no binder, as `DELETE /binders/:id` does.
        if (change.table === 'collection_entries') {
          const binderIds = [
            ...new Set(pushed.flatMap((r) => (r.binderId ? [r.binderId as string] : []))),
          ];
          const owned = binderIds.length
            ? await tx
                .select({ id: binders.id, deletedAt: binders.deletedAt })
                .from(binders)
                .where(and(eq(binders.userId, userId), inArray(binders.id, binderIds)))
            : [];
          if (owned.length !== binderIds.length) throw notFound('Binder');
          const gone = new Set(owned.filter((b) => b.deletedAt).map((b) => b.id));
          for (const r of pushed)
            if (r.binderId && gone.has(r.binderId as string)) r.binderId = null;
        }

        const isDecks = change.table === 'decks';
        const storedEntries = isDecks ? await entriesOf(tx, [...stored.keys()]) : new Map();

        for (const row of pushed) {
          const before = stored.get(row.id);
          const list = pushedEntries.get(row.id) ?? [];
          const old = before ? toRow(before) : null;
          const same =
            !!old &&
            !!old.deletedAt === !!row.deletedAt &&
            JSON.stringify(values(old)) === JSON.stringify(values(row)) &&
            (!isDecks || listKey(storedEntries.get(row.id) ?? []) === listKey(list));
          const r: SyncResolution = resolvePush(old && { ...old, same }, row);

          if (r.action === 'conflict') {
            conflict(change.table, old);
            if (isDecks)
              for (const e of storedEntries.get(row.id) ?? []) conflict('deck_entries', e);
            continue;
          }
          applied.push({ table: change.table, id: row.id, updatedAt: r.updatedAt });
          if (r.action === 'noop' || r.action === 'skip') continue;

          const set = {
            ...values(row),
            updatedAt: new Date(r.updatedAt),
            deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
          };
          writing = `${change.table} ${row.id}`;
          if (r.action === 'insert')
            await tx.insert(table).values({ ...set, id: row.id, userId } as never);
          else
            await tx
              .update(table)
              .set(set as never)
              .where(eq(table.id, row.id));

          if (change.table === 'binders' && row.deletedAt)
            await tx
              .update(collectionEntries)
              .set({ binderId: null, updatedAt: sql`now()` })
              .where(
                and(eq(collectionEntries.binderId, row.id), eq(collectionEntries.userId, userId)),
              );
          if (isDecks && !row.deletedAt) {
            await checkDeckEntries(tx, row.game as DeckGame, list);
            await tx.delete(deckEntries).where(eq(deckEntries.deckId, row.id));
            if (list.length) await tx.insert(deckEntries).values(list);
          }
        }
      }
      return { applied, conflicts: grouped(conflicts) };
    });
  } catch (err) {
    const pg = pgError(err);
    if (pg.code === '23503') throw notFound('Print');
    const rule = UNIQUE_RULES[pg.constraint ?? ''];
    if (pg.code === '23505' && rule)
      throw new HTTPException(409, { message: `${writing}: ${rule}` });
    throw err;
  }
}

/**
 * `GET /sync/pull`: the user's rows with `sync_seq > since`, tombstones included, the lowest
 * first across the tables, `limit` of them (each deck with its whole list, fewer rows once the
 * lists pass `SYNC_DECK_ENTRIES_TOTAL`). Holds the per-user lock exclusively, so every write of
 * the user in flight has committed: no row can appear later with a `sync_seq` below the cursor.
 */
export async function syncPull(
  db: NodePgDatabase,
  userId: string,
  { since, limit }: SyncPullQuery,
): Promise<SyncPullResponse> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(userId)})`);
    const tables = SYNC_TABLES.filter((t): t is RowTable => t !== 'deck_entries');
    const found: { table: RowTable; seq: number; row: Row }[] = [];
    for (const name of tables) {
      const { table, toRow } = tableOf(name);
      const rows = (await tx
        .select()
        .from(table)
        .where(and(eq(table.userId, userId), gt(table.syncSeq, since)))
        .orderBy(asc(table.syncSeq))
        .limit(limit + 1)) as Stored[];
      for (const r of rows) found.push({ table: name, seq: r.syncSeq, row: toRow(r) });
    }
    found.sort((a, b) => a.seq - b.seq);
    const candidates = found.slice(0, limit);
    // Every deck brings its whole list: stop once rows and lists pass the budget, one row always.
    const candidateDecks = candidates.filter((f) => f.table === 'decks').map((f) => f.row.id);
    const sizes = new Map(
      candidateDecks.length
        ? (
            await tx
              .select({ deckId: deckEntries.deckId, n: count() })
              .from(deckEntries)
              .where(inArray(deckEntries.deckId, candidateDecks))
              .groupBy(deckEntries.deckId)
          ).map((r) => [r.deckId, r.n])
        : [],
    );
    const page: typeof found = [];
    let size = 0;
    for (const f of candidates) {
      size += 1 + (f.table === 'decks' ? (sizes.get(f.row.id) ?? 0) : 0);
      if (page.length && size > SYNC_DECK_ENTRIES_TOTAL) break;
      page.push(f);
    }
    const rows = new Map<SyncTable, unknown[]>();
    for (const f of page) rows.set(f.table, [...(rows.get(f.table) ?? []), f.row]);
    const deckIds = page.filter((f) => f.table === 'decks').map((f) => f.row.id);
    const lists = await entriesOf(tx, deckIds);
    rows.set(
      'deck_entries',
      deckIds.flatMap((id) => lists.get(id) ?? []),
    );
    return {
      changes: grouped(rows),
      cursor: page.at(-1)?.seq ?? since,
      more: found.length > page.length,
    };
  });
}
