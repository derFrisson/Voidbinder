import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { games, prints } from './catalog';

// The collection (VB-31), shaped for the sync engine: the client generates `id` and the server
// sets `updated_at` on every write. A delete removes the row at once and logs `(table, id)` in
// `sync_deletions` (VB-75). `deleted_at` is no longer written or read (every row has it null);
// it goes in a later release.

/**
 * The sync cursor (VB-32, ADR 0005): every insert and update of a synced row takes the next value
 * in the trigger `sync_stamp()` (drizzle/0008_sync.sql), so `GET /sync/pull?since=` finds what
 * changed. The trigger also holds a per-user lock that `pull` waits on (see the migration).
 */
export const syncSeq = pgSequence('sync_seq');

/** `sync_seq` of a synced table; the trigger overwrites the default on every write. */
export const syncSeqColumn = () =>
  bigint('sync_seq', { mode: 'number' })
    .notNull()
    .default(sql`nextval('sync_seq')`);

const syncColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  syncSeq: syncSeqColumn(),
};

const CONDITIONS = sql.raw(`('MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO')`);
const CURRENCIES = sql.raw(`('EUR', 'USD')`);

export const binders = pgTable(
  'binders',
  {
    ...syncColumns,
    name: text('name').notNull(),
    gameId: text('game_id').references(() => games.id),
    position: integer('position').notNull().default(0),
    colour: text('colour'),
  },
  (t) => [
    index('binders_user_id_sync_seq_idx').on(t.userId, t.syncSeq),
    uniqueIndex('binders_user_id_name_key').on(t.userId, t.name),
  ],
);

export const collectionEntries = pgTable(
  'collection_entries',
  {
    ...syncColumns,
    printId: uuid('print_id')
      .notNull()
      .references(() => prints.id),
    /**
     * Its foreign key is DEFERRABLE (drizzle/0009_sync_deletions.sql; Drizzle cannot say so): a
     * push deletes a binder in order and moves its entries out at the end (VB-75).
     */
    binderId: uuid('binder_id').references(() => binders.id),
    quantity: integer('quantity').notNull(),
    language: text('language').notNull(),
    condition: text('condition').notNull(),
    finish: text('finish').notNull(),
    purchasePriceCents: integer('purchase_price_cents'),
    purchaseCurrency: text('purchase_currency'),
    note: text('note'),
  },
  (t) => [
    index('collection_entries_user_id_sync_seq_idx').on(t.userId, t.syncSeq),
    index('collection_entries_user_id_print_id_idx').on(t.userId, t.printId),
    index('collection_entries_binder_id_idx').on(t.binderId),
    check('collection_entries_quantity_check', sql`${t.quantity} > 0`),
    check('collection_entries_condition_check', sql`${t.condition} in ${CONDITIONS}`),
    check(
      'collection_entries_purchase_currency_check',
      sql`${t.purchaseCurrency} in ${CURRENCIES}`,
    ),
  ],
);

export const wishlistEntries = pgTable(
  'wishlist_entries',
  {
    ...syncColumns,
    printId: uuid('print_id')
      .notNull()
      .references(() => prints.id),
    quantity: integer('quantity').notNull(),
    /** null: any language. */
    language: text('language'),
    /** null: any finish. */
    finish: text('finish'),
    /** null: any condition; else the worst one accepted (the mockup's "ab NM"). */
    minCondition: text('min_condition'),
    maxPriceCents: integer('max_price_cents'),
    currency: text('currency'),
    note: text('note'),
  },
  (t) => [
    index('wishlist_entries_user_id_sync_seq_idx').on(t.userId, t.syncSeq),
    // One wish per print, language and finish; null ("any") counts as one value.
    uniqueIndex('wishlist_entries_user_print_lang_finish_key').on(
      t.userId,
      t.printId,
      sql`coalesce(${t.language}, '')`,
      sql`coalesce(${t.finish}, '')`,
    ),
    check('wishlist_entries_quantity_check', sql`${t.quantity} > 0`),
    check('wishlist_entries_min_condition_check', sql`${t.minCondition} in ${CONDITIONS}`),
    check('wishlist_entries_currency_check', sql`${t.currency} in ${CURRENCIES}`),
  ],
);

/**
 * The deletion log (VB-75, ADR 0005): a deleted binder, entry, wish or deck leaves only its
 * `(table, id)` here, so `GET /sync/pull` can tell other devices; no content. `sync_seq` is
 * stamped by `sync_stamp()` like the synced tables (same per-user lock). `deleted_at` is the
 * delete's time (a device's clock for a pushed delete), compared with edits; `logged_at` is when
 * the server wrote it, and the daily sweep removes rows older than `SYNC_DELETION_RETENTION_DAYS`
 * by it. A deck's entries go with the deck and are not logged.
 */
export const syncDeletions = pgTable(
  'sync_deletions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    table: text('table').notNull(),
    id: uuid('id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
    syncSeq: syncSeqColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.table, t.id] }),
    index('sync_deletions_user_id_sync_seq_idx').on(t.userId, t.syncSeq),
    index('sync_deletions_logged_at_idx').on(t.loggedAt),
    check(
      'sync_deletions_table_check',
      sql`${t.table} in ('binders', 'collection_entries', 'wishlist_entries', 'decks')`,
    ),
  ],
);
