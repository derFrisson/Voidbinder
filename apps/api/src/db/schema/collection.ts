import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { games, prints } from './catalog';

// The collection (VB-31), shaped for the Sprint 3 sync engine: the client generates `id`, the
// server sets `updated_at` on every write, and a delete sets `deleted_at` (a tombstone) instead
// of removing the row. Reads filter `deleted_at is null`.

const syncColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
    uniqueIndex('binders_user_id_name_live_key')
      .on(t.userId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const collectionEntries = pgTable(
  'collection_entries',
  {
    ...syncColumns,
    printId: uuid('print_id')
      .notNull()
      .references(() => prints.id),
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
    // One live wish per print, language and finish; null ("any") counts as one value.
    uniqueIndex('wishlist_entries_user_print_lang_finish_live_key')
      .on(t.userId, t.printId, sql`coalesce(${t.language}, '')`, sql`coalesce(${t.finish}, '')`)
      .where(sql`${t.deletedAt} is null`),
    check('wishlist_entries_quantity_check', sql`${t.quantity} > 0`),
    check('wishlist_entries_min_condition_check', sql`${t.minCondition} in ${CONDITIONS}`),
    check('wishlist_entries_currency_check', sql`${t.currency} in ${CURRENCIES}`),
  ],
);
