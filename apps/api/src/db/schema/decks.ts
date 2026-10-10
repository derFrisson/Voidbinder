import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { cards, games, prints } from './catalog';

// Decks (VB-34), shaped for the Sprint 3 sync engine like the collection (VB-31): the client
// generates `id`, the server sets `updated_at` on every write (entries included), and a delete
// sets `deleted_at` instead of removing the row. Entries are replaced as a whole, so they have no
// tombstone of their own: the deck's `updated_at` says the list changed.

export const decks = pgTable(
  'decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    name: text('name').notNull(),
    format: text('format').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('decks_user_id_live_idx')
      .on(t.userId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const deckEntries = pgTable(
  'deck_entries',
  {
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    /** The preferred print; null: any. */
    printId: uuid('print_id').references(() => prints.id),
    zone: text('zone').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deckId, t.cardId, t.zone] }),
    check('deck_entries_zone_check', sql`${t.zone} in ('main', 'extra', 'side', 'commander')`),
    check('deck_entries_quantity_check', sql`${t.quantity} > 0`),
  ],
);
