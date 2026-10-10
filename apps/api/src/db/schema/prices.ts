import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { games, prints } from './catalog';

// Prices (VB-30, ADR 0003): integer cents with a currency on every row, a source and the time the
// source observed them. `prices_daily` becomes a TimescaleDB hypertable where the extension exists
// (drizzle/0004_prices.sql); in plain PostgreSQL it stays an ordinary table.

/** 'tcgplayer' (TCGCSV), 'cardmarket' (Scryfall), 'tcgplayer_scryfall', seeded by the migration. */
export const priceSources = pgTable('price_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
});

/**
 * Which external product (and finish) is which print. `method`: 'scryfall_id' (the source's own
 * id, confidence 100), 'number_match' (set + number, 70), 'region_match' (a Yu-Gi-Oh! regional
 * print priced by the EN product, 60), 'name_match' (set + name, 40), 'manual' (an admin
 * override, 100; the importers never overwrite it). One product may price several prints
 * (VB-110: `LOB-001`, `LOB-E001` and `LOB-EN001` all take TCGplayer's `LOB-EN001`).
 */
export const priceMappings = pgTable(
  'price_mappings',
  {
    printId: uuid('print_id')
      .notNull()
      .references(() => prints.id, { onDelete: 'cascade' }),
    source: text('source')
      .notNull()
      .references(() => priceSources.id),
    externalId: text('external_id').notNull(),
    finish: text('finish').notNull(),
    /** The language of the copies the price is for (VB-103); 'en' for TCGplayer. */
    lang: text('lang').notNull().default('en'),
    confidence: smallint('confidence').notNull(),
    method: text('method').notNull(),
    /** User id or 'admin' for a manual mapping. */
    overriddenBy: text('overridden_by'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.printId, t.source, t.finish, t.lang] }),
    index('price_mappings_source_external_id_finish_lang_idx').on(
      t.source,
      t.externalId,
      t.finish,
      t.lang,
    ),
    check('price_mappings_confidence_check', sql`${t.confidence} between 0 and 100`),
    check(
      'price_mappings_method_check',
      sql`${t.method} in ('scryfall_id', 'number_match', 'region_match', 'name_match', 'manual')`,
    ),
  ],
);

/** The latest price per print, finish, source and language. */
export const pricesCurrent = pgTable(
  'prices_current',
  {
    printId: uuid('print_id')
      .notNull()
      .references(() => prints.id, { onDelete: 'cascade' }),
    finish: text('finish').notNull(),
    source: text('source')
      .notNull()
      .references(() => priceSources.id),
    /** The language of the copies the price is for (VB-103); 'en' for TCGplayer. */
    lang: text('lang').notNull().default('en'),
    currency: text('currency').notNull(),
    centsMarket: integer('cents_market').notNull(),
    centsLow: integer('cents_low'),
    centsMid: integer('cents_mid'),
    centsHigh: integer('cents_high'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.printId, t.finish, t.source, t.lang] })],
);

/**
 * One row per print, finish, source, language and UTC day (`observed_at` is that day's midnight). No foreign
 * keys: it is a hypertable with compressed chunks where TimescaleDB exists.
 */
export const pricesDaily = pgTable(
  'prices_daily',
  {
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    printId: uuid('print_id').notNull(),
    finish: text('finish').notNull(),
    source: text('source').notNull(),
    /** The language of the copies the price is for (VB-103); 'en' for TCGplayer. */
    lang: text('lang').notNull().default('en'),
    currency: text('currency').notNull(),
    centsMarket: integer('cents_market').notNull(),
    centsLow: integer('cents_low'),
    centsHigh: integer('cents_high'),
  },
  (t) => [primaryKey({ columns: [t.printId, t.finish, t.source, t.lang, t.observedAt] })],
);

/** Condition → share of the near-mint price. Estimates, never observed prices. */
export const conditionMultipliers = pgTable(
  'condition_multipliers',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    condition: text('condition').notNull(),
    factor: numeric('factor', { precision: 4, scale: 3 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.condition] }),
    check(
      'condition_multipliers_condition_check',
      sql`${t.condition} in ('NM', 'EX', 'GD', 'LP', 'PL', 'PO')`,
    ),
  ],
);
