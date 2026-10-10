import { z } from 'zod';
import {
  NewEntrySchema,
  NewWishSchema,
  UpdateBinderRequestSchema,
  UpdateEntryRequestSchema,
  UpdateWishRequestSchema,
} from './collection.js';
import {
  DECK_FORMATS,
  DeckEntryInputSchema,
  DeckGameSchema,
  UpdateDeckRequestSchema,
} from './decks.js';

// The sync protocol (`/sync/**`, VB-32, ADR 0005): a device pushes its local changes as full rows
// and pulls every row that changed since its cursor. The rows carry the same fields as the REST
// routes; `updatedAt` is the edit time, `deletedAt` the tombstone.

/** The synced tables, in the order a batch is applied: a row's parent before the row. */
export const SYNC_TABLES = [
  'binders',
  'collection_entries',
  'wishlist_entries',
  'decks',
  'deck_entries',
] as const;
export const SyncTableSchema = z.enum(SYNC_TABLES);
export type SyncTable = z.infer<typeof SyncTableSchema>;

/** Rows per push (deck entries aside) and per pull page. */
export const SYNC_LIMIT = 500;
/** Entries of one deck in a push, as `PUT /decks/:id/entries`. */
export const SYNC_DECK_ENTRIES_LIMIT = 500;
/**
 * Deck entries of all decks in one push; a pull page stops adding rows once they and their decks'
 * entries pass it (one row always fits, so a deck with a full list still pages).
 */
export const SYNC_DECK_ENTRIES_TOTAL = 5000;

const Timestamp = z.iso.datetime({ offset: true });

/** What every synced row has besides its fields. */
const Stamp = {
  id: z.uuid(),
  /** The edit time (the client's clock on a push, the stored value on a pull). */
  updatedAt: Timestamp,
  /** Set: the row is deleted (a tombstone). */
  deletedAt: Timestamp.nullable(),
};
/** What a pushed row adds: the `updatedAt` the client last pulled; null for a row it created. */
const Base = { baseUpdatedAt: Timestamp.nullable() };

export const SyncBinderSchema = UpdateBinderRequestSchema.required().extend({
  ...Stamp,
  position: z.number().int().min(0).max(100_000),
});
export const SyncCollectionEntrySchema = UpdateEntryRequestSchema.required().extend({
  ...Stamp,
  printId: NewEntrySchema.shape.printId,
});
export const SyncWishlistEntrySchema = UpdateWishRequestSchema.required().extend({
  ...Stamp,
  printId: NewWishSchema.shape.printId,
});
const DeckRow = UpdateDeckRequestSchema.required().extend({ ...Stamp, game: DeckGameSchema });
/** The format must be one of the deck's game (`DECK_FORMATS`). */
const gameFormat = <T extends z.ZodType<{ game: keyof typeof DECK_FORMATS; format: string }>>(
  s: T,
) =>
  s.refine((d) => (DECK_FORMATS[d.game] as readonly string[]).includes(d.format), {
    message: 'Unknown format for this game',
    path: ['format'],
  });
export const SyncDeckSchema = gameFormat(DeckRow);
/** One line of a deck; a deck's lines always travel together with its row (the whole list). */
export const SyncDeckEntrySchema = DeckEntryInputSchema.extend({
  deckId: z.uuid(),
  printId: z.uuid().nullable(),
});

export type SyncBinder = z.infer<typeof SyncBinderSchema>;
export type SyncCollectionEntry = z.infer<typeof SyncCollectionEntrySchema>;
export type SyncWishlistEntry = z.infer<typeof SyncWishlistEntrySchema>;
export type SyncDeck = z.infer<typeof SyncDeckSchema>;
export type SyncDeckEntry = z.infer<typeof SyncDeckEntrySchema>;

/** A pull page or the server's side of a conflict: rows of one table. */
export const SyncChangeSchema = z.discriminatedUnion('table', [
  z.object({ table: z.literal('binders'), rows: z.array(SyncBinderSchema) }),
  z.object({ table: z.literal('collection_entries'), rows: z.array(SyncCollectionEntrySchema) }),
  z.object({ table: z.literal('wishlist_entries'), rows: z.array(SyncWishlistEntrySchema) }),
  z.object({ table: z.literal('decks'), rows: z.array(SyncDeckSchema) }),
  z.object({ table: z.literal('deck_entries'), rows: z.array(SyncDeckEntrySchema) }),
]);
export type SyncChange = z.infer<typeof SyncChangeSchema>;

/** Pushed rows of one table. */
export const SyncPushChangeSchema = z.discriminatedUnion('table', [
  z.strictObject({
    table: z.literal('binders'),
    rows: z.array(SyncBinderSchema.extend(Base).strict()),
  }),
  z.strictObject({
    table: z.literal('collection_entries'),
    rows: z.array(SyncCollectionEntrySchema.extend(Base).strict()),
  }),
  z.strictObject({
    table: z.literal('wishlist_entries'),
    rows: z.array(SyncWishlistEntrySchema.extend(Base).strict()),
  }),
  z.strictObject({
    table: z.literal('decks'),
    rows: z.array(gameFormat(DeckRow.extend(Base).strict())),
  }),
  z.strictObject({ table: z.literal('deck_entries'), rows: z.array(SyncDeckEntrySchema.strict()) }),
]);
export type SyncPushChange = z.infer<typeof SyncPushChangeSchema>;

const rowKey = (
  table: string,
  r: { id?: string; deckId?: string; cardId?: string; zone?: string },
) => (table === 'deck_entries' ? `${table}:${r.deckId}:${r.cardId}:${r.zone}` : `${table}:${r.id}`);

/**
 * `POST /sync/push`: the device's changes, at most `SYNC_LIMIT` rows (deck entries aside: at most
 * `SYNC_DECK_ENTRIES_LIMIT` per deck and `SYNC_DECK_ENTRIES_TOTAL` in all). A
 * deck's entries are its whole list and need the deck's row in the same push; a deck row without
 * entries means an empty list.
 */
export const SyncPushRequestSchema = z
  .strictObject({ changes: z.array(SyncPushChangeSchema) })
  .refine(
    (b) =>
      b.changes.reduce((n, c) => n + (c.table === 'deck_entries' ? 0 : c.rows.length), 0) <=
      SYNC_LIMIT,
    `At most ${SYNC_LIMIT} rows per push`,
  )
  .refine((b) => {
    const keys = b.changes.flatMap((c) => c.rows.map((r) => rowKey(c.table, r)));
    return new Set(keys).size === keys.length;
  }, 'A row appears once per push (a card once per deck and zone)')
  .refine((b) => {
    const perDeck = new Map<string, number>();
    for (const c of b.changes)
      if (c.table === 'deck_entries')
        for (const r of c.rows) perDeck.set(r.deckId, (perDeck.get(r.deckId) ?? 0) + 1);
    return [...perDeck.values()].every((n) => n <= SYNC_DECK_ENTRIES_LIMIT);
  }, `At most ${SYNC_DECK_ENTRIES_LIMIT} entries per deck`)
  .refine(
    (b) =>
      b.changes.reduce((n, c) => n + (c.table === 'deck_entries' ? c.rows.length : 0), 0) <=
      SYNC_DECK_ENTRIES_TOTAL,
    `At most ${SYNC_DECK_ENTRIES_TOTAL} deck entries per push`,
  );
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

/**
 * `POST /sync/push` answer. `applied`: the rows the server now holds as pushed (written, or
 * equal already), with the `updatedAt` to send as `baseUpdatedAt` next time. `conflicts`: the
 * server kept its row; replace the local copy with it (a deck comes with its entries).
 */
export const SyncPushResponseSchema = z.object({
  applied: z.array(
    z.object({
      table: SyncTableSchema.exclude(['deck_entries']),
      id: z.uuid(),
      updatedAt: Timestamp,
    }),
  ),
  conflicts: z.array(SyncChangeSchema),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

/** `GET /sync/pull?since=&limit=`: rows changed after the cursor `since` (0: everything). */
export const SyncPullQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_LIMIT).default(SYNC_LIMIT),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;

/**
 * `GET /sync/pull` answer: up to `limit` rows (deck entries aside: every deck comes with its whole
 * list; the page ends early once rows and lists pass `SYNC_DECK_ENTRIES_TOTAL`), tombstones
 * included, in table order. `cursor` is the next `since`; `more`: pull again.
 */
export const SyncPullResponseSchema = z.object({
  changes: z.array(SyncChangeSchema),
  cursor: z.number().int(),
  more: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;
